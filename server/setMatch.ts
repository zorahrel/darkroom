// Armonizzazione per post ------------------------------------------------------
// Due scatti della stessa scena tornano dall'edit AI con bilanciamento,
// esposizione e saturazione diversi, perché ogni render è indipendente: nel
// carosello la luce "salta" mentre scorri. Misurato sul post Nara — tutte foto
// dello stesso pomeriggio — il calore variava di 116 punti su 255.
//
// Qui il gruppo di riferimento è la COLLEZIONE (il post), non la vicinanza
// temporale come in sceneWb: è il post che l'occhio giudica come un insieme, e
// due foto a venti minuti di distanza nello stesso carosello devono accordarsi
// anche se non sono una raffica.
//
// Le correzioni sono cache su disco e ricalcolate solo quando cambia il
// contenuto dei post o i file delle versioni.
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

/** Ogni foto assegnata a un post, con il render che si sta guardando. */
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
    // Un post con una foto sola non ha nulla con cui accordarsi.
    .filter(([, items]) => items.length >= 2)
    .map(([name, items]) => ({
      name,
      items: items.map((r) => ({ id: r.id, path: r.image_path })),
    }));
  if (!groups.length) return new Map();

  const r = spawnSync("python3", [SCRIPT], {
    // 0.75: toglie la deriva lasciando a ogni foto il suo carattere. A 1 le
    // tinte diventano identiche e il post si spegne.
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

/** Correzione di armonizzazione per una foto, o null se non è in un post
 *  con almeno un'altra foto. Cache invalidata dal contenuto, non dal tempo. */
export function setMatchFor(photoId: string): SetMatch | null {
  const rows = members();
  const sig = signature(rows);
  if (!cache || cache.sig !== sig) {
    cache = { sig, map: compute(rows) };
  }
  return cache.map.get(photoId) ?? null;
}

/** Svuota la cache: serve quando cambiano i post senza che cambino i file. */
export function invalidateSetMatch(): void {
  cache = null;
}
