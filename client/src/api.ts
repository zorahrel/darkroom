export type PhotoListItem = {
  id: string;
  original_ext: string;
  favorite_version_id: number | null;
  favorite_version_number: number | null;
  latest_version_id: number | null;
  latest_version_number: number | null;
  version_count: number;
  taken_at: number | null;
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
  | "composition" | "identity" | "time_of_day" | "textures"
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
  harmony: "off" | "subtle" | "strong";
  food: "off" | "enhance";
  time_of_day: "preserve" | "golden" | "blue" | "overcast" | "noon" | "tungsten";
  palette: "preserve" | "warm-earth" | "teal-orange" | "desaturated" | "high-saturation";
  contrast: "flat" | "natural" | "punchy";
  grain: "none" | "fine" | "visible";
  shadows: "natural" | "lifted" | "crushed";
  highlights: "preserve" | "warm-lift" | "cool-lift" | "muted" | "neutral";
  bloom: "off" | "subtle" | "glow" | "halation";
  dof: "preserve" | "shallow";
  skin_tones: "preserve" | "airy-lift" | "desaturate" | "saturate" | "porcelain";
  atmosphere: "preserve" | "clean" | "enhance" | "dreamy";
  cleanup: "off" | "minor" | "aggressive";
  preserve: PreserveKey[];
  exclude: ExcludeKey[];
  freeform?: string;
};

export type PhotoDetail = {
  photo: Photo;
  versions: Version[];
  effective_prompt: string;
  effective_config: PromptConfig;
  has_override: boolean;
  global_prompt: string;
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

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
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
  jobs: () => jsonFetch<JobsPayload>("/api/jobs"),
  cancelJob: (id: number) =>
    jsonFetch(`/api/jobs/${id}/cancel`, { method: "POST" }),
  markJobSeen: (id: number) =>
    jsonFetch<{ ok: boolean }>(`/api/jobs/${id}/seen`, { method: "POST" }),
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
    jsonFetch<{ copied: number; total: number; dir: string }>(
      "/api/export-favorites",
      { method: "POST" },
    ),
};

export function rawUrl(id: string, _ext?: string): string {
  // Canonical original URL: resolves the stored path server-side, so it works
  // for both imported originals and generated photos.
  return `/orig/${encodeURIComponent(id)}`;
}

export function thumbRawUrl(id: string, w?: number): string {
  const q = w ? `?w=${w}` : "";
  return `/thumb/raw/${encodeURIComponent(id)}${q}`;
}

export function genUrl(photoId: string, versionNumber: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  return `/gen/${encodeURIComponent(photoId)}/${filename}`;
}

export function thumbGenUrl(photoId: string, versionNumber: number, w?: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const q = w ? `?w=${w}` : "";
  return `/thumb/gen/${encodeURIComponent(photoId)}/${filename}${q}`;
}

export function orphanUrl(filename: string): string {
  return `/orphan/${encodeURIComponent(filename)}`;
}

export function thumbOrphanUrl(filename: string): string {
  return `/thumb/orphan/${encodeURIComponent(filename)}`;
}
