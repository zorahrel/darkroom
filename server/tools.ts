import { existsSync } from "node:fs";
import {
  BACKEND_USES_BROWSER,
  COMFY_HOST,
  FFMPEG_BIN,
  moondreamBin,
  renderConfigured,
  WORKER_BACKEND,
  openaiKey,
} from "./config.ts";
import type { ProjectKind } from "./project.ts";

/**
 * Che cosa sa fare Darkroom, scritto una volta sola.
 *
 * Le stesse capacità erano dichiarate in tre posti che non si parlavano: i 37
 * strumenti dell'MCP, le schede della barra in alto, e il README. Tre elenchi
 * che dicono la stessa cosa divergono al primo ritocco — ed è già successo: il
 * colore e le sorgenti foto si guidavano dall'interfaccia e non esistevano via
 * MCP, quindi «Darkroom lo sa fare» era vero o falso a seconda di da dove
 * chiedevi.
 *
 * Qui uno strumento è un mestiere, non una chiamata: «sviluppa il colore» sta
 * sopra le quattro rotte che lo realizzano. Ognuno dichiara le rotte HTTP che
 * lo eseguono, i nomi MCP che lo guidano, di cosa ha bisogno per funzionare, e
 * i MODI in cui si comincia — aprirlo dentro un progetto, farne uno nuovo, o
 * usarlo subito. Un test verifica che rotte e nomi MCP esistano davvero: un
 * catalogo che promette roba inesistente sarebbe peggio del non averlo.
 *
 * Lo leggono: l'interfaccia (la home), l'MCP (`list_tools`/`start_tool`) e —
 * quando ci sarà — la chat interna. Nessuno dei tre ha una lista propria.
 */

export type ToolArea =
  | "images"
  | "color"
  | "quality"
  | "library"
  | "story"
  | "edit"
  | "system";

/** Le aree in ordine di lettura, con la riga che le spiega. */
export const AREAS: { id: ToolArea; name: string; cosa: string }[] = [
  { id: "images", name: "Immagini", cosa: "Generare e rifare fotogrammi." },
  { id: "color", name: "Colore", cosa: "Un look solo per tutto il set, e l'uscita." },
  { id: "quality", name: "Qualità", cosa: "Misurare cosa è venuto male, prima di pubblicarlo." },
  { id: "library", name: "Libreria", cosa: "Le foto: da dove vengono, come si raggruppano." },
  { id: "story", name: "Racconto", cosa: "Dalla scaletta ai pannelli." },
  { id: "edit", name: "Montaggio", cosa: "Riprese, tagli sul beat, ricostruzione." },
  { id: "system", name: "Sistema", cosa: "Progetti, generatore, stato della macchina." },
];

/** Cosa serve perché uno strumento funzioni davvero, non solo si apra. */
export type Requirement = "generatore" | "ffmpeg" | "moondream" | "comfy";

/** Un campo del modulo di avvio rapido. Il client lo disegna, il server lo legge. */
export type StartField = {
  name: string;
  etichetta: string;
  tipo: "testo" | "lungo" | "numero" | "cartella";
  segnaposto?: string;
  richiesto?: boolean;
  predefinito?: string | number;
  /** Una riga sotto al campo: dice cosa succede, non come si compila. */
  nota?: string;
};

/**
 * Come si comincia.
 *
 * - `apri` — lo strumento vive dentro un progetto: si sceglie quale e si entra.
 * - `nuovo` — fa un progetto nuovo già acceso sulla vista giusta.
 * - `subito` — si usa senza preparare niente: i campi bastano a partire.
 */
export type Start =
  | { modo: "apri"; etichetta: string; rotta: string; view: ProjectKind }
  | { modo: "nuovo"; etichetta: string; fields: StartField[]; nota?: string }
  | { modo: "subito"; etichetta: string; fields: StartField[]; nota?: string };

export type Tool = {
  id: string;
  name: string;
  /** Una riga: cosa fa, in modo che si capisca se è quello che serve. */
  cosa: string;
  area: ToolArea;
  /** Chiave dell'icona; la mappa string→icona sta nel client. */
  icon: string;
  /** Le viste di progetto in cui compare. Vuoto = vale ovunque. */
  views: ProjectKind[];
  /** Le rotte HTTP che lo eseguono. Sono la sua definizione operativa. */
  api: string[];
  /** I nomi degli strumenti MCP che lo guidano da fuori. */
  mcp: string[];
  richiede: Requirement[];
  starters: Start[];
};

