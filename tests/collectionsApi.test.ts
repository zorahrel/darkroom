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

describe("filtro non assegnate", () => {
  test("il filtro separa le foto già in un post da quelle da curare", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });

    const un = await (await grid.request("/api/photos?filter=unassigned")).json();
    const asg = await (await grid.request("/api/photos?filter=assigned")).json();
    expect(un.photos.map((p: any) => p.id).sort()).toEqual(["c", "d"]);
    expect(asg.photos.map((p: any) => p.id).sort()).toEqual(["a", "b"]);

    const { counts } = await (await grid.request("/api/photos/counts")).json();
    expect(counts.unassigned).toBe(2);
    expect(counts.assigned).toBe(2);
  });
});

describe("mi piace", () => {
  test("un click marca la foto, un altro la smarca, e i filtri seguono", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    const put = (id: string, picked: boolean) =>
      grid.request(`/api/photos/${id}/picked`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ picked }),
      });

    expect((await (await put("a", true)).json()).picked).toBe(true);
    await put("b", true);

    const liked = await (await grid.request("/api/photos?filter=picked")).json();
    expect(liked.photos.map((p: any) => p.id).sort()).toEqual(["a", "b"]);
    // Il campo viaggia nella lista: la griglia disegna il cuore senza un giro extra.
    expect(liked.photos.every((p: any) => p.picked === 1)).toBe(true);

    const todo = await (await grid.request("/api/photos?filter=not_picked")).json();
    expect(todo.photos.map((p: any) => p.id).sort()).toEqual(["c", "d"]);

    await put("a", false);
    const after = await (await grid.request("/api/photos?filter=picked")).json();
    expect(after.photos.map((p: any) => p.id)).toEqual(["b"]);

    const { counts } = await (await grid.request("/api/photos/counts")).json();
    expect(counts.picked).toBe(1);
    expect(counts.not_picked).toBe(3);
  });

  test("il mi piace è indipendente dal post e dalla versione preferita", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    await grid.request("/api/photos/a/picked", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picked: true }),
    });
    // Assegnare a un post non tocca il mi piace, e viceversa.
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a"] });
    const row: any = db().query("SELECT picked, favorite_version_id FROM photos WHERE id = 'a'").get();
    expect(row.picked).toBe(1);
    expect(row.favorite_version_id).toBeNull();
  });

  test("mi piace su una foto inesistente è 404", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    const res = await grid.request("/api/photos/fantasma/picked", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picked: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("ordine del carosello", () => {
  test("riordinare non perde né duplica foto, e la prima resta la prima", async () => {
    await call("POST", "/api/collections", {
      id: "uno",
      title: "Uno",
      photo_ids: ["a", "b", "c", "d"],
    });
    // Sposta 'c' in testa: è il gesto del drag & drop sulla copertina.
    await call("PUT", "/api/collections/uno/photos", { photo_ids: ["c", "a", "b", "d"] });

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["c", "a", "b", "d"]);
    expect(json.collections[0].photo_count).toBe(4);
    // Nessuna riga orfana: il PUT sostituisce, non accumula.
    expect(db().query("SELECT COUNT(*) AS n FROM collection_photos").get()).toEqual({ n: 4 });
  });
});

describe("collage", () => {
  async function post(ids: string[]) {
    return call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ids });
  }

  test("unire due foto crea una slide sola, e le foto restano nel post", async () => {
    await post(["a", "b", "c", "d"]);
    const made = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["b", "c"],
      mode: "split",
    });
    expect(made.status).toBe(200);

    const { json } = await call("GET", "/api/collections");
    // Il collage NON consuma le foto: restano membri del post, così scioglierlo
    // le rimette in fila senza doversi ricordare dov'erano.
    expect(json.photos["uno"]).toEqual(["a", "b", "c", "d"]);
    expect(json.collages).toHaveLength(1);
    expect(json.collages[0].photo_ids).toEqual(["b", "c"]);
    // Prende il posto della sua prima foto, non va in fondo.
    expect(json.collages[0].position).toBe(1);
  });

  test("una composizione che non tiene tutte le foto è rifiutata", async () => {
    await post(["a", "b", "c", "d"]);
    // «split» sta a due: con quattro perderebbe due scatti in silenzio.
    const r = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b", "c", "d"],
      mode: "split",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("tiene 2 foto");

    // E nemmeno in PATCH, dove il controllo va fatto sulla combinazione finale.
    await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b", "c", "d"],
      mode: "hero",
    });
    const id = (await call("GET", "/api/collections")).json.collages[0].id;
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "split" })).status).toBe(400);
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "grid", layout: "1x2" })).status).toBe(400);
    // Una combinazione capiente passa.
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "grid", layout: "2x2" })).status).toBe(200);
  });

  test("una composizione inventata è rifiutata", async () => {
    await post(["a", "b"]);
    const r = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b"],
      mode: "fancy",
    });
    expect(r.status).toBe(400);
  });

  test("foto fuori dal post, o già in un collage, non si uniscono", async () => {
    await post(["a", "b"]);
    const fuori = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "c"],
      mode: "split",
    });
    expect(fuori.status).toBe(400);
    expect(fuori.json.error).toContain("non in questo post");

    await call("POST", "/api/collections/uno/collages", { photo_ids: ["a", "b"], mode: "split" });
    const again = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b"],
      mode: "split",
    });
    expect(again.status).toBe(400);
    expect(again.json.error).toContain("già in un collage");
  });

  test("una foto sola non è un collage", async () => {
    await post(["a", "b"]);
    const r = await call("POST", "/api/collections/uno/collages", { photo_ids: ["a"] });
    expect(r.status).toBe(400);
  });

  test("sciogliere il collage lascia il post intatto", async () => {
    await post(["a", "b", "c"]);
    const made = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b"],
      mode: "split",
    });
    await call("DELETE", `/api/collages/${made.json.id}`);

    const { json } = await call("GET", "/api/collections");
    expect(json.collages).toHaveLength(0);
    expect(json.photos["uno"]).toEqual(["a", "b", "c"]);
    expect(db().query("SELECT COUNT(*) AS n FROM collage_photos").get()).toEqual({ n: 0 });
  });

  test("sciogliere il post porta via anche i suoi collage", async () => {
    await post(["a", "b"]);
    await call("POST", "/api/collections/uno/collages", { photo_ids: ["a", "b"], mode: "split" });
    await call("DELETE", "/api/collections/uno");

    expect(db().query("SELECT COUNT(*) AS n FROM collages").get()).toEqual({ n: 0 });
    expect(db().query("SELECT COUNT(*) AS n FROM collage_photos").get()).toEqual({ n: 0 });
    expect(db().query("SELECT COUNT(*) AS n FROM photos").get()).toEqual({ n: 4 });
  });
});
