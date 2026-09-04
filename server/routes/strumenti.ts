import { Hono } from "hono";
import { AREE, STRUMENTI, requisiti, strumento, type Requisito } from "../strumenti.ts";
import { WORKER_BACKEND } from "../config.ts";
import { addProject, currentProjectId, getProject, listProjects, withProject } from "../project.ts";
import { addSource } from "../sources.ts";
import { setGlobalPrompt } from "../db.ts";
import { accodaMancanti, creaGenerazioni } from "./generation.ts";
import { esportaPreferite } from "./pipeline.ts";
import { avviaVerifica } from "./verify.ts";
import { createPanels } from "../storyboard.ts";
import { checkChatgptBrowserAlive, launchChatgptBrowser } from "../worker.ts";

/**
 * Il catalogo degli strumenti, e il modo di cominciarne uno.
 *
 * Due rotte sole. `GET /api/strumenti` dice cosa Darkroom sa fare e cosa di
 * quello è pronto adesso su questa macchina; `POST /api/strumenti/:id/avvia`
 * lo comincia — facendo il progetto che serve, se serve — e risponde con la
 * pagina su cui atterrare.
 *
 * La seconda è il motivo per cui la prima non è una brochure: "usa subito" non
 * è un link a una pagina dove poi bisogna capire cosa fare, è la cosa fatta.
 * E siccome vive nel server, la fanno allo stesso modo l'interfaccia, l'MCP e
 * la chat che verrà — con un cammino solo da tenere funzionante.
 */
export const strumentiRoutes = new Hono();

strumentiRoutes.get("/api/strumenti", async (c) => {
  const req = await requisiti(checkChatgptBrowserAlive);
  return c.json({
    aree: AREE,
    requisiti: req,
    backend: WORKER_BACKEND,
    strumenti: STRUMENTI.map((s) => {
      const manca = s.richiede.filter((r) => !req[r].ok);
      return {
        ...s,
        // "Pronto" è una cosa sola: puoi usarlo adesso. Ciò che manca è detto
        // per nome, con il gesto che lo sistema, perché uno strumento grigio
        // senza motivo è solo una porta chiusa.
        pronto: manca.length === 0,
        manca: manca.map((r) => ({ requisito: r, come: req[r].come })),
      };
    }),
  });
});

// ---------------------------------------------------------------------------

type Valori = Record<string, string | number | undefined>;

const testo = (v: Valori, k: string): string => String(v[k] ?? "").trim();
const numero = (v: Valori, k: string, d: number): number => {
  const n = Number(v[k]);
  return Number.isFinite(n) ? n : d;
};

/** L'esito di un avvio: dove si atterra, su quale progetto, e cosa è successo. */
type Esito = { rotta: string; progetto: string; fatto: string; dati?: unknown };

/**
 * Il progetto su cui lavorare.
 *
 * Se ne arriva uno, quello. Altrimenti si usa l'attivo — la stessa regola
 * dell'MCP, dove `project` assente vuol dire "quello predefinito". Inventare
 * un progetto nuovo a ogni generazione al volo lascerebbe sul disco una fila
 * di cartelle che nessuno ha chiesto.
 */
function progettoDi(dato?: string): string {
  if (dato && getProject(dato)) return dato;
  return currentProjectId();
}

