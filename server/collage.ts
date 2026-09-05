import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./config.ts";
import { db, effectiveGrade, type CollageMode, type CollageRow } from "./db.ts";
import { dirs } from "./project.ts";
import { getPhoto } from "./photos.ts";
import { gradeActive, gradedFile, runColorGrade } from "./gradeCache.ts";

/**
 * Rendering a collage: several photos composed into one carousel slide.
 *
 * The file is cached on disk, with a key covering everything that changes its
 * pixels (layout, gutter, background, the list and order of the photos, and
 * each source's mtime). Change a parameter → the name changes → it is
 * regenerated with nothing to invalidate by hand.
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

/** How many cells a '2x2' layout has. An unreadable layout is worth one cell. */
export function layoutCells(layout: string): number {
  const m = /^(\d+)x(\d+)$/.exec(layout.trim().toLowerCase());
  if (!m) return 1;
  return Number(m[1]) * Number(m[2]);
}

export const COLLAGE_MODES: CollageMode[] = ["hero", "mosaic", "grid", "stack", "split"];

/**
 * How many photos a composition holds. These are limits of legibility, not
 * technical ones: beyond them the panes become postage stamps and the slide
 * cannot be read on a phone.
 */
export function modeCapacity(mode: CollageMode, layout: string): number {
  switch (mode) {
    case "split":
      return 2;
    case "stack":
      return 4; // one in the background + three laid on top
    case "hero":
      return 5; // one large + four in a strip
    case "mosaic":
      return 4; // one large + three in a column
    default:
      return layoutCells(layout);
  }
}

function cacheDir(): string {
  return join(dirs().DATA_DIR, "collages");
}

function hash(s: string): string {
  // djb2: enough to tell two parameter combinations apart, and short enough to
  // fit in a readable file name.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Path of the collage's JPG, generating it if it is missing.
 *
 * `graded` composes the versions with the colour grade applied (what you see in
 * the grid and what ends up in the export), otherwise the originals. If a photo
 * has no graded render it falls back to its original: half a collage is still
 * more useful than an error.
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
    // The collage is composed from the same image you see in the grid: that
    // photo's favourite version (or the last), graded like the rest of the set.
    // With no render, the original.
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
        /* the grade is a bonus: without it, the ungraded render is composed */
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
