import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import { collectionRoutes } from "../server/routes/collections.ts";

const app = new Hono().route("/", collectionRoutes);

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makePhoto(id: string): void {
  const path = join(dirs().RAW_DIR, `${id}.png`);
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  writeFileSync(path, PNG_1X1);
  const now = Date.now();
  db().run(
    `INSERT INTO photos (id, original_path, original_ext, kind, duration_ms, created_at, updated_at)
     VALUES (?, ?, '.png', 'original', 3000, ?, ?)`,
    [id, path, now, now],
  );
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM collection_photos");
  d.run("DELETE FROM collections");
  d.run("DELETE FROM photos");
  for (const id of ["a", "b", "c", "d"]) makePhoto(id);
});

describe("collections API", () => {
  test("creare un post lo restituisce con le sue foto in ordine", async () => {
    const created = await call("POST", "/api/collections", {
      title: "Tokyo, il primo colpo",
      caption: "Atterrati di notte",
      photo_ids: ["c", "a", "b"],
    });
    expect(created.status).toBe(200);
    expect(created.json.id).toBe("tokyo-il-primo-colpo");

    const { json } = await call("GET", "/api/collections");
    expect(json.collections).toHaveLength(1);
    expect(json.collections[0].photo_count).toBe(3);
    expect(json.collections[0].caption).toBe("Atterrati di notte");
    // L'ordine è quello dato, non quello alfabetico o di scatto: un carosello
    // ha una prima slide.
    expect(json.photos["tokyo-il-primo-colpo"]).toEqual(["c", "a", "b"]);
  });

  test("un titolo ripetuto non collide: l'id viene disambiguato", async () => {
    const first = await call("POST", "/api/collections", { title: "Nara" });
    const second = await call("POST", "/api/collections", { title: "Nara" });
    expect(first.json.id).toBe("nara");
    expect(second.json.id).toBe("nara-2");
  });

  test("un titolo vuoto è rifiutato", async () => {
    const { status } = await call("POST", "/api/collections", { title: "   " });
    expect(status).toBe(400);
  });

  test("assegnare una foto la toglie dal post precedente", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("POST", "/api/collections", { id: "due", title: "Due", photo_ids: ["c"] });

    const moved = await call("POST", "/api/collections/assign", {
      photo_ids: ["a"],
      collection_id: "due",
    });
    expect(moved.json.moved).toBe(1);

    const { json } = await call("GET", "/api/collections");
    // Appartenenza esclusiva: 'a' sta in "due" e NON è rimasta anche in "uno".
    expect(json.photos["uno"]).toEqual(["b"]);
    expect(json.photos["due"]).toEqual(["c", "a"]);
  });

  test("assegnare a null toglie dal post senza cancellare la foto", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("POST", "/api/collections/assign", { photo_ids: ["a"], collection_id: null });

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["b"]);
    expect(db().query("SELECT 1 FROM photos WHERE id = 'a'").get()).toBeTruthy();
  });

  test("PUT sostituisce i membri e riscrive l'ordine", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("PUT", "/api/collections/uno/photos", { photo_ids: ["d", "c", "a"] });

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["d", "c", "a"]);
  });

  test("assegnare a un post inesistente è 404, non una riga orfana", async () => {
    const { status } = await call("POST", "/api/collections/assign", {
      photo_ids: ["a"],
      collection_id: "fantasma",
    });
    expect(status).toBe(404);
    expect(db().query("SELECT 1 FROM collection_photos").get()).toBeNull();
  });

  test("sciogliere un post libera le foto ma non le cancella", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("DELETE", "/api/collections/uno");

    const { json } = await call("GET", "/api/collections");
    expect(json.collections).toHaveLength(0);
    expect(json.photos).toEqual({});
    expect(db().query("SELECT COUNT(*) AS n FROM photos").get()).toEqual({ n: 4 });
  });

  test("cancellare una foto la toglie dal post (cascade)", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    db().run("DELETE FROM photos WHERE id = 'a'");

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["b"]);
  });

  test("rinominare cambia il titolo e lascia stare le foto", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a"] });
    await call("PATCH", "/api/collections/uno", { title: "Tokyo di notte" });

    const { json } = await call("GET", "/api/collections");
    expect(json.collections[0].title).toBe("Tokyo di notte");
    expect(json.photos["uno"]).toEqual(["a"]);
  });
});
