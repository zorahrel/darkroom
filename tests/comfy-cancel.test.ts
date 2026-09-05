import { describe, expect, test } from "bun:test";

/**
 * What can be stopped.
 *
 * A queued generation could be removed; one **in progress** could not — it sat
 * there until it finished or until the fifteen minutes with no new frames ran
 * out, and meanwhile it held up the whole queue behind it. It really happens:
 * you launch a run of ten, look at the first and realise the prompt is wrong.
 *
 * What is tested here is the decision, which is the part that can be got wrong:
 * which states to act on, and when ComfyUI has to be told as well.
 */
export function decide(state: string | undefined, promptId: string | null) {
  if (!state || state === "done" || state === "cancelled") {
    return { cancel: false, notifyComfy: false };
  }
  return { cancel: true, notifyComfy: state === "running" && !!promptId };
}

describe("stopping a generation", () => {
  test("queued: it is just removed, the card knows nothing about it", () => {
    expect(decide("pending", null)).toEqual({ cancel: true, notifyComfy: false });
  });

  test("in progress: it is removed AND the card is told to stop", () => {
    expect(decide("running", "abc")).toEqual({ cancel: true, notifyComfy: true });
  });

  test("in progress but not sent yet: nothing to tell the card", () => {
    expect(decide("running", null)).toEqual({ cancel: true, notifyComfy: false });
  });

  test("already finished: it is left alone — interrupting now would stop somebody else's", () => {
    expect(decide("done", "abc")).toEqual({ cancel: false, notifyComfy: false });
  });

  test("already cancelled: cancelling it twice does nothing", () => {
    expect(decide("cancelled", "abc")).toEqual({ cancel: false, notifyComfy: false });
  });

  test("an id that does not exist is not an excuse to interrupt at random", () => {
    expect(decide(undefined, "abc")).toEqual({ cancel: false, notifyComfy: false });
  });
});
