import { describe, expect, test } from "bun:test";

/**
 * Re-attaching to a generation, instead of redoing it.
 *
 * A prompt already sent is in one of three places: finished (history), still
 * alive (queue), or nowhere. Only the third should be resent — but the "still
 * alive" branch did not exist, and every server restart during a generation
 * published a fresh copy of it on the card. Measured: three restarts in one
 * session, three identical copies of the same plan queued on the 3090.
 *
 * What is tested here is the piece that branch decides on: reading ComfyUI's
 * queue.
 */
export function queued(q: any, promptId: string): boolean {
  if (!q) return false;
  const inside = (v: unknown[]) => v.some((x) => Array.isArray(x) && x[1] === promptId);
  return inside(q.queue_running ?? []) || inside(q.queue_pending ?? []);
}

// La forma vera di /queue: [numero, prompt_id, grafo, extra, uscite].
const item = (id: string) => [7, id, {}, {}, ["10"]];

describe("a live prompt is recognised", () => {
  test("while it runs", () => {
    expect(queued({ queue_running: [item("abc")], queue_pending: [] }, "abc")).toBe(true);
  });
  test("while it waits its turn", () => {
    expect(queued({ queue_running: [], queue_pending: [item("abc"), item("def")] }, "def")).toBe(true);
  });
  test("and one that is not there is not there", () => {
    expect(queued({ queue_running: [item("abc")], queue_pending: [item("def")] }, "zzz")).toBe(false);
  });
  test("empty queue: not there", () => {
    expect(queued({ queue_running: [], queue_pending: [] }, "abc")).toBe(false);
  });
  test("a mute ComfyUI is not 'it is alive': better to resend it than to wait for ever", () => {
    expect(queued(null, "abc")).toBe(false);
  });
  test("absent fields blow nothing up", () => {
    expect(queued({}, "abc")).toBe(false);
  });
});
