import { describe, expect, test } from "bun:test";
import {
  cutIndex, laneHeights, tickStep,
  H_RULER, H_ACTS, MIN_SUONO, MIN_TAGLI, MIN_QUADRI,
  timecode, shuttle,
} from "../client/src/pages/video/time.ts";

const T = (...ts: number[]) => ts.map((t) => ({ t }));

describe("which cut is under the playhead", () => {
  const cuts = T(0, 2.09, 4.44, 6.55, 8.71);

  test("before the first cut it stays the first", () => {
    expect(cutIndex(cuts, -1)).toBe(0);
    expect(cutIndex(cuts, 0)).toBe(0);
  });

  test("inside a cut, that cut", () => {
    expect(cutIndex(cuts, 2.09)).toBe(1);
    expect(cutIndex(cuts, 2.1)).toBe(1);
    expect(cutIndex(cuts, 4.43)).toBe(1);
  });

  test("on the cut's exact instant it moves to the new one", () => {
    expect(cutIndex(cuts, 4.44)).toBe(2);
    expect(cutIndex(cuts, 6.55)).toBe(3);
  });

  test("after the last it stays the last", () => {
    expect(cutIndex(cuts, 999)).toBe(4);
  });

  test("an empty list does not blow up", () => {
    expect(cutIndex([], 5)).toBe(0);
  });

  test("it agrees with the linear search over the whole duration", () => {
    // 64 tagli come il montaggio vero, a passo irregolare come i beat.
    const molti = Array.from({ length: 64 }, (_, i) => ({ t: i * 2.1 + (i % 3) * 0.31 }));
    const lineare = (t: number) => {
      let r = 0;
      for (let i = 0; i < molti.length; i++) if ((molti[i]?.t ?? 0) <= t) r = i;
      return r;
    };
    for (let t = 0; t < 150; t += 0.37) expect(cutIndex(molti, t)).toBe(lineare(t));
  });
});

describe("the lanes share out the space", () => {
  test("below the minimum they stay at their minimums, and the sum overflows: the timeline scrolls", () => {
    const c = laneHeights(80);
    expect(c).toEqual({ suono: MIN_SUONO, cuts: MIN_TAGLI, quadri: MIN_QUADRI });
    expect(c.suono + c.cuts + c.quadri).toBeGreaterThan(80 - H_RULER - H_ACTS);
  });

  test("with room, they fill the panel without any left over", () => {
    for (const h of [200, 300, 420, 700]) {
      const c = laneHeights(h);
      const used = c.suono + c.cuts + c.quadri + H_RULER + H_ACTS;
      expect(Math.abs(used - h)).toBeLessThanOrEqual(4);   // solo l'arrotondamento
    }
  });

  test("more room = every lane taller, never the other way round", () => {
    const a = laneHeights(240), b = laneHeights(560);
    expect(b.suono).toBeGreaterThan(a.suono);
    expect(b.cuts).toBeGreaterThan(a.cuts);
    expect(b.quadri).toBeGreaterThan(a.quadri);
  });

  test("no lane goes below its minimum", () => {
    for (const h of [0, 60, 130, 200, 900]) {
      const c = laneHeights(h);
      expect(c.suono).toBeGreaterThanOrEqual(MIN_SUONO);
      expect(c.cuts).toBeGreaterThanOrEqual(MIN_TAGLI);
      expect(c.quadri).toBeGreaterThanOrEqual(MIN_QUADRI);
    }
  });
});

describe("the ruler thins itself out", () => {
  test("from far away the ticks are sparse, close up dense", () => {
    expect(tickStep(5.7)).toBe(15);      // the whole track in ~850px
    expect(tickStep(91)).toBe(1);        // 16x
    expect(tickStep(700)).toBe(0.25);    // 128x
  });

  test("a tick is never closer than 58px, so the label can be read", () => {
    for (const pps of [1, 3, 12, 40, 120, 400, 2000]) {
      expect(tickStep(pps) * pps).toBeGreaterThanOrEqual(58);
    }
  });
});

describe("time written as in an edit", () => {
  test("ore, minuti, secondi e fotogramma", () => {
    expect(timecode(0)).toBe("00:00:00:00");
    expect(timecode(1 / 24)).toBe("00:00:00:01");
    expect(timecode(125.375)).toBe("00:02:05:09");
    expect(timecode(3661.5)).toBe("01:01:01:12");
  });

  test("the frame never overflows: 23.999 frames does not exist", () => {
    for (let k = 0; k < 240; k++) {
      const f = Number(timecode(k / 24).slice(-2));
      expect(f).toBeLessThan(24);
      expect(f).toBe(k % 24);
    }
  });

  test("it rounds to the nearest frame, it does not truncate", () => {
    // The player never reports an exact time: `currentTime` is some number
    // between two frames. Truncating instead of rounding leaves the timecode a
    // frame behind half the time — and a frame is exactly the unit a cut is
    // argued about in.
    expect(timecode(2.0209)).toBe("00:00:02:01");   // 48.50 quadri -> 49
    expect(timecode(2.0207)).toBe("00:00:02:00");   // 48.49 quadri -> 48
    expect(timecode(0.9999)).toBe("00:00:01:00");   // 23.998 -> 24, i.e. the next second
  });

  test("a negative time does not produce strange numbers", () => {
    expect(timecode(-5)).toBe("00:00:00:00");
  });
});

describe("la navetta J K L", () => {
  test("K always stops", () => {
    for (const v of [-8, -1, 0, 1, 4]) expect(shuttle(v, "k")).toBe(0);
  });

  test("L accelerates 1, 2, 4, 8 and stops there", () => {
    let v = 0;
    const visti: number[] = [];
    for (let i = 0; i < 5; i++) { v = shuttle(v, "l"); visti.push(v); }
    expect(visti).toEqual([1, 2, 4, 8, 8]);
  });

  test("J is the mirror of L", () => {
    let v = 0;
    const visti: number[] = [];
    for (let i = 0; i < 5; i++) { v = shuttle(v, "j"); visti.push(v); }
    expect(visti).toEqual([-1, -2, -4, -8, -8]);
  });

  test("changing direction restarts from 1x, not from the previous speed", () => {
    expect(shuttle(8, "j")).toBe(-1);
    expect(shuttle(-4, "l")).toBe(1);
  });
});
