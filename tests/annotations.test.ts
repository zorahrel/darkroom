import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { app } from "../server/app.ts";

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const post = (body: unknown) =>
  app.request("/api/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("annotazioni", () => {
  test("una versione annotata si salva, si rilegge e si scarica", async () => {
    const res = await post({ photo_id: "ann_photo", version_number: 3, note: "striscia piu' centrale", png: PNG_1X1 });
    expect(res.status).toBe(201);
    const { annotation } = await res.json();
    expect(annotation.note).toBe("striscia piu' centrale");
    // Il file su disco e' il PNG mandato, byte per byte: e' quello che l'agente legge.
    expect(existsSync(annotation.image_path)).toBe(true);
    expect(readFileSync(annotation.image_path).readUInt32BE(0)).toBe(0x89504e47);

    const list = await (await app.request("/api/annotations?photo_id=ann_photo&version=3")).json();
    expect(list.annotations.map((a: { id: number }) => a.id)).toContain(annotation.id);
    expect((await app.request(annotation.url)).status).toBe(200);
  });

  test("anche una reference si annota", async () => {
    const res = await post({ ref_file: "geco.png", png: PNG_1X1 });
    expect(res.status).toBe(201);
    const list = await (await app.request("/api/annotations?ref=geco.png")).json();
    expect(list.annotations.length).toBeGreaterThan(0);
  });

  test("rifiuta cio' che non e' un PNG, un bersaglio ambiguo e i percorsi", async () => {
    expect((await post({ photo_id: "x", version_number: 1, png: "data:image/png;base64,aGVsbG8=" })).status).toBe(400);
    expect((await post({ photo_id: "x", version_number: 1, ref_file: "y.png", png: PNG_1X1 })).status).toBe(400);
    expect((await post({ png: PNG_1X1 })).status).toBe(400);
    expect((await post({ photo_id: "../x", version_number: 1, png: PNG_1X1 })).status).toBe(400);
    expect((await app.request("/annotazioni/..%2F/x.png")).status).toBe(400);
  });
});
