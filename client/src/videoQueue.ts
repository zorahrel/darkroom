/**
 * Who stays in the list after a verdict.
 *
 * The pick page keeps its position with an index into a filtered queue. As long
 * as the filter is "all" the index is harmless, but the real filters are the
 * ones the just-judged shot no longer satisfies: with "to judge" the row leaves
 * the queue the instant of the verdict, and the next one moves up into position
 * `i` by itself.
 *
 * Advancing in there skips a shot, and skips it silently: out of 145 shots, 72
 * came out seen and the others marked "never seen" with nothing to explain why.
 * The count at the top of the page showed it and it looked like the operator
 * was being slow.
 *
 * It lives here, outside the component, because it is a rule — not a rendering
 * detail — and because a defect invisible to the eye has to be held still by a
 * test.
 */
export type PickFilter =
  | "da giudicare"
  | "sospette"
  | "tenute"
  | "scartate"
  | "annotate"
  | "in montaggio"
  | "all";

/** true if the shot, after this verdict, disappears from the filtered list. */
export function leavesQueue(filter: PickFilter, kept: boolean): boolean {
  // Both ask for a verdict that is not there yet: giving one makes it leave,
  // whatever it is.
  if (filter === "da giudicare" || filter === "sospette") return true;
  if (filter === "tenute") return !kept;
  if (filter === "scartate") return kept;
  // "annotated", "in the cut" and "all" do not look at the verdict: the row
  // stays where it is and the index must advance as usual.
  return false;
}
