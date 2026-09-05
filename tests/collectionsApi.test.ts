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
  test("creating a post returns it with its photos in order", async () => {
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
    // The order is the one given, not alphabetical or by capture time: a
    // carousel has a first slide.
    expect(json.photos["tokyo-il-primo-colpo"]).toEqual(["c", "a", "b"]);
  });

  test("a repeated title does not collide: the id is disambiguated", async () => {
    const first = await call("POST", "/api/collections", { title: "Nara" });
    const second = await call("POST", "/api/collections", { title: "Nara" });
    expect(first.json.id).toBe("nara");
    expect(second.json.id).toBe("nara-2");
  });

  test("an empty title is refused", async () => {
    const { status } = await call("POST", "/api/collections", { title: "   " });
    expect(status).toBe(400);
  });

  test("assigning a photo removes it from the previous post", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("POST", "/api/collections", { id: "due", title: "Due", photo_ids: ["c"] });

    const moved = await call("POST", "/api/collections/assign", {
      photo_ids: ["a"],
      collection_id: "due",
    });
    expect(moved.json.moved).toBe(1);

    const { json } = await call("GET", "/api/collections");
    // Exclusive membership: 'a' is in "due" and has NOT stayed in "uno" as
    // well.
    expect(json.photos["uno"]).toEqual(["b"]);
    expect(json.photos["due"]).toEqual(["c", "a"]);
  });

  test("assigning to null removes it from the post without deleting the photo", async () => {
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

  test("assigning to a non-existent post is a 404, not an orphan row", async () => {
    const { status } = await call("POST", "/api/collections/assign", {
      photo_ids: ["a"],
      collection_id: "fantasma",
    });
    expect(status).toBe(404);
    expect(db().query("SELECT 1 FROM collection_photos").get()).toBeNull();
  });

  test("dissolving a post frees the photos but does not delete them", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("DELETE", "/api/collections/uno");

    const { json } = await call("GET", "/api/collections");
    expect(json.collections).toHaveLength(0);
    expect(json.photos).toEqual({});
    expect(db().query("SELECT COUNT(*) AS n FROM photos").get()).toEqual({ n: 4 });
  });

  test("deleting a photo removes it from the post (cascade)", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    db().run("DELETE FROM photos WHERE id = 'a'");

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["b"]);
  });

  test("renaming changes the title and leaves the photos alone", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a"] });
    await call("PATCH", "/api/collections/uno", { title: "Tokyo di notte" });

    const { json } = await call("GET", "/api/collections");
    expect(json.collections[0].title).toBe("Tokyo di notte");
    expect(json.photos["uno"]).toEqual(["a"]);
  });
});

