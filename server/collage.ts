import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./config.ts";
import { db, effectiveGrade, type CollageMode, type CollageRow } from "./db.ts";
import { dirs } from "./project.ts";
import { getPhoto } from "./photos.ts";
import { gradeActive, gradedFile, runColorGrade } from "./gradeCache.ts";

/**
 * Rendering di un collage: più foto composte in una sola slide del carosello.
 *
 * Il file è cache su disco, con una chiave che comprende tutto ciò che ne
 * cambia i pixel (layout, gutter, fondo, elenco e ordine delle foto, e il
 * mtime di ogni sorgente). Cambia un parametro → cambia il nome → si rigenera
 * senza dover invalidare niente a mano.
 */

const SCRIPT = join(REPO_ROOT, "scripts", "collage.py");

export type CollageWithPhotos = CollageRow & { photo_ids: string[] };

export function getCollage(id: string): CollageWithPhotos | null {
  const row = db()
    .query<CollageRow, [string]>("SELECT * FROM collages WHERE id = ?")
    .get(id);
  if (!row) return null;
  const ids = db()
    .query<{ photo_id: string }, [string]>(
      "SELECT photo_id FROM collage_photos WHERE collage_id = ? ORDER BY position ASC",
    )
    .all(id)
    .map((r) => r.photo_id);
  return { ...row, photo_ids: ids };
}

/** Quante celle ha un layout '2x2'. Un layout illeggibile vale una cella sola. */
export function layoutCells(layout: string): number {
  const m = /^(\d+)x(\d+)$/.exec(layout.trim().toLowerCase());
  if (!m) return 1;
  return Number(m[1]) * Number(m[2]);
}

export const COLLAGE_MODES: CollageMode[] = ["hero", "mosaic", "grid", "stack", "split"];

/**
 * Quante foto regge una composizione. Sono limiti di leggibilità, non tecnici:
 * oltre, i riquadri diventano francobolli e la slide non si legge sul telefono.
 */
export function modeCapacity(mode: CollageMode, layout: string): number {
  switch (mode) {
    case "split":
      return 2;
    case "stack":
      return 4; // una di fondo + tre appoggiate
    case "hero":
      return 5; // una grande + quattro in striscia
    case "mosaic":
      return 4; // una grande + tre in colonna
    default:
      return layoutCells(layout);
  }
}

function cacheDir(): string {
  return join(dirs().DATA_DIR, "collages");
}

function hash(s: string): string {
  // djb2: basta a distinguere due combinazioni di parametri, e resta corto
  // abbastanza da stare in un nome di file leggibile.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Percorso del JPG del collage, generandolo se manca.
 *
 * `graded` compone le versioni con il color grade applicato (quel che si vede
 * nella griglia e quel che finisce nell'export), altrimenti gli originali.
 * Se una foto non ha un render graded si ricade sul suo originale: un collage
 * a metà è comunque più utile di un errore.
 */
export function collageFile(
  collage: CollageWithPhotos,
  opts: { graded?: boolean; size?: string; quality?: number } = {},
): string {
  const size = opts.size ?? "1080x1350";
  const quality = opts.quality ?? 90;

  const sources: string[] = [];
  for (const pid of collage.photo_ids) {
    const photo = getPhoto(pid);
    if (!photo) continue;
    // Il collage si compone dalla stessa immagine che si vede nella griglia:
    // la versione preferita (o l'ultima) di quella foto, gradata come il resto
    // del set. Senza render, l'originale.
    const version = db()
      .query<{ image_path: string }, [string, string]>(
        `SELECT image_path FROM versions
          WHERE photo_id = ?1
          ORDER BY (id = (SELECT favorite_version_id FROM photos WHERE id = ?2)) DESC, id DESC
          LIMIT 1`,
      )
      .get(pid, pid);
    let src =
      version?.image_path && existsSync(version.image_path)
        ? version.image_path
        : photo.original_path;

    if (opts.graded && src !== photo.original_path) {
      try {
        const cfg = effectiveGrade(photo);
        if (gradeActive(cfg)) {
          const name = src.split("/").pop()!;
          const out = gradedFile(pid, name, src, cfg, 1600, null);
          if (existsSync(out) || runColorGrade(src, out, cfg, 1600, 90, 60000, null)) {
            src = out;
          }
        }
      } catch {
        /* il grade è un di più: senza, si compone il render non gradato */
      }
    }
    if (existsSync(src)) sources.push(src);
  }
  if (sources.length === 0) throw new Error("collage senza foto leggibili");

  const stamp = sources
    .map((s) => {
      try {
        return `${s}:${Math.floor(statSync(s).mtimeMs)}`;
      } catch {
        return s;
      }
    })
    .join("|");
  const key = hash([collage.mode, collage.layout, size, quality, stamp].join("~"));
  const out = join(cacheDir(), `${collage.id}_${key}.jpg`);
  if (existsSync(out)) return out;

  mkdirSync(cacheDir(), { recursive: true });
  const r = spawnSync(
    "python3",
    [
      SCRIPT,
      "--out", out,
      "--mode", collage.mode,
      "--layout", collage.layout,
      "--size", size,
      "--quality", String(quality),
      ...sources,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !existsSync(out)) {
    throw new Error(`collage.py fallito (${r.status}): ${r.stderr || r.stdout}`);
  }
  return out;
}
