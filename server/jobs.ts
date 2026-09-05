import { db, nextVersionNumber,
  versionFileName,
} from "./db.ts";
import type { JobRow, VersionRow } from "./db.ts";
import { genDir, listProjects, withProject } from "./project.ts";
import { mkdirSync, existsSync, statSync, renameSync } from "node:fs";
import { acquireRunnerLock } from "./runnerLock.ts";
import { RUNNER_LOCK, BACKEND_USES_BROWSER } from "./config.ts";
import { join } from "node:path";
import { runWorker, runWorkerGenerate, checkChatgptBrowserAlive, restartChatgptBrowser } from "./worker.ts";
import { runWorkerCodex } from "./worker-codex.ts";
import { runWorkerCodexHttp } from "./worker-codex-http.ts";
import { runWorkerOpenAi, runWorkerOpenAiGenerate } from "./worker-openai.ts";
import { generateEdit } from "./higgsfield.ts";

// Backend selection: WORKER_BACKEND=codex uses Codex CLI (OAuth, no Chrome/CDP,
// no ban risk); anything else keeps the original ChatGPT-web CDP worker.
const WORKER_BACKEND = (process.env.WORKER_BACKEND ?? "cdp").toLowerCase();
// Four backends: "codex" launches the Codex binary and drops the references,
// "codex-http" talks to the CLI's endpoint and attaches them (which is what
// holds coherence across variants), "openai" calls the paid Images API (for the
// long passes, where an interactive account's quota runs out), "cdp" drives the
// browser.
/**
 * Which channel THIS job uses.
 *
 * It was a constant computed at import: the channel was fixed when the process
 * started, so generating with a different backend meant restarting the service
 * — and restarting it changes the behaviour of every project, not just the one
 * being worked on. A choice concerning a single generation must not cost a
 * global restart.
 *
 * It is now resolved when the job starts, and a job can carry its own channel:
 * `null` means "use the system one", which stays the default.
 */
export type Backend = "cdp" | "codex" | "codex-http" | "openai";

export function backendDi(job?: { backend?: string | null }): Backend {
  const picked = (job?.backend ?? WORKER_BACKEND).toLowerCase();
  return picked === "codex-http" || picked === "codex" || picked === "openai"
    ? (picked as Backend)
    : "cdp";
}

function workerPer(b: Backend) {
  return b === "codex-http"
    ? runWorkerCodexHttp
    : b === "codex"
      ? runWorkerCodex
      : b === "openai"
        ? runWorkerOpenAi
        : runWorker;
}

