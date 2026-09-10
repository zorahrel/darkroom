import { Hono } from "hono";
import { AREAS, TOOLS, requirements, tool, type Requirement } from "../tools.ts";
import { WORKER_BACKEND } from "../config.ts";
import { addProject, currentProjectId, getProject, listProjects, withProject } from "../project.ts";
import { addSource } from "../sources.ts";
import { setGlobalPrompt } from "../db.ts";
import { enqueueMissing, createGenerations } from "./generation.ts";
import { exportFavorites } from "./pipeline.ts";
import { startVerification } from "./verify.ts";
import { createPanels } from "../storyboard.ts";
import { launchChatgptBrowser } from "../worker.ts";
import { saluteBrowser } from "./studio.ts";

/**
 * The tool catalogue, and the way to begin one.
 *
 * Two routes only. `GET /api/tools` says what Darkroom can do and which of that
 * is ready right now on this machine; `POST /api/tools/:id/start` begins it —
 * making the project it needs, if it needs one — and answers with the page to
 * land on.
 *
 * The second is why the first is not a brochure: "use it now" is not a link to
 * a page where you then have to work out what to do, it is the thing done. And
 * because it lives in the server, the interface, the MCP and the chat to come
 * all do it the same way — with a single path to keep working.
 */
export const toolRoutes = new Hono();

toolRoutes.get("/api/tools", async (c) => {
  const req = await requirements(saluteBrowser);
  return c.json({
    areas: AREAS,
    requirements: req,
    backend: WORKER_BACKEND,
    tools: TOOLS.map((s) => {
      const missing = s.needs.filter((r) => !req[r].ok);
      return {
        ...s,
        // "Ready" means one thing: you can use it now. What is missing is named,
        // with the gesture that fixes it, because a grey tool with no reason is
        // just a closed door.
        ready: missing.length === 0,
        missing: missing.map((r) => ({ requirement: r, how: req[r].how })),
      };
    }),
  });
});

// ---------------------------------------------------------------------------

type Values = Record<string, string | number | undefined>;

const text = (v: Values, k: string): string => String(v[k] ?? "").trim();
const number = (v: Values, k: string, d: number): number => {
  const n = Number(v[k]);
  return Number.isFinite(n) ? n : d;
};

/** The outcome of a start: where you land, on which project, and what happened. */
type Outcome = { route: string; project: string; done: string; data?: unknown };

/**
 * The project to work on.
 *
 * If one arrives, that one. Otherwise the active one — the same rule as the
 * MCP, where an absent `project` means "the default one". Inventing a new
 * project on every generation on the fly would leave a row of folders on disk
 * that nobody asked for.
 */
function projectOf(given?: string): string {
  if (given && getProject(given)) return given;
  return currentProjectId();
}

/**
 * Chi esegue un avvio.
 *
 * La chiave e' l'id dello strumento, oppure `id:chiave` quando lo strumento ha piu'
 * di una partenza: «genera e rifai» ne ha due — da una frase e da una cartella — e
 * sono due lavori diversi che finiscono nello stesso posto.
 */
const STARTERS: Record<string, (v: Values, project?: string) => Outcome | Promise<Outcome>> = {
  "generate:testo": (v, prog) => {
    const prompt = text(v, "prompt");
    if (!prompt) throw new Error("Serve il prompt: senza, non c'è niente da generare.");
    const pid = projectOf(prog);
    const r = withProject(pid, () => createGenerations(prompt, number(v, "conta", 1)));
    return {
      route: `/p/${pid}`,
      project: pid,
      done: `${r.created} ${r.created === 1 ? "immagine messa" : "immagini messe"} in coda.`,
      data: r,
    };
  },

  "generate:cartella": (v) => {
    const name = text(v, "name");
    const folder = text(v, "folder");
    if (!name) throw new Error("Serve un nome per il lavoro.");
    if (!folder) throw new Error("Serve la cartella delle foto.");
    const p = addProject({ name: name, kind: "photo" });
    return withProject(p.id, () => {
      const { summary } = addSource({ path: folder, mode: "link" });
      const prompt = text(v, "prompt");
      if (prompt) setGlobalPrompt(prompt);
      const enqueued = number(v, "accoda", 1) ? enqueueMissing() : 0;
      return {
        route: `/p/${p.id}`,
        project: p.id,
        done:
          `${summary.added} foto indicizzate` +
          (enqueued ? `, ${enqueued} già in coda.` : ". Le accodi quando vuoi dalla griglia."),
        data: { summary, enqueued },
      };
    });
  },

  sources: (v) => {
    const name = text(v, "name");
    const folder = text(v, "folder");
    if (!name) throw new Error("Serve un nome per la galleria.");
    if (!folder) throw new Error("Serve la cartella delle foto.");
    const p = addProject({ name: name, kind: "photo" });
    const { summary } = withProject(p.id, () => addSource({ path: folder, mode: "link" }));
    return {
      route: `/p/${p.id}`,
      project: p.id,
      done: `${summary.added} foto indicizzate su ${summary.scanned} trovate.`,
      data: summary,
    };
  },

  storyboard: (v) => {
    const name = text(v, "name");
    const rows = text(v, "beats")
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!name) throw new Error("Serve un nome per lo storyboard.");
    if (!rows.length) throw new Error("Serve almeno una inquadratura: una per riga.");
    const p = addProject({ name: name, kind: "storyboard", views: ["photo", "storyboard"] });
    const r = withProject(p.id, () => createPanels(rows.map((description) => ({ description }))));
    return {
      route: `/p/${p.id}/storyboard`,
      project: p.id,
      done: `${r.ids.length} pannelli creati, ${r.enqueued} già in coda per essere disegnati.`,
      data: r,
    };
  },

  edit: (v) => {
    const name = text(v, "name");
    if (!name) throw new Error("Serve un nome per il montaggio.");
    const p = addProject({ name: name, kind: "video", views: ["photo", "video"] });
    return {
      route: `/p/${p.id}/video`,
      project: p.id,
      done: `Progetto video creato in ${p.root}: metti lì le riprese e il brano.`,
      data: p,
    };
  },

  projects: (v) => {
    const name = text(v, "name");
    if (!name) throw new Error("Serve un nome.");
    const p = addProject({ name: name, kind: "photo" });
    return { route: `/p/${p.id}`, project: p.id, done: `Progetto «${p.name}» creato.`, data: p };
  },

  export: (_v, prog) => {
    const pid = projectOf(prog);
    const r = withProject(pid, () => exportFavorites());
    return {
      route: `/p/${pid}`,
      project: pid,
      done: r.total
        ? `${r.copied} preferite su ${r.total} copiate in ${r.dir}.`
        : "Nessuna preferita da esportare: scegli prima la versione buona di qualche foto.",
      data: r,
    };
  },

  quality: (_v, prog) => {
    const pid = projectOf(prog);
    const r = withProject(pid, () => startVerification(200, false));
    return {
      route: `/p/${pid}`,
      project: pid,
      done: r
        ? `Controllo avviato su ${r.started} render. Segnala, non cancella niente.`
        : "Ce n'è già uno in corso: aspetta che finisca.",
      data: r,
    };
  },

  status: async (_v, prog) => {
    const pid = projectOf(prog);
    const r = await launchChatgptBrowser();
    if (!r.ok) throw new Error(r.error ?? "Chrome non è partito.");
    return {
      route: `/p/${pid}`,
      project: pid,
      done: "Chrome dedicato avviato: loggati a chatgpt.com nella finestra che si è aperta.",
    };
  },
};

