import { describe, expect, test } from "bun:test";

/**
 * Da cosa e' nata una versione si deve vedere mentre la si guarda.
 *
 * Il 24/09 l'utente: «fammi vedere anche le foto reference e prompt quando la
 * vedo» e «stai passando una foto mia alterata inutilmente». Le due cose sono
 * legate: gli ingressi non comparivano da nessuna parte, quindi non poteva
 * accorgersi che la foto di partenza era una sua foto ritoccata da me.
 */
const leggi = (p: string) => Bun.file(new URL(p, import.meta.url)).text();

describe("gli ingressi di ogni versione arrivano alla pagina", () => {
  test("l'API li legge da version_inputs, non dal lineage", async () => {
    const s = await leggi("../server/routes/photos.ts");
    expect(s).toContain("ingressi: ingressiDelle(versions)");
    expect(s).toContain("FROM version_inputs");
  });

  test("una foto alterata non puo' passare per originale", async () => {
    const s = await leggi("../server/routes/photos.ts");
    const corpo = s.slice(s.indexOf("function tipoDi"), s.indexOf("function risolvi"));
    // derivate/ va controllata PRIMA di RAW/: e' il caso da non nascondere
    expect(corpo.indexOf("derivateDir()")).toBeGreaterThan(-1);
    expect(corpo.indexOf("derivateDir()")).toBeLessThan(corpo.indexOf("rawDir()"));
    const cerca = s.slice(s.indexOf("function risolvi"), s.indexOf("function ingressiDelle"));
    expect(cerca.indexOf("derivateDir()")).toBeLessThan(cerca.indexOf("rawDir()"));
  });

  test("la miniatura di una versione vecchia non si rompe dopo lo spostamento", async () => {
    const m = await leggi("../server/routes/media.ts");
    const i = m.indexOf("function refFile");
    const corpo = m.slice(i, m.indexOf("mediaRoutes.get", i));
    expect(corpo).toContain("derivateDir()");
  });

  test("il riquadro sta sopra l'anteprima, visibile a ogni larghezza", async () => {
    const p = await leggi("../client/src/components/detail/PhotoPipeline.tsx");
    const anteprima = p.slice(p.indexOf("const previewNode"), p.indexOf("return (\n      <EditorRail"));
    expect(anteprima).toContain("<IngressiVersione");
    const c = await leggi("../client/src/components/detail/IngressiVersione.tsx");
    expect(c).toContain('alterata: { testo: "alterata"');
    expect(c).toContain("pointer-events-none");
  });
});
