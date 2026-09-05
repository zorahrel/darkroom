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
  /** "Like": 1 = I keep it. A human choice about the photo, not the render. */
  picked: number;
  /** 1 = ChatGPT refuses it: it is not queued any more. */
  skipped: number;
  skip_reason: string | null;
  /** Title of the post this photo is the cover of, if it is. */
  cover_of?: string | null;
  /** Provider of the render shown: 'higgsfield' = master, anything else = web draft. */
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
export type ProjectKind = "photo" | "storyboard" | "video";

export type StudioProject = {
  id: string;
  name: string;
  root: string;
  /** The view you land on when opening the project. */
  kind: ProjectKind;
  /** The views switched on: a project can be photo AND storyboard AND video. */
  views: ProjectKind[];
  active: boolean;
  created_at: number;
  db_path: string;
  root_exists: boolean;
  stats: ProjectStats | null;
  /** Video projects only: the numbers that mean something for an edit. Null
   *  elsewhere. */
  video: { cuts: number; shots: number; duration: number } | null;
  error: string | null;
};

export type StudioOverview = {
  projects: StudioProject[];
  worker: {
    backend: string;
    browser_alive: boolean | null;
    runner: RunnerStatus;
    /** Paid backends only: how much it has cost so far, summed from the
     *  jobs. The remaining balance is not readable with a project key
     *  (403 "Missing scopes: api.usage.read"), so the spend is shown. */
    spend?: { usd: number; images: number; model: string; quality: string } | null;
    openai_key?: boolean | null;
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
  /** A warning if the build being served is older than the client sources. */
  stale_dist?: string | null;
  /** Grade conflicts that show up in the photos, not in the step list. */
  grade_warnings?: string[];
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
  /** The photo that dictates the post's colour: attached to every regeneration of it. */
  reference_photo_id: string | null;
  created_at: number;
  photo_count: number;
  /** How many will really go out: it excludes skipped photos (refused by
   *  ChatGPT, hence with no render). It diverges from photo_count when the post
   *  contains a photo that will never be published. */
  publishable_count?: number;
};

/** A carousel slide made of several photos (a collage). */
/** Compositions: all full-bleed, with no frames and no visible background. */
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

// ---- Progetti video -------------------------------------------------------
export type VideoTake = { take: string; frames: number; clip: string; poster: string; kept: boolean };
export type VideoShot = {
  id: string;
  prompt: string;
  takes: VideoTake[];
  /** The one that counts: the hand-set forcing if there is one, else the measured value. */
  intensity: number | null;
  measuredIntensity: number | null;
  manualIntensity: number | null;
  /** One line on what you see. Written by hand, or cropped from the prompt. */
  description: string | null;
  descriptionByHand: boolean;
  moto: number | null;
  detail: number | null;
  inEdit: number;
  kept: boolean;
  why: string | null;
  verdict: "tenuta" | "scartata" | null;
  judgedAt: number | null;
  problems: string[];
  /** Why it deserves to be looked at first. It is not a verdict. */
  suspect: string | null;
  /** Two halves of the same take share this: `z43_0` and `z43_1` -> `z43`. */
  origin: string;
  act: string | null;
  /** Second of the film it first appears at, null if it is not in the cut. */
  minute: number | null;
  /** EVERY time it enters the cut, in order. Empty if it is not cut in. */
  appearances: { t: number; dur: number; act: string | null }[];
  /** Why the planner excluded it, when it was not discarded by hand. */
  excluded: string | null;
};
export type VideoCut = {
  t: number; dur: number; bar: number; shot: string;
  soundIntensity: number; shotIntensity: number | null;
  speed: number; reversed: boolean;
  act: string | null; origin: string;
};
export type VideoAct = { da: number; a: number; name: string; t0: number; t1: number; why?: string };
export type VideoHeld = { bar: number; guarantee: string };
export type VideoAssets = { preview: string | null; reel: string | null; master: string | null };
export type GateRow = { n: string; text: string; ok: boolean | null };
export type VideoGate = {
  rows: GateRow[];
  outcome: "verde" | "rosso" | "sconosciuto";
  failed: string[];
  when: number | null;
  computing: boolean;
};
export type VideoRebuild = {
  active: boolean; log: string;
  startedAt: number | null; finishedAt: number | null; output: number | null;
};

/** A generation on the 3090. How long it takes depends on the parameters, not
 *  on the prompt: it is the card's memory that decides between 90 seconds and
 *  never. */
export type VideoJob = {
  id: number;
  shot: string;
  take: string;
  prompt: string;
  params: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  prompt_id: string | null;
  frames: number | null;
  log: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
};

/** The sound under the timeline: amplitude profile, measured beats, bar
 *  boundaries. `ready` is false until the peaks have been computed. */
export type VideoWave = {
  peaks: number[];
  beats: number[];
  bars: number[];
  duration: number;
  ready: boolean;
};

/** A note pinned to an instant of the cut. */
export type VideoMarker = { t: number; note: string };

/** What has been forced by hand over the derived plan. */
export type VideoOverrides = {
  pin: { bar: number; shot: string }[];
  duration: { bar: number; bars: number }[];
  discardedByHand: { shot: string; reason: string }[];
};

// ---- tool catalogue -------------------------------------------------------
// The shapes come from `server/tools.ts`, which is the source: here they are
// only declared in order to read them. If the two diverge, the server is
// right — this is the copy, not the original.

export type ToolArea =
  | "immagini" | "colore" | "qualita" | "libreria" | "racconto" | "montaggio" | "sistema";

export type Requirement = "generator" | "ffmpeg" | "moondream" | "comfy";

export type StartField = {
  name: string;
  label: string;
  kind: "text" | "long" | "number" | "folder";
  placeholder?: string;
  required?: boolean;
  fallback?: string | number;
  note?: string;
};

export type Start =
  | { mode: "open"; label: string; route: string; view: ProjectKind }
  | { mode: "new" | "now"; label: string; fields: StartField[]; note?: string };

export type Tool = {
  id: string;
  name: string;
  what: string;
  area: ToolArea;
  icon: string;
  views: ProjectKind[];
  api: string[];
  mcp: string[];
  needs: Requirement[];
  starters: Start[];
  /** Usable right now on this machine. */
  ready: boolean;
  /** What is missing, said as the gesture that fixes it. */
  missing: { requirement: Requirement; how: string }[];
};

export type Catalogue = {
  areas: { id: ToolArea; name: string; what: string }[];
  requirements: Record<Requirement, { ok: boolean; how: string }>;
  backend: string;
  tools: Tool[];
};

/** What happened when a tool was started, and where you land. */
export type StartOutcome = {
  ok: true;
  route: string;
  project: string;
  done: string;
  data?: unknown;
};