/** Gli id che hanno un motore. Esportato per la prova che verifica la
 *  corrispondenza col catalogo senza CHIAMARE gli avvii — chiamarli vorrebbe dire
 *  aprire Chrome dentro una suite.
 *
 *  Una chiave composta `id:partenza` conta per il suo id: al catalogo interessa che
 *  lo strumento sia avviabile, non da quale delle sue porte. */
export const STARTABLE = new Set(Object.keys(STARTERS).map((k) => k.split(":")[0]!));

/** Le chiavi cosi' come sono scritte, `id` oppure `id:partenza`. Serve alla prova
 *  che le confronta col catalogo: una partenza che cambia nome da una parte sola non
 *  darebbe nessun errore, il tasto cadrebbe sull'altro avvio e farebbe il lavoro
 *  sbagliato. */
export const CHIAVI_AVVIO = new Set(Object.keys(STARTERS));

toolRoutes.post("/api/tools/:id/start", async (c) => {
  const id = c.req.param("id");
  const s = tool(id);
  if (!s) return c.json({ error: `strumento sconosciuto: ${id}` }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    project?: string;
    values?: Values;
    starter?: string;
  };

  // La partenza scelta, quando ce n'e' piu' d'una. Senza, resta quella sola dello
  // strumento: chi ne ha un avvio solo non ha niente da dichiarare.
  const chiave = String(body.starter ?? "");
  const start = (chiave && STARTERS[`${id}:${chiave}`]) || STARTERS[id];
  if (!start) {
    // Due assenze diverse, e dirle uguali manderebbe a cercare la cosa sbagliata:
    // lo strumento che si apre e basta non ha motori; quello a piu' partenze li ha,
    // ed e' la partenza chiesta a non esistere — di solito una pagina non aggiornata.
    const porte = [...CHIAVI_AVVIO].filter((k) => k.startsWith(`${id}:`)).map((k) => k.slice(id.length + 1));
    return c.json(
      {
        error: porte.length
          ? `«${s.name}» ha ${porte.length} partenze (${porte.join(", ")}) e «${chiave || "nessuna"}» non e' una di quelle.`
          : `«${s.name}» si apre dentro un progetto: non ha un avvio rapido.`,
      },
      400,
    );
  }

  const req = await requirements(saluteBrowser);
  const missing = s.needs.filter((r: Requirement) => !req[r].ok);
  // A missing requirement is stated BEFORE half the work is done: creating the
  // project and then discovering the generator is off leaves an empty folder
  // and no explanation.
  if (missing.length && id !== "stato") {
    return c.json(
      { error: missing.map((r) => req[r].how).join(" "), missing },
      409,
    );
  }

  try {
    const outcome = await start(body.values ?? {}, body.project);
    return c.json({ ok: true, ...outcome });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** Which projects a tool can serve: the ones with the view switched on. */
toolRoutes.get("/api/tools/:id/projects", (c) => {
  const s = tool(c.req.param("id"));
  if (!s) return c.json({ error: "strumento sconosciuto" }, 404);
  const projects = listProjects().filter(
    (p) => s.views.length === 0 || s.views.some((v) => p.views.includes(v)),
  );
  return c.json({ projects });
});
