import { jsonFetch } from "./http";
import type {
  BakeResult,
  Beat,
  Character,
  Panel,
  StoryboardExport,
  StoryboardPayload,
  StoryboardSettings,
  BakeStatus,
  ColorGrade,
  Health,
  HiggsfieldModel,
  HiggsfieldStatus,
  ImportTemplateResult,
  Job,
  JobsPayload,
  Lut,
  Orphan,
  Photo,
  PhotoDetail,
  PhotoListItem,
  PipelineStatus,
  Preset,
  PromptConfig,
  Run,
  RunPhoto,
  StudioOverview,
  StudioProject,
} from "./types";

/** Every REST endpoint the client calls, one method each. */
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
  // Storyboard: panels, cast, and the export Storyboarder opens.
  storyboard: () => jsonFetch<StoryboardPayload>("/api/storyboard"),
  setSequence: (ids: string[]) =>
    jsonFetch<{ ok: true; updated: number; skipped: string[]; panels: Panel[] }>(
      "/api/storyboard/sequence",
      { method: "PUT", body: JSON.stringify({ ids }) },
    ),
  addToSequence: (ids: string[]) =>
    jsonFetch<{ ok: true; added: number; panels: Panel[] }>("/api/storyboard/sequence/add", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  updatePanel: (
    id: string,
    patch: { duration_ms?: number; scene_label?: string | null; character_ids?: string[] },
  ) =>
    jsonFetch<{ panel: Panel }>(`/api/storyboard/panels/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  removePanel: (id: string) =>
    jsonFetch<{ ok: true; panels: Panel[] }>(
      `/api/storyboard/panels/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  createPanels: (beats: Beat[]) =>
    jsonFetch<{ ok: true; ids: string[]; enqueued: number; panels: Panel[] }>(
      "/api/storyboard/panels",
      { method: "POST", body: JSON.stringify({ beats }) },
    ),
  setCharacter: (input: {
    id?: string;
    name: string;
    reference_photo_id?: string | null;
    description?: string | null;
  }) =>
    jsonFetch<{ character: Character }>("/api/storyboard/characters", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteCharacter: (id: string) =>
    jsonFetch<{ ok: true; characters: Character[]; panels: Panel[] }>(
      `/api/storyboard/characters/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  setStoryboardSettings: (patch: Partial<StoryboardSettings>) =>
    jsonFetch<{ settings: StoryboardSettings }>("/api/storyboard/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  exportStoryboard: () =>
    jsonFetch<StoryboardExport>("/api/storyboard/export", { method: "POST" }),
  importTemplate: (filename: string, text: string, save = false) =>
    jsonFetch<ImportTemplateResult>("/api/templates/import", {
      method: "POST",
      body: JSON.stringify({ filename, text, save }),
    }),
};
