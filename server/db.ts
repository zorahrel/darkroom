import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { currentProjectId, dirsFor, genDir } from "./project.ts";

// Paths are centralized in config.ts (env-driven). Re-exported here so existing
// imports from "./db.ts" keep working. These bind to the ENV/default project;
// per-project data dirs come from project.ts accessors (genDir(), rawDir()…).
export {
  ROOT,
  DATA_DIR,
  RAW_DIR,
  TEST1_DIR,
  GEN_DIR,
  FINAL_DIR,
  DB_PATH,
} from "./config.ts";

export const DEFAULT_GLOBAL_PROMPT = `Use image generation to edit this photo.

Base Rules: Use the original image as strict base. Editing only (no generation). Do NOT add/remove elements. Do NOT alter composition or structure.

Realism & Materials: Preserve textures, materials, and natural grain. Maintain full surface realism. No smoothing. No plastic effect. No artificial sharpening.

Lighting (Cinematic & Natural): Preserve original lighting direction and sources. Do NOT introduce new light or alter scene logic. Preserve original time-of-day and overall scene mood. Amplify existing light only: Increase light/shadow contrast (no detail loss). Gently boost natural highlights. Deepen shadows without crushing blacks. Add soft gradients following original light.

Bloom / Glare + White Enhancement: Apply ONLY on existing bright sources. Keep soft, diffused, physically plausible. No heavy glow or washed highlights. Subtle lens flare only if coherent. Gently lift whites ONLY where naturally illuminated. Increase brightness without clipping details. Preserve texture inside highlights. Blend whites seamlessly into bloom. Avoid flat pure white. Keep transitions soft, airy, and natural.

Color Grading: Preserve original color balance of the scene. Maintain natural greens and blues. Respect scene context (daylight, night tones, artificial lighting). Pink tones: Brighter, lighter, more airy, slightly desaturated. Slightly warm highlights. Neutral, clean shadows. Preserve smooth color transitions.

Enhancements: Remove only minor distractions. Apply subtle perspective correction. Maintain full detail fidelity.

Subject Handling: Keep subject sharp and naturally separated via light contrast. No artificial depth of field.

Motion Blur: Apply ONLY to already moving elements. Keep subtle and realistic.

Hard Constraints: No AI artifacts. No fake lighting. No inconsistent shadows. No HDR or overprocessed look.

Style: Cinematic, minimal, editorial photography. Soft atmospheric light. Delicate colors. Refined bloom. Premium editorial look with preserved texture and authentic mood.

OUTPUT THE EDITED IMAGE.`;

// One SQLite handle per project, opened lazily and schema-initialized on first
// use. Keyed by project id so concurrent projects never share a connection.
const _handles = new Map<string, Database>();