// Text-to-image always went through the browser, even with another backend
// selected: with "openai" the quota you wanted to avoid came back in through
// the window.
function generatePer(b: Backend) {
  return b === "openai" ? runWorkerOpenAiGenerate : runWorkerGenerate;
}

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
  /** Where it came from: `{recipe, refset, sources, refs, preamble}`. It travels
   *  with the job and ends up on the version produced, so the tree can group
   *  variants even when the generation goes through the queue instead of a
   *  hand-written script. */
  lineage: string | null = null,
  /** Channel for this job. `null` = the system one. */
  backend: string | null = null,
): JobRow {
  const now = Date.now();
  const result = db().run(
    `INSERT INTO jobs (photo_id, prompt, config, provider, provider_params, mode, input_path, ref_paths, lineage, backend, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [photoId, prompt, configJson, provider, providerParams, mode, inputPath, refPaths, lineage, backend, now],
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
  // A failure that has been SUPERSEDED is no longer a failure: if a more recent
  // job for that photo succeeded (or is still running), the old error must not
  // come back to the list. Without this clause the LIMIT alone was enough to
  // lie — failed rows sort before done ones, so the red row made it into the
  // window and the success that contradicted it stayed out: the grid marked as
  // "failed" a photo that had in fact been regenerated properly.
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

/** Cancels a job that is queued OR running.
 *
 *  It used to touch only 'pending', and a stuck job — the one you actually want
 *  to stop — stayed 'running' and held the browser lock: the queue stopped
 *  advancing. The runner, when it finishes the attempt, checks the state before
 *  requeueing, so a cancelled job does not rise again. */
export function cancelPending(jobId: number): boolean {
  const r = db().run(
    "UPDATE jobs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('pending','running')",
    [Date.now(), jobId],
  );
  return r.changes > 0;
}

// ---- Runner loop -----------------------------------------------------------

let runnerStarted = false;
let runnerStopping = false;
// Heartbeat of the loop: it is there to tell "the queue is idle because it is
// empty" from "the loop is dead and nobody noticed". It has happened: 22
// pending jobs, none running, and the server apparently alive. The watchdog
// below detects it and restarts it instead of waiting for somebody to look.
let loopBeatMs = Date.now();
/** Which loop is the good one. The watchdog restarts the loop, but it cannot
 *  kill the old one: if that is hanging inside `processJob` it is waiting on
 *  the browser, not on a flag. Without an epoch the loops ADD UP — after two
 *  watchdog interventions three of them were pulling from the same queue, which
 *  is exactly the concurrency the cross-process lock exists to prevent
 *  (observed on 05/09: three jobs for the same photo worked on together on a
 *  server up for 19 hours). With the epoch the old one leaves by itself as soon
 *  as the job holding it finishes. */
let loopEpoch = 0;

// Rate-limit handling: after N consecutive "no image" timeouts (silent ChatGPT
// image-gen cap) we pause the queue and auto-resume after a cooldown.
const RATE_LIMIT_THRESHOLD = 3;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
// Pause between two successful generations. A generation takes ~160s, so 20-35s
// of breathing room stretch a 40-photo batch by ~15 minutes: little, compared
// with the 30 minutes of cooldown ONE cap costs. Tunable via env to raise it
// when the account has already been squeezed on the same day.
const JOB_GAP_MS = Number(process.env.JOB_GAP_MS ?? 20000);
const JOB_GAP_JITTER_MS = Number(process.env.JOB_GAP_JITTER_MS ?? 15000);
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
/** ChatGPT refused the photo (copyright, likeness of third parties).
 *  Telling this apart from a real error is what allows us to stop retrying: a
 *  fault passes, a policy "no" does not. */
export function looksLikePolicyRefusal(err: string): boolean {
  return /content-policy refusal/i.test(err);
}

/** Marks the photo as one to skip, with the reason beside it. */
function markSkipped(photoId: string, reason: string) {
  db().run(
    "UPDATE photos SET skipped = 1, skip_reason = ?, updated_at = ? WHERE id = ?",
    [reason.slice(0, 300), Date.now(), photoId],
  );
  console.log(`[jobs] ${photoId}: rifiutata da ChatGPT — marcata skipped`);
}

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

  // "in 3 hours and 36 minutes": this has to be read first, otherwise the
  // generic rule below picks up only "3 hours" and we come back 36 minutes
  // before the reset, burning another attempt against the wall.
  const hm = hint.match(/(\d+)\s*(?:hours?|ore|ora)\s*(?:and|e)\s*(\d+)\s*(?:minutes?|minuti|min)/i);
  if (hm && hm[1] && hm[2]) {
    return now.getTime() + (Number(hm[1]) * 60 + Number(hm[2])) * 60 * 1000;
  }

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
  // One runner per installation. Two launchd services ran for weeks over the
  // same DB and the same ChatGPT account: neither was wrong, but together they
  // sped up the cap and fought over writes. Whoever arrives second still serves
  // HTTP (a second read-only window is legitimate), but does NOT open a second
  // queue.
  const lock = acquireRunnerLock(RUNNER_LOCK);
  if (!lock.ok) {
    console.warn(
      `[jobs] un altro Darkroom sta gia' lavorando la coda (pid ${lock.holderPid}) — questo processo NON avvia il runner. ` +
        "Due runner sullo stesso DB si contendono l'account ChatGPT e le scritture.",
    );
    return;
  }
  const release = lock.release;
  process.on("exit", release);
  process.on("SIGINT", () => { release(); process.exit(0); });
  process.on("SIGTERM", () => { release(); process.exit(0); });
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

  // Watchdog: if the loop has not beaten for 20 minutes while jobs are waiting,
  // it is dead (unhandled exception, hung worker). An hour-long batch loses 20
  // minutes at most instead of stopping entirely until somebody notices. 20 min
  // is longer than the longest job observed (~9 min of timeout + retry), so it
  // does not fire on work that is merely slow.
  setInterval(() => {
    if (runnerStopping) return;
    const stale = Date.now() - loopBeatMs;
    if (stale < 20 * 60 * 1000) return;
    const pending = pickNextPending();
    if (!pending) return;
    console.warn(
      `[jobs] il ciclo non risponde da ${Math.round(stale / 60000)} min con job in coda — riavvio`,
    );
    loopBeatMs = Date.now();
    void loop();
  }, 60 * 1000).unref?.();
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
  const mia = ++loopEpoch;
  while (!runnerStopping && mia === loopEpoch) {
    loopBeatMs = Date.now();
    const now = loopBeatMs;
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

    // Breathing room between one job and the next. It is not politeness: a burst
    // of back-to-back generations on the same account is what trips ChatGPT's
    // silent cap — the one that gives no error, just returns "waiting", and
    // costs us 9 minutes of timeout to work out. The jitter avoids turning up
    // always at the same rhythm, which is the simplest way to be recognised as
    // automation.
    if (!runnerStopping && Date.now() >= pausedUntilMs) {
      await sleep(JOB_GAP_MS + Math.floor(Math.random() * JOB_GAP_JITTER_MS));
    }
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

/** The file a job writes to WHILE generating.
 *
 *  It carries the job number, not the version number, for a precise reason: the
 *  version number can only be known at insert time, because minutes pass
 *  between the start and the end of a generation and other versions of the same
 *  photo can appear. Choosing it in advance made two jobs for the same photo
 *  point at the same `vNN.png`: the second overwrote the first and two rows
 *  were left citing a single file. */
export function workingFile(photoGenDir: string, jobId: number): string {
  return join(photoGenDir, `.job-${jobId}.png`);
}

/** Moves the working file onto its final name and returns that path.
 *
 *  It has to be called AFTER computing the version number and BEFORE writing it
 *  into the row: that is what guarantees `image_path` points at a file that
 *  exists and holds exactly that generation. */
export function finalizeFile(workPath: string, photoGenDir: string, n: number): string {
  const finale = join(photoGenDir, versionFileName(n));
  renameSync(workPath, finale);
  return finale;
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

  const photoGenDir = join(genDir(), photo.id);
  if (!existsSync(photoGenDir)) mkdirSync(photoGenDir, { recursive: true });
  // The working file carries the JOB number, not the version number.
  // The version number is known only at insert time (minutes pass between the
  // choice and the end), and choosing it here means two jobs for the same photo
  // generating together point at the SAME vNN.png: the second overwrites the
  // first and three rows are left citing a single file. Measured on 05/09 on
  // the sunglasses ablation: jobs 235/236/237, versions 71/72/73, a single
  // v71.png on disk and two renders lost.
  const outputPath = workingFile(photoGenDir, job.id);
  const finalize = (n: number): string => finalizeFile(outputPath, photoGenDir, n);

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
      // The number is RECOMPUTED here, not reused from before the generation:
      // minutes pass between the two moments, and if another version of the
      // same photo has arrived meanwhile the insert conflicts on the UNIQUE.
      // The job failed AFTER having already spent the credits and written the
      // file, so the work existed but was reported as failed.
      const finalNumber = nextVersionNumber(photo.id);
      const finalPath = finalize(finalNumber);
      const ins = db().run(
        `INSERT INTO versions
          (photo_id, version_number, image_path, prompt_used, config, provider, provider_params, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'higgsfield', ?, ?, 'generated', ?)`,
        [photo.id, finalNumber, finalPath, job.prompt, job.config, job.provider_params, hfResult.credits, Date.now()],
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
    // Generation has no source image (skips upload). Both paths honor the
    // selected backend (cdp | codex | codex-http | openai).
    const refs = parseRefPaths(job.ref_paths);
    // Resolved NOW, not at process start: a job can carry its own channel, and
    // changing it for one generation must not cost the restart of a service
    // that serves every project.
    const backend = backendDi(job);
    // The quality declared by the job. Without it the worker read only the
    // service's environment: a job asking for `low` was produced in `high`, and
    // a half-cent trial cost 21.
    let wantedQuality: string | undefined;
    try {
      wantedQuality = job.provider_params
        ? ((JSON.parse(job.provider_params) as { quality?: string }).quality ?? undefined)
        : undefined;
    } catch {
      wantedQuality = undefined;
    }
    const result = isGenerate
      ? await generatePer(backend)({ prompt: job.prompt, output: outputPath, refs })
      : await workerPer(backend)({
          image: editInput,
          prompt: job.prompt,
          output: outputPath,
          refs,
          ...(backend === "openai" && wantedQuality ? { quality: wantedQuality } : {}),
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
        // Only THIS job's channel decides whether there is a browser to revive:
        // the global constant restarted Chrome even for a job that talked to
        // the API and had never opened a window.
        if (backend === "cdp" && !(await checkChatgptBrowserAlive())) {
          if (consecutiveBrowserRestarts >= MAX_BROWSER_RESTARTS) {
            // Repeated restarts aren't helping (login lost, Cloudflare wall,
            // crash loop). Back off long and stop hammering; needs a human.
            pausedUntilMs = Date.now() + 15 * 60 * 1000;
            console.log(`[jobs] browser unrecoverable after ${consecutiveBrowserRestarts} restarts — backing off 15min`);
            db().run(
              "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=? AND status <> 'cancelled'",
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
          "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=? AND status <> 'cancelled'",
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
          // When ChatGPT says EXPLICITLY when it reopens, we believe it.
          // Truncating the wait to 30 minutes looked prudent, but it is the
          // opposite: with a 13-hour hint it means turning up 26 times to knock
          // on a closed door, burning a job (and ~6 minutes of timeout) each
          // time. The only thing to cap is a plainly absurd hint.
          const cap = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          const MAX_EXPLICIT_PAUSE_MS = 24 * 60 * 60 * 1000;
          if (explicitReset && explicitReset > Date.now()) {
            const until = Math.min(
              explicitReset + 2 * 60 * 1000,
              Date.now() + MAX_EXPLICIT_PAUSE_MS,
            );
            pausedUntilMs = Math.max(pausedUntilMs, until);
            const ore = ((pausedUntilMs - Date.now()) / 3600000).toFixed(1);
            console.log(
              `[jobs] ChatGPT ha dato un orario di riapertura — coda in pausa ${ore}h, fino a ${new Date(pausedUntilMs).toISOString()}`,
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
                "UPDATE jobs SET status='pending', started_at=NULL, attempts=0, error=? WHERE id=? AND status <> 'cancelled'",
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
          "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=? AND status <> 'cancelled'",
          [`requeued: ${err}`.slice(0, 500), job.id],
        );
        return;
      }
      // Policy refusal: not a fault, a definitive no. Marking the photo takes it
      // out of the bulk enqueues, so it does not come back to the queue every
      // round to collect the same no.
      if (looksLikePolicyRefusal(err)) {
        markSkipped(job.photo_id, err);
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

    // As on the Higgsfield branch: the number is recomputed at insert time,
    // because minutes pass between the choice and the end of the generation.
    const finalNumber = nextVersionNumber(photo.id);
    const finalPath = finalize(finalNumber);
    // The provider is recorded for what it is: saying 'chatgpt' even when the
    // Images API generated it made it impossible to know what a project had
    // cost. `credits` stays NULL for the quota backends, where a zero would say
    // "free" instead of "not measurable".
    // THIS job's channel, not the system one: with a per-job backend the global
    // constant would have recorded 'chatgpt' on a version that came out of the
    // API, and the project's cost would have gone unreadable again.
    const provider = backendDi(job) === "openai" ? "openai" : "chatgpt";
    const cost = result.status === "ok" ? (result.cost_usd ?? null) : null;
    const versionInsert = db().run(
      `INSERT INTO versions
        (photo_id, version_number, image_path, prompt_used, config, provider, provider_params, lineage, source, created_at, credits)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?)`,
      [
        photo.id,
        finalNumber,
        finalPath,
        job.prompt,
        job.config,
        provider,
        // Model and quality: two variants of the same recipe produced at `low` and
        // at `high` are different experiments, and without this the tree showed
        // them as if they were the same thing.
        result.status === "ok" && result.model
          ? JSON.stringify({ model: result.model, quality: result.quality ?? null })
          : null,
        // Where it came from. It travels through the job so queue generations get
        // grouped in the tree too: before, only the hand-written ones had it,
        // and the correct route gave the worse result.
        job.lineage,
        Date.now(),
        cost,
      ],
    );
    const versionId = Number(versionInsert.lastInsertRowid);

    // A generated-from-scratch photo has no original until its first render —
    // adopt it so the grid thumbnail (/thumb/raw/:id reads original_path) works.
    if (photo.kind === "generated" && !photo.original_path) {
      db().run(
        "UPDATE photos SET original_path=?, original_ext='.png', updated_at=? WHERE id=?",
        [finalPath, Date.now(), photo.id],
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
  // A job cancelled while running stays cancelled: overwriting it with
  // 'failed' would make it reappear as an error to look at, when its ending has
  // in fact been decided.
  db().run(
    "UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=? AND status <> 'cancelled'",
    [error.slice(0, 500), Date.now(), jobId],
  );
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export type JobsListItem = JobRow;
export type GeneratedVersion = VersionRow;
