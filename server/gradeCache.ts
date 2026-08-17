import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { normalizeGrade, type ColorGrade } from "./db.ts";
import { deterministicSteps, runGradeSteps } from "./grade.ts";
import { gradedDir } from "./project.ts";

/**
 * On-disk cache for locally graded renders, plus the small predicates the
 * routes use to decide whether a grade runs at all.
 */

/** Bump when scripts/color_grade.py changes in a way that alters output for the
 *  same params, so the on-disk cache invalidates instead of serving stale
 *  renders. v2: gamut-safe HSL saturation/luminance (no more burnt patches).
 *  NB: the in-process Pillow 3D LUT (replacing ffmpeg lut3d, ~25x faster) is a
 *  ≤1/255 diff — imperceptible, within JPEG noise — so it deliberately does NOT
 *  bump the version: invalidating the whole graded cache to re-render every
 *  photo for a sub-1-LSB change would be pure waste. New renders just use the
 *  faster path under the same key. */
export const GRADE_ENGINE_VERSION = 2;

/** The pipeline produces a live render only if enabled and with at least one
 *  active DETERMINISTIC step. 'ai' steps are generative (bake-only) and never
 *  drive the /graded preview. */
export function gradeActive(cfg: ColorGrade): boolean {
  return cfg.enabled && cfg.steps.some((s) => s.enabled && s.type !== "ai");
}

/** Scene-match requested = there is an active white_balance step with scene_match on. */
export function sceneMatchRequested(cfg: ColorGrade): boolean {
  return cfg.steps.some(
    (s) => s.enabled && s.type === "white_balance" && s.params?.scene_match === true,
  );
}

/** Cache path for a graded image, keyed by source mtime/size + steps + width.
 *  Params change ⇒ new key ⇒ auto-recompute; same params ⇒ instant hit.
 *  Only deterministic steps enter the key — 'ai' steps never affect the preview. */
export function gradedFile(
  photoId: string,
  filename: string,
  source: string,
  cfg: ColorGrade,
  width: number,
  wbGain?: [number, number, number] | null,
  match?: { a_shift: number; b_shift: number; a_scale: number; b_scale: number } | null,
): string {
  const st = statSync(source);
  const key = createHash("sha1")
    .update(
      JSON.stringify({
        v: GRADE_ENGINE_VERSION,
        m: Math.round(st.mtimeMs),
        s: st.size,
        steps: deterministicSteps(cfg.steps),
        wb: wbGain ?? null,
        // Le correzioni di gruppo entrano nella chiave: cambiando la
        // composizione del post cambia il risultato, e la cache deve saperlo.
        match: match ?? null,
        width,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return join(gradedDir(), photoId, `${filename}.${key}.jpg`);
}

export function runColorGrade(
  source: string,
  out: string,
  cfg: ColorGrade,
  maxWidth: number,
  quality: number,
  timeoutMs: number,
  wbGain?: [number, number, number] | null,
  match?: { a_shift: number; b_shift: number; a_scale: number; b_scale: number } | null,
): boolean {
  return runGradeSteps(source, out, cfg.steps, { maxWidth, quality, timeoutMs, wbGain, match });
}

/** Overlay an UNSAVED grade passed as a JSON blob in the `g` query param, so a
 *  client (the live preview / per-photo editor) can render a grade before it's
 *  persisted. No `g` ⇒ returns `base` untouched (grid keeps stored-grade behavior). */
export function gradeFromQuery(
  c: { req: { query: (k: string) => string | undefined } },
  base: ColorGrade,
): ColorGrade {
  const g = c.req.query("g");
  if (!g) return base;
  try {
    return normalizeGrade(JSON.parse(g));
  } catch {
    return base;
  }
}
