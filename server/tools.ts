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
export const AREAS: { id: ToolArea; name: string; what: string }[] = [
  { id: "images", name: "Immagini", what: "Generare e rifare fotogrammi." },
  { id: "color", name: "Colore", what: "Un look solo per tutto il set, e l'uscita." },
  { id: "quality", name: "Qualità", what: "Misurare cosa è venuto male, prima di pubblicarlo." },
  { id: "library", name: "Libreria", what: "Le foto: da dove vengono, come si raggruppano." },
  { id: "story", name: "Racconto", what: "Dalla scaletta ai pannelli." },
  { id: "edit", name: "Montaggio", what: "Riprese, tagli sul beat, ricostruzione." },
  { id: "system", name: "Sistema", what: "Progetti, generatore, stato della macchina." },
];

/** Cosa serve perché uno strumento funzioni davvero, non solo si apra. */
export type Requirement = "generator" | "ffmpeg" | "moondream" | "comfy";

/** Un campo del modulo di avvio rapido. Il client lo disegna, il server lo legge. */
export type StartField = {
  name: string;
  label: string;
  kind: "text" | "long" | "number" | "folder";
  placeholder?: string;
  required?: boolean;
  fallback?: string | number;
  /** Una riga sotto al campo: dice cosa succede, non come si compila. */
  note?: string;
};

/**
 * Come si comincia.
 *
 * - `apri` — lo strumento vive dentro un progetto: si sceglie quale e si entra.
 * - `nuovo` — fa un progetto nuovo già acceso sulla vista giusta.
 * - `subito` — si usa senza preparare niente: i campi bastano a partire.
 */
export type Start =
  | { mode: "open"; label: string; route: string; view: ProjectKind }
  | { mode: "new"; label: string; fields: StartField[]; note?: string }
  | { mode: "now"; label: string; fields: StartField[]; note?: string };

export type Tool = {
  id: string;
  name: string;
  /** Una riga: cosa fa, in modo che si capisca se è quello che serve. */
  what: string;
  area: ToolArea;
  /** Chiave dell'icona; la mappa string→icona sta nel client. */
  icon: string;
  /** Le viste di progetto in cui compare. Vuoto = vale ovunque. */
  views: ProjectKind[];
  /** Le rotte HTTP che lo eseguono. Sono la sua definizione operativa. */
  api: string[];
  /** I nomi degli strumenti MCP che lo guidano da fuori. */
  mcp: string[];
  needs: Requirement[];
  starters: Start[];
};

