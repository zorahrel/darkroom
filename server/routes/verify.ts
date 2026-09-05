import { Hono } from "hono";
import { db } from "../db.ts";
import {
  checkPhoto,
  checkVersion,
  deleteFailureMode,
  listFailureModes,
  storedReport,
  suggestFavorite,
  upsertFailureMode,
  verificationSummary,
} from "../verify.ts";

/**
 * Quality control API. The gate reports; it never changes a favourite or
 * deletes a render — those stay explicit user actions.
 */
export const verifyRoutes = new Hono();

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

verifyRoutes.get("/modes", (c) => c.json({ modes: listFailureModes() }));

verifyRoutes.post("/modes", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "body required" }, 400);
  try {
    return c.json({ mode: upsertFailureMode(body) });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

verifyRoutes.delete("/modes/:code", (c) => {
  try {
    const ok = deleteFailureMode(c.req.param("code"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true, modes: listFailureModes() });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

verifyRoutes.get("/versions/:id", (c) => {
  const report = storedReport(Number(c.req.param("id")));
  if (!report) return c.json({ report: null });
  return c.json({ report });
});

verifyRoutes.post("/versions/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const report = await checkVersion(Number(c.req.param("id")), {
      only: Array.isArray(body?.only) ? body.only : undefined,
      includeDisabled: body?.include_disabled === true,
    });
    return c.json({ report });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

verifyRoutes.post("/photos/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const reports = await checkPhoto(c.req.param("id"), {
      only: Array.isArray(body?.only) ? body.only : undefined,
      includeDisabled: body?.include_disabled === true,
    });
    return c.json({ reports, suggestion: suggestFavorite(c.req.param("id")) });
  } catch (err) {
    return c.json({ error: reason(err) }, 400);
  }
});

verifyRoutes.get("/photos/:id", (c) => {
  const id = c.req.param("id");
  const versions = db()
    .query<{ id: number }, [string]>("SELECT id FROM versions WHERE photo_id = ? ORDER BY id ASC")
    .all(id);
  const reports = versions.map((v) => storedReport(v.id)).filter((r) => r !== null);
  return c.json({ reports, suggestion: suggestFavorite(id) });
});

verifyRoutes.get("/summary", (c) => {
  const bucket = Number(c.req.query("bucket"));
  return c.json({ summary: verificationSummary(Number.isFinite(bucket) && bucket > 0 ? bucket : 25) });
});

/**
 * Batch pass over renders that were never checked. Runs in the background (a
 * vision question costs a second or two apiece) and reports progress, in the
 * same shape as the bake batch.
 */
let batch: {
  running: boolean;
  total: number;
  done: number;
  flagged: number;
  failed: number;
  current: string | null;
} = { running: false, total: 0, done: 0, flagged: 0, failed: 0, current: null };

verifyRoutes.get("/batch", (c) => c.json(batch));

/**
 * Starts the check pass in the background.
 *
 * Returns `null` if one is already running: two passes over the same queue
 * tread on each other and the second adds nothing. Outside the route because
 * the home's quick start calls it too.
 */
export function startVerification(limite = 100, recheck = false): { started: number } | null {
  if (batch.running) return null;
  const limit = Math.min(Math.max(Number(limite) || 100, 1), 2000);

  const rows = db()
    .query<{ id: number; photo_id: string }, [number]>(
      `SELECT v.id, v.photo_id FROM versions v
        ${recheck ? "" : "WHERE NOT EXISTS (SELECT 1 FROM version_checks c WHERE c.version_id = v.id)"}
        ORDER BY v.id DESC
        LIMIT ?`,
    )
    .all(limit);

  batch = { running: true, total: rows.length, done: 0, flagged: 0, failed: 0, current: null };
  void (async () => {
    for (const row of rows) {
      batch.current = row.photo_id;
      try {
        const report = await checkVersion(row.id);
        batch.done++;
        if (report.hits.length) batch.flagged++;
      } catch {
        batch.failed++;
      }
    }
    batch.current = null;
    batch.running = false;
  })();

  return { started: rows.length };
}

verifyRoutes.post("/batch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const started = startVerification(Number(body?.limit) || 100, body?.recheck === true);
  if (!started) return c.json({ error: "verifica già in corso", status: batch }, 409);
  return c.json(started);
});
