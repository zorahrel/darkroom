import { describe, expect, test } from "bun:test";
import {
  indiceTaglio, altezzeCorsie, passoTacche,
  H_RIGHELLO, H_ATTI, MIN_SUONO, MIN_TAGLI, MIN_QUADRI,
  timecode, navetta,
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

describe("il tempo scritto come in un montaggio", () => {
  test("ore, minuti, secondi e fotogramma", () => {
    expect(timecode(0)).toBe("00:00:00:00");
    expect(timecode(1 / 24)).toBe("00:00:00:01");
    expect(timecode(125.375)).toBe("00:02:05:09");
    expect(timecode(3661.5)).toBe("01:01:01:12");
  });

  test("il fotogramma non sfora mai: 23.999 quadri non esiste", () => {
    for (let k = 0; k < 240; k++) {
      const f = Number(timecode(k / 24).slice(-2));
      expect(f).toBeLessThan(24);
      expect(f).toBe(k % 24);
    }
  });

  test("arrotonda al fotogramma piu' vicino, non taglia", () => {
    // Il player non riporta mai un tempo esatto: `currentTime` e' un numero
    // qualunque fra due quadri. Tagliando invece di arrotondare, il timecode
    // resta indietro di un fotogramma per meta' del tempo — e un fotogramma e'
    // esattamente l'unita' in cui si discute un taglio.
    expect(timecode(2.0209)).toBe("00:00:02:01");   // 48.50 quadri -> 49
    expect(timecode(2.0207)).toBe("00:00:02:00");   // 48.49 quadri -> 48
    expect(timecode(0.9999)).toBe("00:00:01:00");   // 23.998 -> 24, cioe' il secondo dopo
  });

  test("un tempo negativo non produce numeri strani", () => {
    expect(timecode(-5)).toBe("00:00:00:00");
  });
});

describe("la navetta J K L", () => {
  test("K ferma sempre", () => {
    for (const v of [-8, -1, 0, 1, 4]) expect(navetta(v, "k")).toBe(0);
  });

  test("L accelera 1, 2, 4, 8 e si ferma li'", () => {
    let v = 0;
    const visti: number[] = [];
    for (let i = 0; i < 5; i++) { v = navetta(v, "l"); visti.push(v); }
    expect(visti).toEqual([1, 2, 4, 8, 8]);
  });

  test("J e' lo specchio di L", () => {
    let v = 0;
    const visti: number[] = [];
    for (let i = 0; i < 5; i++) { v = navetta(v, "j"); visti.push(v); }
    expect(visti).toEqual([-1, -2, -4, -8, -8]);
  });

  test("cambiare verso riparte da 1x, non dalla velocita' di prima", () => {
    expect(navetta(8, "j")).toBe(-1);
    expect(navetta(-4, "l")).toBe(1);
  });
});
