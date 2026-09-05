/** Color-pipeline defaults mirrored from the server, plus step construction. */

import type { GradeStep, GradeStepType, PromptConfig } from "./types";

/** LUT id (relative to LUT_DIR) used as the default for a fresh LUT step —
 *  kept in sync with the server's defaultSteps(). */
export const DEFAULT_LUT = "CMG SUMMER 17 LUT/CMG SUMMER LUT '18.cube";

/** Full built-in config, mirrors the server DEFAULT_CONFIG. Seeds a fresh 'ai'
 *  step so PromptBuilder always edits a complete config. */
export const DEFAULT_CONFIG: PromptConfig = {
  preset: "cinematic",
  film_stock: "none",
  white_balance: "preserve",
  sky: "off",
  geometry: "correct",
  composition: "rebalance",
  aspect_ratio: "preserve",
  harmony: "off",
  food: "enhance",
  time_of_day: "preserve",
  lighting: "preserve",
  palette: "preserve",
  contrast: "punchy",
  grain: "none",
  shadows: "crushed",
  highlights: "warm-lift",
  bloom: "subtle",
  dof: "preserve",
  camera: "off",
  drama: "off",
  skin_tones: "airy-lift",
  atmosphere: "enhance",
  cleanup: "minor",
  detail: "off",
  preserve: [
    "identity", "faces_exact", "time_of_day", "textures",
    "cast_shadows", "lighting_direction", "nature_colors", "natural_grain",
  ],
  exclude: [
    "no_smoothing", "no_oversaturation", "no_neon_flare",
    "no_chromatic_vignette", "no_face_morph", "no_new_objects",
  ],
  art_direction: true,
  freeform: "",
};

export const STEP_LABELS: Record<GradeStepType, string> = {
  white_balance: "Bilanciamento bianco",
  levels: "Livelli",
  sakura: "Sakura",
  sky: "Cielo (celesti)",
  bloom: "Bloom (alone sulle luci)",
  lut: "LUT",
  hsl: "HSL / Colore",
  curve: "Curva",
  split_tone: "Split Tone",
  color: "Color (finale)",
  match: "Armonizza il post",
  ai: "Generazione AI",
};

// The 8 Lightroom HSL bands, in order, with a display label.
export const HSL_BANDS: { key: string; label: string }[] = [
  { key: "red", label: "Rosso" },
  { key: "orange", label: "Arancio" },
  { key: "yellow", label: "Giallo" },
  { key: "green", label: "Verde" },
  { key: "aqua", label: "Acqua" },
  { key: "blue", label: "Blu" },
  { key: "purple", label: "Viola" },
  { key: "magenta", label: "Magenta" },
];

// Addable pipeline steps. "ai" = generative edit (first step of the full
// pipeline): editable, reorderable, skipped by the live display, run in the
// multi-pass bake. The others are deterministic and applied on the fly on
// /graded.
export const STEP_ORDER: GradeStepType[] = [
  "ai",
  "white_balance",
  "levels",
  "sakura",
  "lut",
  "sky",
  "bloom",
  "hsl",
  "curve",
  "split_tone",
  "color",
  "match",
];

// Zeroed hue/sat/lum for every HSL band — the neutral starting point.
const HSL_ZERO: Record<string, number> = Object.fromEntries(
  ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"].flatMap((b) => [
    [`hue_${b}`, 0],
    [`sat_${b}`, 0],
    [`lum_${b}`, 0],
  ]),
);

const STEP_DEFAULTS: Record<GradeStepType, Record<string, unknown>> = {
  white_balance: { awb: true, scene_match: false },
  levels: { black: 0.4, white: 99.6 },
  sakura: { sat: 0, hue_shift: 0 },
  sky: { amount: 40, desat: 0, warm: 0 },
  bloom: { amount: 35, threshold: 68, radius: 14, knee: 2, gain: 1 },
  // The real parameters are computed by the server over the group: empty here.
  match: {},
  lut: { lut: DEFAULT_LUT, dose: 80, auto_dose: true, dose_night: 30 },
  hsl: { ...HSL_ZERO },
  curve: { shadows: 0, darks: 0, lights: 0, highlights: 0 },
  split_tone: {
    shadows_hue: 0, shadows_sat: 0,
    midtones_hue: 0, midtones_sat: 0,
    highlights_hue: 0, highlights_sat: 0,
    balance: 0,
  },
  color: {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    brightness: 0, temp: 0, tint: 0, saturation: 0, vibrance: 0,
  },
  ai: { provider: "chatgpt", config: { ...DEFAULT_CONFIG } },
};

let _stepSeq = 0;
/** New step of the given type with its default params. */
export function newStep(type: GradeStepType): GradeStep {
  return {
    id: `s${Date.now().toString(36)}_${(_stepSeq++).toString(36)}`,
    type,
    enabled: true,
    params: { ...STEP_DEFAULTS[type] },
  };
}
