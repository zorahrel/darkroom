import { Hono } from "hono";
import { readLog } from "../mcpLog.ts";

export const mcpLogRoutes = new Hono();
mcpLogRoutes.get("/api/mcp-log", (c) => {
  const outcome = c.req.query("outcome");
  const before = c.req.query("before");
  const limit = c.req.query("limit");
  if ((outcome && outcome !== "ok" && outcome !== "errore") ||
      [before, limit].some((v) => v !== undefined && (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < 1))) {
    return c.json({ error: "Filtri del registro non validi" }, 400);
  }
  c.header("Cache-Control", "no-store");
  return c.json(readLog({ tool: c.req.query("tool"), outcome: outcome as "ok" | "errore" | undefined,
    before: before ? Number(before) : undefined, limit: limit ? Number(limit) : undefined,
    project: c.req.query("project"),
  }));
});
