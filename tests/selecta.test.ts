import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { CARTELLA, annulla, pianifica, raccogli } from "../server/selecta.ts";
import * as motore from "../server/core.ts";

afterAll(() => motore.fermaMotore());

const dir = mkdtempSync(join(tmpdir(), "darkroom-selecta-"));

function aggiungi(id: string, stelle: number | null, colore: string | null, conSidecar = false) {
  const p = join(dir, `${id}.ARW`);
  // Un file di qualche kilobyte: quello che conta è che sia lo stesso file, non cosa contiene.
  writeFileSync(p, Buffer.alloc(4096, 3));
  if (conSidecar) writeFileSync(join(dir, `${id}.xmp`), "<x/>");
  const ora = Date.now();
  db().run(
    `INSERT OR REPLACE INTO photos
      (id, original_path, original_ext, kind, culling_stelle, culling_colore, created_at, updated_at)
     VALUES (?, ?, '.arw', 'original', ?, ?, ?, ?)`,
    [id, p, stelle, colore, ora, ora],
  );
  return p;
}

beforeEach(() => {
  mkdirSync(dir, { recursive: true });
  db().run("DELETE FROM photos WHERE id LIKE 'sel_%'");
  const raccolta = join(dir, CARTELLA);
  if (existsSync(raccolta)) {
    for (const n of readdirSync(raccolta)) require("node:fs").unlinkSync(join(raccolta, n));
    require("node:fs").rmdirSync(raccolta);
  }
});

async function chiama(percorso: string, corpo?: unknown) {
  const res = await app.request(percorso, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo ?? {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("raccolta delle scelte", () => {
  test("il piano dice quanti file e dove, e non crea niente", () => {
    aggiungi("sel_a", 4, "verde");
    const piano = pianifica()!;
    expect(piano.voci.length).toBe(1);
    expect(piano.daCreare).toBe(1);
    expect(piano.cartella).toBe(join(dir, CARTELLA));
    expect(existsSync(piano.cartella)).toBe(false);
  });

  test("entrano i tenuti, non gli scartati né i non giudicati", () => {
    aggiungi("sel_tenuto", 3, null);
    aggiungi("sel_etichettato", null, "blu");
    aggiungi("sel_scartato", 0, null);
    aggiungi("sel_intonso", null, null);
    const ids = pianifica()!.voci.map((v) => v.photoId).sort();
    expect(ids).toEqual(["sel_etichettato", "sel_tenuto"]);
  });

  test("la raccolta collega, non copia: l'originale e la raccolta sono lo stesso file", () => {
    const origine = aggiungi("sel_a", 5, "verde");
    const esito = raccogli();
    expect(esito.collegati).toBe(1);
    expect(esito.copiati).toBe(0);
    const destinazione = join(esito.cartella, "sel_a.ARW");
    expect(existsSync(destinazione)).toBe(true);
    // Stesso inode: nessun byte scritto due volte.
    expect(statSync(destinazione).ino).toBe(statSync(origine).ino);
  });

  test("l'originale non si sposta mai", () => {
    const origine = aggiungi("sel_a", 5, "verde");
    raccogli();
    expect(existsSync(origine)).toBe(true);
    expect(statSync(origine).size).toBe(4096);
  });

  test("il sidecar viaggia insieme allo scatto", () => {
    aggiungi("sel_a", 5, "verde", true);
    const esito = raccogli();
    expect(esito.sidecarPortati).toBe(1);
    expect(existsSync(join(esito.cartella, "sel_a.xmp"))).toBe(true);
  });

  test("raccogliere due volte non duplica", () => {
    aggiungi("sel_a", 5, "verde");
    raccogli();
    const secondo = raccogli();
    expect(secondo.collegati).toBe(0);
    expect(secondo.gia).toBe(1);
  });

  test("annullare riporta la cartella di lavoro a com'era", () => {
    aggiungi("sel_a", 5, "verde", true);
    const prima = readdirSync(dir).sort();
    const esito = raccogli();
    expect(readdirSync(dir)).toContain(CARTELLA);

    const indietro = annulla(esito.cartella);
    expect(indietro.tolti).toBeGreaterThan(0);
    expect(indietro.cartellaRimossa).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(prima);
  });

  test("un file che non abbiamo creato noi non viene toccato, e la cartella resta", () => {
    aggiungi("sel_a", 5, "verde");
    const esito = raccogli();
    // Qualcuno mette qualcosa di suo nella cartella.
    const suo = join(esito.cartella, "note-del-cliente.txt");
    writeFileSync(suo, "non toccare");

    const indietro = annulla(esito.cartella);
    expect(existsSync(suo)).toBe(true);
    expect(indietro.cartellaRimossa).toBe(false);
    expect(indietro.lasciati).toBe(1);
    expect(readFileSync(suo, "utf8")).toBe("non toccare");
  });

  test("annullare due volte non è un errore", () => {
    aggiungi("sel_a", 5, "verde");
    const esito = raccogli();
    annulla(esito.cartella);
    expect(annulla(esito.cartella).tolti).toBe(0);
  });

  test("senza niente di tenuto non si crea nessuna cartella", () => {
    aggiungi("sel_scartato", 0, null);
    expect(pianifica()).toBeNull();
    const esito = raccogli();
    expect(esito.collegati).toBe(0);
    expect(existsSync(join(dir, CARTELLA))).toBe(false);
  });

  test("l'API fa piano, raccolta e ritorno", async () => {
    aggiungi("sel_a", 4, "verde");
    const piano = await chiama("/api/culling/raccolta/piano");
    expect(piano.json.daCreare).toBe(1);

    const fatto = await chiama("/api/culling/raccolta");
    expect(fatto.json.collegati).toBe(1);

    const indietro = await chiama("/api/culling/raccolta/annulla", { cartella: fatto.json.cartella });
    expect(indietro.json.cartellaRimossa).toBe(true);
  });
});