export function db(): Database {
  const pid = currentProjectId();
  const cached = _handles.get(pid);
  if (cached) return cached;
  const path = dirsFor(pid).DB_PATH;
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path, { create: true });
  // PRIMA di ogni altro PRAGMA. WAL lascia convivere lettori e scrittore ma non
  // due scrittori, e il default di SQLite e' zero attesa: qualsiasi contesa
  // diventa un errore immediato invece di una pausa di millisecondi.
  //
  // L'ordine non e' un dettaglio di stile: `journal_mode = WAL` e' esso stesso
  // una scrittura, e con un altro processo in mezzo falliva con
  // SQLITE_BUSY_RECOVERY *prima* che il timeout venisse impostato — il server
  // non partiva proprio, morendo all'import di app.ts. Visto davvero, non
  // teorizzato: il backend e' andato giu' cosi' mentre un secondo processo
  // apriva lo stesso DB.
  d.run("PRAGMA busy_timeout = 5000");
  d.run("PRAGMA journal_mode = WAL");
  d.run("PRAGMA foreign_keys = ON");
  // Register before initializing so any nested db() during schema init (none
  // today, but cheap insurance) resolves to this same handle instead of looping.
  _handles.set(pid, d);
  initSchemaOn(d);
  return d;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    original_path TEXT NOT NULL,
    original_ext TEXT NOT NULL,
    favorite_version_id INTEGER,
    custom_prompt TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    prompt_used TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('imported','generated')),
    created_at INTEGER NOT NULL,
    UNIQUE(photo_id, version_number),
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
  )`,
  // Carries `id` so the gallery's "latest version per photo" subqueries
  // (`WHERE photo_id = ? ORDER BY id DESC LIMIT 1`) are covering.
  `CREATE INDEX IF NOT EXISTS idx_versions_photo_id ON versions(photo_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','cancelled')),
    result_version_id INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at)`,
  // Video generation runs on one GPU over the network, so the queue is a
  // queue of one — but it still has to survive a restart: a WAN generation is
  // ninety seconds when it fits in memory and an hour when it doesn't, and a
  // reload in the middle would otherwise lose the fact that the card is busy.
  `CREATE TABLE IF NOT EXISTS video_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shot TEXT NOT NULL,
    take TEXT NOT NULL DEFAULT 'a',
    prompt TEXT NOT NULL,
    params TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','cancelled')),
    prompt_id TEXT,
    frames INTEGER,
    log TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS orphans (
    filename TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    assigned_photo_id TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  // Saved color-grade templates. `grade` is a full ColorGrade JSON; `source`
  // records where it came from (manual save, or an imported Lightroom/LUT/JSON
  // template) so the UI can badge provenance.
  // Ricette estratte da un'immagine di riferimento (REF-02). Separate dai
  // `presets` (che sono gradazioni colore): qui il corpo e' il testo del prompt,
  // e `from_reference` tiene il legame con l'immagine da cui e' nato — senza,
  // fra sei mesi una ricetta e' una frase senza provenienza.
  `CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    from_reference TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL
  )`,
  // Quality control. `failure_modes` is the catalogue of ways a render can come
  // out wrong; each one is either a cheap pixel measurement or a yes/no question
  // for the local vision model, and can also contribute a clause to the prompt's
  // "Do not" block. `version_checks` records what each check said about a render.
  `CREATE TABLE IF NOT EXISTS failure_modes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('pixel','vlm')),
    question TEXT,
    negative_clause TEXT,
    threshold REAL,
    gate_enabled INTEGER NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS version_checks (
    version_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('hit','clear','unsure','error')),
    detail TEXT,
    checked_at INTEGER NOT NULL,
    PRIMARY KEY (version_id, code),
    FOREIGN KEY(version_id) REFERENCES versions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_version_checks_code ON version_checks(code, verdict)`,
  // Storyboard characters: a named subject with a reference image, pinned on
  // panels so successive generations keep the same face/outfit. `reference_photo_id`
  // points at a photo of this same project (ON DELETE SET NULL: losing the
  // reference must not delete the character).
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    reference_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
    description TEXT,
    created_at INTEGER NOT NULL
  )`,
  // Collections: the publishing unit. A gallery of 200 travel photos becomes a
  // handful of posts/carousels, each an ordered subset. A photo belongs to at
  // most one collection (`photo_id` is the PK of the membership table) —
  // publishing the same shot twice is a mistake, not a feature.
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    caption TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  // `reference_photo_id`: la foto che detta il colore del post. Viene allegata
  // a OGNI generazione del gruppo come seconda immagine, così il modello vede
  // il bersaglio invece di doverlo indovinare. È la differenza fra armonizzare
  // (correggere dopo, con un filtro sopra) e generare già coerente.
  `CREATE INDEX IF NOT EXISTS idx_collections_position ON collections(position)`,
  `CREATE TABLE IF NOT EXISTS collection_photos (
    photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collection_photos ON collection_photos(collection_id, position)`,
  // Collage: una slide del carosello fatta di più foto. Le foto che lo
  // compongono restano membri normali del post (stessa `collection_photos`) —
  // il collage non le consuma, le raggruppa: scioglierlo le rimette in fila
  // esattamente dov'erano. `position` è la posizione della SLIDE nel post, sulla
  // stessa scala delle foto singole. `mode` è la composizione (hero, mosaic,
  // grid, stack, split): tutte a pieno formato, senza cornici né fondo a vista.
  // `layout` serve solo a 'grid'.
  `CREATE TABLE IF NOT EXISTS collages (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'hero',
    layout TEXT NOT NULL DEFAULT '2x2',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS collage_photos (
    photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
    collage_id TEXT NOT NULL REFERENCES collages(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_collage_photos ON collage_photos(collage_id, position)`,
  `CREATE INDEX IF NOT EXISTS idx_collages_collection ON collages(collection_id, position)`,
];

function hasColumn(d: Database, table: string, col: string): boolean {
  const rows = d
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all();
  return rows.some((r) => r.name === col);
}

/** Create tables + run idempotent migrations on a specific handle. Called once
 *  per project when its DB is first opened (see db()). Exported so tests can
 *  exercise the migration path on a throwaway handle (including a "legacy" DB
 *  built with the v0 schema) without going through the per-project cache. */
export function initSchemaOn(d: Database): void {
  for (const stmt of SCHEMA_STATEMENTS) {
    d.run(stmt);
  }

  // Migrations: structured prompt config columns (added later than v0 schema).
  if (!hasColumn(d, "versions", "config")) {
    d.run("ALTER TABLE versions ADD COLUMN config TEXT");
  }
  if (!hasColumn(d, "photos", "config_override")) {
    d.run("ALTER TABLE photos ADD COLUMN config_override TEXT");
  }
  if (!hasColumn(d, "jobs", "config")) {
    d.run("ALTER TABLE jobs ADD COLUMN config TEXT");
  }
  if (!hasColumn(d, "photos", "taken_at")) {
    d.run("ALTER TABLE photos ADD COLUMN taken_at INTEGER");
  }
  // Multi-provider jobs: 'chatgpt' (default, CDP/Codex worker) or 'higgsfield'.
  if (!hasColumn(d, "jobs", "provider")) {
    d.run("ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'chatgpt'");
  }
  // For higgsfield jobs: JSON {model, params:{...}} driving generate_image.
  if (!hasColumn(d, "jobs", "provider_params")) {
    d.run("ALTER TABLE jobs ADD COLUMN provider_params TEXT");
  }
  // Human-readable current step while a job is running (e.g. "upload", "generate").
  if (!hasColumn(d, "jobs", "progress")) {
    d.run("ALTER TABLE jobs ADD COLUMN progress TEXT");
  }
  // Da dove nasce la versione che questo job produrra': ricetta, insieme di
  // sorgenti, reference. Serve all'albero per raggruppare le varianti.
  //
  // Senza, le generazioni fatte dalla coda finivano tutte sotto "origine non
  // registrata" mentre solo quelle lanciate da uno script a mano avevano il
  // lineage: l'effetto perverso e' che la strada CORRETTA dava il risultato
  // peggiore, e per avere un albero leggibile conveniva scrivere INSERT a mano.
  // E' cosi' che sono nati due guasti in un giorno solo: un percorso fuori
  // convenzione (miniature a 500) e dei timestamp in secondi invece che in
  // millisecondi (ordine cronologico rovesciato).
  if (!hasColumn(d, "jobs", "lineage")) {
    d.run("ALTER TABLE jobs ADD COLUMN lineage TEXT");
  }

  // `piano` -> `shot`. The column was the last Italian name in the schema, and
  // a name that only half the codebase can read is a name that gets read
  // wrong: the row came back as `{piano}` while the type said `{shot}`, which
  // TypeScript cannot catch across a `SELECT *`. Renamed in place, so an
  // existing queue survives the upgrade.
  if (hasColumn(d, "video_jobs", "piano") && !hasColumn(d, "video_jobs", "shot")) {
    d.run("ALTER TABLE video_jobs RENAME COLUMN piano TO shot");
  }
  // Con quale canale lavorare QUESTO job: cdp, codex, codex-http, openai.
  //
  // Era una scelta solo globale, letta all'avvio del processo: per generare con
  // un backend diverso bisognava riavviare il servizio, e il riavvio cambia il
  // comportamento di ogni progetto invece che della singola generazione.
  // NULL = usa quello di sistema, che resta il default.
  if (!hasColumn(d, "jobs", "backend")) {
    d.run("ALTER TABLE jobs ADD COLUMN backend TEXT");
  }
  // Acknowledged-by-user flag: hides a failed job from the alert list (kept in
  // the per-photo generation log until retention prunes it).
  if (!hasColumn(d, "jobs", "seen")) {
    d.run("ALTER TABLE jobs ADD COLUMN seen INTEGER NOT NULL DEFAULT 0");
  }
  // How many times this job was actually picked up by a worker (retries on
  // rate-limit increment this), and when it first started — so the log can show
  // real total elapsed instead of a per-attempt timer that resets on requeue.
  if (!hasColumn(d, "jobs", "attempts")) {
    d.run("ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(d, "jobs", "first_started_at")) {
    d.run("ALTER TABLE jobs ADD COLUMN first_started_at INTEGER");
  }
  // Record on each version which engine + settings produced it.
  if (!hasColumn(d, "versions", "provider")) {
    d.run("ALTER TABLE versions ADD COLUMN provider TEXT");
  }
  if (!hasColumn(d, "versions", "provider_params")) {
    d.run("ALTER TABLE versions ADD COLUMN provider_params TEXT");
  }
  // Credits spent to produce this version (Higgsfield). NULL for free/chatgpt.
  if (!hasColumn(d, "versions", "credits")) {
    d.run("ALTER TABLE versions ADD COLUMN credits REAL");
  }
  // Ogni chiamata a un backend a pagamento, riuscita o no.
  //
  // Il costo stava solo su `versions`, cioe' si contava quello che finiva in
  // galleria. Ma si paga la CHIAMATA: una generazione scartata, una fallita
  // dopo che il modello ha gia' prodotto l'immagine, o una prova di
  // calibrazione lanciata da uno script costano uguale e non lasciavano
  // traccia. Misurato il 26/08: 21 immagini generate, 6 contate, $1.26
  // mostrati contro ~$4.47 reali. Il numero in barra non era impreciso, era
  // strutturalmente incompleto.
  d.run(`CREATE TABLE IF NOT EXISTS api_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    quality TEXT,
    output_tokens INTEGER,
    cost_usd REAL NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    origin TEXT,
    created_at INTEGER NOT NULL
  )`);
  d.run("CREATE INDEX IF NOT EXISTS api_calls_created ON api_calls(created_at)");

  // Remember the last Higgsfield selection (model + params) chosen for a photo.
  if (!hasColumn(d, "photos", "higgsfield_selection")) {
    d.run("ALTER TABLE photos ADD COLUMN higgsfield_selection TEXT");
  }
  // Per-photo extra instructions, appended to the prompt on top of the config.
  if (!hasColumn(d, "photos", "extra_instructions")) {
    d.run("ALTER TABLE photos ADD COLUMN extra_instructions TEXT");
  }
  // Per-photo color-grade override (JSON ColorGrade). NULL = use the global grade.
  if (!hasColumn(d, "photos", "grade_override")) {
    d.run("ALTER TABLE photos ADD COLUMN grade_override TEXT");
  }
  // Per-photo freeform review note the human jots on the grid ("too dark",
  // "keep the sign", "recompose tighter"). Distinct from extra_instructions:
  // NOT auto-injected into the prompt — it's read in bulk to distill the next
  // run's generic + per-photo direction. NULL = no note.
  if (!hasColumn(d, "photos", "feedback")) {
    d.run("ALTER TABLE photos ADD COLUMN feedback TEXT");
  }
  // 'original' = imported source photo; 'generated' = created from scratch via a
  // text-to-image job (no source file; the first render becomes its original).
  if (!hasColumn(d, "photos", "kind")) {
    d.run("ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'original'");
  }
  // 'edit' = transform photo.original_path with the prompt (default);
  // 'generate' = text-to-image, no source image.
  if (!hasColumn(d, "jobs", "mode")) {
    d.run("ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'edit'");
  }
  // Override input image for an edit job. NULL = use photo.original_path.
  // Set by the bake orchestrator so a generative ('ai') step edits the working
  // image produced by the previous step (enables multi-pass pipelines).
  if (!hasColumn(d, "jobs", "input_path")) {
    d.run("ALTER TABLE jobs ADD COLUMN input_path TEXT");
  }

  // ---- Storyboard ---------------------------------------------------------
  // A storyboard is an ordinary project whose photos are panels: same
  // versioning, same job queue, plus an order and a duration. A photo gallery
  // simply leaves these NULL and behaves exactly as before.
  if (!hasColumn(d, "photos", "sequence_index")) {
    d.run("ALTER TABLE photos ADD COLUMN sequence_index INTEGER");
  }
  // Panel duration in ms, mirroring Storyboarder's board.duration.
  if (!hasColumn(d, "photos", "duration_ms")) {
    d.run("ALTER TABLE photos ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 3000");
  }
  // Free-text scene/shot label ("INT. BAR - NIGHT"), exported as board.dialogue-less notes.
  if (!hasColumn(d, "photos", "scene_label")) {
    d.run("ALTER TABLE photos ADD COLUMN scene_label TEXT");
  }
  // JSON array of character ids pinned on this panel.
  if (!hasColumn(d, "photos", "character_ids")) {
    d.run("ALTER TABLE photos ADD COLUMN character_ids TEXT");
  }
  // JSON array of extra reference images attached to the generation request
  // (character references). NULL = single-image request, the historical path.
  if (!hasColumn(d, "jobs", "ref_paths")) {
    d.run("ALTER TABLE jobs ADD COLUMN ref_paths TEXT");
  }
  // Il giudizio umano su UNA VARIANTE, distinto da "mi piace" che sta sulla
  // foto: scegliere fra varianti e scegliere fra foto sono due gesti diversi,
  // e tenerli sullo stesso campo costringerebbe a sceglierne uno solo.
  // NULL = non ancora giudicata, che non e' la stessa cosa di "scartata".
  if (!hasColumn(d, "versions", "verdict")) {
    d.run("ALTER TABLE versions ADD COLUMN verdict TEXT"); // keep | maybe | discard
  }

  // The verdicts stored on a version were Italian words the whole UI compared
  // against. Renaming only the code would have made every judgement already
  // made read as "never looked at" — the work of going through a set one
  // render at a time, silently undone, so the values move with the code.
  for (const [from, to] of [["tieni", "keep"], ["forse", "maybe"], ["scarta", "discard"]] as const) {
    d.run("UPDATE versions SET verdict = ? WHERE verdict = ?", [to, from]);
  }
  // Il perche' della scelta. Senza, tornano indietro solo i sopravvissuti e non
  // il motivo, che e' l'unica parte riutilizzabile per la passata successiva.
  if (!hasColumn(d, "versions", "note")) {
    d.run("ALTER TABLE versions ADD COLUMN note TEXT");
  }
  // Da cosa e' nata la variante: sorgenti, riferimenti, ricetta, preambolo.
  // Sullo storico resta NULL, e la vista lo dichiara invece di inventarlo.
  if (!hasColumn(d, "versions", "lineage")) {
    d.run("ALTER TABLE versions ADD COLUMN lineage TEXT");
  }

  // Only the rows of an actual storyboard land in this index.
  d.run(
    `CREATE INDEX IF NOT EXISTS idx_photos_sequence ON photos(sequence_index)
       WHERE sequence_index IS NOT NULL`,
  );

  // "Mi piace": la scelta umana su UNA foto, presa scorrendo la griglia. È
  // deliberatamente separata da favorite_version_id (quale render di quella
  // foto è il buono) e dai post: prima si dice cosa vale, poi si raggruppa.
  if (!hasColumn(d, "collections", "reference_photo_id")) {
    d.run("ALTER TABLE collections ADD COLUMN reference_photo_id TEXT");
  }
  // La copertina è una SCELTA UMANA, e come tale non può vivere nella posizione
  // 0 di una lista che viene riordinata: un riordino cronologico la cancella
  // senza dire niente. Qui è un campo suo, che sopravvive a qualsiasi
  // riorganizzazione del post.
  if (!hasColumn(d, "collections", "cover_photo_id")) {
    d.run("ALTER TABLE collections ADD COLUMN cover_photo_id TEXT");
  }
  if (!hasColumn(d, "photos", "picked")) {
    d.run("ALTER TABLE photos ADD COLUMN picked INTEGER NOT NULL DEFAULT 0");
  }
  // Foto che ChatGPT si rifiuta di elaborare (personaggi protetti da
  // copyright, somiglianze di terzi). Il rifiuto non e' un errore transitorio:
  // riprovare produce lo stesso "no" e brucia un posto in coda ogni volta.
  // Marcata qui, la foto esce dagli accodamenti di massa e la ragione resta
  // scritta accanto, cosi' si sa perche' e' ferma invece di trovarla vuota.
  if (!hasColumn(d, "photos", "skipped")) {
    d.run("ALTER TABLE photos ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(d, "photos", "skip_reason")) {
    d.run("ALTER TABLE photos ADD COLUMN skip_reason TEXT");
  }
  d.run("CREATE INDEX IF NOT EXISTS idx_photos_skipped ON photos(skipped) WHERE skipped = 1");
  d.run("CREATE INDEX IF NOT EXISTS idx_photos_picked ON photos(picked) WHERE picked = 1");

  // ---- Index hygiene ------------------------------------------------------
  // `idx_versions_photo_id` (see SCHEMA_STATEMENTS) makes the gallery's
  // "latest version per photo" subqueries covering — measured on the real
  // 190-photo / 1647-version DB: 2.48 → 0.48 ms per gallery query. The older
  // photo_id-only index is a strict prefix of it, hence pure write overhead.
  d.run("DROP INDEX IF EXISTS idx_versions_photo");

  const has = d
    .query("SELECT value FROM settings WHERE key = 'global_prompt'")
    .get();
  if (!has) {
    d.run("INSERT INTO settings (key, value) VALUES ('global_prompt', ?)", [
      DEFAULT_GLOBAL_PROMPT,
    ]);
  }

  // Reset stale running jobs after a crash/restart
  d.run(
    "UPDATE jobs SET status='pending', started_at=NULL WHERE status='running'",
  );
}

/** Ensure the active project's DB exists and is schema-initialized. */
export function initSchema(): void {
  db();
}

export type PhotoRow = {
  id: string;
  original_path: string;
  original_ext: string;
  favorite_version_id: number | null;
  custom_prompt: string | null;
  config_override: string | null;
  higgsfield_selection: string | null;
  extra_instructions: string | null;
  grade_override: string | null;
  feedback: string | null;
  /** "Mi piace": 1 = la tengo. Indipendente dal post e dalla versione preferita. */
  picked: number;
  /** 1 = ChatGPT rifiuta questa foto: non riaccodarla. */
  skipped: number;
  skip_reason: string | null;
  kind: "original" | "generated";
  taken_at: number | null;
  /** Storyboard: 0-based panel order. NULL = not part of a sequence (a plain photo). */
  sequence_index: number | null;
  /** Storyboard: panel duration in ms (Storyboarder's board.duration). */
  duration_ms: number;
  /** Storyboard: free-text scene/shot label. */
  scene_label: string | null;
  /** Storyboard: JSON array of pinned character ids. */
  character_ids: string | null;
  created_at: number;
  updated_at: number;
};

export type CharacterRow = {
  id: string;
  name: string;
  reference_photo_id: string | null;
  description: string | null;
  created_at: number;
};

/** Una slide del carosello composta da più foto. */
export type CollageMode = "hero" | "mosaic" | "grid" | "stack" | "split";

export type CollageRow = {
  id: string;
  collection_id: string;
  mode: CollageMode;
  layout: string;
  position: number;
  created_at: number;
};

/** A post/carousel: an ordered subset of the gallery, ready to publish. */
export type CollectionRow = {
  id: string;
  title: string;
  caption: string | null;
  position: number;
  /** Foto di riferimento cromatico: allegata a ogni generazione del post. */
  reference_photo_id: string | null;
  /** Copertina scelta a mano: sopravvive ai riordini della lista. */
  cover_photo_id: string | null;
  created_at: number;
};

export type VersionRow = {
  id: number;
  photo_id: string;
  version_number: number;
  image_path: string;
  prompt_used: string;
  config: string | null;
  provider: string | null;
  provider_params: string | null;
  credits: number | null;
  source: "imported" | "generated";
  created_at: number;
};

export type JobRow = {
  id: number;
  photo_id: string;
  prompt: string;
  config: string | null;
  provider: "chatgpt" | "higgsfield";
  provider_params: string | null;
  mode: "edit" | "generate";
  input_path: string | null;
  /** JSON array of extra reference images attached to the request (characters). */
  ref_paths: string | null;
  /** Da dove nasce la versione che questo job produrra': ricetta, insieme di
   *  sorgenti, reference. Viene copiato sulla versione a fine lavorazione. */
  lineage: string | null;
  /** Canale di questo job: cdp, codex, codex-http, openai. NULL = quello di
   *  sistema. Esiste perche' cambiare canale per una generazione non debba
   *  costare il riavvio di un servizio che serve tutti i progetti. */
  backend: string | null;
  progress: string | null;
  seen: number;
  attempts: number;
  first_started_at: number | null;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result_version_id: number | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export type OrphanRow = {
  filename: string;
  source_path: string;
  assigned_photo_id: string | null;
  skipped: number;
  created_at: number;
};

export function getGlobalPrompt(): string {
  const row = db()
    .query<{ value: string }, []>(
      "SELECT value FROM settings WHERE key = 'global_prompt'",
    )
    .get();
  return row?.value ?? DEFAULT_GLOBAL_PROMPT;
}

export function setGlobalPrompt(value: string): void {
  db().run("UPDATE settings SET value = ? WHERE key = 'global_prompt'", [value]);
}

export function effectivePrompt(photo: PhotoRow): string {
  return photo.custom_prompt ?? getGlobalPrompt();
}

export function getDefaultConfig(): string | null {
  const row = db()
    .query<{ value: string }, []>(
      "SELECT value FROM settings WHERE key = 'default_config'",
    )
    .get();
  return row?.value ?? null;
}

export function setDefaultConfig(json: string): void {
  db().run(
    `INSERT INTO settings (key, value) VALUES ('default_config', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [json],
  );
}

// ---- Color grade (local, deterministic look applied on top of generations) --
// The color pipeline is an ORDERED LIST of steps (WB · levels · sakura · LUT ·
// color). Each step can be toggled, has its own params, and the order is
// editable. The same structure is overridable per photo (photos.grade_override).
// Stored as JSON in settings.color_grade.
// 'ai' is a GENERATIVE step: it re-renders the working image through a provider
// (ChatGPT/Higgsfield) using an embedded PromptConfig. It is NOT part of the
// live/deterministic color pipeline (the /graded preview skips it) — it only
// runs during a "bake", where its output feeds the next step.
export type GradeStepType = "white_balance" | "levels" | "sakura" | "sky" | "bloom" | "lut" | "hsl" | "curve" | "split_tone" | "color" | "match" | "ai";

export type GradeStep = {
  /** stable id (React keys / reordering). */
  id: string;
  type: GradeStepType;
  enabled: boolean;
  /** Restrict the step to night or day scenes. Undefined = always.
   *  Serve perché una correzione giusta di notte (togliere l'ambra dalla pietra
   *  sotto i fari) di giorno spegne i colori che fanno funzionare il cibo.
   *  Dosato sulla stessa rampa continua della LUT, non a soglia. */
  only?: "night" | "day";
  /** Type-specific params. For deterministic steps these are scalars
   *  (dose/lut for 'lut', temp/tint… for 'color'…); for an 'ai' step they hold
   *  { provider, config: Partial<PromptConfig> } — hence the loose value type. */
  params: Record<string, unknown>;
};

export type ColorGrade = {
  /** Master switch: off = serve the ungraded original. */
  enabled: boolean;
  /** Steps executed in order. */
  steps: GradeStep[];
};

/** LUT id = path relative to LUT_DIR (see config.ts). "" = no LUT. */
export const DEFAULT_LUT = "CMG SUMMER 17 LUT/CMG SUMMER LUT '18.cube";

/** Default chain: WB → levels → sakura → LUT → color. Purely DETERMINISTIC —
 *  AI generation is NOT a chain step, it's the Input bookend (from-zero prompt or
 *  regenerate favorites). Keeping generation out of the middle removes the
 *  confusing "repeated + disabled AI step" and matches the input→steps→output model. */
export function defaultSteps(): GradeStep[] {
  return [
    // AI edit = primo step della pipeline completa: rigenera l'immagine di lavoro
    // (config vuota = eredita il "look del set"). Saltato dal display /graded,
    // eseguito solo nel bake multi-pass. Vedi grade.ts deterministicSteps.
    { id: "ai", type: "ai", enabled: true, params: { provider: "chatgpt", config: {} } },
    { id: "wb", type: "white_balance", enabled: true, params: { awb: true, scene_match: true } },
    { id: "levels", type: "levels", enabled: true, params: { black: 0.4, white: 99.6 } },
    { id: "sakura", type: "sakura", enabled: true, params: {} },
    { id: "lut", type: "lut", enabled: true, params: { lut: DEFAULT_LUT, dose: 80, auto_dose: true, dose_night: 30 } },
    { id: "sky_mixer", type: "hsl", enabled: true, params: { hue_aqua: 12, sat_aqua: -35, lum_aqua: -8, sat_blue: -12, lum_blue: -6 } },
    { id: "color", type: "color", enabled: false, params: { temp: 0, tint: 0, saturation: 0, brightness: 0, contrast: 0 } },
  ];
}

export const DEFAULT_COLOR_GRADE: ColorGrade = { enabled: false, steps: defaultSteps() };

const STEP_TYPES: GradeStepType[] = ["white_balance", "levels", "sakura", "sky", "bloom", "lut", "hsl", "curve", "split_tone", "color", "match", "ai"];
let _sid = 0;

/** Build steps from the old flat format (back-compat migration). */
function stepsFromLegacy(f: Record<string, unknown>): GradeStep[] {
  const awb = typeof f.awb === "boolean" ? f.awb : true;
  const scene = typeof f.scene_match === "boolean" ? f.scene_match : true;
  return [
    { id: "ai", type: "ai", enabled: true, params: { provider: "chatgpt", config: {} } },
    { id: "wb", type: "white_balance", enabled: awb || scene, params: { awb, scene_match: scene } },
    { id: "levels", type: "levels", enabled: true, params: { black: 0.4, white: 99.6 } },
    { id: "sakura", type: "sakura", enabled: typeof f.pop === "boolean" ? f.pop : true, params: {} },
    {
      id: "lut", type: "lut", enabled: true,
      params: {
        lut: typeof f.lut === "string" ? f.lut : DEFAULT_LUT,
        dose: Number(f.dose ?? 80),
        auto_dose: typeof f.auto_dose === "boolean" ? f.auto_dose : true,
        dose_night: Number(f.dose_night ?? 30),
      },
    },
    { id: "sky_mixer", type: "hsl", enabled: true, params: { hue_aqua: 12, sat_aqua: -35, lum_aqua: -8, sat_blue: -12, lum_blue: -6 } },
    { id: "color", type: "color", enabled: false, params: { temp: 0, tint: 0, saturation: 0, brightness: 0, contrast: 0 } },
  ];
}

/** Sanitize/validate an arbitrary list of steps (from client or storage). */
export function sanitizeSteps(raw: unknown): GradeStep[] {
  if (!Array.isArray(raw)) return defaultSteps();
  const out: GradeStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (!STEP_TYPES.includes(o.type as GradeStepType)) continue;
    const params = o.params && typeof o.params === "object" ? (o.params as Record<string, unknown>) : {};
    const only = o.only === "night" || o.only === "day" ? o.only : undefined;
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : `s${++_sid}_${Date.now().toString(36)}`,
      type: o.type as GradeStepType,
      enabled: o.enabled !== false,
      ...(only ? { only } : {}),
      params,
    });
  }
  return out.length ? out : defaultSteps();
}

