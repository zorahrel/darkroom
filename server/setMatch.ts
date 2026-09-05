// Per-post harmonisation ------------------------------------------------------
// Two shots of the same scene come back from the AI edit with different white
// balance, exposure and saturation, because every render is independent: in the
// carousel the light "jumps" as you scroll. Measured on the Nara post — all
// photos from the same afternoon — warmth varied by 116 points out of 255.
//
// Here the reference group is the COLLECTION (the post), not temporal proximity
// as in sceneWb: it is the post the eye judges as a whole, and two photos taken
// twenty minutes apart in the same carousel have to agree even if they are not
// a burst.
//
// The corrections are cached on disk and recomputed only when the content of
// the posts or the version files changes.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { db } from "./db.ts";
import { REPO_ROOT } from "./config.ts";

const SCRIPT = join(REPO_ROOT, "scripts", "match_set.py");

export type SetMatch = {
  a_shift: number;
  b_shift: number;
  a_scale: number;
  b_scale: number;
};

type Member = { id: string; collection_id: string; image_path: string };

let cache: { sig: string; map: Map<string, SetMatch> } | null = null;

/** Every photo assigned to a post, with the render currently being looked at. */
function members(): Member[] {
  return db()
    .query<Member, []>(
      `SELECT p.id AS id, cp.collection_id AS collection_id, v.image_path AS image_path
         FROM photos p
         JOIN collection_photos cp ON cp.photo_id = p.id
         JOIN versions v ON v.id = COALESCE(
                p.favorite_version_id,
                (SELECT id FROM versions WHERE photo_id = p.id ORDER BY id DESC LIMIT 1))
        ORDER BY cp.collection_id, cp.position`,
    )
    .all();
}

function signature(rows: Member[]): string {
  const parts = rows.map((r) => {
    const m = existsSync(r.image_path) ? Math.round(statSync(r.image_path).mtimeMs) : 0;
    return `${r.id}:${r.collection_id}:${m}`;
  });
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

function compute(rows: Member[]): Map<string, SetMatch> {
  const byCollection = new Map<string, Member[]>();
  for (const r of rows) {
    if (!existsSync(r.image_path)) continue;
    const list = byCollection.get(r.collection_id) ?? [];
    list.push(r);
    byCollection.set(r.collection_id, list);
  }
  const groups = [...byCollection.entries()]
    // A post with a single photo has nothing to match against.
    .filter(([, items]) => items.length >= 2)
    .map(([name, items]) => ({
      name,
      items: items.map((r) => ({ id: r.id, path: r.image_path })),
    }));
  if (!groups.length) return new Map();

  const r = spawnSync("python3", [SCRIPT], {
    // 0.75: removes the drift while leaving each photo its own character. At 1
    // the hues become identical and the post goes flat.
    input: JSON.stringify({ groups, strength: 0.75 }),
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) {
    if (r.stderr) console.warn("[match] fallito:", r.stderr.slice(-300));
    return new Map();
  }
  try {
    return new Map(Object.entries(JSON.parse(r.stdout) as Record<string, SetMatch>));
  } catch {
    return new Map();
  }
}

/** Harmonisation correction for a photo, or null when it is not in a post
 *  with at least one other photo. Cache invalidated by content, not by time. */
export function setMatchFor(photoId: string): SetMatch | null {
  const rows = members();
  const sig = signature(rows);
  if (!cache || cache.sig !== sig) {
    cache = { sig, map: compute(rows) };
  }
  return cache.map.get(photoId) ?? null;
}

/** Empties the cache: needed when the posts change without the files changing. */
export function invalidateSetMatch(): void {
  cache = null;
}
