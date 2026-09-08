import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { db, initSchema, getGlobalPrompt } from "./db.ts";
import { rawDir, test1Dir, genDir } from "./project.ts";

/**
 * I RAW dei corpi diffusi. Prima di questa lista Darkroom accettava tre estensioni,
 * quindi un RAW non entrava nemmeno nel database e la fase di culling — che è quella
 * in cui da migliaia di scatti se ne scelgono centinaia — non era rappresentabile.
 */
const RAW_EXTENSIONS = new Set([
  ".nef", ".nrw",                      // Nikon
  ".cr2", ".cr3", ".crw",              // Canon
  ".arw", ".srf", ".sr2",              // Sony
  ".raf",                              // Fujifilm
  ".orf",                              // Olympus / OM System
  ".rw2",                              // Panasonic
  ".pef",                              // Pentax
  ".dng", ".gpr",                      // Adobe e GoPro
  ".iiq",                              // Phase One
  ".3fr",                              // Hasselblad
  ".erf",                              // Epson
  ".mos",                              // Leaf
  ".mrw",                              // Minolta
  ".x3f",                              // Sigma
  ".raw",
]);

const PHOTO_EXTENSIONS = new Set([
  ".jpeg", ".jpg", ".jpe", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp",
  ...RAW_EXTENSIONS,
]);

/**
 * Le cartelle che Darkroom scrive da sé. Le sue anteprime non devono mai diventare
 * sorgenti: senza questa esclusione, dalla seconda apertura di una cartella si
 * mostrerebbe l'anteprima da 1568 px credendo di mostrare il RAW, e la sostituzione
 * non si vedrebbe.
 */
const CARTELLE_NOSTRE = new Set([
  "Darkroom_Previews",
  "Darkroom_XMP_Backup",
  "Darkroom_Selecta",
  ".cache",
]);

function isRawFile(name: string): boolean {
  return RAW_EXTENSIONS.has(extname(name).toLowerCase());
}

function isPhotoFile(name: string): boolean {
  return PHOTO_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * Sceglie quale file rappresenta lo scatto quando lo stesso nome esiste in più
 * formati. Il RAW vince sempre: contiene tutto quello che contiene il JPEG e in più
 * i dati da cui si sviluppa. Senza questa regola l'originale dipenderebbe dall'ordine
 * in cui il sistema restituisce i file, che non è un criterio.
 */
export function scegliOriginali(nomi: string[]): Map<string, string> {
  const scelti = new Map<string, string>();
  for (const f of nomi) {
    const id = photoIdFromFilename(f);
    const attuale = scelti.get(id);
    if (!attuale || (isRawFile(f) && !isRawFile(attuale))) scelti.set(id, f);
  }
  return scelti;
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

  // Resolve the active project's data dirs once for this scan.
  const RAW_DIR = rawDir();
  const TEST1_DIR = test1Dir();
  const GEN_DIR = genDir();

  ensureDir(GEN_DIR);

  // 1) Index RAW: every photo file becomes a `photos` row
  const rawFiles = readdirSync(RAW_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((f) => !f.startsWith("."))
    .filter((f) => !CARTELLE_NOSTRE.has(f))
    .filter((f) => isPhotoFile(f));

  // Un RAW e il suo JPEG sono lo stesso scatto, non due.
  const originali = scegliOriginali(rawFiles);

  const insertPhoto = d.prepare(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const photoIdsInRaw = new Set<string>();

  d.run("BEGIN");
  try {
    for (const [id, f] of originali) {
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
