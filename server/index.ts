import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import {
  db,
  initSchema,
  effectivePrompt,
  getGlobalPrompt,
  setGlobalPrompt,
  getDefaultConfig,
  setDefaultConfig,
  getColorGrade,
  setColorGrade,
  effectiveGrade,
  normalizeGrade,
  listPresets,
  getPreset,
  createPreset,
  renamePreset,
  deletePreset,
  type PhotoRow,
  type VersionRow,
  type OrphanRow,
  type ColorGrade,
} from "./db.ts";
import { importTemplate } from "./templates.ts";
import { LUT_DIR, REPO_ROOT, WORKER_BACKEND } from "./config.ts";
import {
  rawDir,
  genDir,
  finalDir,
  test1Dir,
  gradedDir,
  withProject,
  getProject,
  listProjects,
  addProject,
  updateProject,
  dirsFor,
} from "./project.ts";
import { runGradeSteps, deterministicSteps } from "./grade.ts";
import { wbGainFor } from "./sceneWb.ts";
import {
  DEFAULT_CONFIG,
  assemblePrompt,
  mergeConfig,
  parseConfig,
  parsePartialConfig,
  type PromptConfig,
} from "./promptConfig.ts";
import {
  enqueueJob,
  jobsSummary,
  listJobs,
  cancelPending,
  markJobSeen,
  markAllFailedSeen,
  listJobsForPhoto,
  startRunner,
  getRunnerStatus,
} from "./jobs.ts";
import { bakePhoto } from "./bake.ts";
import { thumbnailPath } from "./thumb.ts";
import { checkChatgptBrowserAlive, launchChatgptBrowser, CHATGPT_CDP_URL } from "./worker.ts";
import {
  higgsfieldConfigured,
  balance as hfBalance,
  listImageModels as hfModels,
  getCost as hfCost,
} from "./higgsfield.ts";

initSchema();

const app = new Hono();
app.use("*", cors());

// Resolve the active project for every request from `?project=` or the
// `x-darkroom-project` header, and run the handler inside that project's ALS
// context so db()/genDir()/… resolve to it. Unknown/absent → the default
// project (single-project back-compat). Static SPA assets are project-agnostic.
app.use("*", async (c, next) => {
  const pid = c.req.query("project") ?? c.req.header("x-darkroom-project") ?? "";
  if (pid && getProject(pid)) {
    return withProject(pid, () => next());
  }
  return next();
});

// ---- helpers ---------------------------------------------------------------

function getPhoto(id: string): PhotoRow | null {
  return (
    db()
      .query<PhotoRow, [string]>("SELECT * FROM photos WHERE id = ?")
      .get(id) ?? null
  );
}

function getVersionsFor(photoId: string): VersionRow[] {
  return db()
    .query<VersionRow, [string]>(
      "SELECT * FROM versions WHERE photo_id = ? ORDER BY version_number ASC",
    )
    .all(photoId);
}

