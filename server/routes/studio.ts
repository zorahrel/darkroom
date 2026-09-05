import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { WORKER_BACKEND, BACKEND_USES_BROWSER, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, openaiKey } from "../config.ts";
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

/** Spend recorded on the versions, in dollars. It sums what the jobs really
 *  reported: versions from quota backends have `credits` NULL and do not enter
 *  the count. */
function spent(): { usd: number; images: number; model: string; quality: string } {
  let usd = 0;
  let images = 0;
  for (const p of listProjects()) {
    withProject(p.id, () => {
      // The CALLS are counted, not the versions saved. Counting `versions` gave
      // $1.26 over 6 images where the calls were 21 for ~$4.47: the calibration
      // attempts, the discards and the failures are paid for and left no
      // version to count.
      const r = db()
        .query<{ tot: number | null; n: number }, []>(
          "SELECT SUM(cost_usd) AS tot, COUNT(*) AS n FROM api_calls WHERE provider='openai'",
        )
        .get();
      usd += r?.tot ?? 0;
      images += r?.n ?? 0;
    });
  }
  return {
    usd: Math.round(usd * 10000) / 10000,
    images,
    model: OPENAI_IMAGE_MODEL,
    quality: OPENAI_IMAGE_QUALITY,
  };
}

/** If any project has already generated with OpenAI, the spend is shown even
 *  when the active backend is another one: that money stays spent. */
function hasOpenAiVersions(): boolean {
  for (const p of listProjects()) {
    let found = false;
    withProject(p.id, () => {
      found = !!db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM api_calls WHERE provider='openai'").get()?.n;
    });
    if (found) return true;
  }
  return false;
}

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
 * A video project's numbers.
 *
 * A photo project's three columns — photos, favourites, versions — are all zero
 * on a video, because those tables are never filled here. Three zeros do not
 * say "this project is empty": they say you are looking at the wrong thing. An
 * edit's numbers are different ones, and they live in the files the chain
 * writes.
 */
function statsVideo(root: string) {
  const read = <T,>(name: string, otherwise: T): T => {
    try { return JSON.parse(readFileSync(join(root, name), "utf8")) as T; }
    catch { return otherwise; }
  };
  const plan = read<{ segments?: unknown[] }>("plan.json", {});
  const edl = read<{ total_s?: number }>("edl.json", {});
  // durezza.json is not a map of shots: it is { musica_per_battuta, piani }.
  // Counting its keys gave 2.
  const intensity = read<{ shots?: Record<string, unknown> }>("durezza.json", {});
  return {
    cuts: plan.segments?.length ?? 0,
    shots: Object.keys(intensity.shots ?? {}).length,
    duration: edl.total_s ?? 0,
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
      video: p.views.includes("video") && existsSync(p.root) ? statsVideo(p.root) : null,
      error,
    };
  });
  const browserAlive =
    BACKEND_USES_BROWSER ? await checkChatgptBrowserAlive().catch(() => false) : null;

  // How much it has cost so far, summed from the jobs. The BALANCE cannot be
  // read: the /organization/costs and /dashboard/billing endpoints answer 403
  // "Missing scopes: api.usage.read" with an ordinary project key. Showing the
  // measured spend is honest; showing an invented balance is not.
  const spend =
    WORKER_BACKEND === "openai" || hasOpenAiVersions()
      ? spent()
      : null;
  return c.json({
    projects,
    worker: {
      backend: WORKER_BACKEND,
      browser_alive: browserAlive,
      runner: getRunnerStatus(),
      /** Present only for the paid backends. `key` says whether it is
       *  configured: without it the backend does not start, and that has to be
       *  said in advance. */
      spend,
      openai_key: WORKER_BACKEND === "openai" ? !!openaiKey() : null,
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
    views?: ("photo" | "storyboard" | "video")[];
    photos?: { path: string; mode?: "link" | "copy" };
  };
  try {
    const project = addProject({
      name: body.name ?? "",
      id: body.id,
      root: body.root,
      kind: body.kind,
      views: body.views,
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
    views?: ("photo" | "storyboard" | "video")[];
  };
  const project = updateProject(pid, body);
  if (!project) return c.json({ error: "progetto non trovato" }, 404);
  return c.json({ project });
});
