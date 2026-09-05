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
 * What Darkroom can do, written once.
 *
 * The same capabilities used to be declared in three places that did not talk
 * to each other: the MCP's 37 tools, the tabs in the top bar, and the README.
 * Three lists saying the same thing diverge at the first tweak — and it already
 * happened: colour and photo sources were driven from the interface and did not
 * exist over MCP, so «Darkroom can do it» was true or false depending on where
 * you asked from.
 *
 * Here a tool is a craft, not a call: «develop the colour» sits above the four
 * routes that carry it out. Each one declares the HTTP routes that run it, the
 * MCP names that drive it, what it needs in order to work, and the WAYS it is
 * begun — opening it inside a project, making a new one, or using it right
 * away. A test verifies that the routes and MCP names really exist: a catalogue
 * promising things that are not there would be worse than not having one.
 *
 * Its readers: the interface (the home), the MCP (`list_tools`/`start_tool`)
 * and — when it exists — the in-app chat. None of the three has a list of its
 * own.
 */

export type ToolArea =
  | "images"
  | "color"
  | "quality"
  | "library"
  | "story"
  | "edit"
  | "system";

/** The areas in reading order, with the line that explains them. */
export const AREAS: { id: ToolArea; name: string; what: string }[] = [
  { id: "images", name: "Immagini", what: "Generare e rifare fotogrammi." },
  { id: "color", name: "Colore", what: "Un look solo per tutto il set, e l'uscita." },
  { id: "quality", name: "Qualità", what: "Misurare cosa è venuto male, prima di pubblicarlo." },
  { id: "library", name: "Libreria", what: "Le foto: da dove vengono, come si raggruppano." },
  { id: "story", name: "Racconto", what: "Dalla scaletta ai pannelli." },
  { id: "edit", name: "Montaggio", what: "Riprese, tagli sul beat, ricostruzione." },
  { id: "system", name: "Sistema", what: "Progetti, generatore, stato della macchina." },
];

/** What a tool needs in order to really work, not merely to open. */
export type Requirement = "generator" | "ffmpeg" | "moondream" | "comfy";

/** A field of the quick-start form. The client draws it, the server reads it. */
export type StartField = {
  name: string;
  label: string;
  kind: "text" | "long" | "number" | "folder";
  placeholder?: string;
  required?: boolean;
  fallback?: string | number;
  /** A line under the field: it says what happens, not how to fill it in. */
  note?: string;
};

/**
 * How it begins.
 *
 * - `open` — the tool lives inside a project: you choose which and go in.
 * - `new` — makes a new project already switched to the right view.
 * - `now` — used without preparing anything: the fields are enough to start.
 */
export type Start =
  | { mode: "open"; label: string; route: string; view: ProjectKind }
  | { mode: "new"; label: string; fields: StartField[]; note?: string }
  | { mode: "now"; label: string; fields: StartField[]; note?: string };

export type Tool = {
  id: string;
  name: string;
  /** One line: what it does, so you can tell whether it is what you need. */
  what: string;
  area: ToolArea;
  /** The icon's key; the string→icon map lives in the client. */
  icon: string;
  /** The project views it shows up in. Empty = it applies everywhere. */
  views: ProjectKind[];
  /** The HTTP routes that run it. They are its operational definition. */
  api: string[];
  /** The names of the MCP tools that drive it from outside. */
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
    api: ["GET /api/video/cuts", "GET /api/video/overrides", "POST /api/video/pin", "POST /api/video/rebuild"],
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
  /** Why it is not ready and what to do — not «error», but the missing gesture. */
  how: string;
};

/** Is a binary there? An expensive answer (~30ms a shot), so it is measured
 *  rarely. */
function hasBinary(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  try {
    return Bun.spawnSync(["which", bin]).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * The state of the requirements, kept for fifteen seconds.
 *
 * The home re-polls; without a cache every round paid for three `which` calls
 * and a network probe — i.e. the cost of discovering, every time, the same
 * thing that changes once a day.
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

/** Tests only: resets the requirements cache. */
export function forgetRequirements(): void {
  cache = null;
}