describe("unassigned filter", () => {
  test("the filter separates photos already in a post from those to curate", async () => {
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
  test("one click marks the photo, another unmarks it, and the filters follow", async () => {
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
    // The field travels in the list: the grid draws the heart without an extra
    // round trip.
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

  test("the like is independent of the post and of the favourite version", async () => {
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

  test("a like on a non-existent photo is a 404", async () => {
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

describe("carousel order", () => {
  test("reordering neither loses nor duplicates photos, and the first stays first", async () => {
    await call("POST", "/api/collections", {
      id: "uno",
      title: "Uno",
      photo_ids: ["a", "b", "c", "d"],
    });
    // Moves 'c' to the front: it is the drag-and-drop gesture on the cover.
    await call("PUT", "/api/collections/uno/photos", { photo_ids: ["c", "a", "b", "d"] });

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["c", "a", "b", "d"]);
    expect(json.collections[0].photo_count).toBe(4);
    // No orphan rows: the PUT replaces, it does not accumulate.
    expect(db().query("SELECT COUNT(*) AS n FROM collection_photos").get()).toEqual({ n: 4 });
  });
});

describe("collage", () => {
  async function post(ids: string[]) {
    return call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ids });
  }

  test("merging two photos creates a single slide, and the photos stay in the post", async () => {
    await post(["a", "b", "c", "d"]);
    const made = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["b", "c"],
      mode: "split",
    });
    expect(made.status).toBe(200);

    const { json } = await call("GET", "/api/collections");
    // The collage does NOT consume the photos: they stay members of the post,
    // so dissolving it puts them back in line without anybody having to
    // remember where they were.
    expect(json.photos["uno"]).toEqual(["a", "b", "c", "d"]);
    expect(json.collages).toHaveLength(1);
    expect(json.collages[0].photo_ids).toEqual(["b", "c"]);
    // It takes the place of its first photo, it does not go to the end.
    expect(json.collages[0].position).toBe(1);
  });

  test("a composition that does not hold all the photos is refused", async () => {
    await post(["a", "b", "c", "d"]);
    // «split» sta a due: con quattro perderebbe due scatti in silenzio.
    const r = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b", "c", "d"],
      mode: "split",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("tiene 2 foto");

    // Nor in PATCH, where the check has to be made on the final combination.
    await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b", "c", "d"],
      mode: "hero",
    });
    const id = (await call("GET", "/api/collections")).json.collages[0].id;
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "split" })).status).toBe(400);
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "grid", layout: "1x2" })).status).toBe(400);
    // A combination with room passes.
    expect((await call("PATCH", `/api/collages/${id}`, { mode: "grid", layout: "2x2" })).status).toBe(200);
  });

  test("an invented composition is refused", async () => {
    await post(["a", "b"]);
    const r = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b"],
      mode: "fancy",
    });
    expect(r.status).toBe(400);
  });

  test("photos outside the post, or already in a collage, are not merged", async () => {
    await post(["a", "b"]);
    const outside = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "c"],
      mode: "split",
    });
    expect(outside.status).toBe(400);
    expect(outside.json.error).toContain("non in questo post");

    await call("POST", "/api/collections/uno/collages", { photo_ids: ["a", "b"], mode: "split" });
    const again = await call("POST", "/api/collections/uno/collages", {
      photo_ids: ["a", "b"],
      mode: "split",
    });
    expect(again.status).toBe(400);
    expect(again.json.error).toContain("già in un collage");
  });

  test("a single photo is not a collage", async () => {
    await post(["a", "b"]);
    const r = await call("POST", "/api/collections/uno/collages", { photo_ids: ["a"] });
    expect(r.status).toBe(400);
  });

  test("dissolving the collage leaves the post intact", async () => {
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

  test("dissolving the post takes its collages with it", async () => {
    await post(["a", "b"]);
    await call("POST", "/api/collections/uno/collages", { photo_ids: ["a", "b"], mode: "split" });
    await call("DELETE", "/api/collections/uno");

    expect(db().query("SELECT COUNT(*) AS n FROM collages").get()).toEqual({ n: 0 });
    expect(db().query("SELECT COUNT(*) AS n FROM collage_photos").get()).toEqual({ n: 0 });
    expect(db().query("SELECT COUNT(*) AS n FROM photos").get()).toEqual({ n: 4 });
  });
});

describe("the post's colour reference", () => {
  test("it is set and it comes back", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    const r = await call("PATCH", "/api/collections/uno", { reference_photo_id: "a" });
    expect(r.status).toBe(200);
    const { json } = await call("GET", "/api/collections");
    expect(json.collections[0].reference_photo_id).toBe("a");
  });

  test("a photo outside the post cannot be the reference", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    // 'c' exists but lives elsewhere: it would use the colour of another scene
    // with no way of telling where it came from.
    const r = await call("PATCH", "/api/collections/uno", { reference_photo_id: "c" });
    expect(r.status).toBe(400);
  });

  test("the reference can be removed", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a"] });
    await call("PATCH", "/api/collections/uno", { reference_photo_id: "a" });
    await call("PATCH", "/api/collections/uno", { reference_photo_id: null });
    const { json } = await call("GET", "/api/collections");
    expect(json.collections[0].reference_photo_id).toBeNull();
  });

  test("colorReferenceFor does not return the photo itself", async () => {
    const { colorReferenceFor } = await import("../server/colorReference.ts");
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    await call("PATCH", "/api/collections/uno", { reference_photo_id: "a" });
    // The reference itself must not attach to itself: it would chase its own
    // tail.
    expect(colorReferenceFor("a")).toBeNull();
  });
});

describe("cover with one click", () => {
  test("it brings the photo to the front without disturbing the others", async () => {
    await call("POST", "/api/collections", {
      id: "uno", title: "Uno", photo_ids: ["a", "b", "c", "d"],
    });
    const r = await call("POST", "/api/collections/uno/cover", { photo_id: "c" });
    expect(r.status).toBe(200);
    const { json } = await call("GET", "/api/collections");
    // 'c' moves in front; a, b, d keep their relative order.
    expect(json.photos["uno"]).toEqual(["c", "a", "b", "d"]);
  });

  test("a photo outside the post cannot become its cover", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b"] });
    const r = await call("POST", "/api/collections/uno/cover", { photo_id: "d" });
    expect(r.status).toBe(400);
  });

  test("making the first one the cover changes nothing", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b", "c"] });
    await call("POST", "/api/collections/uno/cover", { photo_id: "a" });
    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["a", "b", "c"]);
  });
});

