import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  db,
  effectiveGrade,
  getDefaultConfig,
  nextVersionNumber,
  type PhotoRow,
  type GradeStep,
} from "./db.ts";
import { genDir } from "./project.ts";
import {
  DEFAULT_CONFIG,
  assemblePrompt,
  mergeConfig,
  parseConfig,
  parsePartialConfig,
  type PromptConfig,
} from "./promptConfig.ts";
import { runGradeSteps, deterministicSteps } from "./grade.ts";
import { enqueueJob } from "./jobs.ts";
import { wbGainFor } from "./sceneWb.ts";
import { promptFor } from "./photos.ts";

/** A generative pipeline step: full PromptConfig override + which worker runs it. */
type AiStepParams = {
  provider?: "chatgpt" | "higgsfield";
  config?: Partial<PromptConfig>;
  provider_params?: Record<string, unknown>;
};

export type BakeStepLog = {
  index: number;
  type: string;
  kind: "grade" | "ai" | "skipped";
  ok: boolean;
  detail?: string;
};

export type BakeResult = {
  ok: boolean;
  photo_id: string;
  version_id?: number;
  image_path?: string;
  steps: BakeStepLog[];
  error?: string;
};

/** How long a single AI step may take (queue wait + worker render). Generous so
 *  a busy queue or a slow GPT render doesn't abort a bake mid-way. */
const AI_STEP_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_MS = 3000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Starting image for a bake: favorite render > latest render > original. */
function baseImage(photo: PhotoRow, fromOriginal = false): string | null {
  // A full-pipeline bake (an 'ai' step is present) regenerates from scratch, so
  // it must start from the true source — NOT the already-edited favorite, which
  // would double-apply the AI look. Deterministic-only bakes keep starting from
  // the favorite to burn the live grade into the curated output.
  if (fromOriginal && photo.original_path && existsSync(photo.original_path)) {
    return photo.original_path;
  }
  if (photo.favorite_version_id != null) {
    const fav = db()
      .query<{ image_path: string }, [number]>(
        "SELECT image_path FROM versions WHERE id = ?",
      )
      .get(photo.favorite_version_id);
    if (fav?.image_path && existsSync(fav.image_path)) return fav.image_path;
  }
  const latest = db()
    .query<{ image_path: string }, [string]>(
      "SELECT image_path FROM versions WHERE photo_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(photo.id);
  if (latest?.image_path && existsSync(latest.image_path)) return latest.image_path;
  if (photo.original_path && existsSync(photo.original_path)) return photo.original_path;
  return null;
}

/** Effective PromptConfig for an AI step: built-in default < settings default <
 *  photo override < the step's own config < photo extra_instructions (freeform).
 *  Mirrors index.ts effectiveConfig+withExtra without importing them (avoids a
 *  circular dependency with the route module). */
function configForAiStep(photo: PhotoRow, stepConfig: Partial<PromptConfig> | undefined): PromptConfig {
  const base = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  const withPhoto = mergeConfig(base, parsePartialConfig(photo.config_override));
  const withStep = mergeConfig(withPhoto, stepConfig ?? null);
  const extra = photo.extra_instructions?.trim();
  if (!extra) return withStep;
  const freeform = [withStep.freeform?.trim(), extra].filter(Boolean).join(". ");
  return { ...withStep, freeform };
}

/** Poll a job to completion. Resolves with the produced version's image path. */
async function waitForJob(
  jobId: number,
  timeoutMs: number,
): Promise<{ ok: boolean; imagePath?: string; versionId?: number; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const j = db()
      .query<{ status: string; result_version_id: number | null; error: string | null }, [number]>(
        "SELECT status, result_version_id, error FROM jobs WHERE id = ?",
      )
      .get(jobId);
    if (!j) return { ok: false, error: "job disappeared" };
    if (j.status === "done") {
      const v = j.result_version_id
        ? db()
            .query<{ image_path: string }, [number]>(
              "SELECT image_path FROM versions WHERE id = ?",
            )
            .get(j.result_version_id)
        : null;
      if (!v?.image_path || !existsSync(v.image_path)) {
        return { ok: false, error: "job done but no output image" };
      }
      return { ok: true, imagePath: v.image_path, versionId: j.result_version_id ?? undefined };
    }
    if (j.status === "failed" || j.status === "cancelled") {
      return { ok: false, error: j.error ?? j.status };
    }
    await sleep(POLL_MS);
  }
  return { ok: false, error: "ai step timed out" };
}

function tmpPng(): string {
  return join(tmpdir(), `darkroom_bake_${randomBytes(6).toString("hex")}.png`);
}

/**
 * Bake the full color pipeline (deterministic + generative steps) into a single
 * committed version. Deterministic steps are run through color_grade.py; each
 * 'ai' step re-renders the working image through its provider (input_path
 * override → multi-pass). Consecutive deterministic steps are batched into one
 * grade pass. On success the baked image becomes the photo's favorite and the
 * per-photo display grade is disabled (the look is already baked in → no double
 * application).
 */
