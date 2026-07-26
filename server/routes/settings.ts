import { Hono } from "hono";
import { readdirSync } from "node:fs";
import {
  createPreset,
  db,
  deletePreset,
  getColorGrade,
  getDefaultConfig,
  getGlobalPrompt,
  getPreset,
  listPresets,
  normalizeGrade,
  renamePreset,
  setColorGrade,
  setDefaultConfig,
  setGlobalPrompt,
} from "../db.ts";
import { LUT_DIR } from "../config.ts";
import { importTemplate } from "../templates.ts";
import {
  DEFAULT_CONFIG,
  assemblePrompt,
  mergeConfig,
  parseConfig,
  type PromptConfig,
} from "../promptConfig.ts";
import { effectiveConfig, getPhoto } from "../photos.ts";

/** Settings the whole set shares: prompt, default config, color grade, presets. */
export const settingsRoutes = new Hono();

// ---- API: settings ---------------------------------------------------------

settingsRoutes.get("/api/settings/global-prompt", (c) =>
  c.json({ prompt: getGlobalPrompt() }),
);

settingsRoutes.put("/api/settings/global-prompt", async (c) => {
  const body = await c.req.json<{ prompt: string }>();
  if (typeof body.prompt !== "string" || body.prompt.length < 10) {
    return c.json({ error: "prompt too short" }, 400);
  }
  setGlobalPrompt(body.prompt);
  return c.json({ ok: true });
});

// ---- API: structured prompt config ----------------------------------------

settingsRoutes.get("/api/settings/default-config", (c) => {
  const cfg = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  return c.json({ config: cfg, prompt: assemblePrompt(cfg) });
});

settingsRoutes.put("/api/settings/default-config", async (c) => {
  const body = await c.req.json<{ config: Partial<PromptConfig> }>();
  if (!body || typeof body.config !== "object") return c.json({ error: "config missing" }, 400);
  const merged = mergeConfig(DEFAULT_CONFIG, body.config);
  setDefaultConfig(JSON.stringify(merged));
  return c.json({ ok: true, config: merged, prompt: assemblePrompt(merged) });
});

settingsRoutes.put("/api/photos/:id/config", async (c) => {
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
settingsRoutes.put("/api/photos/:id/grade", async (c) => {
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

// ---- API: color grade ------------------------------------------------------

settingsRoutes.get("/api/luts", (c) => {
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

settingsRoutes.get("/api/settings/color-grade", (c) => c.json({ grade: getColorGrade() }));

settingsRoutes.put("/api/settings/color-grade", async (c) => {
  const body = await c.req.json<{ grade: unknown }>().catch(() => null);
  if (!body || typeof body.grade !== "object" || body.grade === null) {
    return c.json({ error: "grade missing" }, 400);
  }
  const next = normalizeGrade(body.grade);
  setColorGrade(next);
  return c.json({ ok: true, grade: next });
});

// ---- API: presets / templates --------------------------------------------

settingsRoutes.get("/api/presets", (c) => c.json({ presets: listPresets() }));

settingsRoutes.post("/api/presets", async (c) => {
  const body = await c.req.json<{ name?: string; grade?: unknown }>().catch(() => null);
  if (!body || typeof body.grade !== "object" || body.grade === null) {
    return c.json({ error: "grade missing" }, 400);
  }
  const preset = createPreset(String(body.name ?? "Senza nome"), normalizeGrade(body.grade));
  return c.json({ ok: true, preset });
});

settingsRoutes.put("/api/presets/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  if (!id || !body || typeof body.name !== "string") {
    return c.json({ error: "name missing" }, 400);
  }
  if (!getPreset(id)) return c.json({ error: "not found" }, 404);
  renamePreset(id, body.name);
  return c.json({ ok: true, preset: getPreset(id) });
});

settingsRoutes.delete("/api/presets/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!id) return c.json({ error: "bad id" }, 400);
  deletePreset(id);
  return c.json({ ok: true });
});

// Import an external template (Lightroom .xmp/.lrtemplate, a .cube LUT, or our
// own JSON). Body: { filename, text }. Returns the mapped grade + `notes` on
// what couldn't be reproduced; the client decides whether to apply or save it.
settingsRoutes.post("/api/templates/import", async (c) => {
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
