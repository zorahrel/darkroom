import { describe, expect, test } from "bun:test";
import { leavesQueue, type PickFilter } from "../client/src/videoQueue";

/**
 * Il difetto che questi test tengono fermo: giudicare una scena e avanzare
 * comunque salta quella dopo, perche' la giudicata e' gia' uscita dall'elenco
 * e le altre sono scalate. Non lascia traccia — la scena saltata resta "mai
 * vista" e sembra che sia l'operatore a non averla guardata.
 */
describe("dopo un verdetto la scena resta nell'elenco, o no", () => {
  test("'da giudicare' perde la scena qualunque sia il verdetto", () => {
    expect(leavesQueue("da giudicare", true)).toBe(true);
    expect(leavesQueue("da giudicare", false)).toBe(true);
  });

  test("'sospette' la perde ugualmente: chiede un verdetto che non c'e' ancora", () => {
    expect(leavesQueue("sospette", true)).toBe(true);
    expect(leavesQueue("sospette", false)).toBe(true);
  });

  test("'tenute' e 'scartate' la perdono solo quando il verdetto le contraddice", () => {
    expect(leavesQueue("tenute", true)).toBe(false);
    expect(leavesQueue("tenute", false)).toBe(true);
    expect(leavesQueue("scartate", false)).toBe(false);
    expect(leavesQueue("scartate", true)).toBe(true);
  });

  test("gli elenchi che non guardano il verdetto tengono la riga dov'e'", () => {
    for (const f of ["annotate", "in montaggio", "all"] as PickFilter[]) {
      expect(leavesQueue(f, true)).toBe(false);
      expect(leavesQueue(f, false)).toBe(false);
    }
  });
});
