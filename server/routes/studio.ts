import { Hono } from "hono";
import { existsSync } from "node:fs";
import { db } from "../db.ts";
import { WORKER_BACKEND } from "../config.ts";
import { addProject, dirsFor, listProjects, updateProject, withProject } from "../project.ts";
import { getRunnerStatus, jobsSummary } from "../jobs.ts";
import { CHATGPT_CDP_URL, checkChatgptBrowserAlive, launchChatgptBrowser } from "../worker.ts";

/** Worker health and the multi-project overview. */
export const studioRoutes = new Hono();

// ---- API: health -----------------------------------------------------------

studioRoutes.get("/api/health", async (c) => {
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

studioRoutes.post("/api/browser/launch", async (c) => {
  const res = await launchChatgptBrowser();
  if (!res.ok) return c.json({ ok: false, error: res.error }, 500);
  return c.json({ ok: true, cdp_url: CHATGPT_CDP_URL });
});

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

studioRoutes.get("/api/studio/projects", async (c) => {
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

studioRoutes.post("/api/studio/projects", async (c) => {
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

studioRoutes.patch("/api/studio/projects/:pid", async (c) => {
  const pid = c.req.param("pid");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    active?: boolean;
  };
  const project = updateProject(pid, body);
  if (!project) return c.json({ error: "progetto non trovato" }, 404);
  return c.json({ project });
});
