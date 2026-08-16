import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { db, type PhotoRow } from "../db.ts";
import { mergeConfig, type PromptConfig } from "../promptConfig.ts";
import { effectiveConfig, getPhoto, promptFor, withExtra } from "../photos.ts";
import { enqueueJob } from "../jobs.ts";
import {
  higgsfieldConfigured,
  balance as hfBalance,
  listImageModels as hfModels,
  getCost as hfCost,
} from "../higgsfield.ts";

/** Queueing work: per-photo edits, Higgsfield, and from-zero generation. */
export const generationRoutes = new Hono();

// ---- API: generation -------------------------------------------------------

generationRoutes.post("/api/photos/:id/generate", async (c) => {
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
  const prompt = promptFor(cfg);
  const job = enqueueJob(id, prompt, JSON.stringify(cfg));
  return c.json({ job });
});

// ---- Higgsfield -----------------------------------------------------------

generationRoutes.get("/api/higgsfield/status", async (c) => {
  if (!higgsfieldConfigured()) return c.json({ configured: false });
  try {
    const bal = await hfBalance();
    return c.json({ configured: true, ...bal });
  } catch (err) {
    return c.json({ configured: true, error: String(err) });
  }
});

generationRoutes.get("/api/higgsfield/models", async (c) => {
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

generationRoutes.get("/api/higgsfield/cost", async (c) => {
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

generationRoutes.post("/api/photos/:id/generate-higgsfield", async (c) => {
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
  const prompt = promptFor(cfg);
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

generationRoutes.post("/api/photos/reindex-times", async (c) => {
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

generationRoutes.post("/api/generate-missing", (c) => {
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
    enqueueJob(p.id, promptFor(cfg), JSON.stringify(cfg));
    count++;
  }
  return c.json({ enqueued: count });
});

// Generate brand-new images from a text prompt (no source photo). Each creates
// a `kind='generated'` photo whose first render becomes its original.
generationRoutes.post("/api/generate-new", async (c) => {
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
