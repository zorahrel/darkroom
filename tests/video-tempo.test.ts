import { describe, expect, test } from "bun:test";
import {
  indiceTaglio, altezzeCorsie, passoTacche,
  H_RIGHELLO, H_ATTI, MIN_SUONO, MIN_TAGLI, MIN_QUADRI,
} from "../client/src/pages/video/tempo.ts";

const T = (...ts: number[]) => ts.map((t) => ({ t }));

describe("quale taglio sta sotto la testina", () => {
  const cuts = T(0, 2.09, 4.44, 6.55, 8.71);

  test("prima del primo taglio resta il primo", () => {
    expect(indiceTaglio(cuts, -1)).toBe(0);
    expect(indiceTaglio(cuts, 0)).toBe(0);
  });

  test("dentro un taglio, quel taglio", () => {
    expect(indiceTaglio(cuts, 2.09)).toBe(1);
    expect(indiceTaglio(cuts, 2.1)).toBe(1);
    expect(indiceTaglio(cuts, 4.43)).toBe(1);
  });

  test("sull'istante esatto del taglio si passa al nuovo", () => {
    expect(indiceTaglio(cuts, 4.44)).toBe(2);
    expect(indiceTaglio(cuts, 6.55)).toBe(3);
  });

  test("dopo l'ultimo resta l'ultimo", () => {
    expect(indiceTaglio(cuts, 999)).toBe(4);
  });

  test("una lista vuota non esplode", () => {
    expect(indiceTaglio([], 5)).toBe(0);
  });

  test("concorda con la ricerca lineare su tutta la durata", () => {
    // 64 tagli come il montaggio vero, a passo irregolare come i beat.
    const molti = Array.from({ length: 64 }, (_, i) => ({ t: i * 2.1 + (i % 3) * 0.31 }));
    const lineare = (t: number) => {
      let r = 0;
      for (let i = 0; i < molti.length; i++) if ((molti[i]?.t ?? 0) <= t) r = i;
      return r;
    };
    for (let t = 0; t < 150; t += 0.37) expect(indiceTaglio(molti, t)).toBe(lineare(t));
  });
});

describe("le corsie si spartiscono lo spazio", () => {
  test("sotto il minimo restano ai minimi, e la somma sfora: la timeline scorre", () => {
    const c = altezzeCorsie(80);
    expect(c).toEqual({ suono: MIN_SUONO, tagli: MIN_TAGLI, quadri: MIN_QUADRI });
    expect(c.suono + c.tagli + c.quadri).toBeGreaterThan(80 - H_RIGHELLO - H_ATTI);
  });

  test("con spazio, riempiono il pannello senza avanzarne", () => {
    for (const h of [200, 300, 420, 700]) {
      const c = altezzeCorsie(h);
      const usato = c.suono + c.tagli + c.quadri + H_RIGHELLO + H_ATTI;
      expect(Math.abs(usato - h)).toBeLessThanOrEqual(4);   // solo l'arrotondamento
    }
  });

  test("più spazio = ogni corsia più alta, mai il contrario", () => {
    const a = altezzeCorsie(240), b = altezzeCorsie(560);
    expect(b.suono).toBeGreaterThan(a.suono);
    expect(b.tagli).toBeGreaterThan(a.tagli);
    expect(b.quadri).toBeGreaterThan(a.quadri);
  });

  test("nessuna corsia scende sotto il suo minimo", () => {
    for (const h of [0, 60, 130, 200, 900]) {
      const c = altezzeCorsie(h);
      expect(c.suono).toBeGreaterThanOrEqual(MIN_SUONO);
      expect(c.tagli).toBeGreaterThanOrEqual(MIN_TAGLI);
      expect(c.quadri).toBeGreaterThanOrEqual(MIN_QUADRI);
    }
  });
});

describe("il righello si dirada da solo", () => {
  test("da lontano le tacche sono rade, da vicino fitte", () => {
    expect(passoTacche(5.7)).toBe(15);      // tutto il brano in ~850px
    expect(passoTacche(91)).toBe(1);        // 16x
    expect(passoTacche(700)).toBe(0.25);    // 128x
  });

  test("una tacca non sta mai piu' vicina di 58px, cosi' l'etichetta si legge", () => {
    for (const pps of [1, 3, 12, 40, 120, 400, 2000]) {
      expect(passoTacche(pps) * pps).toBeGreaterThanOrEqual(58);
    }
  });
});
