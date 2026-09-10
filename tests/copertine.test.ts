import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { app } from "../server/app.ts";
import { TOOLS } from "../server/tools.ts";

/**
 * Le copertine degli strumenti devono arrivare davvero.
 *
 * Il ripiego della SPA risponde 200 a qualunque percorso sconosciuto, con dentro
 * `index.html`: un `<img>` che riceve dell'HTML non alza nessun errore visibile e la
 * scheda resta semplicemente senza copertina. Controllare il codice di stato non
 * basta — e' 200 in entrambi i casi — quindi qui si guarda il tipo.
 */
describe("le copertine degli strumenti", () => {
  const presenti = existsSync("dist/copertine")
    ? new Set(readdirSync("dist/copertine").filter((n) => n.endsWith(".webp")).map((n) => n.slice(0, -5)))
    : new Set<string>();

  test.skipIf(presenti.size === 0)("arrivano come immagini, non come la pagina", async () => {
    const uno = [...presenti][0]!;
    const r = await app.request(`/copertine/${uno}.webp`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("image/webp");
  });

  test("un percorso che risale la cartella non serve niente", async () => {
    const r = await app.request("/copertine/../../package.json");
    // O rifiutato, o comunque non il file: quello che non deve succedere è servirlo.
    expect(await r.text()).not.toContain('"darkroom"');
  });

  test.skipIf(presenti.size === 0)("ogni strumento del catalogo ha la sua", () => {
    const senza = TOOLS.map((t) => t.id).filter((id) => !presenti.has(id));
    expect(senza).toEqual([]);
  });
});

/**
 * Ogni strumento ha la sua fotografia, e nessuno la divide con un altro.
 *
 * E' l'unica cosa che tiene la serie distinguibile: in un riquadro da 460 punti si
 * guarda l'immagine, non la disposizione. Quando questa lista non c'era, ventuno
 * copertine composte in ventuno modi diversi mostravano tutte la stessa strada al
 * tramonto e sembravano la stessa copertina. Una riga dimenticata su uno strumento
 * nuovo non darebbe nessun errore: darebbe due schede gemelle.
 */
describe("le fotografie delle copertine", () => {
  const sorgente = readFileSync(new URL("../scripts/copertine.ts", import.meta.url), "utf8");
  const blocco = (nome: string) =>
    new RegExp(`const ${nome}[^=]*= \\{([\\s\\S]*?)\\n\\};`).exec(sorgente)?.[1] ?? "";
  const chiavi = (nome: string) => [...blocco(nome).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]!);

  test("ogni soggetto ha la sua fotografia assegnata", () => {
    const senza = chiavi("SOGGETTI").filter((k) => !chiavi("FOTOGRAFIE").includes(k));
    expect(senza).toEqual([]);
  });

  test("e nessuna fotografia e' usata da due strumenti", () => {
    const valori = [...blocco("FOTOGRAFIE").matchAll(/^ {2}\w+: "([^"]+)"/gm)].map((m) => m[1]!);
    const doppie = valori.filter((v, i) => valori.indexOf(v) !== i);
    expect(doppie).toEqual([]);
  });
});
