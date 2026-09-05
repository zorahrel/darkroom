import { describe, expect, test } from "bun:test";
import { leavesQueue, type PickFilter } from "../client/src/videoQueue";

/**
 * The defect these tests hold still: judging a shot and advancing anyway skips
 * the next one, because the judged one has already left the list and the others
 * have moved up. It leaves no trace — the skipped shot stays "never seen" and
 * it looks as though the operator was the one who did not look at it.
 */
describe("after a verdict the shot stays in the list, or does not", () => {
  test("'to judge' loses the shot whatever the verdict", () => {
    expect(leavesQueue("da giudicare", true)).toBe(true);
    expect(leavesQueue("da giudicare", false)).toBe(true);
  });

  test("'suspect' loses it too: it asks for a verdict that is not there yet", () => {
    expect(leavesQueue("sospette", true)).toBe(true);
    expect(leavesQueue("sospette", false)).toBe(true);
  });

  test("'kept' and 'discarded' lose it only when the verdict contradicts them", () => {
    expect(leavesQueue("tenute", true)).toBe(false);
    expect(leavesQueue("tenute", false)).toBe(true);
    expect(leavesQueue("scartate", false)).toBe(false);
    expect(leavesQueue("scartate", true)).toBe(true);
  });

  test("the lists that do not look at the verdict keep the row where it is", () => {
    for (const f of ["annotate", "in montaggio", "all"] as PickFilter[]) {
      expect(leavesQueue(f, true)).toBe(false);
      expect(leavesQueue(f, false)).toBe(false);
    }
  });
});
