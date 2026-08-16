import { db, nextVersionNumber } from "./db.ts";
import type { JobRow, VersionRow } from "./db.ts";
import { genDir, listProjects, withProject } from "./project.ts";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { runWorker, runWorkerGenerate, checkChatgptBrowserAlive, restartChatgptBrowser } from "./worker.ts";
import { runWorkerCodex } from "./worker-codex.ts";
import { generateEdit } from "./higgsfield.ts";

// Backend selection: WORKER_BACKEND=codex uses Codex CLI (OAuth, no Chrome/CDP,
// no ban risk); anything else keeps the original ChatGPT-web CDP worker.
const WORKER_BACKEND = (process.env.WORKER_BACKEND ?? "cdp").toLowerCase();
const runActiveWorker = WORKER_BACKEND === "codex" ? runWorkerCodex : runWorker;

export function enqueueJob(
  photoId: string,
  prompt: string,
  configJson: string | null = null,
  provider: "chatgpt" | "higgsfield" = "chatgpt",
  providerParams: string | null = null,
  mode: "edit" | "generate" = "edit",
  inputPath: string | null = null,
  /** JSON array of extra reference images to attach (storyboard characters). */
  refPaths: string | null = null,
): JobRow {
  const now = Date.now();
  const result = db().run(
    `INSERT INTO jobs (photo_id, prompt, config, provider, provider_params, mode, input_path, ref_paths, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [photoId, prompt, configJson, provider, providerParams, mode, inputPath, refPaths, now],
  );
  const id = Number(result.lastInsertRowid);
  return db()
    .query<JobRow, [number]>("SELECT * FROM jobs WHERE id = ?")
    .get(id) as JobRow;
}

/** Reference images stored on a job, tolerating corrupt/legacy values. Files
 *  that vanished are dropped here rather than failing the job downstream. */
export function parseRefPaths(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && existsSync(p));
  } catch {
    return [];
  }
}

export function listJobs(limit = 100): JobRow[] {
  // Dismissed (seen) failed/cancelled jobs stay in the DB as a log but drop out
  // of the panel so old failures don't pile up in front of the thumbnails.
  //
  // Un fallimento SUPERATO non è più un fallimento: se per quella foto esiste
  // un job più recente andato a buon fine (o ancora in corso), il vecchio
  // errore non deve tornare in lista. Senza questa clausola bastava il LIMIT a
  // mentire — i failed sono ordinati prima dei done, quindi la riga rossa
  // entrava nella finestra e il successo che la smentiva restava fuori: la
  // griglia marcava come "fallita" una foto in realtà rigenerata bene.
  return db()
    .query<JobRow, [number]>(
      `SELECT * FROM jobs j
       WHERE NOT (seen = 1 AND status IN ('failed','cancelled'))
         AND NOT (
           j.status IN ('failed','cancelled')
           AND EXISTS (
             SELECT 1 FROM jobs k
              WHERE k.photo_id = j.photo_id
                AND k.id > j.id
                AND k.status IN ('done','running','pending')
           )
         )
       ORDER BY
         CASE status WHEN 'running' THEN 0 WHEN 'pending' THEN 1
                     WHEN 'failed' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
         id DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function jobsSummary() {
  const rows = db()
    .query<{ status: string; n: number }, []>(
      "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status",
    )
    .all();
  const out: Record<string, number> = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function markJobSeen(jobId: number): boolean {
  return db().run("UPDATE jobs SET seen=1 WHERE id=?", [jobId]).changes > 0;
}

/** Bulk-dismiss every failed/cancelled job from the panel ("scarta falliti").
 *  Keeps them in the DB (retention log); listJobs just stops surfacing them. */
export function markAllFailedSeen(): number {
  return db().run(
    "UPDATE jobs SET seen=1 WHERE status IN ('failed','cancelled') AND seen=0",
  ).changes;
}

export function listJobsForPhoto(photoId: string, limit = 30): JobRow[] {
  return db()
    .query<JobRow, [string, number]>(
      "SELECT * FROM jobs WHERE photo_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(photoId, limit);
}

export function cancelPending(jobId: number): boolean {
  const r = db().run(
    "UPDATE jobs SET status='cancelled', finished_at=? WHERE id=? AND status='pending'",
    [Date.now(), jobId],
  );
  return r.changes > 0;
}

// ---- Runner loop -----------------------------------------------------------

let runnerStarted = false;
let runnerStopping = false;

// Rate-limit handling: after N consecutive "no image" timeouts (silent ChatGPT
// image-gen cap) we pause the queue and auto-resume after a cooldown.
const RATE_LIMIT_THRESHOLD = 3;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
let consecutiveTimeouts = 0;
let pausedUntilMs = 0;
// Guard against an unrecoverable browser: after too many restarts in a row
// without a successful job, back off long instead of hammering kill+relaunch.
let consecutiveBrowserRestarts = 0;
const MAX_BROWSER_RESTARTS = 3;
// Guard against a single photo ChatGPT silently refuses to render (always
// returns "waiting", no explicit rate-limit): skip it after this many attempts
// so it stops blocking the rest of the queue. Tracks the last photo to time out
// so we can tell a stuck-photo (same id looping) from a global silent throttle
// (different ids failing in a row → pause instead of skip).
const MAX_JOB_ATTEMPTS = 6;
let lastTimeoutPhotoId = "";
// If several DIFFERENT photos hit the attempt cap back-to-back, it's a global
// silent throttle (not individual bad photos): pause and keep the photos rather
// than marking them all failed. A lone bad photo skips after one cap hit.
let consecutiveSkips = 0;

export function getRunnerStatus() {
  return {
    paused: Date.now() < pausedUntilMs,
    paused_until: pausedUntilMs || null,
    consecutive_timeouts: consecutiveTimeouts,
  };
}

function looksLikeRateLimit(error: string): boolean {
  return /no image in \d+s/i.test(error);
}

/** Browser/CDP/worker-process transient failures — not the job's fault, retry. */
function looksLikeBrowserDown(error: string): boolean {
  return /connection refused|econnrefused|urlopen error|inspected target navigated or closed|cannot find context|no close frame|websocket|chrome did not|browser not|composer not found|exited 137|exited 143|exited \d+ without JSON|^$/i.test(
    error,
  );
}

/** Parse ChatGPT's reset-time hint embedded in the worker error.
 *  Examples we may see (from edit_batch.py):
 *   - "reset_hint=try again at 9:31 AM"
 *   - "reset_hint=riprova alle 21:57"
 *   - "reset_hint=available again in 42 minutes"
 *   - "reset_hint=in 2 hours"
 *  Returns absolute epoch ms or null if no hint. */
function parseResetHint(error: string): number | null {
  const m = error.match(/reset_hint=([^:]+?)(?=$|::)/i);
  if (!m || !m[1]) return null;
  const hint = m[1].trim();
  const now = new Date();

  // "in N minutes / hours / ore / minuti"
  const rel = hint.match(/(\d+)\s*(minute|minuti|min|hour|hours|ore|ora)/i);
  if (rel && rel[1] && rel[2]) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const mins = /hour|ore|ora/.test(unit) ? n * 60 : n;
    return now.getTime() + mins * 60 * 1000;
  }

  // "at 9:31 AM" / "alle 21:57"
  const t = hint.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (t && t[1] && t[2]) {
    let h = Number(t[1]);
    const m2 = Number(t[2]);
    const ampm = (t[3] || "").toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const target = new Date(now);
    target.setHours(h, m2, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime();
  }
  return null;
}

// Generation log retention: terminal jobs (done/failed/cancelled) are kept as a
// browsable log but pruned after this window so the table doesn't grow forever.
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni

export function cleanupJobs(): { expired: number; orphaned: number } {
  // Drop jobs whose photo no longer exists (e.g. photo deleted) — these would
  // otherwise surface stale, untraceable errors.
  const orphaned = db().run(
    "DELETE FROM jobs WHERE photo_id NOT IN (SELECT id FROM photos)",
  ).changes;
  // Drop old terminal jobs past the retention window.
  const expired = db().run(
    `DELETE FROM jobs
     WHERE status IN ('done','failed','cancelled')
       AND COALESCE(finished_at, created_at) < ?`,
    [Date.now() - JOB_RETENTION_MS],
  ).changes;
  if (orphaned || expired) {
    console.log(`[jobs] cleanup: ${orphaned} orfani, ${expired} scaduti (>7gg)`);
  }
  return { expired, orphaned };
}

/** Run a fn once per registered project, each within its own project context.
 *  Used for cross-project maintenance (reclaim, retention cleanup). */
function forEachProject(fn: () => void) {
  for (const p of listProjects()) withProject(p.id, fn);
}

export function startRunner() {
  if (runnerStarted) return;
  runnerStarted = true;
  // Reclaim orphaned jobs that were marked 'running' when the server died —
  // across every project (each keeps its jobs in its own DB).
  forEachProject(() => {
    const reclaimed = db().run(
      "UPDATE jobs SET status='pending', started_at=NULL WHERE status='running'",
    ).changes;
    if (reclaimed > 0) console.log(`[jobs] reclaimed ${reclaimed} orphaned running job(s)`);
    cleanupJobs();
  });
  // Re-run retention hourly while the server is alive.
  setInterval(() => forEachProject(cleanupJobs), 60 * 60 * 1000).unref?.();
  // Defer the processing loop to the next macrotask so it can never run during
  // module top-level evaluation — otherwise a reclaimed job picked up on boot
  // would start a worker before the HTTP server binds, and a wedged worker
  // (e.g. dead ChatGPT browser) could block startup entirely.
  setTimeout(() => void loop(), 0);
}

export function stopRunner() {
  runnerStopping = true;
}

async function loop() {
  while (!runnerStopping) {
    const now = Date.now();
    if (now < pausedUntilMs) {
      await sleep(5000);
      continue;
    }
    const next = pickNextPending();
    if (!next) {
      await sleep(1500);
      continue;
    }
    // Process the job in ITS project's context so db()/genDir() resolve there.
    await withProject(next.pid, () => processJob(next.job));
  }
}

// Pick the globally-oldest pending job across all active projects. The single
// shared ChatGPT account means generation is inherently serialized, so one
// runner draining every project's queue in created_at order is the right model.
function pickNextPending(): { pid: string; job: JobRow } | null {
  let best: { pid: string; job: JobRow } | null = null;
  for (const p of listProjects()) {
    if (!p.active) continue;
    const job = withProject(p.id, () =>
      db()
        .query<JobRow, []>(
          "SELECT * FROM jobs WHERE status='pending' ORDER BY created_at ASC, id ASC LIMIT 1",
        )
        .get(),
    );
    if (job && (!best || job.created_at < best.job.created_at)) {
      best = { pid: p.id, job };
    }
  }
  return best;
}

function setProgress(jobId: number, text: string) {
  db().run("UPDATE jobs SET progress=? WHERE id=?", [text.slice(0, 200), jobId]);
}

const HIGGSFIELD_STEP_LABELS: Record<string, string> = {
  upload: "Carico immagine…",
  generate: "Genero…",
  poll: "In elaborazione…",
  download: "Scarico risultato…",
};

async function processJob(job: JobRow) {
  const startedAt = Date.now();
  // Atomic claim: if another runner already took this job (changes===0), bail.
  // Prevents two server instances from double-processing the same job and
  // racing on the shared ChatGPT browser (which corrupts image↔photo mapping).
  // Also bumps the attempt counter and records the first start, so the log can
  // show real total elapsed and how many retries a job needed.
  const claimed = db().run(
    `UPDATE jobs
     SET status='running', started_at=?, progress=?,
         attempts = attempts + 1,
         first_started_at = COALESCE(first_started_at, ?)
     WHERE id=? AND status='pending'`,
    [startedAt, "Avvio…", startedAt, job.id],
  ).changes;
  if (claimed === 0) return;

  // Look up the photo source path
  const photo = db()
    .query<
      { id: string; original_path: string; kind: string },
      [string]
    >("SELECT id, original_path, kind FROM photos WHERE id = ?")
    .get(job.photo_id);

  if (!photo) {
    fail(job.id, `photo not found: ${job.photo_id}`);
    return;
  }

  const isGenerate = job.mode === "generate";
  // Edit input: an override (bake multi-pass working image) wins over the source.
  const editInput = job.input_path ?? photo.original_path;

  const versionNumber = nextVersionNumber(photo.id);
  const photoGenDir = join(genDir(), photo.id);
  if (!existsSync(photoGenDir)) mkdirSync(photoGenDir, { recursive: true });
  const outputPath = join(
    photoGenDir,
    `v${String(versionNumber).padStart(2, "0")}.png`,
  );

  // Higgsfield provider: own pipeline (MCP), no CDP/rate-limit logic.
  if (job.provider === "higgsfield") {
    try {
      const pp = job.provider_params
        ? (JSON.parse(job.provider_params) as {
            model: string;
            params?: Record<string, unknown>;
          })
        : { model: "nano_banana_2" };
      const hfResult = await generateEdit({
        imagePath: editInput,
        prompt: job.prompt,
        model: pp.model,
        params: pp.params ?? {},
        outputPath,
        onLog: (m) => {
          console.log(`[higgsfield][job ${job.id}] ${m}`);
          const step = m.split(" ")[0] ?? "";
          setProgress(job.id, HIGGSFIELD_STEP_LABELS[step] ?? m);
        },
      });
      if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
        fail(job.id, `output missing or too small: ${outputPath}`);
        return;
      }
      const ins = db().run(
        `INSERT INTO versions
          (photo_id, version_number, image_path, prompt_used, config, provider, provider_params, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, ?, 'generated', ?)`,
        [photo.id, versionNumber, outputPath, job.prompt, job.config, job.provider_params, hfResult.credits, Date.now()],
      );
      db().run(
        "UPDATE jobs SET status='done', result_version_id=?, finished_at=? WHERE id=?",
        [Number(ins.lastInsertRowid), Date.now(), job.id],
      );
    } catch (err) {
      fail(job.id, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  try {
    setProgress(job.id, isGenerate ? "Genero…" : "Invio a ChatGPT…");
    // Generation has no source image — always via the ChatGPT-web pipeline
    // (skips upload). Editing honors the selected backend (cdp | codex).
    const refs = parseRefPaths(job.ref_paths);
    const result = isGenerate
      ? await runWorkerGenerate({ prompt: job.prompt, output: outputPath, refs })
      : await runActiveWorker({
          image: editInput,
          prompt: job.prompt,
          output: outputPath,
          refs,
        });

    if (result.status !== "ok") {
      const err = result.error ?? "unknown worker error";
      // Browser/CDP down (e.g. user closed the ChatGPT window): every job would
      // fail instantly with "Connection refused" and nuke the whole queue. Treat
      // it as transient — requeue this job and pause briefly so the queue waits
      // for the browser to come back instead of mass-failing.
      if (looksLikeBrowserDown(err)) {
        // The browser is either gone (user closed it) OR its renderer is hung
        // (HTTP endpoint up, every eval times out → empty/timeout error). A soft
        // relaunch can't recover a wedged page, so when the deep aliveness check
        // (page eval) fails we hard-restart: kill + relaunch. Profile is
        // persistent, so after the first login this is unattended.
        let recovered = false;
        if (WORKER_BACKEND !== "codex" && !(await checkChatgptBrowserAlive())) {
          if (consecutiveBrowserRestarts >= MAX_BROWSER_RESTARTS) {
            // Repeated restarts aren't helping (login lost, Cloudflare wall,
            // crash loop). Back off long and stop hammering; needs a human.
            pausedUntilMs = Date.now() + 15 * 60 * 1000;
            console.log(`[jobs] browser unrecoverable after ${consecutiveBrowserRestarts} restarts — backing off 15min`);
            db().run(
              "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=?",
              [`requeued (browser unrecoverable): ${err}`.slice(0, 500), job.id],
            );
            return;
          }
          consecutiveBrowserRestarts++;
          const r = await restartChatgptBrowser();
          recovered = r.ok;
          console.log(
            r.ok
              ? `[jobs] browser was down/hung — hard-restarted ChatGPT browser (attempt ${consecutiveBrowserRestarts})`
              : `[jobs] browser down, restart failed (attempt ${consecutiveBrowserRestarts}): ${r.error ?? "?"}`,
          );
        }
        pausedUntilMs = Date.now() + (recovered ? 10 * 1000 : 2 * 60 * 1000);
        console.log(`[jobs] requeuing job ${job.id}, pausing ${recovered ? "10s" : "2min"} for browser`);
        db().run(
          "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=?",
          [`requeued (browser down): ${err}`.slice(0, 500), job.id],
        );
        return;
      }
      if (looksLikeRateLimit(err)) {
        // Distinguish a real rate-limit (explicit ChatGPT messaging) from a plain
        // slow generation. GPT-5 image edits often render just after our fast-fail
        // window — those must NOT pause the whole queue, only requeue this job.
        const explicit = /rate-limit-detected/i.test(err);
        if (explicit) {
          consecutiveTimeouts++;
          const explicitReset = parseResetHint(err);
          // Cap any pause at the cooldown so a mis-parsed hint can't stall the
          // queue for hours — we just re-check after the cooldown.
          const cap = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          if (explicitReset && explicitReset > Date.now()) {
            pausedUntilMs = Math.min(explicitReset + 2 * 60 * 1000, cap);
            console.log(
              `[jobs] explicit rate-limit reset hint — pausing queue until ${new Date(pausedUntilMs).toISOString()} (capped at cooldown)`,
            );
          } else if (consecutiveTimeouts >= RATE_LIMIT_THRESHOLD) {
            pausedUntilMs = cap;
            console.log(
              `[jobs] rate-limit suspected (${consecutiveTimeouts} explicit timeouts) — pausing queue until ${new Date(pausedUntilMs).toISOString()}`,
            );
          }
        } else {
          // Non-explicit "no image / waiting" timeout. Two failure modes look
          // identical here: (a) ONE bad photo ChatGPT silently won't render,
          // (b) a global silent throttle hitting every photo. Distinguish by
          // whether the SAME photo keeps failing vs DIFFERENT photos.
          const attempts = (job as { attempts?: number }).attempts ?? 0;
          if (attempts >= MAX_JOB_ATTEMPTS) {
            consecutiveSkips++;
            if (consecutiveSkips >= 2) {
              // 2+ photos hit the cap back-to-back → global silent throttle, not
              // bad photos. Pause and give this one a fresh start later (reset
              // attempts) instead of losing it to a 'failed' state.
              consecutiveSkips = 0;
              pausedUntilMs = Date.now() + RATE_LIMIT_COOLDOWN_MS;
              console.log(`[jobs] cap hit on multiple photos — silent throttle, pausing until ${new Date(pausedUntilMs).toISOString()}`);
              db().run(
                "UPDATE jobs SET status='pending', started_at=NULL, attempts=0, error=? WHERE id=?",
                [`requeued (throttle pause): ${err}`.slice(0, 500), job.id],
              );
              return;
            }
            // Lone bad photo: skip it (mark failed) so it stops blocking the
            // queue behind it.
            console.log(`[jobs] job ${job.id} (${job.photo_id}) — ${attempts} silent timeouts, skipping to unblock queue`);
            fail(job.id, `skipped after ${attempts} silent timeouts: ${err}`);
            return;
          }
          if (job.photo_id === lastTimeoutPhotoId) {
            // Same photo looping → don't pause the whole queue; let the attempt
            // cap above skip it on a subsequent pass.
            consecutiveTimeouts = 0;
            console.log(`[jobs] silent timeout, same photo ${job.photo_id} (attempt ${attempts}) — requeue toward skip cap`);
          } else {
            // Different photo than last failure → looks like a global silent
            // throttle. Count it; pause the queue once it crosses the threshold.
            lastTimeoutPhotoId = job.photo_id;
            consecutiveTimeouts++;
            if (consecutiveTimeouts >= RATE_LIMIT_THRESHOLD) {
              pausedUntilMs = Date.now() + RATE_LIMIT_COOLDOWN_MS;
              console.log(`[jobs] silent throttle across photos (${consecutiveTimeouts}) — pausing queue until ${new Date(pausedUntilMs).toISOString()}`);
            } else {
              console.log(`[jobs] silent timeout on ${job.photo_id} (cross-photo ${consecutiveTimeouts}) — requeuing`);
            }
          }
        }
        db().run(
          "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=?",
          [`requeued: ${err}`.slice(0, 500), job.id],
        );
        return;
      }
      fail(job.id, err);
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      fail(job.id, `output missing or too small: ${outputPath}`);
      return;
    }

    // Success → clear rate-limit + browser-restart + skip counters.
    consecutiveTimeouts = 0;
    consecutiveBrowserRestarts = 0;
    consecutiveSkips = 0;

    const versionInsert = db().run(
      `INSERT INTO versions
        (photo_id, version_number, image_path, prompt_used, config, provider, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'chatgpt', 'generated', ?)`,
      [photo.id, versionNumber, outputPath, job.prompt, job.config, Date.now()],
    );
    const versionId = Number(versionInsert.lastInsertRowid);

    // A generated-from-scratch photo has no original until its first render —
    // adopt it so the grid thumbnail (/thumb/raw/:id reads original_path) works.
    if (photo.kind === "generated" && !photo.original_path) {
      db().run(
        "UPDATE photos SET original_path=?, original_ext='.png', updated_at=? WHERE id=?",
        [outputPath, Date.now(), photo.id],
      );
    }

    db().run(
      "UPDATE jobs SET status='done', result_version_id=?, finished_at=? WHERE id=?",
      [versionId, Date.now(), job.id],
    );
  } catch (err) {
    fail(job.id, err instanceof Error ? err.message : String(err));
  }
}

function fail(jobId: number, error: string) {
  db().run(
    "UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=?",
    [error.slice(0, 500), Date.now(), jobId],
  );
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export type JobsListItem = JobRow;
export type GeneratedVersion = VersionRow;