/** Normalize any stored/received value into a step-based ColorGrade, migrating
 *  the old flat format if necessary. */
export function normalizeGrade(parsed: unknown): ColorGrade {
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.steps)) {
      return { enabled: o.enabled === true, steps: sanitizeSteps(o.steps) };
    }
    // old flat format → migrate
    return { enabled: o.enabled === true, steps: stepsFromLegacy(o) };
  }
  return { enabled: false, steps: defaultSteps() };
}

export function getColorGrade(): ColorGrade {
  const row = db()
    .query<{ value: string }, []>(
      "SELECT value FROM settings WHERE key = 'color_grade'",
    )
    .get();
  if (!row?.value) return { enabled: false, steps: defaultSteps() };
  try {
    return normalizeGrade(JSON.parse(row.value));
  } catch {
    return { enabled: false, steps: defaultSteps() };
  }
}

export function setColorGrade(cfg: ColorGrade): void {
  db().run(
    `INSERT INTO settings (key, value) VALUES ('color_grade', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(cfg)],
  );
}

/** Effective grade for a photo: per-photo override if present, else the global. */
export function effectiveGrade(photo: PhotoRow): ColorGrade {
  if (photo.grade_override) {
    try {
      return normalizeGrade(JSON.parse(photo.grade_override));
    } catch {
      /* corrupt override → fall back to the global */
    }
  }
  return getColorGrade();
}

// ---- Presets (saved color-grade templates) --------------------------------

export type PresetRow = {
  id: number;
  name: string;
  grade: string; // ColorGrade JSON
  source: string;
  created_at: number;
};

export type Preset = {
  id: number;
  name: string;
  grade: ColorGrade;
  source: string;
  created_at: number;
};

function rowToPreset(r: PresetRow): Preset {
  let grade: ColorGrade;
  try {
    grade = normalizeGrade(JSON.parse(r.grade));
  } catch {
    grade = { enabled: false, steps: defaultSteps() };
  }
  return { id: r.id, name: r.name, grade, source: r.source, created_at: r.created_at };
}

export function listPresets(): Preset[] {
  return db()
    .query<PresetRow, []>("SELECT * FROM presets ORDER BY created_at DESC, id DESC")
    .all()
    .map(rowToPreset);
}

export function getPreset(id: number): Preset | null {
  const r = db()
    .query<PresetRow, [number]>("SELECT * FROM presets WHERE id = ?")
    .get(id);
  return r ? rowToPreset(r) : null;
}

export function createPreset(name: string, grade: ColorGrade, source = "manual"): Preset {
  const now = Date.now();
  const clean = { enabled: grade.enabled === true, steps: sanitizeSteps(grade.steps) };
  const res = db().run(
    "INSERT INTO presets (name, grade, source, created_at) VALUES (?, ?, ?, ?)",
    [name.trim() || "Senza nome", JSON.stringify(clean), source, now],
  );
  return { id: Number(res.lastInsertRowid), name: name.trim() || "Senza nome", grade: clean, source, created_at: now };
}

export function renamePreset(id: number, name: string): void {
  db().run("UPDATE presets SET name = ? WHERE id = ?", [name.trim() || "Senza nome", id]);
}

export function deletePreset(id: number): void {
  db().run("DELETE FROM presets WHERE id = ?", [id]);
}

/**
 * Il nome del file di una versione. UNA regola sola, in un posto solo.
 *
 * Era ricostruita a mano in tre punti (`jobs.ts`, `bake.ts`, e a mano negli
 * script), e il client la ricostruisce a sua volta in `thumbGenUrl` per
 * chiedere la miniatura. Finche' tutti scrivono la stessa stringa va bene; il
 * 27/08 due cover sono state registrate come
 * `generations/cover-scena-gel-high.png` invece di `generations/1/v30.png`, e
 * il risultato e' stato il peggiore possibile: la riga nel database c'era,
 * l'API la restituiva, l'albero mostrava la variante, e al posto della foto
 * arrivava un 500. Un dato "presente ma invisibile" non si nota finche'
 * qualcuno non va a cercare proprio quella.
 */
export function versionFileName(versionNumber: number): string {
  return `v${String(versionNumber).padStart(2, "0")}.png`;
}

/** Dove DEVE stare il file di una versione: `<gen>/<photo_id>/vNN.png`. */
export function versionPath(photoId: string, versionNumber: number): string {
  return join(genDir(), photoId, versionFileName(versionNumber));
}

/**
 * Controlla che un percorso rispetti la convenzione, e spiega perche' no.
 *
 * Non blocca la scrittura di proposito: le versioni importate da fuori
 * (`source='imported'`) vivono legittimamente altrove, e un progetto vecchio
 * puo' avere percorsi storici che nessuno vuole rompere adesso. Serve a
 * chiamare il problema per nome nel punto in cui nasce, invece di scoprirlo
 * settimane dopo da una miniatura che non carica.
 */
export function pathOutsideConvention(
  photoId: string,
  versionNumber: number,
  imagePath: string,
): string | null {
  const expected = versionPath(photoId, versionNumber);
  if (imagePath === expected) return null;
  return (
    `la versione ${versionNumber} di "${photoId}" punta a ${imagePath} ` +
    `invece di ${expected}: la miniatura verra' cercata all'indirizzo giusto e ` +
    `rispondera' 500, con la variante visibile nell'albero e l'immagine no`
  );
}

