import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { refsDir } from "../server/project.ts";

/**
 * La sezione Riferimenti mostrava zero immagini: chiedeva di incollare un
 * percorso per un file che stava già dentro il progetto.
 *
 * Il costo non è l'attrito, è quello che l'attrito nasconde. Su `profilo` una
 * reference è rimasta inutilizzata su 12 generazioni su 12 mentre il refset
 * continuava a promettere "+ stile", e non c'era nessun posto dove quel numero
 * si potesse leggere: dodici immagini pagate hanno preso la direzione
 * sbagliata prima che qualcuno se ne accorgesse guardandole.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function metti(nome: string): void {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), nome), PNG);
}

function variante(n: number, refs: string[]): void {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES ('p',?,?,'x',NULL,?,'openai','generated',?)`,
    [n, `/gen/v${n}.png`, JSON.stringify({ recipe: "r", refset: "rs", sources: ["p.png"], refs }), Date.now()],
  );
}

async function elenco(): Promise<{ file: string; usata_in: number }[]> {
  const r = (await (await app.request("/api/references")).json()) as {
    references: { file: string; usata_in: number }[];
  };
  return r.references;
}

beforeEach(() => {
  // La cartella dei riferimenti e' condivisa fra i test: senza svuotarla, i
  // file di un test precedente entrano nell'elenco del successivo e
  // l'ordinamento si giudica su dati che nessuno ha messo li' apposta.
  rmSync(refsDir(), { recursive: true, force: true });
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
  db().run("INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES ('p','/p.png','.png',1,1)");
});

describe("i riferimenti del progetto si vedono", () => {
  test("l'elenco mostra i file che stanno nella cartella", async () => {
    metti("stile.png");
    const refs = await elenco();
    expect(refs.some((r) => r.file === "stile.png")).toBe(true);
  });

  test("i file che non sono immagini restano fuori", async () => {
    metti("stile.png");
    mkdirSync(refsDir(), { recursive: true });
    writeFileSync(join(refsDir(), "appunti.txt"), "non sono un'immagine");
    const refs = await elenco();
    expect(refs.some((r) => r.file === "appunti.txt")).toBe(false);
  });
});

describe("una reference mai usata si vede che è mai usata", () => {
  test("zero varianti quando nessuna generazione l'ha allegata", async () => {
    metti("mai-usata.png");
    variante(1, []);
    variante(2, []);
    const r = (await elenco()).find((x) => x.file === "mai-usata.png");
    expect(r!.usata_in).toBe(0);
  });

  test("il conteggio segue le varianti che l'hanno davvero allegata", async () => {
    metti("usata.png");
    variante(1, ["usata.png"]);
    variante(2, ["usata.png"]);
    variante(3, []);
    const r = (await elenco()).find((x) => x.file === "usata.png");
    expect(r!.usata_in).toBe(2);
  });

  test("il caso di profilo: promessa nel refset, assente nei file", async () => {
    // Dodici varianti che dichiarano uno stile e non allegano niente. Prima di
    // questa vista il numero non esisteva da nessuna parte.
    metti("stile-promesso.png");
    for (let n = 1; n <= 12; n++) variante(n, []);
    const r = (await elenco()).find((x) => x.file === "stile-promesso.png");
    expect(r!.usata_in).toBe(0);
  });

  test("le mai usate stanno in cima: sono quelle su cui decidere", async () => {
    // I nomi sono scelti perche' l'ordine alfabetico dia il risultato
    // OPPOSTO: se l'ordinamento per uso sparisse, 'a-mai-usata' verrebbe
    // comunque prima e il test passerebbe senza controllare niente.
    metti("a-usata-tanto.png");
    metti("z-mai-usata.png");
    variante(1, ["a-usata-tanto.png"]);
    const refs = await elenco();
    expect(refs.map((r) => r.file)).toEqual(["z-mai-usata.png", "a-usata-tanto.png"]);
  });

  test("un lineage illeggibile non fa sparire l'elenco", async () => {
    metti("stile.png");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('p',9,'/gen/v9.png','x',NULL,'{rotto',  'openai','generated',?)`,
      [Date.now()],
    );
    const refs = await elenco();
    expect(refs.some((r) => r.file === "stile.png")).toBe(true);
  });
});

describe("dalla galleria si estrae senza ricostruire il percorso", () => {
  test("un nome nudo si risolve dentro i riferimenti del progetto", async () => {
    metti("stile.png");
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "stile.png" }),
    });
    // Il file esiste: qualunque sia l'esito dell'estrazione (il modello di
    // visione può non essere installato), NON deve essere "immagine non trovata".
    const body = (await r.json()) as { error?: string };
    expect(body.error ?? "").not.toBe("immagine non trovata");
  });

  test("un nome che non esiste resta un errore", async () => {
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "non-esiste-affatto.png" }),
    });
    expect(r.status).toBe(400);
  });
});
