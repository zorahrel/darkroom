import { Database } from "bun:sqlite";

// Paths are centralized in config.ts (env-driven). Re-exported here so existing
// imports from "./db.ts" keep working.
export {
  ROOT,
  DATA_DIR,
  RAW_DIR,
  TEST1_DIR,
  GEN_DIR,
  FINAL_DIR,
  DB_PATH,
} from "./config.ts";
import { DB_PATH } from "./config.ts";

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

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { create: true });
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  return _db;
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
  `CREATE INDEX IF NOT EXISTS idx_versions_photo ON versions(photo_id)`,
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
  `CREATE TABLE IF NOT EXISTS orphans (
    filename TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    assigned_photo_id TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
];

function hasColumn(table: string, col: string): boolean {
  const rows = db()
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all();
  return rows.some((r) => r.name === col);
}

export function initSchema(): void {
  const d = db();
  for (const stmt of SCHEMA_STATEMENTS) {
    d.run(stmt);
  }

  // Migrations: structured prompt config columns (added later than v0 schema).
  if (!hasColumn("versions", "config")) {
    d.run("ALTER TABLE versions ADD COLUMN config TEXT");
  }
  if (!hasColumn("photos", "config_override")) {
    d.run("ALTER TABLE photos ADD COLUMN config_override TEXT");
  }
  if (!hasColumn("jobs", "config")) {
    d.run("ALTER TABLE jobs ADD COLUMN config TEXT");
  }
  if (!hasColumn("photos", "taken_at")) {
    d.run("ALTER TABLE photos ADD COLUMN taken_at INTEGER");
  }
  // Multi-provider jobs: 'chatgpt' (default, CDP/Codex worker) or 'higgsfield'.
  if (!hasColumn("jobs", "provider")) {
    d.run("ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'chatgpt'");
  }
  // For higgsfield jobs: JSON {model, params:{...}} driving generate_image.
  if (!hasColumn("jobs", "provider_params")) {
    d.run("ALTER TABLE jobs ADD COLUMN provider_params TEXT");
  }
  // Human-readable current step while a job is running (e.g. "upload", "generate").
  if (!hasColumn("jobs", "progress")) {
    d.run("ALTER TABLE jobs ADD COLUMN progress TEXT");
  }
  // Acknowledged-by-user flag: hides a failed job from the alert list (kept in
  // the per-photo generation log until retention prunes it).
  if (!hasColumn("jobs", "seen")) {
    d.run("ALTER TABLE jobs ADD COLUMN seen INTEGER NOT NULL DEFAULT 0");
  }
  // How many times this job was actually picked up by a worker (retries on
  // rate-limit increment this), and when it first started — so the log can show
  // real total elapsed instead of a per-attempt timer that resets on requeue.
  if (!hasColumn("jobs", "attempts")) {
    d.run("ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn("jobs", "first_started_at")) {
    d.run("ALTER TABLE jobs ADD COLUMN first_started_at INTEGER");
  }
  // Record on each version which engine + settings produced it.
  if (!hasColumn("versions", "provider")) {
    d.run("ALTER TABLE versions ADD COLUMN provider TEXT");
  }
  if (!hasColumn("versions", "provider_params")) {
    d.run("ALTER TABLE versions ADD COLUMN provider_params TEXT");
  }
  // Credits spent to produce this version (Higgsfield). NULL for free/chatgpt.
  if (!hasColumn("versions", "credits")) {
    d.run("ALTER TABLE versions ADD COLUMN credits REAL");
  }
  // Remember the last Higgsfield selection (model + params) chosen for a photo.
  if (!hasColumn("photos", "higgsfield_selection")) {
    d.run("ALTER TABLE photos ADD COLUMN higgsfield_selection TEXT");
  }
  // Per-photo extra instructions, appended to the prompt on top of the config.
  if (!hasColumn("photos", "extra_instructions")) {
    d.run("ALTER TABLE photos ADD COLUMN extra_instructions TEXT");
  }
  // 'original' = imported source photo; 'generated' = created from scratch via a
  // text-to-image job (no source file; the first render becomes its original).
  if (!hasColumn("photos", "kind")) {
    d.run("ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'original'");
  }
  // 'edit' = transform photo.original_path with the prompt (default);
  // 'generate' = text-to-image, no source image.
  if (!hasColumn("jobs", "mode")) {
    d.run("ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'edit'");
  }

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

export type PhotoRow = {
  id: string;
  original_path: string;
  original_ext: string;
  favorite_version_id: number | null;
  custom_prompt: string | null;
  config_override: string | null;
  higgsfield_selection: string | null;
  extra_instructions: string | null;
  kind: "original" | "generated";
  taken_at: number | null;
  created_at: number;
  updated_at: number;
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

export function nextVersionNumber(photoId: string): number {
  const row = db()
    .query<{ n: number }, [string]>(
      "SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE photo_id = ?",
    )
    .get(photoId);
  return (row?.n ?? 0) + 1;
}