function ensureFinalDir() {
  const dir = finalDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Resolve the effective PromptConfig for a photo: photo override > settings default > built-in default. */
function effectiveConfig(photo: PhotoRow): PromptConfig {
  const base = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  // Override is stored as a partial — only the fields the user changed.
  const override = parsePartialConfig(photo.config_override);
  return mergeConfig(base, override);
}

/** Fold per-photo extra instructions into the config's freeform block, so they
 *  ride along with the assembled prompt without overriding the global config. */
function withExtra(cfg: PromptConfig, photo: PhotoRow): PromptConfig {
  const extra = photo.extra_instructions?.trim();
  if (!extra) return cfg;
  const merged = [cfg.freeform?.trim(), extra].filter(Boolean).join(". ");
  return { ...cfg, freeform: merged };
}

// ---- Color grade (local look) ---------------------------------------------

function safeSeg(s: string): boolean {
  return !(s.includes("..") || s.includes("/"));
}

/** The pipeline produces a live render only if enabled and with at least one
 *  active DETERMINISTIC step. 'ai' steps are generative (bake-only) and never
 *  drive the /graded preview. */
function gradeActive(cfg: ColorGrade): boolean {
  return cfg.enabled && cfg.steps.some((s) => s.enabled && s.type !== "ai");
}

/** Scene-match requested = there is an active white_balance step with scene_match on. */
function sceneMatchRequested(cfg: ColorGrade): boolean {
  return cfg.steps.some(
    (s) => s.enabled && s.type === "white_balance" && s.params?.scene_match === true,
  );
}

/** Cache path for a graded image, keyed by source mtime/size + steps + width.
 *  Params change ⇒ new key ⇒ auto-recompute; same params ⇒ instant hit.
 *  Only deterministic steps enter the key — 'ai' steps never affect the preview. */
function gradedFile(
  photoId: string,
  filename: string,
  source: string,
  cfg: ColorGrade,
  width: number,
  wbGain?: [number, number, number] | null,
): string {
  const st = statSync(source);
  const key = createHash("sha1")
    .update(
      JSON.stringify({
        m: Math.round(st.mtimeMs),
        s: st.size,
        steps: deterministicSteps(cfg.steps),
        wb: wbGain ?? null,
        width,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return join(gradedDir(), photoId, `${filename}.${key}.jpg`);
}

function runColorGrade(
  source: string,
  out: string,
  cfg: ColorGrade,
  maxWidth: number,
  quality: number,
  timeoutMs: number,
  wbGain?: [number, number, number] | null,
): boolean {
  return runGradeSteps(source, out, cfg.steps, { maxWidth, quality, timeoutMs, wbGain });
}

// ---- API: photos -----------------------------------------------------------

app.get("/api/photos", (c) => {
  const filter = c.req.query("filter") ?? "all";
  const where: string[] = [];
  if (filter === "no_versions") {
    where.push("(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) = 0");
  } else if (filter === "with_versions") {
    where.push("(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) > 0");
  } else if (filter === "no_favorite") {
    where.push("p.favorite_version_id IS NULL");
  } else if (filter === "with_favorite") {
    where.push("p.favorite_version_id IS NOT NULL");
  } else if (filter === "in_queue") {
    where.push(
      "EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status IN ('pending','running'))",
    );
  } else if (filter === "failed") {
    where.push(
      "EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status = 'failed') AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.photo_id = p.id)",
    );
  } else if (filter === "with_override") {
    where.push("p.config_override IS NOT NULL");
  }
  const sql = `
    SELECT
      p.id,
      p.original_ext,
      p.favorite_version_id,
      p.taken_at,
      p.feedback,
      (SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) AS version_count,
      (SELECT v.version_number FROM versions v
         WHERE v.photo_id = p.id AND v.id = p.favorite_version_id) AS favorite_version_number,
      (SELECT v.id FROM versions v
         WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1) AS latest_version_id,
      (SELECT v.version_number FROM versions v
         WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1) AS latest_version_number
    FROM photos p
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY (p.taken_at IS NULL) ASC, p.taken_at ASC, p.id ASC
  `;
  const rows = db()
    .query<
      {
        id: string;
        original_ext: string;
        favorite_version_id: number | null;
        taken_at: number | null;
        feedback: string | null;
        version_count: number;
        favorite_version_number: number | null;
        latest_version_id: number | null;
        latest_version_number: number | null;
      },
      []
    >(sql)
    .all();
  return c.json({ photos: rows });
});

// Per-filter counts for the grid filter bar (one pass, conditional aggregation).
// Keys match the client Filter ids so the bar can index directly. MUST be
// registered before "/api/photos/:id" or that route captures "counts" as :id.
app.get("/api/photos/counts", (c) => {
  const hasVersions = "(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id)";
  const row = db()
    .query<Record<string, number>, []>(
      `SELECT
         COUNT(*) AS "all",
         SUM(CASE WHEN ${hasVersions} = 0 THEN 1 ELSE 0 END) AS no_versions,
         SUM(CASE WHEN ${hasVersions} > 0 THEN 1 ELSE 0 END) AS with_versions,
         SUM(CASE WHEN p.favorite_version_id IS NULL THEN 1 ELSE 0 END) AS no_favorite,
         SUM(CASE WHEN p.favorite_version_id IS NOT NULL THEN 1 ELSE 0 END) AS with_favorite,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status IN ('pending','running')) THEN 1 ELSE 0 END) AS in_queue,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status = 'failed') AND ${hasVersions} = 0 THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN p.config_override IS NOT NULL THEN 1 ELSE 0 END) AS with_override
       FROM photos p`,
    )
    .get();
  return c.json({ counts: row ?? {} });
});

// Every photo that carries a review note — for distilling the next run's
// direction in one pass. Registered before "/api/photos/:id" so "feedback"
// isn't captured as an :id.
app.get("/api/feedback", (c) => {
  const rows = db()
    .query<{ id: string; feedback: string; updated_at: number }, []>(
      "SELECT id, feedback, updated_at FROM photos WHERE feedback IS NOT NULL AND TRIM(feedback) <> '' ORDER BY updated_at DESC",
    )
    .all();
  return c.json({ feedback: rows, count: rows.length });
});

app.get("/api/photos/:id", (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const versions = getVersionsFor(id);
  const cfg = effectiveConfig(photo);
  return c.json({
    photo,
    versions,
    effective_prompt: assemblePrompt(withExtra(cfg, photo)),
    effective_config: cfg,
    has_override: photo.config_override !== null,
    legacy_prompt: effectivePrompt(photo),
    global_prompt: getGlobalPrompt(),
    effective_grade: effectiveGrade(photo),
    has_grade_override: photo.grade_override !== null,
  });
});

app.put("/api/photos/:id/favorite", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ version_id: number | null }>();
  if (body.version_id !== null) {
    const exists = db()
      .query<{ id: number }, [number, string]>(
        "SELECT id FROM versions WHERE id = ? AND photo_id = ?",
      )
      .get(body.version_id, id);
    if (!exists) return c.json({ error: "version not found" }, 400);
  }
  db().run(
    "UPDATE photos SET favorite_version_id = ?, updated_at = ? WHERE id = ?",
    [body.version_id, Date.now(), id],
  );
  return c.json({ ok: true });
});

app.put("/api/photos/:id/prompt", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ prompt: string | null }>();
  db().run(
    "UPDATE photos SET custom_prompt = ?, updated_at = ? WHERE id = ?",
    [body.prompt, Date.now(), id],
  );
  return c.json({ ok: true });
});

app.put("/api/photos/:id/extra", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ extra: string | null }>();
  const value = (body.extra ?? "").trim() || null;
  db().run(
    "UPDATE photos SET extra_instructions = ?, updated_at = ? WHERE id = ?",
    [value, Date.now(), id],
  );
  return c.json({ ok: true });
});

