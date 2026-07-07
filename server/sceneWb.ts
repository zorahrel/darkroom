// Scene white-balance match ---------------------------------------------------
// Shots of the same scene (a burst) come back from the AI edit with slightly
// different white balance, so near-identical frames drift in colour. We group
// the favourites by capture time and compute, per group, a shared per-channel
// gain that pulls every member's neutral onto a common target — deterministic
// and content-robust, unlike a distribution transfer. The gains are cached and
// only recomputed when the favourite set (or its files) changes.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { db } from "./db.ts";
import { REPO_ROOT } from "./config.ts";

const SCENE_SCRIPT = join(REPO_ROOT, "scripts", "scene_wb.py");
// Max gap between consecutive shots to still count as the same scene. A burst
// is seconds apart; unrelated shots are minutes apart. Kept generous because
// the correction is WB-only (gentle) — over-grouping never breaks an image.
const GROUP_GAP_MS = 40_000;

type Gain = [number, number, number];

let cache: { sig: string; gains: Map<string, Gain> } | null = null;

type FavRow = { id: string; taken_at: number | null; image_path: string };

function favorites(): FavRow[] {
  return db()
    .query<FavRow, []>(
      `SELECT p.id AS id, p.taken_at AS taken_at, v.image_path AS image_path
       FROM photos p
       JOIN versions v ON v.id = p.favorite_version_id
       WHERE p.favorite_version_id IS NOT NULL
       ORDER BY (p.taken_at IS NULL) ASC, p.taken_at ASC, p.id ASC`,
    )
    .all();
}

/** Split favourites into scene groups by capture-time proximity. */
function groupByScene(rows: FavRow[]): FavRow[][] {
  const groups: FavRow[][] = [];
  let cur: FavRow[] = [];
  let prev: number | null = null;
  for (const r of rows) {
    if (!existsSync(r.image_path)) continue;
    if (
      r.taken_at == null ||
      prev == null ||
      r.taken_at - prev > GROUP_GAP_MS
    ) {
      if (cur.length) groups.push(cur);
      cur = [r];
    } else {
      cur.push(r);
    }
    prev = r.taken_at;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function signature(rows: FavRow[]): string {
  const parts = rows.map((r) => {
    const m = existsSync(r.image_path)
      ? Math.round(statSync(r.image_path).mtimeMs)
      : 0;
    return `${r.id}:${r.taken_at ?? "x"}:${m}`;
  });
  return createHash("sha1")
    .update(JSON.stringify({ gap: GROUP_GAP_MS, parts }))
    .digest("hex");
}

function compute(): Map<string, Gain> {
  const rows = favorites();
  const groups = groupByScene(rows).filter((g) => g.length >= 2);
  if (!groups.length) return new Map();
  const manifest = {
    groups: groups.map((g) => g.map((r) => ({ id: r.id, path: r.image_path }))),
  };
  const r = spawnSync("python3", [SCENE_SCRIPT], {
    input: JSON.stringify(manifest),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return new Map();
  try {
    const raw = JSON.parse(r.stdout) as Record<string, Gain>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/** Per-photo shared WB gain, or null if the photo isn't in a multi-shot scene.
 *  Cached; recomputed only when the favourite set or its files change. */
export function wbGainFor(photoId: string): Gain | null {
  const rows = favorites();
  const sig = signature(rows);
  if (!cache || cache.sig !== sig) {
    cache = { sig, gains: compute() };
  }
  return cache.gains.get(photoId) ?? null;
}