export const TOOLS: Tool[] = [
  // ---- immagini -----------------------------------------------------------
  {
    id: "generate",
    name: "Genera immagini",
    cosa: "Da un testo, senza foto di partenza. Finiscono in galleria come tutto il resto.",
    area: "images",
    icon: "sparkles",
    views: ["photo"],
    api: ["POST /api/generate-new", "GET /api/jobs"],
    mcp: ["generate_image", "list_jobs"],
    richiede: ["generatore"],
    starters: [
      {
        modo: "subito",
        etichetta: "Genera adesso",
        nota: "Va in coda sul progetto scelto. Se non ne scegli uno, ne apro uno nuovo.",
        fields: [
          { name: "prompt", etichetta: "Cosa vuoi vedere", tipo: "lungo", richiesto: true,
            segnaposto: "un vicolo di Kyoto sotto la pioggia, insegne al neon, 35mm" },
          { name: "count", etichetta: "Quante", tipo: "numero", predefinito: 1 },
        ],
      },
      { modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "retouch",
    name: "Rifai un set di foto",
    cosa: "Mette in coda ogni foto senza versioni, con il prompt del progetto. Una cartella intera in un clic.",
    area: "images",
    icon: "wand",
    views: ["photo"],
    api: ["POST /api/generate-missing", "POST /api/photos/:id/generate", "PUT /api/settings/global-prompt"],
    mcp: ["generate_missing", "edit_photo", "set_global_prompt"],
    richiede: ["generatore"],
    starters: [
      {
        modo: "nuovo",
        etichetta: "Da una cartella",
        nota: "Indicizzo la cartella (senza copiare niente) e accodo tutte le foto.",
        fields: [
          { name: "name", etichetta: "Come si chiama il lavoro", tipo: "testo", richiesto: true,
            segnaposto: "Kyoto 2026" },
          { name: "folder", etichetta: "La cartella delle foto", tipo: "cartella", richiesto: true,
            segnaposto: "/Users/…/Foto/Kyoto" },
          { name: "prompt", etichetta: "Il look, a parole (facoltativo)", tipo: "lungo",
            segnaposto: "pellicola, luce di taglio, incarnati caldi" },
          { name: "enqueue", etichetta: "Accoda subito tutte le foto (1 = sì)", tipo: "numero", predefinito: 1 },
        ],
      },
      { modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "prompt",
    name: "Banco del prompt",
    cosa: "Il look si compone da controlli con l'anteprima, non da un aggettivo. Vale per tutto il set o per una foto sola.",
    area: "images",
    icon: "sliders",
    views: ["photo"],
    api: ["GET /api/settings/default-config", "PUT /api/settings/global-prompt", "GET /api/presets"],
    mcp: ["set_global_prompt"],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" }],
  },

  // ---- colore -------------------------------------------------------------
  {
    id: "color",
    name: "Sviluppo colore",
    cosa: "Un look uniforme su tutto il set: LUT .cube, bilanciamento del bianco, cielo. Anteprima viva nella griglia, cotto in esportazione.",
    area: "color",
    icon: "palette",
    views: ["photo"],
    api: ["GET /api/settings/color-grade", "PUT /api/settings/color-grade", "GET /api/luts"],
    mcp: ["color_grade"],
    richiede: ["ffmpeg"],
    starters: [{ modo: "apri", etichetta: "Apri il banco colore", rotta: "/p/:pid", view: "photo" }],
  },
  {
    id: "export",
    name: "Esporta le preferite",
    cosa: "Copia le preferite, già sviluppate a piena risoluzione, in una cartella fuori dal progetto.",
    area: "color",
    icon: "download",
    views: ["photo"],
    api: ["POST /api/export-favorites"],
    mcp: ["export_favorites"],
    richiede: [],
    starters: [
      { modo: "subito", etichetta: "Esporta adesso", fields: [],
        nota: "Serve un progetto con delle preferite: scegline uno qui sopra." },
    ],
  },
  {
    id: "pipeline",
    name: "Catena completa",
    cosa: "Rigenera le preferite, sviluppa, promuove ed esporta: la catena intera come una mossa sola.",
    area: "color",
    icon: "workflow",
    views: ["photo"],
    api: ["POST /api/pipeline/regenerate", "POST /api/pipeline/promote-latest", "POST /api/pipeline/bake-favorites", "GET /api/pipeline/status"],
    mcp: [],
    richiede: ["ffmpeg"],
    starters: [{ modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" }],
  },

  // ---- qualità ------------------------------------------------------------
  {
    id: "quality",
    name: "Controlli qualità",
    cosa: "Misura ogni render contro i modi noti di venire male: luci bruciate, neri schiacciati, doppioni, più le domande sì/no al modello che vede.",
    area: "quality",
    icon: "shield",
    views: ["photo", "storyboard"],
    api: ["POST /api/verify/photos/:id", "POST /api/verify/batch", "GET /api/verify/summary", "GET /api/verify/modes"],
    mcp: ["check_photo", "verification_summary", "list_failure_modes", "add_failure_mode"],
    richiede: ["ffmpeg", "moondream"],
    starters: [
      {
        modo: "subito",
        etichetta: "Passa tutto il progetto",
        nota: "Segnala e suggerisce; non cancella e non promuove niente da solo.",
        fields: [],
      },
      { modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "defects",
    name: "Catalogo dei difetti",
    cosa: "Una lamentela che torna diventa un controllo automatico e una clausola nel «non fare» del prompt.",
    area: "quality",
    icon: "list",
    views: ["photo", "storyboard"],
    api: ["GET /api/verify/modes", "POST /api/verify/modes"],
    mcp: ["list_failure_modes", "add_failure_mode"],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri la galleria", rotta: "/p/:pid", view: "photo" }],
  },

  // ---- libreria -----------------------------------------------------------
  {
    id: "gallery",
    name: "Griglia della galleria",
    cosa: "Sfoglia il set, filtra per stato (senza versioni, senza preferita, in coda, fallite) e scegli qual è il render buono di ogni foto.",
    area: "library",
    icon: "images",
    views: ["photo"],
    api: ["GET /api/photos", "GET /api/photos/:id", "PUT /api/photos/:id/favorite"],
    mcp: ["list_photos", "get_photo", "set_favorite"],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri la griglia", rotta: "/p/:pid", view: "photo" }],
  },
  {
    id: "sources",
    name: "Foto del progetto",
    cosa: "Da quali cartelle vengono le foto: indicizzate sul posto oppure copiate dentro. «Rileggi» prende quelle aggiunte dopo.",
    area: "library",
    icon: "folder",
    views: ["photo"],
    api: ["GET /api/sources", "POST /api/sources", "POST /api/sources/rescan"],
    mcp: ["add_photos", "rescan_photos"],
    richiede: [],
    starters: [
      {
        modo: "nuovo",
        etichetta: "Nuova galleria",
        nota: "Crea il progetto e indicizza la cartella. Niente viene copiato né spostato.",
        fields: [
          { name: "name", etichetta: "Come si chiama", tipo: "testo", richiesto: true, segnaposto: "Kyoto 2026" },
          { name: "folder", etichetta: "La cartella delle foto", tipo: "cartella", richiesto: true,
            segnaposto: "/Users/…/Foto/Kyoto" },
        ],
      },
      { modo: "apri", etichetta: "Gestisci le cartelle", rotta: "/p/:pid/sources", view: "photo" },
    ],
  },
  {
    id: "posts",
    name: "Post e caroselli",
    cosa: "Raggruppa la galleria in quello che pubblichi davvero: sottoinsiemi ordinati, con copertina e didascalia. Una foto sta in un post solo.",
    area: "library",
    icon: "layers",
    views: ["photo"],
    api: ["GET /api/collections", "POST /api/collections", "POST /api/collections/assign"],
    mcp: ["list_collections", "assign_photos"],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri la griglia", rotta: "/p/:pid?group=collection", view: "photo" }],
  },
  {
    id: "references",
    name: "Riferimenti di stile",
    cosa: "Immagini di riferimento e ricette: il colore di un post si rende, non si corregge dopo.",
    area: "library",
    icon: "image",
    views: ["photo"],
    api: ["GET /api/references", "POST /api/references", "GET /api/recipes"],
    mcp: [],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri i riferimenti", rotta: "/p/:pid/riferimenti", view: "photo" }],
  },
  {
    id: "tree",
    name: "Albero delle versioni",
    cosa: "Da quale render discende ogni render, con il verdetto dato a ciascuno. Serve a capire dove si è rotta una catena.",
    area: "library",
    icon: "gitbranch",
    views: ["photo"],
    api: ["GET /api/lineage", "PATCH /api/versions/:id/verdict"],
    mcp: [],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri l'albero", rotta: "/p/:pid/albero", view: "photo" }],
  },
  {
    id: "orphans",
    name: "Immagini orfane",
    cosa: "Render trovati sul disco senza una foto a cui appartenere: si assegnano o si mettono da parte.",
    area: "library",
    icon: "help",
    views: ["photo"],
    api: ["GET /api/orphans", "POST /api/orphans/:filename/assign"],
    mcp: [],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri le orfane", rotta: "/p/:pid/orphans", view: "photo" }],
  },

  // ---- racconto -----------------------------------------------------------
  {
    id: "storyboard",
    name: "Storyboard",
    cosa: "Una scaletta diventa pannelli in ordine, uno per battuta, con durata, scena e un cast che tiene la faccia da un pannello all'altro.",
    area: "story",
    icon: "clapper",
    views: ["storyboard"],
    api: ["GET /api/storyboard", "POST /api/storyboard/panels", "PUT /api/storyboard/sequence", "POST /api/storyboard/export"],
    mcp: ["list_storyboard", "create_panels", "set_sequence", "update_panel", "list_characters", "set_character", "export_storyboard"],
    richiede: ["generatore"],
    starters: [
      {
        modo: "nuovo",
        etichetta: "Da una scaletta",
        nota: "Una riga per inquadratura. Ogni riga diventa un pannello, già in coda per essere disegnato.",
        fields: [
          { name: "name", etichetta: "Come si chiama", tipo: "testo", richiesto: true, segnaposto: "Il corto del bar" },
          { name: "beats", etichetta: "Le inquadrature, una per riga", tipo: "lungo", richiesto: true,
            segnaposto: "INT. BAR - NOTTE, lei entra bagnata di pioggia\nprimo piano sulle mani che tremano\ncampo lungo, la strada vuota" },
        ],
      },
      { modo: "apri", etichetta: "Apri lo storyboard", rotta: "/p/:pid/storyboard", view: "storyboard" },
    ],
  },

  // ---- montaggio ----------------------------------------------------------
  {
    id: "edit",
    name: "Montaggio sul beat",
    cosa: "Il piano dei tagli deriva dalle misure del brano: durezza del suono contro durezza dell'immagine. Le forzature restano dichiarate.",
    area: "edit",
    icon: "film",
    views: ["video"],
    api: ["GET /api/video/cuts", "GET /api/video/overrides", "POST /api/video/pin", "POST /api/video/ricostruisci"],
    mcp: ["video_cuts", "video_forcings", "video_pin", "video_duration", "video_rebuild", "video_rebuild_status"],
    richiede: ["ffmpeg"],
    starters: [
      {
        modo: "nuovo",
        etichetta: "Nuovo montaggio",
        nota: "Crea il progetto video. Le riprese e il brano si mettono nella sua cartella.",
        fields: [{ name: "name", etichetta: "Come si chiama", tipo: "testo", richiesto: true, segnaposto: "Lungomare" }],
      },
      { modo: "apri", etichetta: "Apri il montaggio", rotta: "/p/:pid/video", view: "video" },
    ],
  },
  {
    id: "picks",
    name: "Scelta delle riprese",
    cosa: "Una ripresa per volta, con i provini e i problemi già misurati: si tiene o si scarta, e si dice perché.",
    area: "edit",
    icon: "check",
    views: ["video"],
    api: ["GET /api/video/shots", "POST /api/video/pick"],
    mcp: ["video_shots", "video_judge"],
    richiede: [],
    starters: [{ modo: "apri", etichetta: "Apri la scelta", rotta: "/p/:pid/video/scelta", view: "video" }],
  },
  {
    id: "shots",
    name: "Genera riprese",
    cosa: "Una ripresa nuova sulla 3090 via ComfyUI, con i parametri che ci stanno davvero nella memoria della scheda.",
    area: "edit",
    icon: "video",
    views: ["video"],
    api: ["POST /api/video/generate", "GET /api/video/generatetions"],
    mcp: ["video_generate", "video_generations"],
    richiede: ["comfy"],
    starters: [{ modo: "apri", etichetta: "Apri il montaggio", rotta: "/p/:pid/video", view: "video" }],
  },
  {
    id: "gate",
    name: "Barra del montaggio",
    cosa: "I controlli sul video costruito, ognuno con il numero misurato: tagli sulle battute, niente riprese doppie, correlazione suono/immagine.",
    area: "edit",
    icon: "gauge",
    views: ["video"],
    api: ["GET /api/video/gate"],
    mcp: ["video_check"],
    richiede: ["ffmpeg"],
    starters: [{ modo: "apri", etichetta: "Apri il montaggio", rotta: "/p/:pid/video", view: "video" }],
  },

  // ---- sistema ------------------------------------------------------------
  {
    id: "projects",
    name: "Progetti",
    cosa: "Tutti i lavori su questa macchina: crearli, accendere le viste, metterne uno in pausa. Togliere un progetto non cancella niente.",
    area: "system",
    icon: "grid",
    views: [],
    api: ["GET /api/studio/projects", "POST /api/studio/projects", "PATCH /api/studio/projects/:pid"],
    mcp: ["list_projects", "add_project", "update_project"],
    richiede: [],
    starters: [
      {
        modo: "nuovo",
        etichetta: "Progetto vuoto",
        fields: [
          { name: "name", etichetta: "Come si chiama", tipo: "testo", richiesto: true, segnaposto: "Kyoto 2026" },
        ],
      },
    ],
  },
  {
    id: "queue",
    name: "Coda dei lavori",
    cosa: "Cosa sta girando, cosa è fallito e perché. Il generatore è uno solo per tutti i progetti.",
    area: "system",
    icon: "activity",
    views: [],
    api: ["GET /api/jobs", "POST /api/jobs/:id/cancel"],
    mcp: ["list_jobs"],
    richiede: [],
    starters: [],
  },
  {
    id: "status",
    name: "Stato del generatore",
    cosa: "Se il backend può generare adesso: browser ChatGPT vivo, chiave configurata, coda in pausa.",
    area: "system",
    icon: "plug",
    views: [],
    api: ["GET /api/health", "POST /api/browser/launch"],
    mcp: ["status"],
    richiede: [],
    starters: [
      { modo: "subito", etichetta: "Avvia il browser", fields: [],
        nota: "Apre il Chrome dedicato: ci si logga a chatgpt.com una volta sola." },
    ],
  },
];

export const tool = (id: string): Tool | undefined =>
  TOOLS.find((s) => s.id === id);

// ---------------------------------------------------------------------------
// Pronto o no

export type RequirementState = {
  ok: boolean;
  /** Perché non è pronto e cosa si fa — non «errore», ma il gesto che manca. */
  come: string;
};

/** Un binario c'è? Risposta cara (~30ms a colpo), quindi si misura di rado. */
function haBinario(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  try {
    return Bun.spawnSync(["which", bin]).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Lo stato dei requisiti, tenuto per quindici secondi.
 *
 * La home ripolla; senza cache ogni giro pagava tre `which` e una sonda di
 * rete — cioè il costo di scoprire ogni volta la stessa cosa che cambia una
 * volta al giorno.
 */
let cache: { t: number; v: Record<Requirement, RequirementState> } | null = null;

export async function requirements(
  browserAlive?: () => Promise<boolean>,
): Promise<Record<Requirement, RequirementState>> {
  if (cache && Date.now() - cache.t < 15_000) return cache.v;

  const generatore: RequirementState = await (async () => {
    if (WORKER_BACKEND === "openai") {
      return openaiKey()
        ? { ok: true, come: "Chiave OpenAI configurata." }
        : { ok: false, come: "Manca la chiave OpenAI (Keychain: openai/darkroom, o OPENAI_API_KEY)." };
    }
    if (BACKEND_USES_BROWSER) {
      const alive = browserAlive ? await browserAlive().catch(() => false) : false;
      return alive
        ? { ok: true, come: "Chrome dedicato collegato." }
        : { ok: false, come: "Il Chrome dedicato non è avviato: avvialo e loggati a chatgpt.com." };
    }
    return { ok: true, come: `Backend ${WORKER_BACKEND}.` };
  })();

  const v: Record<Requirement, RequirementState> = {
    generatore,
    ffmpeg: haBinario(FFMPEG_BIN)
      ? { ok: true, come: "ffmpeg trovato." }
      : { ok: false, come: "Manca ffmpeg: `brew install ffmpeg` (o imposta FFMPEG)." },
    moondream: haBinario(moondreamBin())
      ? { ok: true, come: "Moondream trovato." }
      : {
          ok: false,
          come: "Manca la CLI Moondream: i controlli a pixel funzionano lo stesso, quelli che guardano l'immagine no.",
        },
    comfy: {
      // A shot needs both halves: ComfyUI to render the frames and the render
      // box to collect them. Reporting "ready" on COMFY_HOST alone was a
      // half-truth that only failed later, inside an ssh call.
      ok: !!COMFY_HOST && renderConfigured(),
      come: !COMFY_HOST
        ? "Nessun ComfyUI configurato (COMFY_HOST): la generazione di riprese resta spenta."
        : renderConfigured()
          ? `ComfyUI su ${COMFY_HOST}.`
          : `ComfyUI su ${COMFY_HOST}, ma manca la macchina che raccoglie i fotogrammi (RENDER_SSH, RENDER_DIR, RENDER_OUT_DIR).`,
    },
  };
  cache = { t: Date.now(), v };
  return v;
}

/** Solo per i test: rimette a zero la cache dei requisiti. */
export function forgetRequirements(): void {
  cache = null;
}