export async function bakePhoto(photoId: string): Promise<BakeResult> {
  const photo = db()
    .query<PhotoRow, [string]>("SELECT * FROM photos WHERE id = ?")
    .get(photoId);
  if (!photo) return { ok: false, photo_id: photoId, steps: [], error: "photo not found" };

  const grade = effectiveGrade(photo);
  const enabled = grade.steps.filter((s) => s.enabled);
  if (enabled.length === 0) {
    return { ok: false, photo_id: photoId, steps: [], error: "no enabled steps to bake" };
  }

  const hasAi = enabled.some((s) => s.type === "ai");
  const start = baseImage(photo, hasAi);
  if (!start) return { ok: false, photo_id: photoId, steps: [], error: "no source image" };

  const log: BakeStepLog[] = [];
  let working = start;
  // Buffer consecutive deterministic steps, flushing the group as one grade pass
  // whenever we hit an 'ai' step (or at the end).
  let pending: GradeStep[] = [];
  // Track the last AI pass: its committed version becomes the favorite in "live"
  // mode (see the tail), where trailing deterministic steps stay live instead of
  // being baked in.
  let aiRan = false;
  let lastAiVersionId: number | null = null;

  const wbGain = enabled.some(
    (s) => s.type === "white_balance" && s.params?.scene_match === true,
  )
    ? wbGainFor(photoId)
    : null;

  const flushGrade = (): boolean => {
    const det = deterministicSteps(pending);
    pending = [];
    if (det.length === 0) return true;
    const out = tmpPng();
    // Full resolution for a final export (maxWidth 0), lossless PNG.
    const ok = runGradeSteps(working, out, det, {
      maxWidth: 0,
      quality: 95,
      timeoutMs: 120000,
      wbGain,
    });
    log.push({
      index: log.length,
      type: det.map((s) => s.type).join("+"),
      kind: "grade",
      ok,
      detail: ok ? undefined : "color_grade.py failed",
    });
    if (ok) working = out;
    return ok;
  };

  for (const step of enabled) {
    if (step.type !== "ai") {
      pending.push(step);
      continue;
    }
    // Flush any deterministic steps accumulated before this AI pass.
    if (!flushGrade()) {
      return { ok: false, photo_id: photoId, steps: log, error: "grade step failed" };
    }
    const ap = (step.params ?? {}) as AiStepParams;
    const provider = ap.provider === "higgsfield" ? "higgsfield" : "chatgpt";
    const cfg = configForAiStep(photo, ap.config);
    const prompt = promptFor(cfg);
    const providerParams =
      provider === "higgsfield" && ap.provider_params
        ? JSON.stringify(ap.provider_params)
        : null;
    const job = enqueueJob(
      photoId,
      prompt,
      JSON.stringify(cfg),
      provider,
      providerParams,
      "edit",
      working, // multi-pass: edit the current working image, not the original
    );
    const res = await waitForJob(job.id, AI_STEP_TIMEOUT_MS);
    log.push({
      index: log.length,
      type: `ai:${provider}`,
      kind: "ai",
      ok: res.ok,
      detail: res.ok ? undefined : res.error,
    });
    if (!res.ok || !res.imagePath) {
      return { ok: false, photo_id: photoId, steps: log, error: res.error ?? "ai step failed" };
    }
    working = res.imagePath;
    aiRan = true;
    lastAiVersionId = res.versionId ?? null;
  }

  // LIVE model — an AI step ran: the AI output IS the favorite, and the trailing
  // deterministic steps stay LIVE (rendered on-the-fly by /graded) so the pipeline
  // remains editable instead of being frozen. We reuse the version the runner
  // already committed for the AI pass (no extra baked commit) and clear any
  // per-photo grade override so the photo follows the (editable) global grade.
  // NB: assumes the AI step is at the head of the chain (no deterministic steps
  // before it that would then be double-applied by the live grade) — true for the
  // current pipeline. Trailing deterministic steps are intentionally NOT baked.
  if (aiRan && lastAiVersionId != null) {
    db().run(
      "UPDATE photos SET favorite_version_id = ?, grade_override = NULL, updated_at = ? WHERE id = ?",
      [lastAiVersionId, Date.now(), photo.id],
    );
    return {
      ok: true,
      photo_id: photoId,
      version_id: lastAiVersionId,
      image_path: working,
      steps: log,
    };
  }

  // FREEZE model — deterministic-only pipeline (no AI step): flush the trailing
  // steps and commit a single baked final, disabling the grade so it serves as-is.
  if (!flushGrade()) {
    return { ok: false, photo_id: photoId, steps: log, error: "grade step failed" };
  }

  // Commit the baked image as a new version.
  const versionNumber = nextVersionNumber(photo.id);
  const photoGenDir = join(genDir(), photo.id);
  mkdirSync(photoGenDir, { recursive: true });
  const finalPath = join(photoGenDir, `v${String(versionNumber).padStart(2, "0")}.png`);
  copyFileSync(working, finalPath);

  const ins = db().run(
    `INSERT INTO versions
       (photo_id, version_number, image_path, prompt_used, config, provider, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'baked', 'generated', ?)`,
    [
      photo.id,
      versionNumber,
      finalPath,
      "baked pipeline",
      JSON.stringify({ baked: true, steps: grade.steps }),
      Date.now(),
    ],
  );
  const versionId = Number(ins.lastInsertRowid);

  // The look is baked in → disable the display grade for this photo so /graded
  // serves the baked image as-is (no double application), and adopt it as favorite.
  db().run(
    "UPDATE photos SET favorite_version_id = ?, grade_override = ?, updated_at = ? WHERE id = ?",
    [versionId, JSON.stringify({ enabled: false, steps: grade.steps }), Date.now(), photo.id],
  );

  return { ok: true, photo_id: photoId, version_id: versionId, image_path: finalPath, steps: log };
}
