import { describe, expect, test } from "bun:test";
import {
  anchoredScroll,
  canvasSize,
  centerOf,
  contentPointAt,
  fitZoom,
  scrollToCenter,
} from "../client/src/components/flow/viewport.ts";

/** La mappa 900x1700 in una finestra 500x800. Lo scroll massimo e' (area - finestra). */
const box = { cw: 500, ch: 800 };
const W = 900;
const H = 1700;
const maxScroll = (z: number) => {
  const s = canvasSize(W, H, z, box);
  return { left: s.width - box.cw, top: s.height - box.ch };
};

describe("centrare sulla mappa", () => {
  test("ogni punto del contenuto si puo' portare al centro, anche negli angoli", () => {
    for (const z of [0.2, 0.6, 1.5]) {
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]] as const) {
        const s = scrollToCenter(x, y, z);
        const max = maxScroll(z);
        // raggiungibile: dentro l'area scorrevole
        expect(s.left).toBeLessThanOrEqual(max.left + 1e-6);
        expect(s.top).toBeLessThanOrEqual(max.top + 1e-6);
        // e il centro della finestra cade proprio li'
        const c = centerOf(s, z, box);
        expect(Math.abs(c.x - x)).toBeLessThan(1e-6);
        expect(Math.abs(c.y - y)).toBeLessThan(1e-6);
      }
    }
  });
  test("senza il margine un nodo all'angolo NON sarebbe centrabile (la prova che il margine serve)", () => {
    const z = 1;
    const senza = { left: W * z - box.cw, top: H * z - box.ch }; // scroll massimo senza margine
    const voluto = scrollToCenter(W, H, z);
    expect(voluto.left).toBeGreaterThan(senza.left);
  });
});

describe("adatta", () => {
  test("fa stare tutto con un respiro, e rispetta i limiti", () => {
    const z = fitZoom(W, H, box);
    expect(W * z).toBeLessThanOrEqual(box.cw);
    expect(H * z).toBeLessThanOrEqual(box.ch);
    expect(fitZoom(10, 10, box)).toBe(1.5); // contenuto minuscolo: non oltre il massimo
    expect(fitZoom(100000, 100000, box)).toBe(0.15);
    expect(fitZoom(0, 10, box)).toBe(1);
  });
});

describe("zoom ancorato", () => {
  test("il punto sotto il cursore resta fermo", () => {
    const scroll = { left: 123, top: 456 };
    const [ox, oy] = [210, 330];
    for (const [z, nz] of [[0.5, 1.2], [1.2, 0.4], [1, 1.25]] as const) {
      const before = contentPointAt(ox, oy, scroll, z, box);
      const next = anchoredScroll(ox, oy, scroll, z, nz, box);
      const after = contentPointAt(ox, oy, next, nz, box);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-6);
    }
  });
});

describe("zoom su un solo nodo", () => {
  test("un nodo 40x71 riempie la finestra, e lo zoom non supera il tetto", () => {
    const box = { cw: 572, ch: 1158 };
    const z = fitZoom(40, 71, box, { min: 0.15, max: 16, breathe: 0.94 });
    // il nodo ingrandito sta nella finestra e ne occupa quasi tutta l'altezza o la larghezza
    expect(40 * z).toBeLessThanOrEqual(box.cw);
    expect(71 * z).toBeLessThanOrEqual(box.ch);
    expect(Math.max((40 * z) / box.cw, (71 * z) / box.ch)).toBeGreaterThan(0.9);
    // su una finestra enorme si ferma al tetto invece di sgranare all'infinito
    expect(fitZoom(40, 71, { cw: 20000, ch: 20000 }, { max: 16 })).toBe(16);
  });
});
