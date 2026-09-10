import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
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