const AVVII: Record<string, (v: Valori, progetto?: string) => Esito | Promise<Esito>> = {
  genera: (v, prog) => {
    const prompt = testo(v, "prompt");
    if (!prompt) throw new Error("Serve il prompt: senza, non c'è niente da generare.");
    const pid = progettoDi(prog);
    const r = withProject(pid, () => creaGenerazioni(prompt, numero(v, "conta", 1)));
    return {
      rotta: `/p/${pid}`,
      progetto: pid,
      fatto: `${r.created} ${r.created === 1 ? "immagine messa" : "immagini messe"} in coda.`,
      dati: r,
    };
  },

  ritocca: (v) => {
    const nome = testo(v, "nome");
    const cartella = testo(v, "cartella");
    if (!nome) throw new Error("Serve un nome per il lavoro.");
    if (!cartella) throw new Error("Serve la cartella delle foto.");
    const p = addProject({ name: nome, kind: "photo" });
    return withProject(p.id, () => {
      const { summary } = addSource({ path: cartella, mode: "link" });
      const prompt = testo(v, "prompt");
      if (prompt) setGlobalPrompt(prompt);
      const accodate = numero(v, "accoda", 1) ? accodaMancanti() : 0;
      return {
        rotta: `/p/${p.id}`,
        progetto: p.id,
        fatto:
          `${summary.added} foto indicizzate` +
          (accodate ? `, ${accodate} già in coda.` : ". Le accodi quando vuoi dalla griglia."),
        dati: { summary, accodate },
      };
    });
  },

  sorgenti: (v) => {
    const nome = testo(v, "nome");
    const cartella = testo(v, "cartella");
    if (!nome) throw new Error("Serve un nome per la galleria.");
    if (!cartella) throw new Error("Serve la cartella delle foto.");
    const p = addProject({ name: nome, kind: "photo" });
    const { summary } = withProject(p.id, () => addSource({ path: cartella, mode: "link" }));
    return {
      rotta: `/p/${p.id}`,
      progetto: p.id,
      fatto: `${summary.added} foto indicizzate su ${summary.scanned} trovate.`,
      dati: summary,
    };
  },

  storyboard: (v) => {
    const nome = testo(v, "nome");
    const righe = testo(v, "scaletta")
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!nome) throw new Error("Serve un nome per lo storyboard.");
    if (!righe.length) throw new Error("Serve almeno una inquadratura: una per riga.");
    const p = addProject({ name: nome, kind: "storyboard", views: ["photo", "storyboard"] });
    const r = withProject(p.id, () => createPanels(righe.map((description) => ({ description }))));
    return {
      rotta: `/p/${p.id}/storyboard`,
      progetto: p.id,
      fatto: `${r.ids.length} pannelli creati, ${r.enqueued} già in coda per essere disegnati.`,
      dati: r,
    };
  },

  montaggio: (v) => {
    const nome = testo(v, "nome");
    if (!nome) throw new Error("Serve un nome per il montaggio.");
    const p = addProject({ name: nome, kind: "video", views: ["photo", "video"] });
    return {
      rotta: `/p/${p.id}/video`,
      progetto: p.id,
      fatto: `Progetto video creato in ${p.root}: metti lì le riprese e il brano.`,
      dati: p,
    };
  },

  progetti: (v) => {
    const nome = testo(v, "nome");
    if (!nome) throw new Error("Serve un nome.");
    const p = addProject({ name: nome, kind: "photo" });
    return { rotta: `/p/${p.id}`, progetto: p.id, fatto: `Progetto «${p.name}» creato.`, dati: p };
  },

  esporta: (_v, prog) => {
    const pid = progettoDi(prog);
    const r = withProject(pid, () => esportaPreferite());
    return {
      rotta: `/p/${pid}`,
      progetto: pid,
      fatto: r.total
        ? `${r.copied} preferite su ${r.total} copiate in ${r.dir}.`
        : "Nessuna preferita da esportare: scegli prima la versione buona di qualche foto.",
      dati: r,
    };
  },

  qualita: (_v, prog) => {
    const pid = progettoDi(prog);
    const r = withProject(pid, () => avviaVerifica(200, false));
    return {
      rotta: `/p/${pid}`,
      progetto: pid,
      fatto: r
        ? `Controllo avviato su ${r.started} render. Segnala, non cancella niente.`
        : "Ce n'è già uno in corso: aspetta che finisca.",
      dati: r,
    };
  },

  stato: async (_v, prog) => {
    const pid = progettoDi(prog);
    const r = await launchChatgptBrowser();
    if (!r.ok) throw new Error(r.error ?? "Chrome non è partito.");
    return {
      rotta: `/p/${pid}`,
      progetto: pid,
      fatto: "Chrome dedicato avviato: loggati a chatgpt.com nella finestra che si è aperta.",
    };
  },
};

/** Gli id che hanno un motore. Esportato per il test che verifica la
 *  corrispondenza col catalogo senza dover CHIAMARE gli avvii — chiamarli
 *  vorrebbe dire far partire Chrome dentro una suite. */
export const AVVIABILI = new Set(Object.keys(AVVII));

strumentiRoutes.post("/api/strumenti/:id/avvia", async (c) => {
  const id = c.req.param("id");
  const s = strumento(id);
  if (!s) return c.json({ error: `strumento sconosciuto: ${id}` }, 404);
  const avvia = AVVII[id];
  if (!avvia) {
    return c.json(
      { error: `«${s.nome}» si apre dentro un progetto: non ha un avvio rapido.` },
      400,
    );
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    progetto?: string;
    valori?: Valori;
  };

  const req = await requisiti(checkChatgptBrowserAlive);
  const manca = s.richiede.filter((r: Requisito) => !req[r].ok);
  // Un requisito che manca si dice PRIMA di fare metà del lavoro: creare il
  // progetto e poi scoprire che il generatore è spento lascia una cartella
  // vuota e nessuna spiegazione.
  if (manca.length && id !== "stato") {
    return c.json(
      { error: manca.map((r) => req[r].come).join(" "), manca },
      409,
    );
  }

  try {
    const esito = await avvia(body.valori ?? {}, body.progetto);
    return c.json({ ok: true, ...esito });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** Quali progetti può servire uno strumento: quelli con la vista accesa. */
strumentiRoutes.get("/api/strumenti/:id/progetti", (c) => {
  const s = strumento(c.req.param("id"));
  if (!s) return c.json({ error: "strumento sconosciuto" }, 404);
  const progetti = listProjects().filter(
    (p) => s.viste.length === 0 || s.viste.some((v) => p.views.includes(v)),
  );
  return c.json({ progetti });
});
