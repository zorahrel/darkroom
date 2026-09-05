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
import { checkChatgptBrowserAlive, launchChatgptBrowser } from "../worker.ts";

/**
 * Il catalogo degli strumenti, e il modo di cominciarne uno.
 *
 * Due rotte sole. `GET /api/tools` dice cosa Darkroom sa fare e cosa di
 * quello è pronto adesso su questa macchina; `POST /api/tools/:id/start`
 * lo comincia — facendo il progetto che serve, se serve — e risponde con la
 * pagina su cui atterrare.
 *
 * La seconda è il motivo per cui la prima non è una brochure: "usa subito" non
 * è un link a una pagina dove poi bisogna capire cosa fare, è la cosa fatta.
 * E siccome vive nel server, la fanno allo stesso modo l'interfaccia, l'MCP e
 * la chat che verrà — con un cammino solo da tenere funzionante.
 */
export const toolRoutes = new Hono();

toolRoutes.get("/api/tools", async (c) => {
  const req = await requirements(checkChatgptBrowserAlive);
  return c.json({
    areas: AREAS,
    requirements: req,
    backend: WORKER_BACKEND,
    tools: TOOLS.map((s) => {
      const missing = s.needs.filter((r) => !req[r].ok);
      return {
        ...s,
        // "Pronto" è una cosa sola: puoi usarlo adesso. Ciò che manca è detto
        // per nome, con il gesto che lo sistema, perché uno strumento grigio
        // senza motivo è solo una porta chiusa.
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

/** L'esito di un avvio: dove si atterra, su quale progetto, e cosa è successo. */
type Outcome = { route: string; project: string; done: string; data?: unknown };

/**
 * Il progetto su cui lavorare.
 *
 * Se ne arriva uno, quello. Altrimenti si usa l'attivo — la stessa regola
 * dell'MCP, dove `project` assente vuol dire "quello predefinito". Inventare
 * un progetto nuovo a ogni generazione al volo lascerebbe sul disco una fila
 * di cartelle che nessuno ha chiesto.
 */
function projectOf(given?: string): string {
  if (given && getProject(given)) return given;
  return currentProjectId();
}

const STARTERS: Record<string, (v: Values, project?: string) => Outcome | Promise<Outcome>> = {
  generate: (v, prog) => {
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

  retouch: (v) => {
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

/** Gli id che hanno un motore. Esportato per il test che verifica la
 *  corrispondenza col catalogo senza dover CHIAMARE gli avvii — chiamarli
 *  vorrebbe dire far partire Chrome dentro una suite. */
export const AVVIABILI = new Set(Object.keys(STARTERS));

toolRoutes.post("/api/tools/:id/start", async (c) => {
  const id = c.req.param("id");
  const s = tool(id);
  if (!s) return c.json({ error: `strumento sconosciuto: ${id}` }, 404);
  const start = STARTERS[id];
  if (!start) {
    return c.json(
      { error: `«${s.name}» si apre dentro un progetto: non ha un avvio rapido.` },
      400,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    project?: string;
    values?: Values;
  };

  const req = await requirements(checkChatgptBrowserAlive);
  const missing = s.needs.filter((r: Requirement) => !req[r].ok);
  // Un requisito che manca si dice PRIMA di fare metà del lavoro: creare il
  // progetto e poi scoprire che il generatore è spento lascia una cartella
  // vuota e nessuna spiegazione.
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

/** Quali progetti può servire uno strumento: quelli con la vista accesa. */
toolRoutes.get("/api/tools/:id/projects", (c) => {
  const s = tool(c.req.param("id"));
  if (!s) return c.json({ error: "strumento sconosciuto" }, 404);
  const projects = listProjects().filter(
    (p) => s.views.length === 0 || s.views.some((v) => p.views.includes(v)),
  );
  return c.json({ projects });
});