export const TOOLS: Tool[] = [
  // ---- immagini -----------------------------------------------------------
  {
    id: "generate",
    name: "Genera immagini",
    what: "Da un testo, senza foto di partenza. Finiscono in galleria come tutto il resto.",
    area: "images",
    icon: "sparkles",
    views: ["photo"],
    api: ["POST /api/generate-new", "GET /api/jobs"],
    mcp: ["generate_image", "list_jobs"],
    needs: ["generator"],
    starters: [
      {
        mode: "now",
        label: "Genera adesso",
        note: "Va in coda sul progetto scelto. Se non ne scegli uno, ne apro uno nuovo.",
        fields: [
          { name: "prompt", label: "Cosa vuoi vedere", kind: "long", required: true,
            placeholder: "un vicolo di Kyoto sotto la pioggia, insegne al neon, 35mm" },
          { name: "count", label: "Quante", kind: "number", fallback: 1 },
        ],
      },
      { mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "retouch",
    name: "Rifai un set di foto",
    what: "Mette in coda ogni foto senza versioni, con il prompt del progetto. Una cartella intera in un clic.",
    area: "images",
    icon: "wand",
    views: ["photo"],
    api: ["POST /api/generate-missing", "POST /api/photos/:id/generate", "PUT /api/settings/global-prompt"],
    mcp: ["generate_missing", "edit_photo", "set_global_prompt"],
    needs: ["generator"],
    starters: [
      {
        mode: "new",
        label: "Da una cartella",
        note: "Indicizzo la cartella (senza copiare niente) e accodo tutte le foto.",
        fields: [
          { name: "name", label: "Come si chiama il lavoro", kind: "text", required: true,
            placeholder: "Kyoto 2026" },
          { name: "folder", label: "La cartella delle foto", kind: "folder", required: true,
            placeholder: "/Users/…/Foto/Kyoto" },
          { name: "prompt", label: "Il look, a parole (facoltativo)", kind: "long",
            placeholder: "pellicola, luce di taglio, incarnati caldi" },
          { name: "enqueue", label: "Accoda subito tutte le foto (1 = sì)", kind: "number", fallback: 1 },
        ],
      },
      { mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "prompt",
    name: "Banco del prompt",
    what: "Il look si compone da controlli con l'anteprima, non da un aggettivo. Vale per tutto il set o per una foto sola.",
    area: "images",
    icon: "sliders",
    views: ["photo"],
    api: ["GET /api/settings/default-config", "PUT /api/settings/global-prompt", "GET /api/presets"],
    mcp: ["set_global_prompt"],
    needs: [],
    starters: [{ mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" }],
  },

  // ---- colore -------------------------------------------------------------
  {
    id: "color",
    name: "Sviluppo colore",
    what: "Un look uniforme su tutto il set: LUT .cube, bilanciamento del bianco, cielo. Anteprima viva nella griglia, cotto in esportazione.",
    area: "color",
    icon: "palette",
    views: ["photo"],
    api: ["GET /api/settings/color-grade", "PUT /api/settings/color-grade", "GET /api/luts"],
    mcp: ["color_grade"],
    needs: ["ffmpeg"],
    starters: [{ mode: "open", label: "Apri il banco colore", route: "/p/:pid", view: "photo" }],
  },
  {
    id: "export",
    name: "Esporta le preferite",
    what: "Copia le preferite, già sviluppate a piena risoluzione, in una cartella fuori dal progetto.",
    area: "color",
    icon: "download",
    views: ["photo"],
    api: ["POST /api/export-favorites"],
    mcp: ["export_favorites"],
    needs: [],
    starters: [
      { mode: "now", label: "Esporta adesso", fields: [],
        note: "Serve un progetto con delle preferite: scegline uno qui sopra." },
    ],
  },
  {
    id: "pipeline",
    name: "Catena completa",
    what: "Rigenera le preferite, sviluppa, promuove ed esporta: la catena intera come una mossa sola.",
    area: "color",
    icon: "workflow",
    views: ["photo"],
    api: ["POST /api/pipeline/regenerate", "POST /api/pipeline/promote-latest", "POST /api/pipeline/bake-favorites", "GET /api/pipeline/status"],
    mcp: [],
    needs: ["ffmpeg"],
    starters: [{ mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" }],
  },

  // ---- qualità ------------------------------------------------------------
  {
    id: "quality",
    name: "Controlli qualità",
    what: "Misura ogni render contro i modi noti di venire male: luci bruciate, neri schiacciati, doppioni, più le domande sì/no al modello che vede.",
    area: "quality",
    icon: "shield",
    views: ["photo", "storyboard"],
    api: ["POST /api/verify/photos/:id", "POST /api/verify/batch", "GET /api/verify/summary", "GET /api/verify/modes"],
    mcp: ["check_photo", "verification_summary", "list_failure_modes", "add_failure_mode"],
    needs: ["ffmpeg", "moondream"],
    starters: [
      {
        mode: "now",
        label: "Passa tutto il progetto",
        note: "Segnala e suggerisce; non cancella e non promuove niente da solo.",
        fields: [],
      },
      { mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" },
    ],
  },
  {
    id: "defects",
    name: "Catalogo dei difetti",
    what: "Una lamentela che torna diventa un controllo automatico e una clausola nel «non fare» del prompt.",
    area: "quality",
    icon: "list",
    views: ["photo", "storyboard"],
    api: ["GET /api/verify/modes", "POST /api/verify/modes"],
    mcp: ["list_failure_modes", "add_failure_mode"],
    needs: [],
    starters: [{ mode: "open", label: "Apri la galleria", route: "/p/:pid", view: "photo" }],
  },

  // ---- libreria -----------------------------------------------------------
  {
    id: "gallery",
    name: "Griglia della galleria",
    what: "Sfoglia il set, filtra per stato (senza versioni, senza preferita, in coda, fallite) e scegli qual è il render buono di ogni foto.",
    area: "library",
    icon: "images",
    views: ["photo"],
    api: ["GET /api/photos", "GET /api/photos/:id", "PUT /api/photos/:id/favorite"],
    mcp: ["list_photos", "get_photo", "set_favorite"],
    needs: [],
    starters: [{ mode: "open", label: "Apri la griglia", route: "/p/:pid", view: "photo" }],
  },
  {
    id: "sources",
    name: "Foto del progetto",
    what: "Da quali cartelle vengono le foto: indicizzate sul posto oppure copiate dentro. «Rileggi» prende quelle aggiunte dopo.",
    area: "library",
    icon: "folder",
    views: ["photo"],
    api: ["GET /api/sources", "POST /api/sources", "POST /api/sources/rescan"],
    mcp: ["add_photos", "rescan_photos"],
    needs: [],
    starters: [
      {
        mode: "new",
        label: "Nuova galleria",
        note: "Crea il progetto e indicizza la cartella. Niente viene copiato né spostato.",
        fields: [
          { name: "name", label: "Come si chiama", kind: "text", required: true, placeholder: "Kyoto 2026" },
          { name: "folder", label: "La cartella delle foto", kind: "folder", required: true,
            placeholder: "/Users/…/Foto/Kyoto" },
        ],
      },
      { mode: "open", label: "Gestisci le cartelle", route: "/p/:pid/sources", view: "photo" },
    ],
  },
  {
    id: "posts",
    name: "Post e caroselli",
    what: "Raggruppa la galleria in quello che pubblichi davvero: sottoinsiemi ordinati, con copertina e didascalia. Una foto sta in un post solo.",
    area: "library",
    icon: "layers",
    views: ["photo"],
    api: ["GET /api/collections", "POST /api/collections", "POST /api/collections/assign"],
    mcp: ["list_collections", "assign_photos"],
    needs: [],
    starters: [{ mode: "open", label: "Apri la griglia", route: "/p/:pid?group=collection", view: "photo" }],
  },
  {
    id: "references",
    name: "Riferimenti di stile",
    what: "Immagini di riferimento e ricette: il colore di un post si rende, non si corregge dopo.",
    area: "library",
    icon: "image",
    views: ["photo"],
    api: ["GET /api/references", "POST /api/references", "GET /api/recipes"],
    mcp: [],
    needs: [],
    starters: [{ mode: "open", label: "Apri i riferimenti", route: "/p/:pid/references", view: "photo" }],
  },
  {
    id: "tree",
    name: "Albero delle versioni",
    what: "Da quale render discende ogni render, con il verdetto dato a ciascuno. Serve a capire dove si è rotta una catena.",
    area: "library",
    icon: "gitbranch",
    views: ["photo"],
    api: ["GET /api/lineage", "PATCH /api/versions/:id/verdict"],
    mcp: [],
    needs: [],
    starters: [{ mode: "open", label: "Apri l'albero", route: "/p/:pid/tree", view: "photo" }],
  },
  {
    id: "orphans",
    name: "Immagini orfane",
    what: "Render trovati sul disco senza una foto a cui appartenere: si assegnano o si mettono da parte.",
    area: "library",
    icon: "help",
    views: ["photo"],
    api: ["GET /api/orphans", "POST /api/orphans/:filename/assign"],
    mcp: [],
    needs: [],
    starters: [{ mode: "open", label: "Apri le orfane", route: "/p/:pid/orphans", view: "photo" }],
  },

  // ---- racconto -----------------------------------------------------------
  {
    id: "storyboard",
    name: "Storyboard",
    what: "Una scaletta diventa pannelli in ordine, uno per battuta, con durata, scena e un cast che tiene la faccia da un pannello all'altro.",
    area: "story",
    icon: "clapper",
    views: ["storyboard"],
    api: ["GET /api/storyboard", "POST /api/storyboard/panels", "PUT /api/storyboard/sequence", "POST /api/storyboard/export"],
    mcp: ["list_storyboard", "create_panels", "set_sequence", "update_panel", "list_characters", "set_character", "export_storyboard"],
    needs: ["generator"],
    starters: [
      {
        mode: "new",
        label: "Da una scaletta",
        note: "Una riga per inquadratura. Ogni riga diventa un pannello, già in coda per essere disegnato.",
        fields: [
          { name: "name", label: "Come si chiama", kind: "text", required: true, placeholder: "Il corto del bar" },
          { name: "beats", label: "Le inquadrature, una per riga", kind: "long", required: true,
            placeholder: "INT. BAR - NOTTE, lei entra bagnata di pioggia\nprimo piano sulle mani che tremano\ncampo lungo, la strada vuota" },
        ],
      },
      { mode: "open", label: "Apri lo storyboard", route: "/p/:pid/storyboard", view: "storyboard" },
    ],
  },

  // ---- montaggio ----------------------------------------------------------
  {
    id: "edit",
    name: "Montaggio sul beat",
    what: "Il piano dei tagli deriva dalle misure del brano: durezza del suono contro durezza dell'immagine. Le forzature restano dichiarate.",
    area: "edit",
    icon: "film",
    views: ["video"],
    api: ["GET /api/video/cuts", "GET /api/video/overrides", "POST /api/video/pin", "POST /api/video/ricostruisci"],
    mcp: ["video_cuts", "video_forcings", "video_pin", "video_duration", "video_rebuild", "video_rebuild_status"],
    needs: ["ffmpeg"],
    starters: [
      {
        mode: "new",
        label: "Nuovo montaggio",
        note: "Crea il progetto video. Le riprese e il brano si mettono nella sua cartella.",
        fields: [{ name: "name", label: "Come si chiama", kind: "text", required: true, placeholder: "Lungomare" }],
      },
      { mode: "open", label: "Apri il montaggio", route: "/p/:pid/video", view: "video" },
    ],
  },
  {
    id: "picks",
    name: "Scelta delle riprese",
    what: "Una ripresa per volta, con i provini e i problemi già misurati: si tiene o si scarta, e si dice perché.",
    area: "edit",
    icon: "check",
    views: ["video"],
    api: ["GET /api/video/shots", "POST /api/video/pick"],
    mcp: ["video_shots", "video_judge"],
    needs: [],
    starters: [{ mode: "open", label: "Apri la scelta", route: "/p/:pid/video/pick", view: "video" }],
  },
  {
    id: "shots",
    name: "Genera riprese",
    what: "Una ripresa nuova sulla 3090 via ComfyUI, con i parametri che ci stanno davvero nella memoria della scheda.",
    area: "edit",
    icon: "video",
    views: ["video"],
    api: ["POST /api/video/generate", "GET /api/video/generations"],
    mcp: ["video_generate", "video_generations"],
    needs: ["comfy"],
    starters: [{ mode: "open", label: "Apri il montaggio", route: "/p/:pid/video", view: "video" }],
  },
  {
    id: "gate",
    name: "Barra del montaggio",
    what: "I controlli sul video costruito, ognuno con il numero misurato: tagli sulle battute, niente riprese doppie, correlazione suono/immagine.",
    area: "edit",
    icon: "gauge",
    views: ["video"],
    api: ["GET /api/video/gate"],
    mcp: ["video_check"],
    needs: ["ffmpeg"],
    starters: [{ mode: "open", label: "Apri il montaggio", route: "/p/:pid/video", view: "video" }],
  },

  // ---- sistema ------------------------------------------------------------
  {
    id: "projects",
    name: "Progetti",
    what: "Tutti i lavori su questa macchina: crearli, accendere le viste, metterne uno in pausa. Togliere un progetto non cancella niente.",
    area: "system",
    icon: "grid",
    views: [],
    api: ["GET /api/studio/projects", "POST /api/studio/projects", "PATCH /api/studio/projects/:pid"],
    mcp: ["list_projects", "add_project", "update_project"],
    needs: [],
    starters: [
      {
        mode: "new",
        label: "Progetto vuoto",
        fields: [
          { name: "name", label: "Come si chiama", kind: "text", required: true, placeholder: "Kyoto 2026" },
        ],
      },
    ],
  },
  {
    id: "queue",
    name: "Coda dei lavori",
    what: "Cosa sta girando, cosa è fallito e perché. Il generatore è uno solo per tutti i progetti.",
    area: "system",
    icon: "activity",
    views: [],
    api: ["GET /api/jobs", "POST /api/jobs/:id/cancel"],
    mcp: ["list_jobs"],
    needs: [],
    starters: [],
  },
  {
    id: "status",
    name: "Stato del generatore",
    what: "Se il backend può generare adesso: browser ChatGPT vivo, chiave configurata, coda in pausa.",
    area: "system",
    icon: "plug",
    views: [],
    api: ["GET /api/health", "POST /api/browser/launch"],
    mcp: ["status"],
    needs: [],
    starters: [
      { mode: "now", label: "Avvia il browser", fields: [],
        note: "Apre il Chrome dedicato: ci si logga a chatgpt.com una volta sola." },
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
  how: string;
};

/** Un binario c'è? Risposta cara (~30ms a colpo), quindi si misura di rado. */
function hasBinary(bin: string): boolean {
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

  const generator: RequirementState = await (async () => {
    if (WORKER_BACKEND === "openai") {
      return openaiKey()
        ? { ok: true, how: "Chiave OpenAI configurata." }
        : { ok: false, how: "Manca la chiave OpenAI (Keychain: openai/darkroom, o OPENAI_API_KEY)." };
    }
    if (BACKEND_USES_BROWSER) {
      const alive = browserAlive ? await browserAlive().catch(() => false) : false;
      return alive
        ? { ok: true, how: "Chrome dedicato collegato." }
        : { ok: false, how: "Il Chrome dedicato non è avviato: avvialo e loggati a chatgpt.com." };
    }
    return { ok: true, how: `Backend ${WORKER_BACKEND}.` };
  })();

  const v: Record<Requirement, RequirementState> = {
    generator,
    ffmpeg: hasBinary(FFMPEG_BIN)
      ? { ok: true, how: "ffmpeg trovato." }
      : { ok: false, how: "Manca ffmpeg: `brew install ffmpeg` (o imposta FFMPEG)." },
    moondream: hasBinary(moondreamBin())
      ? { ok: true, how: "Moondream trovato." }
      : {
          ok: false,
          how: "Manca la CLI Moondream: i controlli a pixel funzionano lo stesso, quelli che guardano l'immagine no.",
        },
    comfy: {
      // A shot needs both halves: ComfyUI to render the frames and the render
      // box to collect them. Reporting "ready" on COMFY_HOST alone was a
      // half-truth that only failed later, inside an ssh call.
      ok: !!COMFY_HOST && renderConfigured(),
      how: !COMFY_HOST
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
