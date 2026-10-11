import { db } from "./db.ts";
import { listClips } from "./clips.ts";

/**
 * Il flusso di una foto: versioni (immagini) e clip (video) sullo stesso albero.
 *
 * Una versione nasce da un'altra (un ritocco, una variante) e un clip nasce da una versione (il
 * suo primo fotogramma). Oggi la parentela delle versioni non e' nei dati, solo nelle note: la
 * tabella `version_parents` la rende esplicita senza toccare lo schema di `versions`.
 *
 * Le FOGLIE FINALI sono le cose scelte come risultato: una foto, un video, o piu' d'uno. Non e' il
 * `favorite` della foto (quello dice quale render rappresenta la foto nella galleria): una foglia
 * finale puo' essere anche un clip, e un ramo puo' averne piu' d'una.
 */

export type BranchNode =
  | {
      key: string;
      kind: "version";
      version_number: number;
      parent: number | null;
      favorite: boolean;
      final: boolean;
      note: string | null;
      created_at: number;
    }
  | {
      key: string;
      kind: "clip";
      clip_id: number;
      /** La versione da cui parte il video: il suo primo fotogramma. */
      parent: number | null;
      final: boolean;
      model: string | null;
      duration: number | null;
      has_audio: boolean;
      created_at: number;
    };

function ensure(): void {
  db().run(`CREATE TABLE IF NOT EXISTS version_parents (
    photo_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    parent INTEGER,
    PRIMARY KEY (photo_id, version_number)
  )`);
  db().run(`CREATE TABLE IF NOT EXISTS finals (
    photo_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('version','clip')),
    ref INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (photo_id, kind, ref)
  )`);
}

export function setParent(photoId: string, versionNumber: number, parent: number | null): void {
  ensure();
  if (parent === versionNumber) throw new Error("una versione non puo' essere figlia di se stessa");
  db().run(
    `INSERT INTO version_parents (photo_id, version_number, parent) VALUES (?, ?, ?)
     ON CONFLICT(photo_id, version_number) DO UPDATE SET parent = excluded.parent`,
    [photoId, versionNumber, parent],
  );
}

/** Accende o spegne una foglia finale. Torna lo stato nuovo. */
export function setFinal(photoId: string, kind: "version" | "clip", ref: number, on: boolean): boolean {
  ensure();
  if (on) {
    db().run("INSERT OR IGNORE INTO finals (photo_id, kind, ref, created_at) VALUES (?, ?, ?, ?)", [
      photoId,
      kind,
      ref,
      Date.now(),
    ]);
  } else {
    db().run("DELETE FROM finals WHERE photo_id = ? AND kind = ? AND ref = ?", [photoId, kind, ref]);
  }
  return on;
}

export function getBranches(photoId: string): { nodes: BranchNode[]; finals: string[] } {
  ensure();
  const parents = new Map<number, number | null>();
  for (const r of db()
    .query("SELECT version_number, parent FROM version_parents WHERE photo_id = ?")
    .all(photoId) as { version_number: number; parent: number | null }[]) {
    parents.set(r.version_number, r.parent);
  }
  const finals = db()
    .query("SELECT kind, ref FROM finals WHERE photo_id = ?")
    .all(photoId) as { kind: "version" | "clip"; ref: number }[];
  const isFinal = (kind: "version" | "clip", ref: number) => finals.some((f) => f.kind === kind && f.ref === ref);

  const fav = db()
    .query(
      `SELECT v.version_number AS n FROM photos p JOIN versions v ON v.id = p.favorite_version_id
       WHERE p.id = ?`,
    )
    .get(photoId) as { n: number } | null;

  const vers = db()
    .query(
      "SELECT version_number, note, created_at FROM versions WHERE photo_id = ? ORDER BY version_number",
    )
    .all(photoId) as { version_number: number; note: string | null; created_at: number }[];

  const nodes: BranchNode[] = vers.map((v) => ({
    key: `v${v.version_number}`,
    kind: "version" as const,
    version_number: v.version_number,
    parent: parents.get(v.version_number) ?? null,
    favorite: fav?.n === v.version_number,
    final: isFinal("version", v.version_number),
    // Le note dei ritocchi sono lunghe: al client basta il senso, il resto sta nella versione.
    note: v.note ? (v.note.length > 160 ? `${v.note.slice(0, 157)}...` : v.note) : null,
    created_at: v.created_at,
  }));
  for (const c of listClips(photoId)) {
    nodes.push({
      key: `c${c.id}`,
      kind: "clip",
      clip_id: c.id,
      parent: c.version_number,
      final: isFinal("clip", c.id),
      model: c.model,
      duration: c.duration,
      has_audio: !!c.has_audio,
      created_at: c.created_at,
    });
  }
  return {
    nodes,
    finals: finals.map((f) => (f.kind === "version" ? `v${f.ref}` : `c${f.ref}`)),
  };
}
