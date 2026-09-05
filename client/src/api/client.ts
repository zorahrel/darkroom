import { jsonFetch } from "./http";
import type {
  VideoShot,
  VideoAct,
  VideoHeld,
  VideoGate,
  VideoRebuild,
  VideoJob,
  VideoWave,
  VideoMarker,
  VideoOverrides,
  VideoCut,
  VideoAssets,
  BakeResult,
  ImportSummary,
  PhotoSource,
  ProjectKind,
  FailureMode,
  FavoriteSuggestion,
  VerificationSummary,
  VerifyBatchStatus,
  VersionReport,
  Beat,
  Character,
  Collage,
  Collection,
  CollectionsPayload,
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
  PhotoDetail,
  PhotoListItem,
  PipelineStatus,
  Preset,
  PromptConfig,
  Run,
  RunPhoto,
  StudioOverview,
  StudioProject,
  Catalogue,
  StartOutcome,
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
  // A name is enough; everything else is optional.
  studioAddProject: (input: {
    name: string;
    kind?: ProjectKind;
    views?: ProjectKind[];
    root?: string;
    photos?: { path: string; mode?: "link" | "copy" };
  }) =>
    jsonFetch<{ project: StudioProject; summary: ImportSummary | null }>("/api/studio/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Forget a project: registry only — the folder and its work stay on disk. */
  studioRemoveProject: (pid: string) =>
    jsonFetch<{ ok: true; project: StudioProject }>(
      `/api/studio/projects/${encodeURIComponent(pid)}`,
      { method: "DELETE" },
    ),
  studioPatchProject: (pid: string, patch: { name?: string; active?: boolean; kind?: ProjectKind; views?: ProjectKind[] }) =>
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
  // Photo sources of the active project: folders linked in place, or copied.
  sources: () => jsonFetch<{ sources: PhotoSource[] }>("/api/sources"),
  addSource: (path: string, mode: "link" | "copy" = "link") =>
    jsonFetch<{ source: PhotoSource; summary: ImportSummary; sources: PhotoSource[] }>(
      "/api/sources",
      { method: "POST", body: JSON.stringify({ path, mode }) },
    ),
  rescanSources: () =>
    jsonFetch<{ summary: ImportSummary; sources: PhotoSource[] }>("/api/sources/rescan", {
      method: "POST",
    }),
  removeSource: (path: string) =>
    jsonFetch<{ ok: true; sources: PhotoSource[] }>("/api/sources", {
      method: "DELETE",
      body: JSON.stringify({ path }),
    }),
  // Quality control: the gate reports, the user decides.
  failureModes: () => jsonFetch<{ modes: FailureMode[] }>("/api/verify/modes"),
  setFailureMode: (input: Partial<FailureMode> & { code: string }) =>
    jsonFetch<{ mode: FailureMode }>("/api/verify/modes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteFailureMode: (code: string) =>
    jsonFetch<{ ok: true; modes: FailureMode[] }>(
      `/api/verify/modes/${encodeURIComponent(code)}`,
      { method: "DELETE" },
    ),
  versionReport: (versionId: number) =>
    jsonFetch<{ report: VersionReport | null }>(`/api/verify/versions/${versionId}`),
  checkVersion: (versionId: number, only?: string[]) =>
    jsonFetch<{ report: VersionReport }>(`/api/verify/versions/${versionId}`, {
      method: "POST",
      body: JSON.stringify({ only }),
    }),
  photoReports: (photoId: string) =>
    jsonFetch<{ reports: VersionReport[]; suggestion: FavoriteSuggestion }>(
      `/api/verify/photos/${encodeURIComponent(photoId)}`,
    ),
  checkPhoto: (photoId: string) =>
    jsonFetch<{ reports: VersionReport[]; suggestion: FavoriteSuggestion }>(
      `/api/verify/photos/${encodeURIComponent(photoId)}`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  verificationSummary: () =>
    jsonFetch<{ summary: VerificationSummary }>("/api/verify/summary"),
  verifyBatch: (limit = 100, recheck = false) =>
    jsonFetch<{ started: number }>("/api/verify/batch", {
      method: "POST",
      body: JSON.stringify({ limit, recheck }),
    }),
  verifyBatchStatus: () => jsonFetch<VerifyBatchStatus>("/api/verify/batch"),
  /** "Mi piace" su una foto: un click nella griglia. */
  setPicked: (id: string, picked: boolean) =>
    jsonFetch<{ ok: true; picked: boolean }>(
      `/api/photos/${encodeURIComponent(id)}/picked`,
      { method: "PUT", body: JSON.stringify({ picked }) },
    ),
  // Collections (posts/caroselli): the publishing grouping over the gallery.
  collections: () => jsonFetch<CollectionsPayload>("/api/collections"),
  createCollection: (input: {
    id?: string;
    title: string;
    caption?: string;
    photo_ids?: string[];
  }) =>
    jsonFetch<{ ok: true; id: string }>("/api/collections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCollection: (
    id: string,
    patch: Partial<Pick<Collection, "title" | "caption" | "position" | "reference_photo_id">>,
  ) =>
    jsonFetch<{ ok: true }>(`/api/collections/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCollection: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/collections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  setCollectionPhotos: (id: string, photoIds: string[]) =>
    jsonFetch<{ ok: true; count: number }>(
      `/api/collections/${encodeURIComponent(id)}/photos`,
      { method: "PUT", body: JSON.stringify({ photo_ids: photoIds }) },
    ),
  /** Porta una foto in testa al post: un click invece del drag. */
  setCover: (collectionId: string, photoId: string) =>
    jsonFetch<{ ok: true; cover: string }>(
      `/api/collections/${encodeURIComponent(collectionId)}/cover`,
      { method: "POST", body: JSON.stringify({ photo_id: photoId }) },
    ),
  /** Append photos to a collection, or pull them out of every one (null). */
  assignToCollection: (photoIds: string[], collectionId: string | null) =>
    jsonFetch<{ ok: true; moved: number; collection_id: string | null }>(
      "/api/collections/assign",
      {
        method: "POST",
        body: JSON.stringify({ photo_ids: photoIds, collection_id: collectionId }),
      },
    ),
  // Collage: raggruppa più foto di un post in una sola slide.
  createCollage: (
    collectionId: string,
    input: { photo_ids: string[]; mode?: Collage["mode"]; layout?: string },
  ) =>
    jsonFetch<{ ok: true; id: string }>(
      `/api/collections/${encodeURIComponent(collectionId)}/collages`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateCollage: (
    id: string,
    patch: Partial<Pick<Collage, "mode" | "layout" | "photo_ids">>,
  ) =>
    jsonFetch<{ ok: true }>(`/api/collages/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCollage: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/collages/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importTemplate: (filename: string, text: string, save = false) =>
    jsonFetch<ImportTemplateResult>("/api/templates/import", {
      method: "POST",
      body: JSON.stringify({ filename, text, save }),
    }),

  // ---- Progetti video ----------------------------------------------------
  videoShots: () => jsonFetch<{ shots: VideoShot[] }>("/api/video/shots"),
  videoCuts: () =>
    jsonFetch<{
      cuts: VideoCut[]; duration: number; bpm: number | null;
      acts: VideoAct[]; held: VideoHeld[];
    }>("/api/video/cuts"),
  videoAssets: () => jsonFetch<VideoAssets>("/api/video/assets"),
  videoWave: () => jsonFetch<VideoWave>("/api/video/wave"),
  videoIntensity: (shot: string, value: number | null) =>
    jsonFetch<{ ok: true; shots: VideoShot[] }>("/api/video/intensity", {
      method: "POST", body: JSON.stringify({ shot, value }),
    }),
  videoDescrizione: (shot: string, text: string) =>
    jsonFetch<{ ok: true; shots: VideoShot[] }>("/api/video/description", {
      method: "POST", body: JSON.stringify({ shot, text }),
    }),
  videoClearVerdict: (shot: string) =>
    jsonFetch<{ ok: true; shots: VideoShot[] }>("/api/video/clear-verdict", {
      method: "POST", body: JSON.stringify({ shot }),
    }),
  videoSwap: (barA: number, shotA: string, barB: number, shotB: string) =>
    jsonFetch<{ pin: Record<string, string> }>("/api/video/swap", {
      method: "POST", body: JSON.stringify({ barA, shotA, barB, shotB }),
    }),
  videoSganciaPin: (bars: number[]) =>
    jsonFetch<{ pin: Record<string, string> }>("/api/video/unpin", {
      method: "POST", body: JSON.stringify({ bars }),
    }),
  videoOverrides: () => jsonFetch<VideoOverrides>("/api/video/overrides"),
  videoMarkers: () => jsonFetch<{ markers: VideoMarker[] }>("/api/video/markers"),
  videoMarker: (t: number, note: string | null) =>
    jsonFetch<{ markers: VideoMarker[] }>("/api/video/marker", {
      method: "POST", body: JSON.stringify({ t, note }),
    }),
  videoRipresa: (shot: string, take: string, kept: boolean) =>
    jsonFetch<{ ok: boolean; shots: VideoShot[] }>("/api/video/ripresa", {
      method: "POST",
      body: JSON.stringify({ shot, take, kept }),
    }),
  videoProblem: (shot: string, text?: string, i?: number) =>
    jsonFetch<{ ok: boolean; shots: VideoShot[] }>("/api/video/problem", {
      method: "POST",
      body: JSON.stringify({ shot, text, i }),
    }),
  /** `kept: null` toglie il verdetto e riporta la ripresa a "mai giudicata". */
  videoPick: (shot: string, kept: boolean | null, why?: string) =>
    jsonFetch<{ ok: boolean; shots: VideoShot[] }>("/api/video/pick", {
      method: "POST",
      body: JSON.stringify({ shot, kept, why }),
    }),
  videoPin: (bar: number, shot: string | null) =>
    jsonFetch<{ ok: true }>("/api/video/pin", {
      method: "POST",
      body: JSON.stringify({ bar, shot }),
    }),
  videoDuration: (bar: number, bars: number | null) =>
    jsonFetch<{ ok: true }>("/api/video/durata", {
      method: "POST",
      body: JSON.stringify({ bar, bars }),
    }),
  videoGate: (force = false) =>
    jsonFetch<VideoGate>(`/api/video/gate${force ? "?force=1" : ""}`),
  videoRicostruisci: () =>
    jsonFetch<{ ok: true }>("/api/video/ricostruisci", { method: "POST" }),
  videoRebuild: () => jsonFetch<VideoRebuild>("/api/video/rebuild"),
  videoGenerazioni: () =>
    jsonFetch<{ jobs: VideoJob[]; default: Record<string, number | string> }>("/api/video/generations"),
  videoGenerate: (shot: string, prompt: string, take: string, params: Record<string, number | string>) =>
    jsonFetch<{ job: VideoJob }>("/api/video/generate", {
      method: "POST",
      body: JSON.stringify({ shot, prompt, take, params }),
    }),
  videoCancelGeneration: (id: number) =>
    jsonFetch<{ ok: boolean }>(`/api/video/generations/${id}/cancel`, { method: "POST" }),

  // ---- catalogo degli strumenti -------------------------------------------
  /** Cosa sa fare Darkroom e cosa di quello è pronto adesso. */
  tools: () => jsonFetch<Catalogue>("/api/tools"),
  /** I progetti che possono ospitare uno strumento (quelli con la vista giusta). */
  toolProjects: (id: string) =>
    jsonFetch<{ projects: StudioProject[] }>(`/api/tools/${encodeURIComponent(id)}/progetti`),
  /** Comincia uno strumento: fa il lavoro e risponde con la pagina dove andare. */
  startTool: (id: string, body: { project?: string; values?: Record<string, string | number> }) =>
    jsonFetch<StartOutcome>(`/api/tools/${encodeURIComponent(id)}/avvia`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
