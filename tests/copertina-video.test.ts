import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { addProject } from "../server/project.ts";
import { TEST_ROOT } from "./setup.ts";

/**
 * La copertina di un progetto di montaggio.
 *
 * Un progetto video non ha fotografie nel database, quindi la scheda restava
 * l'unica muta della pagina: nome, tre numeri e un rettangolo vuoto. Le clip
 * stanno su disco, e i nomi bastano — il fotogramma lo estrae la sua rotta
 * quando l'immagine viene chiesta davvero.
 */
async function schede() {
  const r = await app.request("/api/studio/projects");
  return ((await r.json()) as any).projects as any[];
}

describe("un progetto di montaggio ha una copertina", () => {
  test("le clip della cartella arrivano alla scheda, i file che non sono video no", async () => {
    const root = join(TEST_ROOT, "montaggio");
    mkdirSync(root, { recursive: true });
    for (const n of ["b.mp4", "a.mov", "c.mkv", "d.mp4", "e.mp4", "note.txt", ".nascosto.mp4"]) {
      writeFileSync(join(root, n), "");
    }
    const p = addProject({ name: "Montaggio", root, kind: "video", views: ["video"] });

    const scheda = (await schede()).find((x) => x.id === p.id);
    expect(scheda).toBeDefined();
    // Ordinate e tagliate a quattro: la scheda ne mostra quattro, non tutte.
    expect(scheda.video.clip).toEqual(["a.mov", "b.mp4", "c.mkv", "d.mp4"]);
  });

  test("una cartella senza clip non promette una copertina che non c'è", async () => {
    const root = join(TEST_ROOT, "montaggio-vuoto");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "appunti.md"), "");
    const p = addProject({ name: "Vuoto", root, kind: "video", views: ["video"] });

    const scheda = (await schede()).find((x) => x.id === p.id);
    expect(scheda.video.clip).toEqual([]);
  });

  test("un progetto di fotografie non guadagna una lista di clip", async () => {
    const p = addProject({ name: "Scatti", kind: "photo", views: ["photo"] });
    const scheda = (await schede()).find((x) => x.id === p.id);
    expect(scheda.video).toBeNull();
  });
});
