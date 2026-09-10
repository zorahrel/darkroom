import { describe, expect, test } from "bun:test";
import { TOOLS } from "../server/tools.ts";
import { CHIAVI_AVVIO } from "../server/routes/tools.ts";

/**
 * Le partenze del catalogo e i motori che le eseguono.
 *
 * «Genera e rifai immagini» ha due partenze — da una frase e da una cartella — e
 * sono due lavori diversi che finiscono nello stesso posto. Il server sceglie quale
 * eseguire da una chiave scritta nel catalogo: se quella chiave cambia da una parte
 * sola nessuno protesta, il tasto cade sull'altro avvio e fa il lavoro sbagliato
 * senza dirlo. Questa prova e' l'unico posto in cui quella slegatura si vede.
 */
describe("ogni partenza ha il suo motore", () => {
  const conChiave = TOOLS.flatMap((t) =>
    t.starters
      .filter((s): s is Extract<typeof s, { key?: string }> => s.mode !== "open" && !!(s as { key?: string }).key)
      .map((s) => ({ tool: t.id, key: (s as { key?: string }).key!, label: s.label })),
  );

  test("le partenze dichiarate esistono davvero dall'altra parte", () => {
    const orfane = conChiave.filter((s) => !CHIAVI_AVVIO.has(`${s.tool}:${s.key}`));
    expect(orfane).toEqual([]);
  });

  test("e nessun motore a chiave resta senza la sua partenza", () => {
    const dichiarate = new Set(conChiave.map((s) => `${s.tool}:${s.key}`));
    const sospese = [...CHIAVI_AVVIO].filter((k) => k.includes(":") && !dichiarate.has(k));
    expect(sospese).toEqual([]);
  });

  test("«genera e rifai» ha le due partenze, e portano a due lavori diversi", () => {
    const t = TOOLS.find((x) => x.id === "generate")!;
    const chiavi = t.starters.map((s) => (s as { key?: string }).key).filter(Boolean);
    expect(chiavi.sort()).toEqual(["cartella", "testo"]);
    expect(CHIAVI_AVVIO.has("generate:testo")).toBe(true);
    expect(CHIAVI_AVVIO.has("generate:cartella")).toBe(true);
  });
});
