import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { db } from "./db.ts";
import { rawDir } from "./project.ts";

/**
 * Where a project's photos come from.
 *
 * A project doesn't have to own its originals. A source is a folder on disk
 * plus how to treat it:
 *
 *  - `link` — index the files where they are. Nothing is copied, nothing is
 *    duplicated on disk; the DB stores absolute paths, which is how the
 *    importer has always worked, so this costs nothing.
 *  - `copy` — bring the files into the project's own RAW folder, for when the
 *    source is a card, a download folder, or anything you'll want to clear out.
 *
 * The choice belongs to the moment you pick the files, not to project setup.
 */

export type SourceMode = "link" | "copy";

export type PhotoSource = {
  path: string;
  mode: SourceMode;
  added_at: number;
};

const SETTINGS_KEY = "photo_sources";
const PHOTO_EXTENSIONS = new Set([".jpeg", ".jpg", ".png"]);

function isPhotoFile(name: string): boolean {
  return PHOTO_EXTENSIONS.has(extname(name).toLowerCase());
}

export function listSources(): PhotoSource[] {
  const row = db()
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is PhotoSource => Boolean(s) && typeof s.path === "string")
      .map((s) => ({
        path: s.path,
        mode: s.mode === "copy" ? "copy" : "link",
        added_at: typeof s.added_at === "number" ? s.added_at : 0,
      }));
  } catch {
    return [];
  }
}

function saveSources(sources: PhotoSource[]): void {
  db().run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_KEY, JSON.stringify(sources)],
  );
}

export type ImportSummary = {
  scanned: number;
  added: number;
  skipped: number;
  copied: number;
};

/**
 * Register a folder and index what's in it.
 *
 * Re-adding the same folder is fine: it re-scans and picks up new files, which
 * is what you want after dropping more photos in.
 */
export function addSource(input: { path: string; mode?: SourceMode }): {
  source: PhotoSource;
  summary: ImportSummary;
} {
  // Validate BEFORE resolving: `resolve("")` is the process's cwd, which would
  // quietly register whatever folder the server happens to run from.
  const raw = String(input.path ?? "").trim();
  if (!raw) throw new Error("serve la cartella delle foto");
  const path = resolve(raw);
  if (!existsSync(path)) throw new Error(`cartella inesistente: ${path}`);
  if (!statSync(path).isDirectory()) throw new Error(`non è una cartella: ${path}`);

  const mode: SourceMode = input.mode === "copy" ? "copy" : "link";
  const sources = listSources().filter((s) => s.path !== path);
  const source: PhotoSource = { path, mode, added_at: Date.now() };
  sources.push(source);
  saveSources(sources);

  return { source, summary: importSource(source) };
}

export function removeSource(path: string): boolean {
  const target = resolve(path);
  const sources = listSources();
  const left = sources.filter((s) => s.path !== target);
  if (left.length === sources.length) return false;
  saveSources(left);
  // Photos already indexed stay: forgetting where they came from must not
  // delete work done on them.
  return true;
}

/** A free photo id derived from the filename, so two folders can hold a
 *  `DSC_0001.jpg` each without one hiding the other. */
function freePhotoId(base: string, path: string): string | null {
  const existing = db().prepare<{ id: string; original_path: string }, [string]>(
    "SELECT id, original_path FROM photos WHERE id = ?",
  );
  const first = existing.get(base);
  if (!first) return base;
  if (first.original_path === path) return null; // already indexed, same file
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}_${n}`;
    const row = existing.get(candidate);
    if (!row) return candidate;
    if (row.original_path === path) return null;
  }
  return null;
}

/** Index one source. Returns what it did, so the UI can say something true. */
export function importSource(source: PhotoSource): ImportSummary {
  const summary: ImportSummary = { scanned: 0, added: 0, skipped: 0, copied: 0 };
  if (!existsSync(source.path)) return summary;

  const files = readdirSync(source.path)
    .filter((f) => !f.startsWith("."))
    .filter(isPhotoFile)
    .sort();
  summary.scanned = files.length;

  const insert = db().prepare(
    `INSERT INTO photos (id, original_path, original_ext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const raw = rawDir();
  if (source.mode === "copy") mkdirSync(raw, { recursive: true });

  for (const file of files) {
    const from = join(source.path, file);
    // In copy mode the project's own file is the one we index.
    const target = source.mode === "copy" ? join(raw, file) : from;
    const base = file.replace(/\.[^.]+$/, "");
    const id = freePhotoId(base, target);
    if (!id) {
      summary.skipped++;
      continue;
    }
    if (source.mode === "copy" && !existsSync(target)) {
      copyFileSync(from, target);
      summary.copied++;
    }
    insert.run(id, target, extname(file).toLowerCase(), now, now);
    summary.added++;
  }
  return summary;
}

/** Re-scan every registered source — for when files were added on disk. */
export function rescanSources(): ImportSummary {
  const total: ImportSummary = { scanned: 0, added: 0, skipped: 0, copied: 0 };
  for (const source of listSources()) {
    const s = importSource(source);
    total.scanned += s.scanned;
    total.added += s.added;
    total.skipped += s.skipped;
    total.copied += s.copied;
  }
  return total;
}
