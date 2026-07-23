export type PhotoListItem = {
  id: string;
  original_ext: string;
  favorite_version_id: number | null;
  favorite_version_number: number | null;
  latest_version_id: number | null;
  latest_version_number: number | null;
  version_count: number;
  taken_at: number | null;
  feedback: string | null;
};

export type Version = {
  id: number;
  photo_id: string;
  version_number: number;
  image_path: string;
  prompt_used: string;
  config?: string | null;
  provider?: string | null;
  provider_params?: string | null;
  credits?: number | null;
  source: "imported" | "generated";
  created_at: number;
};

export type Photo = {
  id: string;
  original_path: string;
  original_ext: string;
  favorite_version_id: number | null;
  custom_prompt: string | null;
  higgsfield_selection: string | null;
  extra_instructions: string | null;
  created_at: number;
  updated_at: number;
};

export type PreserveKey =
  | "composition" | "identity" | "faces_exact" | "time_of_day" | "textures"
  | "signs_text" | "color_balance" | "weather" | "cast_shadows"
  | "lighting_direction" | "nature_colors" | "natural_grain";

export type ExcludeKey =
  | "no_added_elements" | "no_smoothing" | "no_oversaturation"
  | "no_neon_flare" | "no_chromatic_vignette"
  | "no_motion_blur" | "no_orton" | "no_painterly"
  | "no_face_morph" | "no_new_objects";

export type PromptConfig = {
  preset: "cinematic" | "editorial" | "documentary" | "fine-art";
  film_stock: "none" | "portra-400" | "portra-800" | "cinestill-800t" | "ektar-100" | "fuji-400h";
  white_balance: "preserve" | "neutral" | "warm" | "cool";
  geometry: "off" | "straighten" | "correct";
  composition: "off" | "rebalance" | "recompose";
  aspect_ratio: "preserve" | "1:1" | "4:5" | "5:4" | "3:2" | "2:3" | "16:9" | "9:16";
  harmony: "off" | "subtle" | "strong";
  food: "off" | "enhance";
  time_of_day: "preserve" | "golden" | "blue" | "overcast" | "noon" | "tungsten";
  lighting: "preserve" | "dramatic-romantic" | "soft-directional" | "hard-directional" | "flat-even";
  palette: "preserve" | "warm-earth" | "teal-orange" | "desaturated" | "high-saturation";
  contrast: "flat" | "natural" | "punchy";
  grain: "none" | "fine" | "visible";
  shadows: "natural" | "lifted" | "crushed";
  highlights: "preserve" | "warm-lift" | "cool-lift" | "muted" | "neutral";
  bloom: "off" | "subtle" | "glow" | "halation";
  dof: "preserve" | "shallow";
  camera: "off" | "leica-m" | "fuji-x100" | "sony-a7-prime" | "hasselblad" | "ricoh-gr" | "contax-t2";
  drama: "off" | "clean" | "bold";
  skin_tones: "preserve" | "airy-lift" | "desaturate" | "saturate" | "porcelain";
  atmosphere: "preserve" | "clean" | "enhance" | "dreamy";
  cleanup: "off" | "minor" | "aggressive" | "aggressive-keep";
  detail: "off" | "restore-authentic" | "enhance";
  preserve: PreserveKey[];
  exclude: ExcludeKey[];
  /** "Direzione AI": hand the model art-director agency (decisive cleanup +
   *  bolder recompose toward an iconic frame). */
  art_direction?: boolean;
  freeform?: string;
};

export type PhotoDetail = {
  photo: Photo;
  versions: Version[];
  effective_prompt: string;
  effective_config: PromptConfig;
  has_override: boolean;
  global_prompt: string;
  /** Effective grade for this photo (per-photo override or the global). */
  effective_grade: ColorGrade;
  /** True if this photo has a dedicated grade override. */
  has_grade_override: boolean;
};