/**
 * Quando e' nata una versione, in millisecondi.
 *
 * La convenzione del progetto e' `Date.now()`, cioe' MILLISECONDI, e vale per
 * ogni tabella. Le versioni registrate a mano da uno script il 27/08 usavano
 * `Math.floor(Date.now()/1000)` — secondi — e il risultato e' stato un ordine
 * cronologico che metteva le tre piu' recenti in fondo: un numero mille volte
 * piu' piccolo di tutti gli altri sembra vecchio di cinquant'anni.
 *
 * Non si e' rotto niente e nessuno se ne e' accorto finche' l'albero non ha
 * iniziato a ordinare per data. Da qui in poi si chiama questa, invece di
 * scrivere l'espressione a mano ogni volta.
 */
export function adesso(): number {
  return Date.now();
}

/** Un istante e' in secondi invece che in millisecondi? Serve per accorgersi
 *  dei dati gia' scritti male, che nessun controllo futuro puo' prevenire. */
export function suspectInstant(t: number): boolean {
  // 100000000000 ms = marzo 1973; nessun dato vero sta sotto, mentre QUALSIASI
  // timestamp in secondi di questo secolo ci sta abbondantemente sotto.
  return t > 0 && t < 100_000_000_000;
}

export function nextVersionNumber(photoId: string): number {
  const row = db()
    .query<{ n: number }, [string]>(
      "SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE photo_id = ?",
    )
    .get(photoId);
  return (row?.n ?? 0) + 1;
}
