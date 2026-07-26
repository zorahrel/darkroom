import { spawnSync } from "bun";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { FFMPEG_BIN } from "./config.ts";
import { currentProjectId, dirs, getProject } from "./project.ts";
import { getStoryboardSettings, listPanels, type Panel } from "./storyboard.ts";

/**
 * Export the active project to Storyboarder's native format
 * (github.com/wonderunit/storyboarder), so Darkroom can own the AI/orchestration
 * half and hand the 3D blocking, hand-drawing and print half to the tool that
 * already does it well.
 *
 * The shape below is not guessed: it was read off three real `.storyboarder`
 * fixtures in the Storyboarder repo (example / ducks / shot-generator).
 *   { version, aspectRatio, fps, defaultBoardTiming, boards: [...] }
 * with images living in an `images/` folder next to the file, named
 * `board-<number>-<uid>.png`.
 */

/** File-format version we write. Matches the newest fixture in the Storyboarder repo. */
const STORYBOARDER_VERSION = "2.0.1";

export type Board = {
  uid: string;
  url: string;
  newShot: boolean;
  lastEdited: number;
  number: number;
  shot: string;
  time: number;
  duration: number;
  lineMileage: number;
  notes?: string;
};

export type Scene = {
  version: string;
  aspectRatio: number;
  fps: number;
  defaultBoardTiming: number;
  boards: Board[];
};

export type ExportResult = {
  /** Absolute path of the written .storyboarder file. */
  path: string;
  /** Directory holding the file and its images/. */
  dir: string;
  boards: number;
  /** Panels skipped because they have no usable image yet. */
  skipped: string[];
};

/** Storyboarder-style 5-char uid, derived from the photo id so re-exporting the
 *  same board keeps the same filenames instead of churning the images folder. */
export function uidFor(photoId: string): string {
  const hash = createHash("sha1").update(photoId).digest();
  let out = "";
  const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let i = 0; i < 5; i++) out += ALPHABET[hash[i]! % ALPHABET.length];
  return out;
}

export function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "storyboard";
}

/**
 * Build the scene object for the current panels. Pure: no disk writes, so the
 * timing/ordering logic is testable on its own.
 */
export function buildScene(panels: Panel[], settings = getStoryboardSettings()): Scene {
  const boards: Board[] = [];
  let time = 0;
  let previousLabel: string | null = null;
  panels.forEach((panel, i) => {
    const number = i + 1;
    const uid = uidFor(panel.id);
    // A panel opens a new shot when its scene label changes (and the first one
    // always does) — the same meaning Storyboarder gives board.newShot.
    const newShot = i === 0 || panel.scene_label !== previousLabel;
    previousLabel = panel.scene_label;
    const board: Board = {
      uid,
      url: `board-${number}-${uid}.png`,
      newShot,
      lastEdited: panel.updated_at,
      number,
      shot: `${number}A`,
      time,
      duration: panel.duration_ms,
      // Hand-drawn ink length. Ours are generated, so there is none.
      lineMileage: 0,
    };
    if (panel.scene_label) board.notes = panel.scene_label;
    boards.push(board);
    time += panel.duration_ms;
  });
  return {
    version: STORYBOARDER_VERSION,
    aspectRatio: settings.aspect_ratio,
    fps: settings.fps,
    defaultBoardTiming: 3000,
    boards,
  };
}

/** Copy `source` to `dest` (a .png path), converting when it isn't already PNG.
 *  Storyboarder derives sibling filenames from the board url by swapping the
 *  `.png` suffix, so a mislabelled jpeg would break its thumbnails. */
function copyAsPng(source: string, dest: string): void {
  if (extname(source).toLowerCase() === ".png") {
    copyFileSync(source, dest);
    return;
  }
  const res = spawnSync({
    cmd: [FFMPEG_BIN, "-y", "-loglevel", "error", "-i", source, dest],
    stdout: "ignore",
    stderr: "pipe",
  });
  if (!res.success) {
    throw new Error(
      `could not convert ${source} to PNG (${FFMPEG_BIN}): ${new TextDecoder().decode(res.stderr)}`,
    );
  }
}

/**
 * Write `<final>/storyboard/<slug>/<slug>.storyboarder` + `images/`.
 * Re-exporting replaces the previous images folder so deleted panels don't
 * linger, and returns the panels that had no image to export.
 */
export function exportStoryboard(): ExportResult {
  const panels = listPanels();
  if (panels.length === 0) throw new Error("no panels in this project — sequence some photos first");

  const project = getProject(currentProjectId());
  const slug = slugifyName(project?.name ?? currentProjectId());
  const dir = join(dirs().FINAL_DIR, "storyboard", slug);
  const imagesDir = join(dir, "images");

  const usable = panels.filter((p) => p.image_path);
  const skipped = panels.filter((p) => !p.image_path).map((p) => p.id);
  if (usable.length === 0) {
    throw new Error("no panel has an image yet — generate the panels before exporting");
  }

  const scene = buildScene(usable);

  rmSync(imagesDir, { recursive: true, force: true });
  mkdirSync(imagesDir, { recursive: true });
  scene.boards.forEach((board, i) => {
    copyAsPng(usable[i]!.image_path!, join(imagesDir, board.url));
  });

  const path = join(dir, `${slug}.storyboarder`);
  writeFileSync(path, JSON.stringify(scene, null, 2) + "\n");
  return { path, dir, boards: scene.boards.length, skipped };
}