// Freeform per-photo review note jotted on the grid. Read in bulk (below) to
// steer the next run; NOT injected into the prompt.
app.put("/api/photos/:id/feedback", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ feedback: string | null }>();
  const value = (body.feedback ?? "").trim() || null;
  db().run("UPDATE photos SET feedback = ?, updated_at = ? WHERE id = ?", [
    value,
    Date.now(),
    id,
  ]);
  return c.json({ ok: true, feedback: value });
});

app.delete("/api/photos/:id/versions/:vid", (c) => {
  const id = c.req.param("id");
  const vid = Number(c.req.param("vid"));
  const v = db()
    .query<VersionRow, [number, string]>(
      "SELECT * FROM versions WHERE id = ? AND photo_id = ?",
    )
    .get(vid, id);
  if (!v) return c.json({ error: "not found" }, 404);

  // If this is the favorite, clear it first
  db().run(
    "UPDATE photos SET favorite_version_id = NULL WHERE id = ? AND favorite_version_id = ?",
    [id, vid],
  );
  db().run("DELETE FROM versions WHERE id = ?", [vid]);

  // Remove the file from disk (only inside generations/)
  if (v.image_path.startsWith(genDir()) && existsSync(v.image_path)) {
    try {
      unlinkSync(v.image_path);
    } catch {}
  }

  return c.json({ ok: true });
});

// ---- API: generation -------------------------------------------------------

app.post("/api/photos/:id/generate", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);

  // Accept optional one-shot config override in the body (does not persist on the photo).
  let oneShot: Partial<PromptConfig> | null = null;
  try {
    const body = await c.req.json().catch(() => null);
    if (body && typeof body === "object" && body.config) oneShot = body.config;
  } catch {}

  const cfg = withExtra(mergeConfig(effectiveConfig(photo), oneShot), photo);
  const prompt = assemblePrompt(cfg);
  const job = enqueueJob(id, prompt, JSON.stringify(cfg));
  return c.json({ job });
});

// ---- Higgsfield -----------------------------------------------------------

app.get("/api/higgsfield/status", async (c) => {
  if (!higgsfieldConfigured()) return c.json({ configured: false });
  try {
    const bal = await hfBalance();
    return c.json({ configured: true, ...bal });
  } catch (err) {
    return c.json({ configured: true, error: String(err) });
  }
});

app.get("/api/higgsfield/models", async (c) => {
  if (!higgsfieldConfigured()) return c.json({ models: [] });
  // One retry: a transient token-refresh race or Cloudflare hiccup shouldn't
  // 500 and break the UI's Higgsfield button.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const models = await hfModels();
      return c.json({ models });
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  return c.json({ error: String(lastErr) }, 500);
});

