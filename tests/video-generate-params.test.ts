import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS } from "../server/comfy.ts";
import { normaliseVideoParams as normalise } from "../server/videoParams.ts";

/**
 * Generation parameters, as they actually arrive.
 *
 * Ten generations started with the same seed because the body carried them at
 * the top level (`{shot, prompt, seed}`) and the route only read them nested
 * (`{params: {seed}}`). No error, no warning: five pairs of duplicates.
 *
 * This used to re-implement the route's normalisation instead of importing it,
 * which made it a test of its own copy — the route could drift back to the
 * broken behaviour with everything still green. It now imports the same
 * function the route calls.
 */
describe("generation parameters arrive", () => {
  test("at the top level, the way the MCP server sends them", () => {
    const r = normalise({ shot: "x", prompt: "y", seed: 29, steps: 24 });
    expect(r.params.seed).toBe(29);
    expect(r.params.steps).toBe(24);
    expect(r.ignored).toEqual([]);
  });

  test("nested, the way the UI used to", () => {
    expect(normalise({ shot: "x", prompt: "y", params: { seed: 7 } }).params.seed).toBe(7);
  });

  test("the top level wins over the nested one: it is what the caller wrote last", () => {
    expect(normalise({ shot: "x", prompt: "y", params: { seed: 7 }, seed: 29 }).params.seed).toBe(29);
  });

  test("what nobody touches keeps its starting value", () => {
    const r = normalise({ shot: "x", prompt: "y", seed: 3 });
    expect(r.params.width).toBe(DEFAULT_PARAMS.width);
    expect(r.params.length).toBe(DEFAULT_PARAMS.length);
  });

  test("a field that does not exist is NAMED, not dropped in silence", () => {
    expect(normalise({ shot: "x", prompt: "y", seedd: 29 }).ignored).toContain("seedd");
  });

  test("nor does a number that is not a number get through quietly", () => {
    const r = normalise({ shot: "x", prompt: "y", seed: "abc" });
    expect(r.params.seed).toBe(DEFAULT_PARAMS.seed);
    expect(r.ignored).toContain("seed");
  });

  test("a string stays a string", () => {
    expect(normalise({ shot: "x", prompt: "y", neg_extra: "no broken legs" }).params.neg_extra)
      .toBe("no broken legs");
  });
});
