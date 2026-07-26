import { Hono } from "hono";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db, effectiveGrade, getColorGrade, getDefaultConfig } from "../db.ts";
import { finalDir } from "../project.ts";
import { DEFAULT_CONFIG, assemblePrompt, parseConfig } from "../promptConfig.ts";
import { effectiveConfig, ensureFinalDir, getPhoto, withExtra } from "../photos.ts";
import { gradeActive, runColorGrade, sceneMatchRequested } from "../gradeCache.ts";
import { wbGainFor } from "../sceneWb.ts";
import { enqueueJob } from "../jobs.ts";
import { bakePhoto } from "../bake.ts";

/** The pipeline: export, regenerate/promote the set, bake, and run history. */
export const pipelineRoutes = new Hono();

// ---- API: export -----------------------------------------------------------

pipelineRoutes.post("/api/export-favorites", (c) => {
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

// ---- API: pipeline (AI generation stage as a first-class system step) ------

// Regenerate the whole favorite set through the AI edit worker with the
// system's effective config. This is the generation stage of the pipeline,
// exposed as one action instead of a manual per-photo loop.
pipelineRoutes.post("/api/pipeline/regenerate", (c) => {
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
pipelineRoutes.post("/api/pipeline/promote-latest", (c) => {
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
pipelineRoutes.get("/api/pipeline/status", (c) => {
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
pipelineRoutes.post("/api/pipeline/bake/:id", async (c) => {
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

pipelineRoutes.get("/api/pipeline/bake-status", (c) => c.json(bakeBatch));

pipelineRoutes.post("/api/pipeline/bake-favorites", (c) => {
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

pipelineRoutes.get("/api/runs", (c) => {
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

pipelineRoutes.get("/api/runs/:id/photos", (c) => {
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
