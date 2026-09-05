import type { VideoCut } from "../../api";

/**
 * The two timeline measurements that go wrong silently.
 *
 * They live here, outside the components, because an error in neither of them
 * gives an error: it gives a panel that opens the wrong cut, or a lane squashed
 * to zero. They are only seen by looking, and looking is exactly what this page
 * is meant to be good for.
 */

/** Which cut is under an instant. Binary search because the transport calls
 *  it on every `timeupdate` and the keyboard on every arrow. */
export function cutIndex(cuts: Pick<VideoCut, "t">[], t: number): number {
  let lo = 0, hi = cuts.length - 1, r = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if ((cuts[m]?.t ?? 0) <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

export const H_RULER = 20;
export const H_ACTS = 16;
export const MIN_SUONO = 34;
export const MIN_CUTS = 44;
export const MIN_QUADRI = 40;

export type LaneHeights = { sound: number; cuts: number; frames: number };

/**
 * How the three tall lanes share out the panel's space.
 *
 * Pulling the divider up, the timeline grows and the waveform, the blocks and
 * the frames grow with it — which is why you enlarge it. If there is not enough
 * space they go down to their minimums and the timeline scrolls vertically,
 * instead of squashing everything until it says nothing any more.
 */
export function laneHeights(height: number): LaneHeights {
  const remains = Math.max(0, height - H_RULER - H_ACTS - 2);
  const minimums = MIN_SUONO + MIN_CUTS + MIN_QUADRI;
  if (remains <= minimums) return { sound: MIN_SUONO, cuts: MIN_CUTS, frames: MIN_QUADRI };
  const extra = remains - minimums;
  return {
    sound: Math.round(MIN_SUONO + extra * 0.24),
    cuts: Math.round(MIN_CUTS + extra * 0.40),
    frames: Math.round(MIN_QUADRI + extra * 0.36),
  };
}

/** How often to put a tick so the ruler stays readable: from far away one
 *  every ten seconds, close up one a second. */
export function tickStep(pxPerSecond: number): number {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxPerSecond >= 58) return s;
  return 60;
}

/**
 * Time as an edit writes it: `hours:minutes:seconds:frame`.
 *
 * `2:05.4` is fine for saying roughly where you are, but not for saying *which
 * frame*: four tenths is ten frames at 24, and a cut is argued at the frame. An
 * editor writes `00:02:05:09` because that number is addressable — it can be
 * written in a note and found again exactly.
 */
export function timecode(s: number, fps = 24): string {
  const tot = Math.max(0, Math.round(s * fps));
  const f = tot % fps;
  const sec = Math.floor(tot / fps);
  const due = (n: number) => String(n).padStart(2, "0");
  return `${due(Math.floor(sec / 3600))}:${due(Math.floor(sec / 60) % 60)}:${due(sec % 60)}:${due(f)}`;
}

/** The J/K/L shuttle speeds, as on any edit bench: pressing repeatedly
 *  accelerates, K stops, and backwards is the mirror of forwards. */
export function shuttle(current: number, key: "j" | "k" | "l"): number {
  const scala = [1, 2, 4, 8];
  if (key === "k") return 0;
  const toward = key === "l" ? 1 : -1;
  if (Math.sign(current) !== toward) return toward;                 // cambio di verso: riparti da 1x
  const i = scala.indexOf(Math.abs(current));
  return toward * (scala[Math.min(scala.length - 1, i + 1)] ?? 1);
}
