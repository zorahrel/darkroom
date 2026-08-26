import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";

/**
 * La radice dell'albero è l'INSIEME di sorgenti, non la prima foto di esso.
 *
 * Due regole sbagliate stanno una di qua e una di là da questa: raggruppare per
 * `photo_id` metteva tutte le varianti sotto la prima sorgente e lasciava le
 * altre a "0 varianti"; dare una radice a ogni foto contribuente avrebbe
 * mostrato le stesse 12 varianti tre volte. Quello che si controlla qui è che
 * non si scivoli in nessuna delle due.
 */

function foto(id: string) {
  db().run(
    "INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES (?,?,'.png',1,1)",
    [id, `/src/${id}.png`],
  );
}

function variante(n: number, sorgenti: string[], photoId = sorgenti[0]!) {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES (?,?,?,'p',NULL,?,'openai','generated',?)`,
    [
      photoId.replace(/\.png$/, ""),
      n,
      `/gen/v${n}.png`,
      JSON.stringify({ recipe: "r", refset: "rs", sources: sorgenti }),
      Date.now(),
    ],
  );
}

async function albero(): Promise<{ photos: { photo: string; photos?: string[]; variants: number }[] }> {
  return (await (await app.request("/api/lineage")).json()) as never;
}

beforeEach(() => {
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
});

describe("la radice è l'insieme, non la prima foto", () => {
  test("tre scatti insieme danno UNA radice con tutte e tre", async () => {
    for (const id of ["A", "B", "C"]) foto(id);
    for (let n = 1; n <= 12; n++) variante(n, ["A.png", "B.png", "C.png"]);

    const { photos } = await albero();
    const conVarianti = photos.filter((p) => p.variants > 0);
    expect(conVarianti).toHaveLength(1);
    expect(conVarianti[0]!.photos).toHaveLength(3);
    expect(conVarianti[0]!.variants).toBe(12);
    // Il difetto opposto: 3 radici x 12 = 36 apparizioni per 12 generazioni.
    expect(photos.reduce((a, p) => a + p.variants, 0)).toBe(12);
  });

  test("nessuna foto dell'insieme compare a parte con zero varianti", async () => {
    for (const id of ["A", "B", "C"]) foto(id);
    variante(1, ["A.png", "B.png", "C.png"]);
    const { photos } = await albero();
    // B e C hanno contribuito: non devono comparire come radici vuote.
    expect(photos).toHaveLength(1);
  });

  test("una foto sola è l'insieme di uno, senza casi speciali", async () => {
    foto("A");
    foto("B");
    variante(1, ["A.png"]);
    variante(2, ["B.png"], "B.png");
    const { photos } = await albero();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(2);
    for (const p of photos) expect(p.photos).toHaveLength(1);
  });

  test("insiemi che si sovrappongono restano radici distinte", async () => {
    for (const id of ["A", "B", "C"]) foto(id);
    variante(1, ["A.png", "B.png"]);
    variante(2, ["A.png", "B.png"]);
    variante(3, ["A.png", "B.png", "C.png"]);
    const { photos } = await albero();
    const r = photos.filter((p) => p.variants > 0);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.variants).sort()).toEqual([1, 2]);
    // Nessuna variante contata due volte: {A,B} non è un ramo di {A,B,C}.
    expect(r.reduce((a, p) => a + p.variants, 0)).toBe(3);
  });

  test("l'ordine di allegamento non crea due radici per lo stesso insieme", async () => {
    for (const id of ["A", "B"]) foto(id);
    variante(1, ["A.png", "B.png"]);
    variante(2, ["B.png", "A.png"], "A.png");
    const { photos } = await albero();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(1);
  });

  test("le foto che non hanno generato restano visibili", async () => {
    foto("A");
    foto("mai-usata");
    variante(1, ["A.png"]);
    const { photos } = await albero();
    expect(photos.some((p) => p.photo === "mai-usata" && p.variants === 0)).toBe(true);
  });
});

describe("il riferimento si puo' guardare, non solo misurare", () => {
  // La distanza dalla reference si calcola (fondo, area, rapporto di luce), ma
  // "quanto ci somiglia" resta un giudizio da fare con gli occhi. Perche' sia
  // possibile sovrapporla, il file deve essere servito e il lineage deve dire
  // QUALE file era: il refset e' una frase per un umano, non un percorso.
  test("il lineage riporta i file di riferimento, non solo il refset", async () => {
    foto("A");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('A',1,'/gen/v1.png','p',NULL,?,'openai','generated',?)`,
      [
        JSON.stringify({
          recipe: "r",
          refset: "3 sorgenti + stile",
          sources: ["A.png"],
          refs: ["stile.png"],
        }),
        Date.now(),
      ],
    );
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    expect(photos[0]!.groups[0]!.refs).toEqual(["stile.png"]);
  });

  test("una generazione senza riferimenti non ne inventa", async () => {
    foto("A");
    variante(1, ["A.png"]);
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    // Array vuoto, non undefined: la vista decide se mostrare i controlli
    // contando questi, e un undefined la farebbe sbagliare in silenzio.
    expect(photos[0]!.groups[0]!.refs).toEqual([]);
  });

  test("la rotta dei riferimenti rifiuta il path traversal", async () => {
    const r = await app.request("/refs/..%2f..%2fphotos.db");
    expect([400, 404]).toContain(r.status);
  });
});
