import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import {
  db,
  initSchema,
  RAW_DIR,
  TEST1_DIR,
  GEN_DIR,
  getGlobalPrompt,
} from "./db.ts";

const PHOTO_EXTENSIONS = new Set([".jpeg", ".jpg", ".png"]);

function isPhotoFile(name: string): boolean {
  return PHOTO_EXTENSIONS.has(extname(name).toLowerCase());
}

function photoIdFromFilename(filename: string): string {
  // Strip extension to get photo_id (e.g. IMG_2762.jpeg -> IMG_2762)
  return filename.replace(/\.[^.]+$/, "");
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function runImporter(): {
  photos: number;
  versionsImported: number;
  orphans: number;
} {
  initSchema();
  const d = db();
  const now = Date.now();
  const promptSnapshot = getGlobalPrompt();

  ensureDir(GEN_DIR);

  // 1) Index RAW: every photo file becomes a `photos` row
  const rawFiles = readdirSync(RAW_DIR)
    .filter((f) => !f.startsWith("."))
    .filter((f) => isPhotoFile(f));

  const insertPhoto = d.prepare(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const photoIdsInRaw = new Set<string>();

  d.run("BEGIN");
  try {
    for (const f of rawFiles) {
      const id = photoIdFromFilename(f);
      photoIdsInRaw.add(id);
      const ext = extname(f).toLowerCase();
      insertPhoto.run(id, join(RAW_DIR, f), ext, now, now);
    }
    d.run("COMMIT");
  } catch (err) {
    d.run("ROLLBACK");
    throw err;
  }

  const photosCount = (
    d.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM photos").get() ?? {
      n: 0,
    }
  ).n;

  // 2) Index TEST1: import previously-generated PNGs
  let versionsImported = 0;
  let orphansAdded = 0;

  if (existsSync(TEST1_DIR)) {
    const test1Files = readdirSync(TEST1_DIR)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .filter((f) => !f.startsWith("."));

    const insertVersion = d.prepare(
      `INSERT OR IGNORE INTO versions
        (photo_id, version_number, image_path, prompt_used, source, created_at)
       VALUES (?, 1, ?, ?, 'imported', ?)`,
    );
    const insertOrphan = d.prepare(
      `INSERT OR IGNORE INTO orphans (filename, source_path, created_at)
       VALUES (?, ?, ?)`,
    );

    d.run("BEGIN");
    try {
      for (const f of test1Files) {
        // Pattern: <PHOTO_ID>_chatgpt.png  → direct match if PHOTO_ID exists in RAW
        const directMatch = f.match(/^(.+)_chatgpt\.png$/i);
        const candidate = directMatch?.[1];
        if (candidate && photoIdsInRaw.has(candidate)) {
          const dstDir = join(GEN_DIR, candidate);
          ensureDir(dstDir);
          const dstPath = join(dstDir, "v01.png");
          if (!existsSync(dstPath)) {
            copyFileSync(join(TEST1_DIR, f), dstPath);
          }
          const result = insertVersion.run(
            candidate,
            dstPath,
            promptSnapshot,
            statSync(join(TEST1_DIR, f)).mtimeMs | 0,
          );
          if (result.changes > 0) versionsImported++;
        } else {
          // japan_NNN_<descrizione>_chatgpt.png or other unknown shapes → orphan
          const result = insertOrphan.run(f, join(TEST1_DIR, f), now);
          if (result.changes > 0) orphansAdded++;
        }
      }
      d.run("COMMIT");
    } catch (err) {
      d.run("ROLLBACK");
      throw err;
    }
  }

  return {
    photos: photosCount,
    versionsImported,
    orphans: orphansAdded,
  };
}
