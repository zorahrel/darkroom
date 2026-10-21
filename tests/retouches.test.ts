import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { app } from "../server/app.ts";
import { db, initSchemaOn, retouchSlotOn } from "../server/db.ts";

/**
 * Ritocchi sotto la principale: la migrazione aggancia le versioni `local` alla
 * loro partenza, un ritocco di un ritocco si appiattisce, e il preferito puo'
 * essere un ritocco.
 */

function addVersion(
  d: Database,
  photoId: string,
  n: number,
  provider: string,
  lineage: object | null = null,
): number {
  const r = d.run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, provider, lineage, source, created_at)
     VALUES (?, ?, ?, 'p', ?, ?, 'generated', ?)`,
    [photoId, n, `/x/${photoId}/v${n}.png`, provider, lineage ? JSON.stringify(lineage) : null, Date.now()],
  );
  return Number(r.lastInsertRowid);
}

function slotOf(d: Database, id: number) {
  return d
    .query<{ parent_version_id: number | null; retouch_number: number | null }, [number]>(
      "SELECT parent_version_id, retouch_number FROM versions WHERE id = ?",
    )
    .get(id)!;
}

function freshDb(): Database {
  const d = new Database(":memory:");
  initSchemaOn(d);
  d.run(
    "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('f', '/x/f.jpg', '.jpg', 0, 0)",
  );
  return d;
}

describe("migrazione dei ritocchi", () => {
  test("le versioni local con una partenza valida vanno sotto la principale, le altre no", () => {
    const d = freshDb();
    const v1 = addVersion(d, "f", 1, "chatgpt");
    const v2 = addVersion(d, "f", 2, "local", { partenza: "v1" }); // formato «v318»
    const v3 = addVersion(d, "f", 3, "local", { partenza: "v01.png" }); // formato «v348.png»
    const v4 = addVersion(d, "f", 4, "local", { materia: "/abs/generations/f/v1.png" }); // Kaumat
    const v5 = addVersion(d, "f", 5, "local", { sources: ["v01.png"] }); // Kaumat c19
    const v6 = addVersion(d, "f", 6, "local", { partenza: "v99.png" }); // partenza che non esiste
    const v7 = addVersion(d, "f", 7, "chatgpt", { partenza: "v01.png" }); // rigenerazione, non ritocco
    const v8 = addVersion(d, "f", 8, "local", { partenza: "1" }); // l'originale

    // Lo storico: la migrazione gira di nuovo e riempie (e' quello che succede al riavvio).
    initSchemaOn(d);

    expect(slotOf(d, v1)).toEqual({ parent_version_id: null, retouch_number: null });
    expect(slotOf(d, v2)).toEqual({ parent_version_id: v1, retouch_number: 1 });
    expect(slotOf(d, v3)).toEqual({ parent_version_id: v1, retouch_number: 2 });
    expect(slotOf(d, v4)).toEqual({ parent_version_id: v1, retouch_number: 3 });
    expect(slotOf(d, v5)).toEqual({ parent_version_id: v1, retouch_number: 4 });
    for (const id of [v6, v7, v8]) {
      expect(slotOf(d, id)).toEqual({ parent_version_id: null, retouch_number: null });
    }

    // Idempotente: un terzo giro non rinumera niente.
    initSchemaOn(d);
    expect(slotOf(d, v3)).toEqual({ parent_version_id: v1, retouch_number: 2 });
  });

  test("un ritocco di un ritocco si appiattisce sulla principale", () => {
    const d = freshDb();
    const v1 = addVersion(d, "f", 1, "chatgpt");
    const v2 = addVersion(d, "f", 2, "local", { partenza: "v01.png" });
    const v3 = addVersion(d, "f", 3, "local", { partenza: "v02.png" }); // parte dal ritocco
    initSchemaOn(d);
    expect(slotOf(d, v2)).toEqual({ parent_version_id: v1, retouch_number: 1 });
    expect(slotOf(d, v3)).toEqual({ parent_version_id: v1, retouch_number: 2 });

    // Lo stesso per i ritocchi nuovi: lo slot sopra r2 e' r3 della v1, mai r2.1.
    expect(retouchSlotOn(d, v3)).toEqual({ parent_version_id: v1, retouch_number: 3 });
    expect(retouchSlotOn(d, v1)).toEqual({ parent_version_id: v1, retouch_number: 3 });
  });
});

describe("preferito su un ritocco", () => {
  test("PUT favorite accetta un ritocco e GET lo restituisce con padre e numero", async () => {
    const d = db();
    d.run(
      "INSERT OR REPLACE INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('rit', '/x/rit.jpg', '.jpg', 0, 0)",
    );
    const v1 = addVersion(d, "rit", 1, "chatgpt");
    const slot = retouchSlotOn(d, v1)!;
    const v2 = addVersion(d, "rit", 2, "local", { partenza: "v01.png" });
    d.run("UPDATE versions SET parent_version_id = ?, retouch_number = ? WHERE id = ?", [
      slot.parent_version_id,
      slot.retouch_number,
      v2,
    ]);

    const put = await app.request("/api/photos/rit/favorite", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version_id: v2 }),
    });
    expect(put.status).toBe(200);

    const res = await app.request("/api/photos/rit");
    const json = (await res.json()) as {
      photo: { favorite_version_id: number };
      versions: { id: number; parent_version_id: number | null; retouch_number: number | null }[];
    };
    expect(json.photo.favorite_version_id).toBe(v2);
    const r = json.versions.find((v) => v.id === v2)!;
    expect(r.parent_version_id).toBe(v1);
    expect(r.retouch_number).toBe(1);
    expect(json.versions.find((v) => v.id === v1)!.parent_version_id).toBeNull();
  });
});
