import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";

// La pagina di una foto con centinaia di versioni scaricava ogni volta tutti i
// prompt (3,3 MB su 609 versioni): la lista leggera li lascia fuori e il prompt
// arriva solo per la versione aperta.
beforeAll(() => {
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  const raw = join(dirs().RAW_DIR, "slim_photo.png");
  writeFileSync(raw, "x");
  const now = Date.now();
  db().run(
    `INSERT OR REPLACE INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('slim_photo', ?, '.png', ?, ?)`,
    [raw, now, now],
  );
  db().run("DELETE FROM versions WHERE photo_id = 'slim_photo'");
  for (const n of [1, 2]) {
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at, lineage)
       VALUES ('slim_photo', ?, ?, ?, 'generated', ?, '{"materia":"x"}')`,
      [n, join(dirs().GEN_DIR, "slim_photo", `v${n}.png`), `PROMPT LUNGO ${n} `.repeat(200), now],
    );
  }
});

describe("dettaglio foto leggero", () => {
  test("con slim=1 le versioni arrivano senza prompt ne' discendenza", async () => {
    const full = await (await app.request("/api/photos/slim_photo")).json();
    expect(full.versions[0].prompt_used).toContain("PROMPT LUNGO 1");
    const r = await app.request("/api/photos/slim_photo?slim=1");
    expect(r.status).toBe(200);
    const slim = await r.json();
    expect(slim.versions).toHaveLength(2);
    expect(slim.versions[0].prompt_used).toBe("");
    expect(slim.versions[0].lineage).toBeUndefined();
    expect(slim.versions[1].version_number).toBe(2);
  });

  test("il prompt di una versione si chiede da solo", async () => {
    const slim = await (await app.request("/api/photos/slim_photo?slim=1")).json();
    const vid = slim.versions[1].id;
    const r = await app.request(`/api/photos/slim_photo/versions/${vid}/prompt`);
    expect(r.status).toBe(200);
    expect((await r.json()).prompt_used).toContain("PROMPT LUNGO 2");
    expect((await app.request("/api/photos/slim_photo/versions/999999/prompt")).status).toBe(404);
  });
});

describe("graduata senza grade", () => {
  // Con il grade spento /graded restituiva il PNG intero anche quando la pagina
  // chiedeva 720 px: 2,4 MB per versione, decodificati a ogni cambio.
  test("con una larghezza manda l'anteprima, senza manda l'originale", async () => {
    const dir = join(dirs().GEN_DIR, "slim_photo");
    mkdirSync(dir, { recursive: true });
    const png = join(dir, "v1.png");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1200x1200", "-frames:v", "1", png]);
    const g = encodeURIComponent(JSON.stringify({ enabled: false, steps: [] }));
    const small = await app.request(`/graded/slim_photo/v1.png?w=480&g=${g}`);
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toContain("jpeg");
    const full = await app.request(`/graded/slim_photo/v1.png?g=${g}`);
    expect(full.headers.get("content-type")).toContain("png");
  });
});
