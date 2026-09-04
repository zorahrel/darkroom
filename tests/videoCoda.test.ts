import { describe, expect, test } from "bun:test";
import { esceDallaCoda, type FiltroScelta } from "../client/src/videoCoda";

/**
 * Il difetto che questi test tengono fermo: giudicare una scena e avanzare
 * comunque salta quella dopo, perche' la giudicata e' gia' uscita dall'elenco
 * e le altre sono scalate. Non lascia traccia — la scena saltata resta "mai
 * vista" e sembra che sia l'operatore a non averla guardata.
 */
describe("dopo un verdetto la scena resta nell'elenco, o no", () => {
  test("'da giudicare' perde la scena qualunque sia il verdetto", () => {
    expect(esceDallaCoda("da giudicare", true)).toBe(true);
    expect(esceDallaCoda("da giudicare", false)).toBe(true);
  });

  test("'sospette' la perde ugualmente: chiede un verdetto che non c'e' ancora", () => {
    expect(esceDallaCoda("sospette", true)).toBe(true);
    expect(esceDallaCoda("sospette", false)).toBe(true);
  });

  test("'tenute' e 'scartate' la perdono solo quando il verdetto le contraddice", () => {
    expect(esceDallaCoda("tenute", true)).toBe(false);
    expect(esceDallaCoda("tenute", false)).toBe(true);
    expect(esceDallaCoda("scartate", false)).toBe(false);
    expect(esceDallaCoda("scartate", true)).toBe(true);
  });

  test("gli elenchi che non guardano il verdetto tengono la riga dov'e'", () => {
    for (const f of ["annotate", "in montaggio", "tutte"] as FiltroScelta[]) {
      expect(esceDallaCoda(f, true)).toBe(false);
      expect(esceDallaCoda(f, false)).toBe(false);
    }
  });
});
