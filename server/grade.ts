import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { LUT_DIR, REPO_ROOT, FFMPEG_BIN } from "./config.ts";
import type { GradeStep } from "./db.ts";

const COLOR_SCRIPT = join(REPO_ROOT, "scripts", "color_grade.py");

/** Deterministic (script-runnable) steps only. 'ai' steps are generative and
 *  handled by the bake orchestrator, never by the local color pipeline. */
export function deterministicSteps(steps: GradeStep[]): GradeStep[] {
  return steps.filter((s) => s.type !== "ai");
}

/** Resolve LUT ids (relative → absolute under LUT_DIR) and drop 'ai' steps, so
 *  the Python color grader receives only steps it understands with usable paths.
 *
 *  Il passo `match` è l'unico i cui parametri NON stanno nel grade: dipendono
 *  dal gruppo (quali altre foto stanno in quel post) e vengono calcolati dal
 *  server. Se non ci sono — foto non assegnata, o post con una foto sola — il
 *  passo viene tolto invece di essere applicato a vuoto. */
export function resolveStepsForScript(
  steps: GradeStep[],
  match?: { a_shift: number; b_shift: number; a_scale: number; b_scale: number } | null,
): GradeStep[] {
  const out: GradeStep[] = [];
  for (const s of deterministicSteps(steps)) {
    if (s.type === "lut" && typeof s.params.lut === "string" && s.params.lut) {
      out.push({ ...s, params: { ...s.params, lut: join(LUT_DIR, s.params.lut) } });
      continue;
    }
    if (s.type === "match") {
      if (match) out.push({ ...s, params: { ...s.params, ...match } });
      continue;
    }
    out.push(s);
  }
  return out;
}

export type GradeRunOpts = {
  maxWidth: number;
  quality: number;
  timeoutMs: number;
  wbGain?: [number, number, number] | null;
  /** Correzioni di armonizzazione, calcolate sul post di appartenenza. */
  match?: { a_shift: number; b_shift: number; a_scale: number; b_scale: number } | null;
};

/** Run an ordered list of grade steps through color_grade.py. Steps are resolved
 *  (LUT paths, ai dropped) here, so callers pass raw GradeStep[]. Returns true on
 *  a successful render. A child env with an absolute ffmpeg + a broad PATH keeps
 *  this working under a minimal launchd environment. */
export function runGradeSteps(
  source: string,
  out: string,
  steps: GradeStep[],
  opts: GradeRunOpts,
): boolean {
  const resolved = resolveStepsForScript(steps, opts.match);
  if (resolved.length === 0) return false; // nothing deterministic to apply
  mkdirSync(dirname(out), { recursive: true });
  // The steps (with absolute LUT paths) are passed via a temp file: LUT paths
  // have apostrophes/spaces that would break shell quoting on argv.
  const stepsFile = join(tmpdir(), `darkroom_steps_${randomBytes(6).toString("hex")}.json`);
  writeFileSync(stepsFile, JSON.stringify(resolved));
  const args = [
    COLOR_SCRIPT,
    "--input", source,
    "--output", out,
    "--steps-file", stepsFile,
    "--quality", String(opts.quality),
  ];
  if (opts.maxWidth > 0) args.push("--max-width", String(opts.maxWidth));
  if (opts.wbGain) args.push("--wb-gain", opts.wbGain.join(","));
  const r = spawnSync("python3", args, {
    encoding: "utf8",
    timeout: opts.timeoutMs,
    env: {
      ...process.env,
      FFMPEG: FFMPEG_BIN,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
    },
  });
  try { unlinkSync(stepsFile); } catch { /* best-effort cleanup */ }
  return r.status === 0 && existsSync(out);
}
