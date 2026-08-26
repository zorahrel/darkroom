import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { WORKER_BACKEND, BACKEND_USES_BROWSER } from "../config.ts";
import {
  addProject,
  dirsFor,
  listProjects,
  removeProject,
  updateProject,
  withProject,
} from "../project.ts";
import { getRunnerStatus, jobsSummary } from "../jobs.ts";
import { addSource, listSources, removeSource, rescanSources } from "../sources.ts";
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

/**
 * I numeri di un progetto video.
 *
 * Le tre colonne di un progetto foto — foto, preferite, versioni — su un video
 * valgono zero tutte e tre, perche' quelle tabelle qui non si riempiono mai.
 * Tre zeri non dicono "questo progetto e' vuoto": dicono che si sta guardando
 * la cosa sbagliata. I numeri di un montaggio sono altri, e stanno nei file che
 * la catena scrive.
 */
function statsVideo(root: string) {
  const leggi = <T,>(nome: string, altrimenti: T): T => {
    try { return JSON.parse(readFileSync(join(root, nome), "utf8")) as T; }
    catch { return altrimenti; }
  };
  const plan = leggi<{ segments?: unknown[] }>("plan.json", {});
  const edl = leggi<{ total_s?: number }>("edl.json", {});
  // durezza.json non e' una mappa di piani: e' { musica_per_battuta, piani }.
  // Contare le sue chiavi dava 2.
  const durezza = leggi<{ piani?: Record<string, unknown> }>("durezza.json", {});
  return {
    tagli: plan.segments?.length ?? 0,
    piani: Object.keys(durezza.piani ?? {}).length,
    durata: edl.total_s ?? 0,
  };
}

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
    const panels = one("SELECT COUNT(*) AS n FROM photos WHERE sequence_index IS NOT NULL");
    const last =
      d.query<{ t: number | null }, []>(
        "SELECT MAX(created_at) AS t FROM versions",
      ).get()?.t ?? null;
    return { favorites, photos, versions, panels, queue: jobsSummary(), last_version_at: last };
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
      video: p.kind === "video" && existsSync(p.root) ? statsVideo(p.root) : null,
      error,
    };
  });
  const browserAlive =
    BACKEND_USES_BROWSER ? await checkChatgptBrowserAlive().catch(() => false) : null;
  return c.json({
    projects,
    worker: {
      backend: WORKER_BACKEND,
      browser_alive: browserAlive,
      runner: getRunnerStatus(),
    },
  });
});

// A name is all it takes: the id is derived and the folder is created under
// PROJECTS_DIR. `root` is the escape hatch for an existing folder of your own.
studioRoutes.post("/api/studio/projects", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    root?: string;
    kind?: "photo" | "storyboard" | "video";
    photos?: { path: string; mode?: "link" | "copy" };
  };
  try {
    const project = addProject({
      name: body.name ?? "",
      id: body.id,
      root: body.root,
      kind: body.kind,
    });
    // Photos, if the user picked a folder in the same step. Runs inside the new
    // project's context so it lands in ITS database, not the active one's.
    let summary = null;
    if (body.photos?.path) {
      summary = withProject(project.id, () =>
        addSource({ path: body.photos!.path, mode: body.photos!.mode }).summary,
      );
    }
    return c.json({ project, summary });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Forget a project: registry only, the files stay.
studioRoutes.delete("/api/studio/projects/:pid", (c) => {
  const removed = removeProject(c.req.param("pid"));
  if (!removed) return c.json({ error: "progetto non trovato" }, 404);
  return c.json({ ok: true, project: removed, projects: listProjects() });
});

// Photo sources of the ACTIVE project (the project middleware resolves it).
studioRoutes.get("/api/sources", (c) => c.json({ sources: listSources() }));

studioRoutes.post("/api/sources", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: string; mode?: "link" | "copy" };
  try {
    const { source, summary } = addSource({ path: body.path ?? "", mode: body.mode });
    return c.json({ source, summary, sources: listSources() });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

studioRoutes.post("/api/sources/rescan", (c) => c.json({ summary: rescanSources(), sources: listSources() }));

studioRoutes.delete("/api/sources", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: string };
  const ok = removeSource(String(body.path ?? ""));
  if (!ok) return c.json({ error: "sorgente non registrata" }, 404);
  return c.json({ ok: true, sources: listSources() });
});

studioRoutes.patch("/api/studio/projects/:pid", async (c) => {
  const pid = c.req.param("pid");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    active?: boolean;
    kind?: "photo" | "storyboard" | "video";
  };
  const project = updateProject(pid, body);
  if (!project) return c.json({ error: "progetto non trovato" }, 404);
  return c.json({ project });
});
