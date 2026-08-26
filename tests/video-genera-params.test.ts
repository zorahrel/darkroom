import { describe, expect, test } from "bun:test";
import { PARAMETRI_DEFAULT } from "../server/comfy.ts";

/**
 * I parametri di generazione, come arrivano davvero.
 *
 * Dieci generazioni sono partite con lo stesso seme perche' il corpo li
 * portava al primo livello (`{piano, prompt, seed}`) e la rotta li leggeva
 * solo annidati (`{params: {seed}}`). Nessun errore, nessun avviso: cinque
 * coppie di doppioni. Questo test e' la stessa normalizzazione della rotta,
 * estratta perche' possa fallire.
 */
export function normalizza(corpo: Record<string, unknown>) {
  const grezzi: Record<string, unknown> = { ...((corpo.params as object) ?? {}) };
  const ignorati: string[] = [];
  for (const [k, v] of Object.entries(corpo)) {
    if (["piano", "prompt", "take", "params", "project"].includes(k)) continue;
    if (k in PARAMETRI_DEFAULT) grezzi[k] = v;
    else ignorati.push(k);
  }
  const params: Record<string, unknown> = {};
  for (const [k, atteso] of Object.entries(PARAMETRI_DEFAULT)) {
    if (!(k in grezzi)) continue;
    const v = grezzi[k];
    if (typeof atteso === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) { ignorati.push(k); continue; }
      params[k] = n;
    } else params[k] = String(v);
  }
  return { params: { ...PARAMETRI_DEFAULT, ...params }, ignorati };
}

describe("i parametri di generazione arrivano", () => {
  test("al primo livello, come li manda l'MCP", () => {
    const r = normalizza({ piano: "x", prompt: "y", seed: 29, steps: 24 });
    expect(r.params.seed).toBe(29);
    expect(r.params.steps).toBe(24);
    expect(r.ignorati).toEqual([]);
  });

  test("annidati, come faceva la UI", () => {
    expect(normalizza({ piano: "x", prompt: "y", params: { seed: 7 } }).params.seed).toBe(7);
  });

  test("il primo livello vince sull'annidato: e' quello che il chiamante ha scritto per ultimo", () => {
    expect(normalizza({ piano: "x", prompt: "y", params: { seed: 7 }, seed: 29 }).params.seed).toBe(29);
  });

  test("quello che non si tocca resta al valore di partenza", () => {
    const r = normalizza({ piano: "x", prompt: "y", seed: 3 });
    expect(r.params.width).toBe(PARAMETRI_DEFAULT.width);
    expect(r.params.length).toBe(PARAMETRI_DEFAULT.length);
  });

  test("un campo che non esiste viene NOMINATO, non buttato in silenzio", () => {
    expect(normalizza({ piano: "x", prompt: "y", semee: 29 }).ignorati).toContain("semee");
  });

  test("e nemmeno un numero che non e' un numero passa zitto", () => {
    const r = normalizza({ piano: "x", prompt: "y", seed: "abc" });
    expect(r.params.seed).toBe(PARAMETRI_DEFAULT.seed);
    expect(r.ignorati).toContain("seed");
  });

  test("una stringa resta una stringa", () => {
    expect(normalizza({ piano: "x", prompt: "y", neg_extra: "niente gambe rotte" }).params.neg_extra)
      .toBe("niente gambe rotte");
  });
});