describe("the cover is a choice, not a position", () => {
  test("it survives a complete reordering of the post", async () => {
    await call("POST", "/api/collections", {
      id: "uno", title: "Uno", photo_ids: ["a", "b", "c", "d"],
    });
    await call("POST", "/api/collections/uno/cover", { photo_id: "c" });

    // A chronological reorder rewrites ALL the positions. This used to silently
    // erase the hand-picked cover — it really happened, and the user's choices
    // were lost.
    await call("PUT", "/api/collections/uno/photos", { photo_ids: ["a", "b", "c", "d"] });

    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"][0]).toBe("c");
    expect(json.collections[0].cover_photo_id).toBe("c");
  });

  test("if the cover leaves the post, the given order is respected", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b", "c"] });
    await call("POST", "/api/collections/uno/cover", { photo_id: "c" });
    // 'c' is no longer among the members: forcing it to the front makes no
    // sense.
    await call("PUT", "/api/collections/uno/photos", { photo_ids: ["b", "a"] });
    const { json } = await call("GET", "/api/collections");
    expect(json.photos["uno"]).toEqual(["b", "a"]);
  });

  test("changing the cover updates both the order and the field", async () => {
    await call("POST", "/api/collections", { id: "uno", title: "Uno", photo_ids: ["a", "b", "c"] });
    await call("POST", "/api/collections/uno/cover", { photo_id: "b" });
    await call("POST", "/api/collections/uno/cover", { photo_id: "c" });
    const { json } = await call("GET", "/api/collections");
    expect(json.collections[0].cover_photo_id).toBe("c");
    expect(json.photos["uno"][0]).toBe("c");
  });
});

describe("filtro pro", () => {
  test("it separates photos that have a pro master from web drafts alone", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    const now = Date.now();
    // 'a' has a render from the paid model, 'b' only from the web version.
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, provider, created_at)
       VALUES ('a', 1, '/x/a.png', 'p', 'generated', 'higgsfield', ?)`,
      [now],
    );
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, provider, created_at)
       VALUES ('b', 1, '/x/b.png', 'p', 'generated', 'chatgpt', ?)`,
      [now],
    );
    const { photos } = await (await grid.request("/api/photos?filter=pro")).json();
    expect(photos.map((p: any) => p.id)).toEqual(["a"]);

    const { counts } = await (await grid.request("/api/photos/counts")).json();
    expect(counts.pro).toBe(1);
  });

  test("shown_provider reflects the render shown, not just any one", async () => {
    const { photoRoutes } = await import("../server/routes/photos.ts");
    const grid = new Hono().route("/", photoRoutes);
    const now = Date.now();
    // A photo can HAVE a pro master and still show the web draft, if that is
    // the favourite: the badge follows what you see.
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, provider, created_at)
       VALUES ('c', 1, '/x/c1.png', 'p', 'generated', 'chatgpt', ?)`,
      [now],
    );
    const vid = Number(
      db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    );
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, provider, created_at)
       VALUES ('c', 2, '/x/c2.png', 'p', 'generated', 'higgsfield', ?)`,
      [now + 1],
    );
    db().run("UPDATE photos SET favorite_version_id = ? WHERE id = 'c'", [vid]);
    const { photos } = await (await grid.request("/api/photos")).json();
    const c = photos.find((p: any) => p.id === "c");
    expect(c.shown_provider).toBe("chatgpt");
  });
});

describe("a post says how many photos will really go out", () => {
  test("publishable_count excludes skipped photos", async () => {
    const cid = "pub_test";
    db().run("INSERT INTO collections (id, title, position, created_at) VALUES (?, 'T', 99, ?)", [cid, Date.now()]);
    for (const [pid, skip] of [["pub_a", 0], ["pub_b", 0], ["pub_c", 1]] as const) {
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, skipped, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?, ?)",
        [pid, skip, Date.now(), Date.now()],
      );
      db().run("INSERT INTO collection_photos (collection_id, photo_id, position) VALUES (?, ?, 0)", [cid, pid]);
    }
    const r = await app.request("/api/collections");
    const body = (await r.json()) as { collections: { id: string; photo_count: number; publishable_count: number }[] };
    const col = body.collections.find((c) => c.id === cid)!;
    // 3 in the post, but one is refused by ChatGPT and will never have a
    // render: announcing 3 slides and publishing 2 is a surprise at the wrong
    // moment.
    expect(col.photo_count).toBe(3);
    expect(col.publishable_count).toBe(2);
  });
});
