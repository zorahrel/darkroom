import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../server/app.ts";
import { listClips } from "../server/clips.ts";
import { db } from "../server/db.ts";

/**
 * Il flusso a rami: versioni e clip sullo stesso albero, con le foglie finali.
 * Si protegge che la parentela sia quella dichiarata (e non una catena inventata), che un clip
 * penda dalla sua versione e che le foglie finali siano indipendenti dal `favorite`.
 */
const PHOTO = "rami_photo";
const req = (path: string, init?: RequestInit) => app.request(path, init);
const put = (path: string, body: unknown) =>
  req(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(() => {
  const now = Date.now();
  db().run(
    "INSERT OR IGNORE INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?)",
    [PHOTO, now, now],
  );
  for (const n of [1, 2, 3]) {
    db().run(
      "INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at, note) VALUES (?, ?, ?, '', 'generated', ?, ?)",
      [PHOTO, n, `/x/v${n}.png`, now + n, `nota ${n}`],
    );
  }
  listClips(PHOTO); // la tabella dei clip nasce al primo uso
  db().run("INSERT INTO clips (photo_id, version_number, file, model, has_audio, duration, created_at) VALUES (?, 2, '/x/c.mp4', 'M', 1, 5, ?)", [
    PHOTO,
    now,
  ]);
});

describe("rami", () => {
  test("senza genitori dichiarati le versioni sono radici, e il clip pende dalla sua versione", async () => {
    const r = await (await req(`/api/photos/${PHOTO}/branches`)).json();
    const v = r.nodes.filter((n: { kind: string }) => n.kind === "version");
    expect(v.map((n: { parent: number | null }) => n.parent)).toEqual([null, null, null]);
    const clip = r.nodes.find((n: { kind: string }) => n.kind === "clip");
    expect(clip.parent).toBe(2);
    expect(clip.key).toMatch(/^c\d+$/);
  });

  test("il genitore dichiarato compare nell'albero; una versione non puo' essere figlia di se stessa", async () => {
    expect((await put(`/api/photos/${PHOTO}/versions/3/parent`, { parent: 2 })).status).toBe(200);
    expect((await put(`/api/photos/${PHOTO}/versions/3/parent`, { parent: 3 })).status).toBe(400);
    const r = await (await req(`/api/photos/${PHOTO}/branches`)).json();
    expect(r.nodes.find((n: { key: string }) => n.key === "v3").parent).toBe(2);
  });

  test("una foglia finale puo' essere un video, e non tocca il favorito", async () => {
    const before = await (await req(`/api/photos/${PHOTO}/branches`)).json();
    const clipId = before.nodes.find((n: { kind: string }) => n.kind === "clip").clip_id;
    expect((await put(`/api/photos/${PHOTO}/finals`, { kind: "clip", ref: clipId, final: true })).status).toBe(200);
    expect((await put(`/api/photos/${PHOTO}/finals`, { kind: "version", ref: 3, final: true })).status).toBe(200);
    const r = await (await req(`/api/photos/${PHOTO}/branches`)).json();
    expect(r.finals.sort()).toEqual([`c${clipId}`, "v3"].sort());
    expect(r.nodes.some((n: { favorite?: boolean }) => n.favorite)).toBe(false);
    await put(`/api/photos/${PHOTO}/finals`, { kind: "clip", ref: clipId, final: false });
    const r2 = await (await req(`/api/photos/${PHOTO}/branches`)).json();
    expect(r2.finals).toEqual(["v3"]);
  });

  test("richieste storte tornano 400, foto che non c'e' torna 404", async () => {
    expect((await put(`/api/photos/${PHOTO}/finals`, { kind: "boh", ref: 1, final: true })).status).toBe(400);
    expect((await req(`/api/photos/non_esiste/branches`)).status).toBe(404);
  });
});