app.get("/api/higgsfield/cost", async (c) => {
  const model = c.req.query("model");
  if (!model) return c.json({ error: "model required" }, 400);
  const params: Record<string, unknown> = {};
  for (const k of ["resolution", "quality", "aspect_ratio", "mode"]) {
    const v = c.req.query(k);
    if (v) params[k] = v;
  }
  try {
    const cost = await hfCost(model, "subtle cinematic color grade", params);
    return c.json({ cost });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post("/api/photos/:id/generate-higgsfield", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  if (!higgsfieldConfigured()) return c.json({ error: "higgsfield non collegato" }, 400);

  const body = (await c.req.json().catch(() => null)) as {
    model?: string;
    params?: Record<string, unknown>;
    config?: Partial<PromptConfig>;
  } | null;
  const model = body?.model;
  if (!model) return c.json({ error: "model required" }, 400);

  // Reuse the structured prompt so Higgsfield gets the same cinematic intent.
  const cfg = withExtra(mergeConfig(effectiveConfig(photo), body?.config ?? null), photo);
  const prompt = assemblePrompt(cfg);
  const providerParams = JSON.stringify({ model, params: body?.params ?? {} });
  // Remember this selection so the picker prefills it next time for this photo.
  db().run("UPDATE photos SET higgsfield_selection=?, updated_at=? WHERE id=?", [
    providerParams,
    Date.now(),
    id,
  ]);
  const job = enqueueJob(id, prompt, JSON.stringify(cfg), "higgsfield", providerParams);
  return c.json({ job });
});

app.post("/api/photos/reindex-times", async (c) => {
  const photos = db()
    .query<{ id: string; original_path: string }, []>(
      "SELECT id, original_path FROM photos",
    )
    .all();
  let updated = 0;
  let missed = 0;
  for (const p of photos) {
    if (!existsSync(p.original_path)) {
      missed++;
      continue;
    }
    try {
      const proc = Bun.spawn({
        cmd: ["mdls", "-name", "kMDItemContentCreationDate", "-raw", p.original_path],
        stdout: "pipe",
        stderr: "ignore",
      });
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      if (!out || out === "(null)") {
        // fallback to file mtime
        const ms = statSync(p.original_path).mtimeMs;
        db().run("UPDATE photos SET taken_at = ? WHERE id = ?", [Math.floor(ms), p.id]);
        updated++;
        continue;
      }
      // mdls returns ISO-ish "2026-03-07 20:56:32 +0000"
      const ms = new Date(out.replace(" +", "+").replace(" -", "-").replace(" ", "T")).getTime();
      if (!Number.isFinite(ms)) {
        missed++;
        continue;
      }
      db().run("UPDATE photos SET taken_at = ? WHERE id = ?", [ms, p.id]);
      updated++;
    } catch {
      missed++;
    }
  }
  return c.json({ updated, missed, total: photos.length });
});

app.post("/api/generate-missing", (c) => {
  const photos = db()
    .query<PhotoRow, []>(
      `SELECT p.* FROM photos p
       WHERE (SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) = 0
       ORDER BY p.id ASC`,
    )
    .all();
  let count = 0;
  for (const p of photos) {
    const cfg = withExtra(effectiveConfig(p), p);
    enqueueJob(p.id, assemblePrompt(cfg), JSON.stringify(cfg));
    count++;
  }
  return c.json({ enqueued: count });
});

// Generate brand-new images from a text prompt (no source photo). Each creates
// a `kind='generated'` photo whose first render becomes its original.
app.post("/api/generate-new", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return c.json({ error: "prompt required" }, 400);
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 50);

  const now = Date.now();
  const ids: string[] = [];
  const insert = db().prepare(
    `INSERT INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
  );
  for (let i = 0; i < count; i++) {
    // Unique, sortable id; index disambiguates within the same millisecond.
    const id = `gen_${now}_${String(i).padStart(2, "0")}`;
    insert.run(id, now, now);
    enqueueJob(id, prompt, null, "chatgpt", null, "generate");
    ids.push(id);
  }
  return c.json({ created: ids.length, ids });
});

// ---- API: settings ---------------------------------------------------------

app.get("/api/settings/global-prompt", (c) =>
  c.json({ prompt: getGlobalPrompt() }),
);

app.put("/api/settings/global-prompt", async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  if (typeof body.prompt !== "string" || body.prompt.length < 10) {
    return c.json({ error: "prompt too short" }, 400);
  }
  setGlobalPrompt(body.prompt);
  return c.json({ ok: true });
});

// ---- API: structured prompt config ----------------------------------------

app.get("/api/settings/default-config", (c) => {
  const cfg = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  return c.json({ config: cfg, prompt: assemblePrompt(cfg) });
});

app.put("/api/settings/default-config", async (c) => {
  const body = await c.req.json<{ config: Partial<PromptConfig> }>();
  if (!body || typeof body.config !== "object") return c.json({ error: "config missing" }, 400);
  const merged = mergeConfig(DEFAULT_CONFIG, body.config);
  setDefaultConfig(JSON.stringify(merged));
  return c.json({ ok: true, config: merged, prompt: assemblePrompt(merged) });
});

app.put("/api/photos/:id/config", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ config: Partial<PromptConfig> | null }>();
  if (body.config === null) {
    db().run("UPDATE photos SET config_override = NULL, updated_at = ? WHERE id = ?", [Date.now(), id]);
    return c.json({ ok: true, cleared: true });
  }
  if (!body.config || typeof body.config !== "object") return c.json({ error: "bad config" }, 400);
  const json = JSON.stringify(body.config);
  db().run("UPDATE photos SET config_override = ?, updated_at = ? WHERE id = ?", [json, Date.now(), id]);
  const fresh = getPhoto(id)!;
  return c.json({ ok: true, effective: effectiveConfig(fresh) });
});

// Per-photo color-grade override. body.grade = null → back to the global grade.
app.put("/api/photos/:id/grade", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ grade: unknown }>().catch(() => null);
  if (!body || !("grade" in body)) return c.json({ error: "grade missing" }, 400);
  if (body.grade === null) {
    db().run("UPDATE photos SET grade_override = NULL, updated_at = ? WHERE id = ?", [Date.now(), id]);
    return c.json({ ok: true, cleared: true });
  }
  if (typeof body.grade !== "object") return c.json({ error: "bad grade" }, 400);
  const next = normalizeGrade(body.grade);
  db().run("UPDATE photos SET grade_override = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify(next), Date.now(), id,
  ]);
  return c.json({ ok: true, effective: next });
});

// ---- API: jobs -------------------------------------------------------------

app.get("/api/jobs", (c) => {
  const summary = jobsSummary();
  const items = listJobs(50);
  return c.json({ summary, items, runner: getRunnerStatus() });
});

app.post("/api/jobs/:id/cancel", (c) => {
  const id = Number(c.req.param("id"));
  const ok = cancelPending(id);
  if (!ok) return c.json({ error: "cannot cancel" }, 400);
  return c.json({ ok: true });
});

app.post("/api/jobs/:id/seen", (c) => {
  const id = Number(c.req.param("id"));
  const ok = markJobSeen(id);
  return c.json({ ok });
});

app.post("/api/jobs/seen-failed", (c) => {
  const dismissed = markAllFailedSeen();
  return c.json({ ok: true, dismissed });
});

app.get("/api/photos/:id/jobs", (c) => {
  const id = c.req.param("id");
  return c.json({ jobs: listJobsForPhoto(id) });
});

// ---- API: orphans ----------------------------------------------------------

app.get("/api/orphans", (c) => {
  const rows = db()
    .query<OrphanRow, []>(
      "SELECT * FROM orphans WHERE assigned_photo_id IS NULL AND skipped = 0 ORDER BY filename ASC",
    )
    .all();
  return c.json({ orphans: rows });
});

app.post("/api/orphans/:filename/assign", async (c) => {
  const filename = c.req.param("filename");
  const body = await c.req.json<{ photo_id: string }>();
  const orphan = db()
    .query<OrphanRow, [string]>(
      "SELECT * FROM orphans WHERE filename = ?",
    )
    .get(filename);
  if (!orphan) return c.json({ error: "orphan not found" }, 404);
  const photo = getPhoto(body.photo_id);
  if (!photo) return c.json({ error: "photo not found" }, 404);

  // Copy file into generations/<photo>/ and pick next free version slot
  const dstDir = join(genDir(), photo.id);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
  const existing = getVersionsFor(photo.id);
  const nextV = (existing.at(-1)?.version_number ?? 0) + 1;
  const dstPath = join(dstDir, `v${String(nextV).padStart(2, "0")}.png`);
  copyFileSync(orphan.source_path, dstPath);

  db().run(
    `INSERT INTO versions
      (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?, ?, ?, ?, 'imported', ?)`,
    [photo.id, nextV, dstPath, getGlobalPrompt(), Date.now()],
  );
  db().run(
    "UPDATE orphans SET assigned_photo_id = ? WHERE filename = ?",
    [photo.id, filename],
  );

  return c.json({ ok: true, version_number: nextV });
});

app.post("/api/orphans/:filename/skip", (c) => {
  const filename = c.req.param("filename");
  const r = db().run("UPDATE orphans SET skipped = 1 WHERE filename = ?", [
    filename,
  ]);
  return c.json({ ok: r.changes > 0 });
});

// ---- API: export -----------------------------------------------------------

app.post("/api/export-favorites", (c) => {
  ensureFinalDir();
  const rows = db()
    .query<
      { photo_id: string; image_path: string },
      []
    >(
      `SELECT p.id AS photo_id, v.image_path
       FROM photos p
       JOIN versions v ON v.id = p.favorite_version_id
       WHERE p.favorite_version_id IS NOT NULL`,
    )
    .all();
  const globalGrade = getColorGrade();
  const graded = gradeActive(globalGrade);
  let copied = 0;
  for (const r of rows) {
    if (!existsSync(r.image_path)) continue;
    // Each favorite uses ITS effective grade (per-photo override if present).
    const photo = getPhoto(r.photo_id);
    const cfg = photo ? effectiveGrade(photo) : globalGrade;
    if (gradeActive(cfg)) {
      // Full-res graded JPG (no downscale) — the real deliverable.
      const dst = join(finalDir(), `${r.photo_id}.jpg`);
      const wbGain = sceneMatchRequested(cfg) ? wbGainFor(r.photo_id) : null;
      if (runColorGrade(r.image_path, dst, cfg, 0, 95, 120000, wbGain)) {
        copied++;
        continue;
      }
      // fall through to raw copy on grade error
    }
    const dst = join(finalDir(), `${r.photo_id}.png`);
    copyFileSync(r.image_path, dst);
    copied++;
  }
  return c.json({ copied, total: rows.length, dir: finalDir(), graded });
});

// ---- API: color grade ------------------------------------------------------

app.get("/api/luts", (c) => {
  let files: string[] = [];
  try {
    files = readdirSync(LUT_DIR, { recursive: true }) as string[];
  } catch {}
  const luts = files
    .filter((f) => f.toLowerCase().endsWith(".cube"))
    .map((f) => {
      const parts = f.split("/");
      const base = parts[parts.length - 1] ?? f;
      return {
        id: f,
        name: base.replace(/\.cube$/i, ""),
        group: parts.length > 1 ? (parts[0] ?? "root") : "root",
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return c.json({ luts, current: getColorGrade() });
});

app.get("/api/settings/color-grade", (c) => c.json({ grade: getColorGrade() }));

app.put("/api/settings/color-grade", async (c) => {
  const body = await c.req.json<{ grade: unknown }>().catch(() => null);
  if (!body || typeof body.grade !== "object" || body.grade === null) {
    return c.json({ error: "grade missing" }, 400);
  }
  const next = normalizeGrade(body.grade);
  setColorGrade(next);
  return c.json({ ok: true, grade: next });
});

// ---- API: presets / templates --------------------------------------------

app.get("/api/presets", (c) => c.json({ presets: listPresets() }));

app.post("/api/presets", async (c) => {
  const body = await c.req.json<{ name?: string; grade?: unknown }>().catch(() => null);
  if (!body || typeof body.grade !== "object" || body.grade === null) {
    return c.json({ error: "grade missing" }, 400);
  }
  const preset = createPreset(String(body.name ?? "Senza nome"), normalizeGrade(body.grade));
  return c.json({ ok: true, preset });
});

app.put("/api/presets/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  if (!id || !body || typeof body.name !== "string") {
    return c.json({ error: "name missing" }, 400);
  }
  if (!getPreset(id)) return c.json({ error: "not found" }, 404);
  renamePreset(id, body.name);
  return c.json({ ok: true, preset: getPreset(id) });
});

app.delete("/api/presets/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "bad id" }, 400);
  deletePreset(id);
  return c.json({ ok: true });
});

// Import an external template (Lightroom .xmp/.lrtemplate, a .cube LUT, or our
// own JSON). Body: { filename, text }. Returns the mapped grade + `notes` on
// what couldn't be reproduced; the client decides whether to apply or save it.
app.post("/api/templates/import", async (c) => {
  const body = await c.req.json<{ filename?: string; text?: string; save?: boolean }>().catch(() => null);
  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return c.json({ error: "text missing" }, 400);
  }
  try {
    const res = importTemplate(String(body.filename ?? "template"), body.text);
    const preset = body.save ? createPreset(res.name, res.grade, "import") : null;
    return c.json({ ok: true, ...res, preset });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "import fallito" }, 400);
  }
});

// ---- API: pipeline (AI generation stage as a first-class system step) ------

// Regenerate the whole favorite set through the AI edit worker with the
// system's effective config. This is the generation stage of the pipeline,
// exposed as one action instead of a manual per-photo loop.
app.post("/api/pipeline/regenerate", (c) => {
  const rows = db()
    .query<{ id: string }, []>(
      `SELECT id FROM photos
       WHERE favorite_version_id IS NOT NULL
       ORDER BY (taken_at IS NULL) ASC, taken_at ASC, id ASC`,
    )
    .all();
  const jobs: number[] = [];
  for (const r of rows) {
    const photo = getPhoto(r.id);
    if (!photo) continue;
    const cfg = withExtra(effectiveConfig(photo), photo);
    const prompt = assemblePrompt(cfg);
    const job = enqueueJob(r.id, prompt, JSON.stringify(cfg));
    jobs.push(job.id);
  }
  return c.json({ queued: jobs.length, jobs });
});

// Promote every favorite to its most recent generated version — the "commit"
// step after a regeneration run, so the set (grid + color) reflects the newest
// output. Non-destructive: prior versions stay and can be re-promoted.
app.post("/api/pipeline/promote-latest", (c) => {
  const rows = db()
    .query<{ id: string; latest: number | null }, []>(
      `SELECT p.id AS id,
         (SELECT v.id FROM versions v WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1) AS latest
       FROM photos p WHERE p.favorite_version_id IS NOT NULL`,
    )
    .all();
  const now = Date.now();
  let promoted = 0;
  for (const r of rows) {
    if (r.latest == null) continue;
    db().run("UPDATE photos SET favorite_version_id = ?, updated_at = ? WHERE id = ?", [
      r.latest,
      now,
      r.id,
    ]);
    promoted++;
  }
  return c.json({ promoted });
});

// One shot of the whole pipeline's live state: what the AI stage will run, the
// local color look, and how the current set is doing in the queue.
app.get("/api/pipeline/status", (c) => {
  const cfg = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  const grade = getColorGrade();
  const favs = db()
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM photos WHERE favorite_version_id IS NOT NULL",
    )
    .get();
  const q = db()
    .query<{ status: string; n: number }, []>(
      `SELECT status, COUNT(*) AS n FROM jobs
       WHERE photo_id IN (SELECT id FROM photos WHERE favorite_version_id IS NOT NULL)
       GROUP BY status`,
    )
    .all();
  const jobsBy: Record<string, number> = {};
  for (const r of q) jobsBy[r.status] = r.n;
  return c.json({
    generation: {
      config: cfg,
      prompt: assemblePrompt(cfg),
      film_stock: cfg.film_stock,
      contrast: cfg.contrast,
      shadows: cfg.shadows,
      grain: cfg.grain,
      white_balance: cfg.white_balance,
      palette: cfg.palette,
      composition: cfg.composition,
      aspect_ratio: cfg.aspect_ratio,
      lighting: cfg.lighting,
      cleanup: cfg.cleanup,
      detail: cfg.detail,
      freeform: cfg.freeform ?? "",
    },
    grade,
    favorites: favs?.n ?? 0,
    queue: jobsBy,
  });
});

// Bake the full pipeline (deterministic grade + generative 'ai' steps) for one
// photo into a committed final version. Awaited: fast for grade-only chains,
// minutes when an 'ai' step is present (the client shows progress).
app.post("/api/pipeline/bake/:id", async (c) => {
  const id = c.req.param("id");
  if (!getPhoto(id)) return c.json({ error: "not found" }, 404);
  const result = await bakePhoto(id);
  return c.json(result, result.ok ? 200 : 400);
});

// Bake every favorite. Runs in the background (a full set with 'ai' steps can
// take a long time and must stay serialized on the single shared worker) and
// returns immediately; progress is observable via versions/jobs + bake status.
let bakeBatch: { running: boolean; total: number; done: number; failed: number; current: string | null } = {
  running: false, total: 0, done: 0, failed: 0, current: null,
};

app.get("/api/pipeline/bake-status", (c) => c.json(bakeBatch));

app.post("/api/pipeline/bake-favorites", (c) => {
  if (bakeBatch.running) return c.json({ error: "bake already running", status: bakeBatch }, 409);
  const rows = db()
    .query<{ id: string }, []>(
      `SELECT id FROM photos WHERE favorite_version_id IS NOT NULL
       ORDER BY (taken_at IS NULL) ASC, taken_at ASC, id ASC`,
    )
    .all();
  bakeBatch = { running: true, total: rows.length, done: 0, failed: 0, current: null };
  void (async () => {
    for (const r of rows) {
      bakeBatch.current = r.id;
      try {
        const res = await bakePhoto(r.id);
        if (res.ok) bakeBatch.done++;
        else bakeBatch.failed++;
      } catch {
        bakeBatch.failed++;
      }
    }
    bakeBatch.current = null;
    bakeBatch.running = false;
  })();
  return c.json({ started: rows.length });
});

// ---- API: runs (generation batches) ----------------------------------------
// A "run" is a time-cluster of generated versions — one regeneration batch.
// The schema has no batch id, so runs are derived from created_at gaps.
const RUN_GAP_MS = 20 * 60 * 1000;
type RunItem = { photo_id: string; version_number: number; created_at: number };
type RunCluster = { id: number; from: number; to: number; items: RunItem[] };

function computeRuns(): RunCluster[] {
  const rows = db()
    .query<RunItem, []>(
      "SELECT photo_id, version_number, created_at FROM versions WHERE source = 'generated' ORDER BY created_at ASC, id ASC",
    )
    .all();
  const runs: RunCluster[] = [];
  let cur: RunCluster | null = null;
  for (const r of rows) {
    if (!cur || r.created_at - cur.to > RUN_GAP_MS) {
      cur = { id: r.created_at, from: r.created_at, to: r.created_at, items: [] };
      runs.push(cur);
    }
    cur.items.push(r);
    cur.to = r.created_at;
  }
  return runs;
}

app.get("/api/runs", (c) => {
  const runs = computeRuns()
    .map((run) => ({
      id: run.id,
      from: run.from,
      to: run.to,
      versions: run.items.length,
      photos: new Set(run.items.map((i) => i.photo_id)).size,
    }))
    // Skip single-photo probe edits — a "run" the user browses is a batch.
    .filter((r) => r.photos >= 3)
    .sort((a, b) => b.from - a.from); // newest first
  return c.json({ runs });
});

app.get("/api/runs/:id/photos", (c) => {
  const id = Number(c.req.param("id"));
  const run = computeRuns().find((r) => r.id === id);
  if (!run) return c.json({ photos: [] });
  // One version per photo — the latest produced within this run.
  const latest = new Map<string, number>();
  for (const it of run.items) {
    const prev = latest.get(it.photo_id);
    if (prev == null || it.version_number > prev) latest.set(it.photo_id, it.version_number);
  }
  const photos = [...latest.entries()]
    .map(([pid, v]) => ({
      id: pid,
      version_number: v,
      taken_at: getPhoto(pid)?.taken_at ?? null,
    }))
    .sort((a, b) => (a.taken_at ?? 0) - (b.taken_at ?? 0));
  return c.json({ photos });
});

// ---- API: health -----------------------------------------------------------

app.get("/api/health", async (c) => {
  const browser = await checkChatgptBrowserAlive();
  return c.json({
    browser,
    openclaw: browser, // legacy alias for older clients
    cdp_url: CHATGPT_CDP_URL,
    hint: browser
      ? null
      : `ChatGPT browser non avviato. POST /api/browser/launch o usa il bottone in UI.`,
  });
});

app.post("/api/browser/launch", async (c) => {
  const res = await launchChatgptBrowser();
  if (!res.ok) return c.json({ ok: false, error: res.error }, 500);
  return c.json({ ok: true, cdp_url: CHATGPT_CDP_URL });
});

// ---- Static: raw, generations, thumbs --------------------------------------

function serveFile(absPath: string, mime?: string): Response {
  if (!existsSync(absPath)) return new Response("not found", { status: 404 });
  const stat = statSync(absPath);
  const data = readFileSync(absPath);
  return new Response(data, {
    headers: {
      "content-type": mime ?? guessMime(absPath),
      "content-length": String(stat.size),
      "cache-control": "public, max-age=300",
    },
  });
}

function guessMime(p: string): string {
  const ext = extname(p).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  // ES modules and CSS MUST have correct MIME or the browser refuses them.
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

app.get("/raw/:filename", (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(rawDir(), filename));
});

// Serve a photo's original by id, reading its stored path directly. Works for
// both imported originals (in RAW) and generated photos (in GEN), and is the
// canonical "original" URL used by the client.
app.get("/orig/:id", (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo || !photo.original_path || !existsSync(photo.original_path)) {
    return new Response("not found", { status: 404 });
  }
  return serveFile(photo.original_path);
});

app.get("/gen/:photoId/:filename", (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (
    photoId.includes("..") ||
    photoId.includes("/") ||
    filename.includes("..") ||
    filename.includes("/")
  ) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(genDir(), photoId, filename));
});

app.get("/orphan/:filename", (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(test1Dir(), filename));
});

function parseWidth(c: { req: { query: (k: string) => string | undefined } }, def: number, max = 3200): number {
  const w = Number(c.req.query("w"));
  if (!Number.isFinite(w) || w <= 0) return def;
  return Math.min(Math.round(w), max);
}

app.get("/thumb/raw/:id", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return new Response("not found", { status: 404 });
  try {
    const path = await thumbnailPath(photo.original_path, parseWidth(c, 480));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

app.get("/thumb/gen/:photoId/:filename", async (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (
    photoId.includes("..") ||
    photoId.includes("/") ||
    filename.includes("..") ||
    filename.includes("/")
  ) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(genDir(), photoId, filename);
  try {
    const path = await thumbnailPath(source, parseWidth(c, 720));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

app.get("/thumb/orphan/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(test1Dir(), filename);
  try {
    const path = await thumbnailPath(source, parseWidth(c, 480));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

// Serve a generation with the color look (step engine: WB + levels + sakura +
// LUT + color) applied on the fly, cached on disk by a params-hash. Grade off /
// no active steps / grade error all fail open to the ungraded generation, so the
// grid never breaks.
app.get("/graded/:photoId/:filename", (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (!safeSeg(photoId) || !safeSeg(filename)) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(genDir(), photoId, filename);
  if (!existsSync(source)) return new Response("not found", { status: 404 });

  // Grade base = per-photo override if present, else the global; then optional
  // query params (unsaved live preview) override it.
  const photo = getPhoto(photoId);
  const base = photo ? effectiveGrade(photo) : getColorGrade();
  const cfg = gradeFromQuery(c, base);
  if (!gradeActive(cfg)) {
    return serveFile(source); // passthrough — ungraded original
  }
  const width = parseWidth(c, 1600, 3200);
  const wbGain = sceneMatchRequested(cfg) ? wbGainFor(photoId) : null;
  const out = gradedFile(photoId, filename, source, cfg, width, wbGain);
  if (!existsSync(out)) {
    const ok = runColorGrade(source, out, cfg, width, 90, 60000, wbGain);
    if (!ok) return serveFile(source); // fail open on grade error
  }
  return serveFile(out, "image/jpeg");
});

// Overlay an UNSAVED grade passed as a JSON blob in the `g` query param, so a
// client (the live preview / per-photo editor) can render a grade before it's
// persisted. No `g` ⇒ returns `base` untouched (grid keeps stored-grade behavior).
function gradeFromQuery(
  c: { req: { query: (k: string) => string | undefined } },
  base: ColorGrade,
): ColorGrade {
  const g = c.req.query("g");
  if (!g) return base;
  try {
    return normalizeGrade(JSON.parse(g));
  } catch {
    return base;
  }
}

// ---- API: Studio (multi-project overview) ---------------------------------
// Aggregates, for every registered project, its pipeline/queue state so a
// single top-level page can supervise all local projects. The worker (shared
// ChatGPT browser) is global, so its health/runner status is reported once.

/** Gather a project's headline stats within its own DB context. */
function projectStats(pid: string) {
  return withProject(pid, () => {
    const d = db();
    const one = (sql: string): number =>
      d.query<{ n: number }, []>(sql).get()?.n ?? 0;
    const favorites = one(
      "SELECT COUNT(*) AS n FROM photos WHERE favorite_version_id IS NOT NULL",
    );
    const photos = one("SELECT COUNT(*) AS n FROM photos");
    const versions = one("SELECT COUNT(*) AS n FROM versions");
    const last =
      d.query<{ t: number | null }, []>(
        "SELECT MAX(created_at) AS t FROM versions",
      ).get()?.t ?? null;
    return { favorites, photos, versions, queue: jobsSummary(), last_version_at: last };
  });
}

app.get("/api/studio/projects", async (c) => {
  const projects = listProjects().map((p) => {
    const d = dirsFor(p.id);
    let stats: ReturnType<typeof projectStats> | null = null;
    let error: string | null = null;
    try {
      stats = projectStats(p.id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      ...p,
      db_path: d.DB_PATH,
      root_exists: existsSync(p.root),
      stats,
      error,
    };
  });
  const browserAlive =
    WORKER_BACKEND === "codex" ? null : await checkChatgptBrowserAlive().catch(() => false);
  return c.json({
    projects,
    worker: {
      backend: WORKER_BACKEND,
      browser_alive: browserAlive,
      runner: getRunnerStatus(),
    },
  });
});

app.post("/api/studio/projects", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    root?: string;
  };
  const root = (body.root ?? "").trim();
  if (!root || !existsSync(root)) {
    return c.json({ error: `root inesistente: ${root || "(vuoto)"}` }, 400);
  }
  try {
    const project = addProject({ id: body.id ?? "", name: body.name, root });
    return c.json({ project });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.patch("/api/studio/projects/:pid", async (c) => {
  const pid = c.req.param("pid");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    active?: boolean;
  };
  const project = updateProject(pid, body);
  if (!project) return c.json({ error: "progetto non trovato" }, 404);
  return c.json({ project });
});

// ---- Static: built SPA (dist) + live filter previews -----------------------
// Lets the dashboard be served from the backend port directly (no separate
// Vite needed). Previews are served live from client/public so freshly
// generated thumbnails show up without a rebuild.
// The built SPA + previews are part of the APP, not a project's data — serve
// them from the repo (where `vite build` emits dist/), independent of the
// active project. (Vite's outDir is <repo>/dist.)
const DIST_DIR = join(REPO_ROOT, "dist");
const PUBLIC_DIR = join(REPO_ROOT, "client", "public");

app.get("/previews/*", (c) => {
  const rel = c.req.path.replace(/^\/+/, "");
  if (rel.includes("..")) return new Response("bad request", { status: 400 });
  return serveFile(join(PUBLIC_DIR, rel));
});

app.get("/assets/*", (c) => {
  const rel = c.req.path.replace(/^\/+/, "");
  if (rel.includes("..")) return new Response("bad request", { status: 400 });
  return serveFile(join(DIST_DIR, rel));
});

// SPA fallback: any other GET serves index.html (client-side routing).
app.get("*", () => serveFile(join(DIST_DIR, "index.html"), "text/html; charset=utf-8"));

// ---- Boot ------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3535);
startRunner();

console.log(`Darkroom server listening on http://localhost:${PORT}`);
console.log(`  projects:    ${listProjects().map((p) => p.id).join(", ")}`);
console.log(`  RAW:         ${rawDir()}`);
console.log(`  generations: ${genDir()}`);
console.log(`  final:       ${finalDir()}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
