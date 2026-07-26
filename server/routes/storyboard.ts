import { Hono } from "hono";
import {
  appendToSequence,
  createPanels,
  deleteCharacter,
  getStoryboardSettings,
  listCharacters,
  listPanels,
  removeFromSequence,
  setSequence,
  setStoryboardSettings,
  updatePanel,
  upsertCharacter,
  type Beat,
} from "../storyboard.ts";
import { exportStoryboard } from "../storyboardExport.ts";

/**
 * Storyboard API. Everything here is plain DB work — the one exception is
 * `POST /panels`, which turns a beat sheet into queued generation jobs.
 * Re-ordering a board must never touch the worker.
 */
export const storyboardRoutes = new Hono();

/** Message from a thrown error, without leaking a stack to the client. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

storyboardRoutes.get("/", (c) =>
  c.json({
    panels: listPanels(),
    characters: listCharacters(),
    settings: getStoryboardSettings(),
  }),
);

storyboardRoutes.get("/settings", (c) => c.json({ settings: getStoryboardSettings() }));

storyboardRoutes.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
  return c.json({ settings: setStoryboardSettings(body) });
});

storyboardRoutes.put("/sequence", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.ids)) return c.json({ error: "ids array required" }, 400);
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  const { updated, skipped } = setSequence(ids);
  return c.json({ ok: true, updated, skipped, panels: listPanels() });
});

storyboardRoutes.post("/sequence/add", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.ids)) return c.json({ error: "ids array required" }, 400);
  const ids = body.ids.filter((id): id is string => typeof id === "string");
  const { added } = appendToSequence(ids);
  return c.json({ ok: true, added, panels: listPanels() });
});

storyboardRoutes.patch("/panels/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
  try {
    const panel = updatePanel(c.req.param("id"), body);
    if (!panel) return c.json({ error: "not found" }, 404);
    return c.json({ panel });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

storyboardRoutes.delete("/panels/:id", (c) => {
  const removed = removeFromSequence(c.req.param("id"));
  if (!removed) return c.json({ error: "not a panel of this storyboard" }, 404);
  return c.json({ ok: true, panels: listPanels() });
});

storyboardRoutes.post("/panels", async (c) => {
  const body = await c.req.json<{ beats?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.beats)) return c.json({ error: "beats array required" }, 400);
  try {
    const { ids, enqueued } = createPanels(body.beats as Beat[]);
    return c.json({ ok: true, ids, enqueued, panels: listPanels() });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

storyboardRoutes.get("/characters", (c) => c.json({ characters: listCharacters() }));

storyboardRoutes.post("/characters", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
  try {
    return c.json({ character: upsertCharacter(body) });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

storyboardRoutes.delete("/characters/:id", (c) => {
  const ok = deleteCharacter(c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, characters: listCharacters(), panels: listPanels() });
});

storyboardRoutes.post("/export", (c) => {
  try {
    return c.json({ ok: true, ...exportStoryboard() });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});
