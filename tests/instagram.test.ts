import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import { IG_ROOT } from "../server/instagram.ts";
import { instagramRoutes } from "../server/routes/instagram.ts";

const app = new Hono().route("/", instagramRoutes);

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** Una foto con una versione preferita `vN.png`. */
function photoWithFavorite(id: string, n: number): void {
  const now = Date.now();
  const raw = join(dirs().RAW_DIR, `${id}.png`);
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  writeFileSync(raw, "x");
  db().run(
    `INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?, ?, '.png', ?, ?)`,
    [id, raw, now, now],
  );
  const v = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?, ?, ?, 'p', 'generated', ?)`,
    [id, n, join(dirs().GEN_DIR, id, `v${n}.png`), now],
  );
  db().run("UPDATE photos SET favorite_version_id = ? WHERE id = ?", [Number(v.lastInsertRowid), id]);
}

function collection(id: string, position: number, cover: string, members: string[]): void {
  db().run(
    `INSERT INTO collections (id, title, caption, position, created_at, cover_photo_id) VALUES (?, ?, '', ?, ?, ?)`,
    [id, `Post ${id}`, position, Date.now(), cover],
  );
  members.forEach((m, i) =>
    db().run("INSERT INTO collection_photos (photo_id, collection_id, position) VALUES (?, ?, ?)", [m, id, i]),
  );
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM collection_photos");
  d.run("DELETE FROM collections");
  d.run("DELETE FROM versions");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM settings WHERE key = 'instagram'");
  rmSync(IG_ROOT(), { recursive: true, force: true });
});

describe("anteprima Instagram", () => {
  test("i post in programma escono dal piu' recente, con la copertina graduata della preferita", async () => {
    photoWithFavorite("a", 3);
    photoWithFavorite("b", 12);
    photoWithFavorite("c", 7);
    collection("primo", 0, "a", ["a"]);
    collection("ultimo", 1, "c", ["b", "c"]);

    const { status, json } = await call("GET", "/api/instagram");
    expect(status).toBe(200);
    expect(json.profile).toBeNull();
    expect(json.planned.map((p: any) => p.id)).toEqual(["ultimo", "primo"]);
    expect(json.planned[0].kind).toBe("carousel");
    expect(json.planned[1].kind).toBe("photo");
    expect(json.planned[0].cover).toStartWith("/graded/c/v7.png?");
  });

  test("un nome utente non valido e' rifiutato", async () => {
    const r = await call("PUT", "/api/instagram", { username: "../etc" });
    expect(r.status).toBe(400);
  });

  test("con l'account scelto il profilo torna con gli indirizzi delle sue immagini", async () => {
    const dir = join(IG_ROOT(), "prova");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({
        username: "prova",
        fetched_at: 1,
        full_name: "Prova",
        counts: { posts: "3", followers: "10", following: "2" },
        bio: ["riga"],
        link: null,
        avatar: "avatar.jpg",
        highlights: [{ title: "Mare", image: "hl0.jpg" }],
        posts: [{ href: "/prova/p/x/", kind: "photo", alt: "", image: "post00.jpg" }],
      }),
    );
    expect((await call("PUT", "/api/instagram", { username: "prova" })).status).toBe(200);
    const { json } = await call("GET", "/api/instagram");
    expect(json.profile.avatar).toBe("/instagram-media/prova/avatar.jpg");
    expect(json.profile.highlights[0].image).toBe("/instagram-media/prova/hl0.jpg");
    expect(json.profile.posts[0].image).toBe("/instagram-media/prova/post00.jpg");
  });

  test("un avatar su un progetto che non esiste e' rifiutato, e la scelta non cambia", async () => {
    const r = await call("PUT", "/api/instagram", { avatar: { project: "nessuno", photo: "1", version: 1 } });
    expect(r.status).toBe(400);
    expect((await call("GET", "/api/instagram")).json.settings.avatar).toBeNull();
  });
});