export type Job = {
  id: number;
  photo_id: string;
  prompt: string;
  provider?: "chatgpt" | "higgsfield";
  provider_params?: string | null;
  progress?: string | null;
  seen?: number;
  attempts?: number;
  first_started_at?: number | null;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  result_version_id: number | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export type RunnerStatus = {
  paused: boolean;
  paused_until: number | null;
  consecutive_timeouts: number;
};

export type JobsPayload = {
  summary: Record<string, number>;
  items: Job[];
  runner?: RunnerStatus;
};

export type HiggsfieldModelParam = {
  name: string;
  required?: string;
  type?: string;
  default?: string;
  options?: string[];
};

export type HiggsfieldModel = {
  id: string;
  name: string;
  provider_name: string;
  description: string;
  parameters: HiggsfieldModelParam[];
  aspect_ratios: string[];
  tags: string[];
};

export type HiggsfieldStatus = {
  configured: boolean;
  credits?: number;
  subscription_plan_type?: string;
  error?: string;
};

export type Orphan = {
  filename: string;
  source_path: string;
  assigned_photo_id: string | null;
  skipped: number;
  created_at: number;
};

export type Health = {
  browser: boolean;
  openclaw: boolean; // legacy alias
  cdp_url: string;
  hint: string | null;
};

// ---- Studio (multi-project overview) --------------------------------------
export type ProjectStats = {
  favorites: number;
  photos: number;
  versions: number;
  queue: Record<string, number>;
  last_version_at: number | null;
};

export type StudioProject = {
  id: string;
  name: string;
  root: string;
  active: boolean;
  created_at: number;
  db_path: string;
  root_exists: boolean;
  stats: ProjectStats | null;
  error: string | null;
};

export type StudioOverview = {
  projects: StudioProject[];
  worker: {
    backend: string;
    browser_alive: boolean | null;
    runner: RunnerStatus;
  };
};

// ---- Active project (multi-project / Studio) ------------------------------
// The active project is taken from the URL path (`/p/:pid/...`) so links are
// shareable/bookmarkable and Back/Forward move between projects. It's sent on
// every API call via the `x-darkroom-project` header and appended as
// `?project=` to image URLs (which can't carry custom headers). No `/p/:pid`
// segment (e.g. `/studio`) = the server's default project.
export function currentProject(): string {
  if (typeof window === "undefined") return "";
  const m = window.location.pathname.match(/^\/p\/([^/]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

/** Remember the last-opened project so `/` can land back on it. */
export function rememberProject(pid: string): void {
  if (typeof localStorage === "undefined") return;
  if (pid) localStorage.setItem("darkroom.project", pid);
  else localStorage.removeItem("darkroom.project");
}

/** Last-opened project (for the `/` landing redirect / Studio highlight). */
export function lastProject(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem("darkroom.project") || "";
}

/** Append the active project as a query param (for <img> URLs). */
function pq(url: string): string {
  const p = currentProject();
  if (!p) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}project=${encodeURIComponent(p)}`;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const p = currentProject();
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(p ? { "x-darkroom-project": p } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => jsonFetch<Health>("/api/health"),
  listPhotos: (filter: string = "all") =>
    jsonFetch<{ photos: PhotoListItem[] }>(
      `/api/photos?filter=${encodeURIComponent(filter)}`,
    ),
  getPhoto: (id: string) =>
    jsonFetch<PhotoDetail>(`/api/photos/${encodeURIComponent(id)}`),
  setFavorite: (id: string, version_id: number | null) =>
    jsonFetch(`/api/photos/${encodeURIComponent(id)}/favorite`, {
      method: "PUT",
      body: JSON.stringify({ version_id }),
    }),
  setPrompt: (id: string, prompt: string | null) =>
    jsonFetch(`/api/photos/${encodeURIComponent(id)}/prompt`, {
      method: "PUT",
      body: JSON.stringify({ prompt }),
    }),
  setExtraInstructions: (id: string, extra: string | null) =>
    jsonFetch(`/api/photos/${encodeURIComponent(id)}/extra`, {
      method: "PUT",
      body: JSON.stringify({ extra }),
    }),
  setFeedback: (id: string, feedback: string | null) =>
    jsonFetch<{ ok: boolean; feedback: string | null }>(
      `/api/photos/${encodeURIComponent(id)}/feedback`,
      {
        method: "PUT",
        body: JSON.stringify({ feedback }),
      },
    ),
  deleteVersion: (id: string, vid: number) =>
    jsonFetch(
      `/api/photos/${encodeURIComponent(id)}/versions/${vid}`,
      { method: "DELETE" },
    ),
  generate: (id: string) =>
    jsonFetch<{ job: Job }>(
      `/api/photos/${encodeURIComponent(id)}/generate`,
      { method: "POST" },
    ),
  generateMissing: () =>
    jsonFetch<{ enqueued: number }>("/api/generate-missing", {
      method: "POST",
    }),
  generateNew: (prompt: string, count = 1) =>
    jsonFetch<{ created: number; ids: string[] }>("/api/generate-new", {
      method: "POST",
      body: JSON.stringify({ prompt, count }),
    }),
  reindexTimes: () =>
    jsonFetch<{ updated: number; missed: number; total: number }>(
      "/api/photos/reindex-times",
      { method: "POST" },
    ),
  getGlobalPrompt: () => jsonFetch<{ prompt: string }>("/api/settings/global-prompt"),
  setGlobalPrompt: (prompt: string) =>
    jsonFetch("/api/settings/global-prompt", {
      method: "PUT",
      body: JSON.stringify({ prompt }),
    }),
  getDefaultConfig: () =>
    jsonFetch<{ config: PromptConfig; prompt: string }>("/api/settings/default-config"),
  setDefaultConfig: (config: PromptConfig) =>
    jsonFetch<{ ok: true; config: PromptConfig; prompt: string }>(
      "/api/settings/default-config",
      { method: "PUT", body: JSON.stringify({ config }) },
    ),
  setPhotoConfig: (id: string, config: PromptConfig | null) =>
    jsonFetch(`/api/photos/${encodeURIComponent(id)}/config`, {
      method: "PUT",
      body: JSON.stringify({ config }),
    }),
  setPhotoGrade: (id: string, grade: ColorGrade | null) =>
    jsonFetch<{ ok: true; effective?: ColorGrade; cleared?: boolean }>(
      `/api/photos/${encodeURIComponent(id)}/grade`,
      { method: "PUT", body: JSON.stringify({ grade }) },
    ),
  higgsfieldStatus: () =>
    jsonFetch<HiggsfieldStatus>("/api/higgsfield/status"),
  higgsfieldModels: () =>
    jsonFetch<{ models: HiggsfieldModel[] }>("/api/higgsfield/models"),
  higgsfieldCost: (model: string, params: Record<string, string>) => {
    const q = new URLSearchParams({ model, ...params }).toString();
    return jsonFetch<{ cost: { credits: number; credits_exact: number } | null }>(
      `/api/higgsfield/cost?${q}`,
    );
  },
  generateHiggsfield: (
    id: string,
    model: string,
    params: Record<string, string>,
  ) =>
    jsonFetch<{ job: Job }>(
      `/api/photos/${encodeURIComponent(id)}/generate-higgsfield`,
      { method: "POST", body: JSON.stringify({ model, params }) },
    ),
  photoCounts: () =>
    jsonFetch<{ counts: Record<string, number> }>("/api/photos/counts"),
  jobs: () => jsonFetch<JobsPayload>("/api/jobs"),
  cancelJob: (id: number) =>
    jsonFetch(`/api/jobs/${id}/cancel`, { method: "POST" }),
  markJobSeen: (id: number) =>
    jsonFetch<{ ok: boolean }>(`/api/jobs/${id}/seen`, { method: "POST" }),
  markAllFailedSeen: () =>
    jsonFetch<{ ok: true; dismissed: number }>("/api/jobs/seen-failed", {
      method: "POST",
    }),
  photoJobs: (id: string) =>
    jsonFetch<{ jobs: Job[] }>(
      `/api/photos/${encodeURIComponent(id)}/jobs`,
    ),
  orphans: () => jsonFetch<{ orphans: Orphan[] }>("/api/orphans"),
  assignOrphan: (filename: string, photo_id: string) =>
    jsonFetch(
      `/api/orphans/${encodeURIComponent(filename)}/assign`,
      { method: "POST", body: JSON.stringify({ photo_id }) },
    ),
  skipOrphan: (filename: string) =>
    jsonFetch(`/api/orphans/${encodeURIComponent(filename)}/skip`, {
      method: "POST",
    }),
  exportFavorites: () =>
    jsonFetch<{ copied: number; total: number; dir: string; graded: boolean }>(
      "/api/export-favorites",
      { method: "POST" },
    ),
  getColorGrade: () =>
    jsonFetch<{ grade: ColorGrade }>("/api/settings/color-grade"),
  setColorGrade: (grade: ColorGrade) =>
    jsonFetch<{ ok: true; grade: ColorGrade }>("/api/settings/color-grade", {
      method: "PUT",
      body: JSON.stringify({ grade }),
    }),
  luts: () => jsonFetch<{ luts: Lut[]; current: ColorGrade }>("/api/luts"),
  pipelineStatus: () => jsonFetch<PipelineStatus>("/api/pipeline/status"),
  pipelineRegenerate: () =>
    jsonFetch<{ queued: number; jobs: number[] }>("/api/pipeline/regenerate", {
      method: "POST",
    }),
  pipelinePromoteLatest: () =>
    jsonFetch<{ promoted: number }>("/api/pipeline/promote-latest", {
      method: "POST",
    }),
  bake: (id: string) =>
    jsonFetch<BakeResult>(`/api/pipeline/bake/${id}`, { method: "POST" }),
  bakeFavorites: () =>
    jsonFetch<{ started: number }>("/api/pipeline/bake-favorites", { method: "POST" }),
  bakeStatus: () => jsonFetch<BakeStatus>("/api/pipeline/bake-status"),
  runs: () => jsonFetch<{ runs: Run[] }>("/api/runs"),
  runPhotos: (id: number) =>
    jsonFetch<{ photos: RunPhoto[] }>(`/api/runs/${id}/photos`),
  // Studio: cross-project overview + registry management.
  studioProjects: () => jsonFetch<StudioOverview>("/api/studio/projects"),
  studioAddProject: (input: { id: string; name?: string; root: string }) =>
    jsonFetch<{ project: StudioProject }>("/api/studio/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  studioPatchProject: (pid: string, patch: { name?: string; active?: boolean }) =>
    jsonFetch<{ project: StudioProject }>(
      `/api/studio/projects/${encodeURIComponent(pid)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  // Presets / templates
  presets: () => jsonFetch<{ presets: Preset[] }>("/api/presets"),
  createPreset: (name: string, grade: ColorGrade) =>
    jsonFetch<{ ok: true; preset: Preset }>("/api/presets", {
      method: "POST",
      body: JSON.stringify({ name, grade }),
    }),
  renamePreset: (id: number, name: string) =>
    jsonFetch<{ ok: true; preset: Preset }>(`/api/presets/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  deletePreset: (id: number) =>
    jsonFetch<{ ok: true }>(`/api/presets/${id}`, { method: "DELETE" }),
  importTemplate: (filename: string, text: string, save = false) =>
    jsonFetch<ImportTemplateResult>("/api/templates/import", {
      method: "POST",
      body: JSON.stringify({ filename, text, save }),
    }),
};

export type Preset = {
  id: number;
  name: string;
  grade: ColorGrade;
  source: string;
  created_at: number;
};

export type ImportTemplateResult = {
  ok: true;
  grade: ColorGrade;
  name: string;
  notes: string[];
  preset: Preset | null;
};

export type Run = {
  id: number;
  from: number;
  to: number;
  versions: number;
  photos: number;
};

export type RunPhoto = {
  id: string;
  version_number: number;
  taken_at: number | null;
};

export type PipelineStatus = {
  generation: {
    config: Record<string, unknown>;
    prompt: string;
    film_stock: string;
    contrast: string;
    shadows: string;
    grain: string;
    white_balance: string;
    palette: string;
    composition: string;
    aspect_ratio: string;
    lighting: string;
    cleanup: string;
    detail: string;
    freeform: string;
  };
  grade: ColorGrade;
  favorites: number;
  queue: Record<string, number>;
};

export type GradeStepType =
  | "white_balance"
  | "levels"
  | "sakura"
  | "sky"
  | "lut"
  | "hsl"
  | "curve"
  | "split_tone"
  | "color"
  | "ai";

export type GradeStep = {
  id: string;
  type: GradeStepType;
  enabled: boolean;
  /** Scalars for deterministic steps; for an 'ai' step: { provider, config }. */
  params: Record<string, unknown>;
};

/** Params of an 'ai' (generative) step. */
export type AiStepParams = {
  provider: "chatgpt" | "higgsfield";
  config: Partial<PromptConfig>;
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

export type BakeStatus = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current: string | null;
};

/** The color pipeline = ordered list of steps (WB · levels · sakura · LUT · color). */
export type ColorGrade = {
  enabled: boolean;
  steps: GradeStep[];
};

export type Lut = { id: string; name: string; group: string };

/** LUT id (relative to LUT_DIR) used as the default for a fresh LUT step —
 *  kept in sync with the server's defaultSteps(). */
export const DEFAULT_LUT = "CMG SUMMER 17 LUT/CMG SUMMER LUT '18.cube";

/** Full built-in config, mirrors the server DEFAULT_CONFIG. Seeds a fresh 'ai'
 *  step so PromptBuilder always edits a complete config. */
export const DEFAULT_CONFIG: PromptConfig = {
  preset: "cinematic",
  film_stock: "none",
  white_balance: "preserve",
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
  lut: "LUT",
  hsl: "HSL / Colore",
  curve: "Curva",
  split_tone: "Split Tone",
  color: "Color (finale)",
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

// Addable pipeline steps. "ai" = edit generativo (primo step della pipeline
// completa): editabile, riordinabile, saltato dal display live, eseguito nel
// bake multi-pass. Gli altri sono deterministici e applicati al volo su /graded.
export const STEP_ORDER: GradeStepType[] = [
  "ai",
  "white_balance",
  "levels",
  "sakura",
  "lut",
  "sky",
  "hsl",
  "curve",
  "split_tone",
  "color",
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
  sakura: {},
  sky: { amount: 40 },
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

/** URL of a generation with the global color look applied on the fly.
 *  `bust` changes when grade settings change, to defeat the browser cache. */
export function gradedUrl(
  photoId: string,
  versionNumber: number,
  w?: number,
  bust?: string | number,
): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const params = new URLSearchParams();
  if (w) params.set("w", String(w));
  if (bust !== undefined) params.set("b", String(bust));
  const q = params.toString();
  return pq(`/graded/${encodeURIComponent(photoId)}/${filename}${q ? "?" + q : ""}`);
}

// Like gradedUrl but overlays an UNSAVED grade passed as a JSON blob in `g`, so
// a preview can render the current step values before they're persisted. The
// server caches per (steps,wbGain,width), so a grade already seen is instant.
export function gradedPreviewUrl(
  photoId: string,
  versionNumber: number,
  grade: ColorGrade,
  w?: number,
): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const p = new URLSearchParams();
  if (w) p.set("w", String(w));
  p.set("g", JSON.stringify(grade));
  return pq(`/graded/${encodeURIComponent(photoId)}/${filename}?${p.toString()}`);
}

export function rawUrl(id: string, _ext?: string): string {
  // Canonical original URL: resolves the stored path server-side, so it works
  // for both imported originals and generated photos.
  return pq(`/orig/${encodeURIComponent(id)}`);
}

export function thumbRawUrl(id: string, w?: number): string {
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/raw/${encodeURIComponent(id)}${q}`);
}

export function genUrl(photoId: string, versionNumber: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  return pq(`/gen/${encodeURIComponent(photoId)}/${filename}`);
}

export function thumbGenUrl(photoId: string, versionNumber: number, w?: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/gen/${encodeURIComponent(photoId)}/${filename}${q}`);
}

export function orphanUrl(filename: string): string {
  return pq(`/orphan/${encodeURIComponent(filename)}`);
}

export function thumbOrphanUrl(filename: string): string {
  return pq(`/thumb/orphan/${encodeURIComponent(filename)}`);
}
