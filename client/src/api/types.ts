/** Shapes returned by the Darkroom API, shared by every page. */

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
  /** "Mi piace": 1 = la tengo. Scelta umana sulla foto, non sul render. */
  picked: number;
  /** 1 = ChatGPT la rifiuta: non viene piu' accodata. */
  skipped: number;
  skip_reason: string | null;
  /** Titolo del post di cui questa foto e' la copertina, se lo e'. */
  cover_of?: string | null;
  /** Provider del render mostrato: 'higgsfield' = master, altro = bozza web. */
  shown_provider: string | null;
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
  white_balance: "preserve" | "neutral" | "neutral-strict" | "warm" | "cool";
  sky: "off" | "deep-blue" | "bright-airy" | "even-blue" | "deep-night";
  geometry: "off" | "straighten" | "correct";
  composition: "off" | "rebalance" | "recompose" | "wide-hero" | "hero-object" | "tunnel" | "tele-isolate";
  aspect_ratio: "preserve" | "1:1" | "4:5" | "5:4" | "3:2" | "2:3" | "16:9" | "9:16";
  harmony: "off" | "subtle" | "strong";
  food: "off" | "enhance" | "strict";
  time_of_day: "preserve" | "golden" | "blue" | "overcast" | "noon" | "tungsten";
  lighting: "preserve" | "dramatic-romantic" | "soft-directional" | "hard-directional" | "flat-even";
  palette: "preserve" | "warm-earth" | "teal-orange" | "desaturated" | "high-saturation";
  contrast: "flat" | "natural" | "punchy";
  grain: "none" | "fine" | "visible";
  shadows: "natural" | "lifted" | "crushed";
  highlights: "preserve" | "warm-lift" | "cool-lift" | "muted" | "neutral";
  bloom: "off" | "subtle" | "glow" | "halation";
  dof: "preserve" | "shallow" | "wide-open" | "deep-focus";
  camera: "off" | "adaptive" | "leica-m" | "fuji-x100" | "sony-a7-prime" | "hasselblad" | "ricoh-gr" | "contax-t2";
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
export type PhotoSource = {
  path: string;
  mode: "link" | "copy";
  added_at: number;
};

export type ImportSummary = {
  scanned: number;
  added: number;
  skipped: number;
  copied: number;
};

export type ProjectStats = {
  favorites: number;
  photos: number;
  versions: number;
  /** Photos that are storyboard panels — keeps the board reachable. */
  panels: number;
  queue: Record<string, number>;
  last_version_at: number | null;
};

/** What a project is for: it decides which views the UI offers. */
export type ProjectKind = "photo" | "storyboard";

export type StudioProject = {
  id: string;
  name: string;
  root: string;
  kind: ProjectKind;
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
  /** Avviso se il build servito e' piu' vecchio dei sorgenti del client. */
  stale_dist?: string | null;
};

export type GradeStepType =
  | "white_balance"
  | "levels"
  | "sakura"
  | "sky"
  | "bloom"
  | "lut"
  | "hsl"
  | "curve"
  | "split_tone"
  | "color"
  | "match"
  | "ai";

export type GradeStep = {
  id: string;
  type: GradeStepType;
  enabled: boolean;
  /** Restrict the step to night or day scenes. Undefined = always. */
  only?: "night" | "day";
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

// ---- Storyboard -----------------------------------------------------------

/** One panel of the board: a photo with an order, a duration and a cast. */
export type Panel = {
  id: string;
  sequence_index: number;
  duration_ms: number;
  scene_label: string | null;
  character_ids: string[];
  kind: "original" | "generated";
  favorite_version_id: number | null;
  version_count: number;
  /** Server-side path of the image this panel exports as; null = nothing yet. */
  image_path: string | null;
  updated_at: number;
};

export type Character = {
  id: string;
  name: string;
  reference_photo_id: string | null;
  description: string | null;
  created_at: number;
};

export type StoryboardSettings = {
  style: string;
  aspect_ratio: number;
  fps: number;
};

export type StoryboardPayload = {
  panels: Panel[];
  characters: Character[];
  settings: StoryboardSettings;
};

/** One shot to draw. */
export type Beat = {
  description: string;
  duration_ms?: number;
  scene_label?: string | null;
  character_ids?: string[];
};

export type StoryboardExport = {
  ok: true;
  path: string;
  dir: string;
  boards: number;
  skipped: string[];
};

// ---- Quality control ------------------------------------------------------

export type CheckKind = "pixel" | "vlm";
export type Verdict = "hit" | "clear" | "unsure" | "error";

/** One known way a render can come out wrong. */
export type FailureMode = {
  code: string;
  label: string;
  kind: CheckKind;
  question: string | null;
  negative_clause: string | null;
  threshold: number | null;
  gate_enabled: boolean;
  builtin: boolean;
  created_at: number;
};

export type CheckResult = {
  code: string;
  verdict: Verdict;
  detail: string | null;
};

export type VersionReport = {
  version_id: number;
  photo_id: string;
  version_number: number;
  checks: CheckResult[];
  hits: string[];
  unsure: string[];
  /** 0-10; 10 = nothing flagged. */
  score: number;
  checked_at: number;
};

export type FavoriteSuggestion = {
  photo_id: string;
  suggested_version_id: number | null;
  suggested_version_number: number | null;
  current_favorite_id: number | null;
  differs: boolean;
  reason: string;
  scores: { version_id: number; version_number: number; score: number; hits: string[] }[];
};

export type VerificationSummary = {
  checked_versions: number;
  total_versions: number;
  flagged_versions: number;
  by_code: { code: string; label: string; hits: number; checked: number; rate: number }[];
  trend: { from: number; to: number; versions: number; flagged: number; rate: number }[];
};

export type VerifyBatchStatus = {
  running: boolean;
  total: number;
  done: number;
  flagged: number;
  failed: number;
  current: string | null;
};

/** A post/carousel: an ordered subset of the gallery, ready to publish. */
export type Collection = {
  id: string;
  title: string;
  caption: string | null;
  position: number;
  /** Foto che detta il colore del post: allegata a ogni sua rigenerazione. */
  reference_photo_id: string | null;
  created_at: number;
  photo_count: number;
  /** Quante ne usciranno davvero: esclude le foto saltate (rifiutate da
   *  ChatGPT, quindi senza render). Diverge da photo_count quando il post
   *  contiene una foto che non verra' mai pubblicata. */
  publishable_count?: number;
};

/** Una slide del carosello composta da più foto (collage). */
/** Composizioni: tutte a pieno formato, senza cornici né fondo a vista. */
export type CollageMode = "hero" | "mosaic" | "grid" | "stack" | "split";

export type Collage = {
  id: string;
  collection_id: string;
  mode: CollageMode;
  layout: string;
  position: number;
  created_at: number;
  photo_ids: string[];
};

/** Every collection plus its member photo ids, in order, keyed by collection id. */
export type CollectionsPayload = {
  collections: Collection[];
  photos: Record<string, string[]>;
  collages: Collage[];
};
