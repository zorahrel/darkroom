import { describe, expect, test } from "bun:test";
import { receipt } from "../mcp/server.ts";

/**
 * A write must not answer with the project's state. The real case: video_judge
 * returned 247,000 characters to confirm one verdict, and from MCP it was
 * unusable. These cases run against `receipt`, not against a fetch: it is the
 * function that has to be right, the transport is already tested elsewhere.
 */
describe("receipt", () => {
  test("big lists become a count", () => {
    const r = receipt({ ok: true, discarded: { a: "x" }, shots: [1, 2, 3] }) as any;
    expect(r.ok).toBe(true);
    expect(r.discarded).toEqual({ a: "x" });
    expect(r.shots).toBe("3 voci — chiedile con video_shots/video_cuts");
  });

  test("it does not touch what is not a known list", () => {
    const r = receipt({ ok: true, error: null, bar: 12 }) as any;
    expect(r).toEqual({ ok: true, error: null, bar: 12 });
  });

  test("a small but known list is compressed all the same: the threshold is not the length", () => {
    expect((receipt({ cuts: [] }) as any).cuts).toBe("0 voci — chiedile con video_shots/video_cuts");
  });

  test("it copes with what is not an object", () => {
    expect(receipt("ok")).toBe("ok");
    expect(receipt(null)).toBe(null);
  });
});
