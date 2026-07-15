import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type PhotoDetail,
  type PromptConfig,
  type ColorGrade,
  type GradeStepType,
  type Lut,
  type Job,
  rawUrl,
  gradedPreviewUrl,
  gradedUrl,
  STEP_LABELS,
  STEP_ORDER,
  newStep,
} from "../api";
import VersionCarousel from "../components/VersionCarousel";
import { StepParams, stepSummary, groupLuts, isStepTouched } from "../components/StepEditor";
import PromptEditor from "../components/PromptEditor";
import PromptBuilder from "../components/PromptBuilder";
import HiggsfieldButton from "../components/HiggsfieldButton";
import PhotoJobsLog from "../components/PhotoJobsLog";
import PresetsPanel from "../components/PresetsPanel";
import { useDebouncedImage } from "../lib/useDebouncedImage";
import EditorShell, { type ToolGroup, type AddableStep } from "../components/mobile/EditorShell";
import {
  StepIcon,
  IconChevronLeft,
  IconRefresh,
  IconBookmark,
  IconClose,
  IconLayers,
  IconUndo,
  IconRedo,
  IconDownload,
} from "../components/mobile/icons";
import { useHistory } from "../lib/useHistory";

export default function DetailPage() {
  const { pid, id } = useParams<{ pid: string; id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const base = pid ? `/p/${pid}` : "";
  const [data, setData] = useState<PhotoDetail | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [allIds, setAllIds] = useState<string[]>([]);
  const [latestJob, setLatestJob] = useState<Job | null>(null);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [luts, setLuts] = useState<Lut[]>([]);

  useEffect(() => {
    api.luts().then((r) => setLuts(r.luts)).catch(() => {});
  }, []);

  const initedRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!id) return;
    const d = await api.getPhoto(id);
    setData(d);
    const favIdx = d.photo.favorite_version_id
      ? d.versions.findIndex((v) => v.id === d.photo.favorite_version_id)
      : -1;
    const lastIdx = Math.max(0, d.versions.length - 1);
    if (initedRef.current !== id) {
      // First load of this photo: honor ?v=<version_number> deep-link,
      // else prefer the favorite, else the newest version.
      initedRef.current = id;
      const vParam = searchParams.get("v");
      const vIdx = vParam
        ? d.versions.findIndex((v) => v.version_number === Number(vParam))
        : -1;
      setCurrentVersion(vIdx >= 0 ? vIdx : favIdx >= 0 ? favIdx : lastIdx);
    } else if (d.versions.length > prevCountRef.current) {
      // A new version was just generated → jump to it.
      setCurrentVersion(lastIdx);
    }
    prevCountRef.current = d.versions.length;
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Light polling: if there are running jobs for this photo, refresh
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const tick = async () => {
      try {
        const jobs = await api.jobs();
        const mine = jobs.items.filter((j) => j.photo_id === id);
        // Prefer an active job; otherwise the most recently created one.
        const active = mine.find(
          (j) => j.status === "pending" || j.status === "running",
        );
        const newest = mine.reduce<Job | null>(
          (acc, j) => (!acc || j.created_at > acc.created_at ? j : acc),
          null,
        );
        if (alive) {
          setLatestJob(active ?? newest);
          setPausedUntil(jobs.runner?.paused ? jobs.runner.paused_until : null);
        }
        const stillWorking = !!active;
        const hasFresh = mine.some(
          (j) =>
            j.status === "done" &&
            j.finished_at &&
            j.finished_at > (data?.photo.updated_at ?? 0),
        );
        if (stillWorking || hasFresh) {
          if (alive) refresh();
        }
      } catch {}
    };
    tick();
    const intv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(intv);
    };
  }, [id, data, refresh]);

  // Build a sibling ID list once for prev/next navigation
  useEffect(() => {
    api.listPhotos("all").then((r) => setAllIds(r.photos.map((p) => p.id)));
  }, []);

  const siblings = useMemo(() => {
    if (!id || allIds.length === 0)
      return { prev: null, next: null, index: -1, total: allIds.length };
    const idx = allIds.indexOf(id);
    if (idx < 0)
      return { prev: null, next: null, index: -1, total: allIds.length };
    return {
      prev: idx > 0 ? allIds[idx - 1] : null,
      next: idx < allIds.length - 1 ? allIds[idx + 1] : null,
      index: idx,
      total: allIds.length,
    };
  }, [id, allIds]);

  // Keyboard: g = generate, [ / ] = prev/next photo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }
      if (e.key === "g" || e.key === "G") {
        if (!generating) onGenerate();
      } else if ((e.key === "[" || e.key === "ArrowLeft") && siblings.prev) {
        navigate(`${base}/photo/${encodeURIComponent(siblings.prev)}`);
      } else if ((e.key === "]" || e.key === "ArrowRight") && siblings.next) {
        navigate(`${base}/photo/${encodeURIComponent(siblings.next)}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, siblings.prev, siblings.next, navigate]);

  if (!id) return null;
  if (!data) return <div className="py-20 text-center text-neutral-500">Carico…</div>;

  const { photo, versions, effective_prompt, global_prompt, effective_config, has_override } = data;
  const v = versions[currentVersion];
  const isFavorite = v ? v.id === photo.favorite_version_id : false;
  const hasOverride = photo.custom_prompt !== null;

  async function onGenerate() {
    setGenerating(true);
    try {
      await api.generate(photo.id);
      await refresh();
    } finally {
      setGenerating(false);
    }
  }

  // Version handlers — shared by the desktop "Generazioni" column and the mobile
  // editor's "Versioni" panel, so switch/favorite/delete behave identically.
  function onVersionChange(idx: number) {
    setCurrentVersion(idx);
    const vn = versions[idx]?.version_number;
    if (vn != null) {
      const next = new URLSearchParams(searchParams);
      next.set("v", String(vn));
      setSearchParams(next, { replace: true });
    }
  }
  async function onFavoriteToggle() {
    if (!v) return;
    await api.setFavorite(photo.id, isFavorite ? null : v.id);
    await refresh();
  }
  async function onDeleteVersion() {
    if (!v) return;
    await api.deleteVersion(photo.id, v.id);
    setCurrentVersion(0);
    await refresh();
  }

  const generateButtons = (
    <div className="flex items-center gap-2">
      <button
        onClick={onGenerate}
        disabled={generating}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 normal-case font-medium tracking-normal text-white"
      >
        <IconRefresh className="w-3.5 h-3.5" />
        {generating ? "Enqueue…" : "ChatGPT"}
      </button>
      <HiggsfieldButton
        photoId={photo.id}
        initialSelection={photo.higgsfield_selection}
        onEnqueued={refresh}
      />
    </div>
  );

  const versionCarousel = (
    <VersionCarousel
      versions={versions}
      current={Math.min(currentVersion, Math.max(0, versions.length - 1))}
      onChange={onVersionChange}
      isFavorite={isFavorite}
      beforeSrc={rawUrl(photo.id, photo.original_ext)}
      onFavoriteToggle={onFavoriteToggle}
      onDelete={onDeleteVersion}
    />
  );

  // On mobile the editor shell covers the page, so the generations move inside it
  // as a "Versioni" panel — nothing is lost behind the full-screen editor.
  const versionsPanel = (
    <div className="space-y-3">
      {generateButtons}
      {versionCarousel}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link to={base || "/"} className="text-sm text-neutral-400 hover:text-white">
          ← Indietro
        </Link>
        <span className="font-mono text-sm text-neutral-300">{photo.id}</span>
        <JobStatusBadge job={latestJob} />
        <div className="flex-1" />
        <div className="text-xs text-neutral-500 flex items-center gap-2">
          <button
            onClick={() =>
              siblings.prev &&
              navigate(`${base}/photo/${encodeURIComponent(siblings.prev)}`)
            }
            disabled={!siblings.prev}
            title={siblings.prev ?? undefined}
            className="w-7 h-7 rounded border border-neutral-700 hover:border-neutral-500 hover:text-white disabled:opacity-30 disabled:hover:border-neutral-700 flex items-center justify-center"
            aria-label="foto precedente"
          >
            ◀
          </button>
          <span className="tabular-nums text-neutral-300 min-w-[4.5rem] text-center">
            {siblings.index >= 0 ? siblings.index + 1 : "—"} / {siblings.total}
          </span>
          <button
            onClick={() =>
              siblings.next &&
              navigate(`${base}/photo/${encodeURIComponent(siblings.next)}`)
            }
            disabled={!siblings.next}
            title={siblings.next ?? undefined}
            className="w-7 h-7 rounded border border-neutral-700 hover:border-neutral-500 hover:text-white disabled:opacity-30 disabled:hover:border-neutral-700 flex items-center justify-center"
            aria-label="foto successiva"
          >
            ▶
          </button>
          <span className="ml-3 text-neutral-600 hidden md:inline">[g] genera · ←/→ o [/] foto</span>
        </div>
      </div>

      <JobStatusBanner pausedUntil={pausedUntil} />

      {/* Con una versione, l'editor a schermo intero (EditorShell) copre la
          pagina e mostra le generazioni nel gruppo "Versioni": qui nascondiamo
          Originale+Generazioni per non renderizzare due volte il carosello.
          Senza versione, resta visibile per poter generare. */}
      <div
        className={
          (versions.length > 0 ? "hidden" : "grid") +
          " grid-cols-1 lg:grid-cols-2 gap-4 items-start"
        }
      >
        {/* Original */}
        <div className="space-y-2">
          <div className="h-8 flex items-center text-xs uppercase tracking-wider text-neutral-500">
            Originale
          </div>
          <div className="aspect-square w-full rounded-lg overflow-hidden bg-black border border-neutral-800">
            <img
              src={rawUrl(photo.id, photo.original_ext)}
              alt={photo.id}
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Generations */}
        <div className="space-y-2">
          <div className="h-8 flex items-center text-xs uppercase tracking-wider text-neutral-500">
            <span>Generazioni</span>
            <div className="flex-1" />
            {generateButtons}
          </div>
          {versionCarousel}
        </div>
      </div>

      {/* Pipeline della foto: stessa grammatica della home (bookend colorati +
          StageConnector). Input = generazione ChatGPT · Step = colore locale.
          Un'unica anteprima sticky serve tutta la pipeline (hover-step incluso). */}
      <PhotoPipeline
        photoId={photo.id}
        versionNumber={v ? v.version_number : null}
        effectiveConfig={effective_config}
        hasConfigOverride={has_override}
        prompt={effective_prompt}
        extraInitial={photo.extra_instructions ?? ""}
        effectiveGrade={data.effective_grade}
        hasGradeOverride={data.has_grade_override}
        luts={luts}
        onSaved={refresh}
        onExit={() => navigate(base || "/")}
        mobileExtras={versionsPanel}
        photoNav={{
          prev: siblings.prev ?? null,
          next: siblings.next ?? null,
          index: siblings.index,
          total: siblings.total,
          onPrev: () =>
            siblings.prev &&
            navigate(`${base}/photo/${encodeURIComponent(siblings.prev)}`),
          onNext: () =>
            siblings.next &&
            navigate(`${base}/photo/${encodeURIComponent(siblings.next)}`),
        }}
      />

      {/* Con una versione l'editor a schermo intero copre la pagina: log job e
          legacy prompt restano solo quando non c'è ancora nulla da editare. */}
      {versions.length === 0 && (
        <>
          <PhotoJobsLog photoId={photo.id} />

          <details className="border border-neutral-800 rounded-lg">
            <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-500 hover:text-neutral-300">
              Legacy: prompt freeform raw (deprecato — usa la config sopra)
            </summary>
            <div className="p-3">
              <PromptEditor
                effective={global_prompt}
                global={global_prompt}
                hasOverride={hasOverride}
                onSave={async (next) => {
                  await api.setPrompt(photo.id, next);
                  await refresh();
                }}
                onResetToGlobal={async () => {
                  await api.setPrompt(photo.id, null);
                  await refresh();
                }}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

const JOB_STATUS_META: Record<
  Job["status"],
  { label: string; dot: string; chip: string }
> = {
  pending: {
    label: "In coda",
    dot: "bg-amber-400",
    chip: "bg-amber-900/40 text-amber-200 border-amber-800/60",
  },
  running: {
    label: "In corso",
    dot: "bg-blue-400 animate-pulse",
    chip: "bg-blue-900/40 text-blue-200 border-blue-800/60",
  },
  done: {
    label: "Completato",
    dot: "bg-emerald-400",
    chip: "bg-emerald-900/40 text-emerald-200 border-emerald-800/60",
  },
  failed: {
    label: "Fallito",
    dot: "bg-red-400",
    chip: "bg-red-900/40 text-red-200 border-red-800/60",
  },
  cancelled: {
    label: "Annullato",
    dot: "bg-neutral-500",
    chip: "bg-neutral-800 text-neutral-400 border-neutral-700",
  },
};

function JobStatusBadge({ job }: { job: Job | null }) {
  if (!job) return null;
  // Failures/cancellations are surfaced only in the Jobs log, never on the photo.
  if (job.status === "failed" || job.status === "cancelled") return null;
  const meta = JOB_STATUS_META[job.status];
  const running = job.status === "running" || job.status === "pending";
  // While active, show the granular step the worker reported.
  const label = running && job.progress ? job.progress : meta.label;
  const provider = job.provider === "higgsfield" ? "Higgsfield" : "ChatGPT";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border " +
        meta.chip
      }
    >
      <span className={"w-1.5 h-1.5 rounded-full " + meta.dot} />
      <span className="opacity-60">{provider}</span>
      {label}
    </span>
  );
}

function JobStatusBanner({
  pausedUntil,
}: {
  pausedUntil: number | null;
}) {
  // Errors are intentionally NOT shown here — they live only in the Jobs log.
  // This banner is reserved for queue-wide info (rate-limit pause).
  const showPaused = pausedUntil && pausedUntil > Date.now();
  if (!showPaused) return null;

  return (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      Coda in pausa (rate-limit ChatGPT) — riprende{" "}
      {new Date(pausedUntil!).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </div>
  );
}

function ExtraInstructionsCard({
  photoId,
  initial,
  onSaved,
}: {
  photoId: string;
  initial: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(initial), [initial, photoId]);

  const dirty = text.trim() !== initial.trim();

  return (
    <div className="space-y-2 border-t border-neutral-800/70 pt-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-neutral-300">
          Istruzioni extra per questa foto
        </div>
        {initial.trim() && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-200">
            attive
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-neutral-500">
          si sommano alla config, valgono solo qui
        </span>
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="es. 'raddrizza il cartello', 'togli il riflesso sul vetro', 'rendi il cielo meno slavato'"
        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-sm leading-relaxed focus:outline-none focus:border-neutral-600"
      />
      <div className="flex justify-end gap-2">
        {initial.trim() && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.setExtraInstructions(photoId, null);
                setText("");
                await onSaved();
              } finally {
                setSaving(false);
              }
            }}
            className="text-sm px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50"
          >
            Rimuovi
          </button>
        )}
        <button
          disabled={saving || !dirty}
          onClick={async () => {
            setSaving(true);
            try {
              await api.setExtraInstructions(photoId, text.trim() || null);
              await onSaved();
            } finally {
              setSaving(false);
            }
          }}
          className="text-sm px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50"
        >
          {saving ? "Salvo…" : "Salva"}
        </button>
      </div>
    </div>
  );
}

// La pipeline colore per LA SINGOLA foto: anteprima gradata live (tieni premuto
// per la base) + editor degli step in override dedicato. Salva → override
// per-foto; reset → torna al grade globale.
// L'intera pipeline della foto: un'unica anteprima sticky a sinistra (condivisa
// da TUTTI gli stage, guidata dall'hover-step del colore) e gli stage a destra
// nella stessa grammatica bookend della home — Input (viola) → Step (fucsia).
function PhotoPipeline({
  photoId,
  versionNumber,
  effectiveConfig,
  hasConfigOverride,
  prompt,
  extraInitial,
  effectiveGrade,
  hasGradeOverride,
  luts,
  onSaved,
  onExit,
  mobileExtras,
  photoNav,
}: {
  photoId: string;
  versionNumber: number | null;
  effectiveConfig: PromptConfig;
  hasConfigOverride: boolean;
  prompt: string;
  extraInitial: string;
  effectiveGrade: ColorGrade;
  hasGradeOverride: boolean;
  luts: Lut[];
  onSaved: () => Promise<unknown> | void;
  onExit: () => void;
  mobileExtras?: ReactNode;
  photoNav?: {
    prev: string | null;
    next: string | null;
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  // Stato del colore con undo/redo: `setDraft` registra la storia, i drag degli
  // slider collassano in un passo solo (coalescing nell'hook).
  const {
    state: draft,
    set: setDraft,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetHistory,
  } = useHistory<ColorGrade>(effectiveGrade);
  const [saving, setSaving] = useState(false);
  const [compare, setCompare] = useState(false);
  const [baking, setBaking] = useState(false);
  const [bakeMsg, setBakeMsg] = useState<string | null>(null);
  const hasAiStep = draft.steps.some((s) => s.enabled && s.type === "ai");
  const effSig = JSON.stringify(effectiveGrade);
  // Re-sync (and clear history) when the upstream effective grade changes,
  // e.g. after a save/reset/refresh — that becomes the new undo baseline.
  useEffect(() => resetHistory(effectiveGrade), [effSig, resetHistory]);

  // Undo/redo scorciatoie da tastiera (⌘Z / ⌘⇧Z), ignorate quando si scrive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Editor mobile a schermo intero (<lg): appena c'è una versione lo shell è
  // già lì sotto la foto (niente bottone d'ingresso). Le generazioni vivono in
  // un pannello "Versioni" dentro lo shell, così l'overlay non nasconde nulla.
  const lutGroups = useMemo(() => groupLuts(luts), [luts]);

  const hasVersion = versionNumber != null;
  const W = 720;
  const previewSrc = hasVersion
    ? gradedPreviewUrl(photoId, versionNumber, draft, W)
    : "";
  // Debounce + preload the graded preview so dragging a slider fires a few
  // renders (not one per pixel) and never flashes blank between frames.
  const { shown: previewShown } = useDebouncedImage(previewSrc || null, 150);
  const displaySrc = previewShown ?? previewSrc;
  const baseSrc = hasVersion
    ? `/thumb/gen/${encodeURIComponent(photoId)}/v${String(versionNumber).padStart(2, "0")}.png?w=${W}`
    : "";
  const dirty = JSON.stringify(draft) !== effSig;
  const showBase = compare || !draft.enabled;

  // Salva/bake/reset condivisi fra la action row desktop e la toolbar mobile.
  async function doSave() {
    setSaving(true);
    try {
      await api.setPhotoGrade(photoId, draft);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function doReset() {
    setSaving(true);
    try {
      await api.setPhotoGrade(photoId, null);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function doBake() {
    setBaking(true);
    setBakeMsg(hasAiStep ? "Bake in corso (step AI, può richiedere minuti)…" : "Bake…");
    try {
      const res = await api.bake(photoId);
      setBakeMsg(res.ok ? "Bake completato ✓" : `Bake fallito: ${res.error ?? "?"}`);
      if (res.ok) await onSaved();
    } catch (e) {
      setBakeMsg(`Bake fallito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBaking(false);
    }
  }
  // Esporta l'immagine gradata full-res della versione corrente (download).
  function doExport() {
    if (versionNumber == null) return;
    const a = document.createElement("a");
    a.href = gradedUrl(photoId, versionNumber, undefined, Date.now());
    a.download = `${photoId}-v${String(versionNumber).padStart(2, "0")}-graded.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function patchStepAt(idx: number, patch: Partial<ColorGrade["steps"][number]>) {
    setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === idx ? { ...s, ...patch } : s)) });
  }
  function patchParamsAt(idx: number, p: Record<string, unknown>) {
    setDraft({
      ...draft,
      steps: draft.steps.map((s, j) => (j === idx ? { ...s, params: { ...s.params, ...p } } : s)),
    });
  }
  function moveStepAt(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const next = draft.steps.slice();
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    setDraft({ ...draft, steps: next });
  }
  function removeStepAt(idx: number) {
    setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== idx) });
  }
  function addStep(type: GradeStepType) {
    setDraft({ ...draft, steps: [...draft.steps, newStep(type)] });
  }
  // Applica un preset come override di questa foto (poi si salva col pulsante Salva).
  function applyGrade(g: ColorGrade) {
    setDraft({ enabled: g.enabled, steps: g.steps });
  }

  // Toolbar mobile: "Genera" (la generazione ChatGPT, non uno step della catena)
  // + ogni step deterministico come chip riordinabile. Il pannello di ogni step
  // mostra SOLO i parametri; enable/riordino/rimuovi vivono nel suo header (step).
  const mobileGroups: ToolGroup[] = useMemo(() => {
    const groups: ToolGroup[] = [
      ...(mobileExtras
        ? [
            {
              id: "versioni",
              label: "Versioni",
              icon: <IconLayers />,
              render: () => <>{mobileExtras}</>,
            } satisfies ToolGroup,
          ]
        : []),
      {
        id: "preset",
        label: "Preset",
        icon: <IconBookmark />,
        render: () => (
          <PresetsPanel grade={draft} onApply={applyGrade} applyLabel="Applica alla foto" />
        ),
      },
      {
        id: "genera",
        label: "Genera",
        icon: <StepIcon type="ai" />,
        render: () => (
          <div className="space-y-4">
            <PhotoConfigCard
              photoId={photoId}
              config={effectiveConfig}
              hasOverride={hasConfigOverride}
              prompt={prompt}
              onSaved={onSaved}
            />
            <ExtraInstructionsCard photoId={photoId} initial={extraInitial} onSaved={onSaved} />
          </div>
        ),
      },
    ];
    let order = 0;
    draft.steps.forEach((s, idx) => {
      if (s.type === "ai") return;
      order += 1;
      groups.push({
        id: s.id,
        label: STEP_LABELS[s.type],
        icon: <StepIcon type={s.type} />,
        step: {
          order,
          enabled: s.enabled,
          onToggle: (v) => patchStepAt(idx, { enabled: v }),
          canUp: idx > 0,
          canDown: idx < draft.steps.length - 1,
          onMove: (dir) => moveStepAt(idx, dir),
          onRemove: () => removeStepAt(idx),
          onReset: isStepTouched(s)
            ? () => patchStepAt(idx, { params: newStep(s.type).params })
            : undefined,
          summary: stepSummary(s),
        },
        render: () =>
          s.enabled ? (
            <StepParams step={s} lutGroups={lutGroups} onParams={(p) => patchParamsAt(idx, p)} />
          ) : (
            <p className="text-sm text-neutral-500">
              Step disattivo. Attivalo dall'interruttore qui sopra per modificarne i parametri.
            </p>
          ),
      });
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, lutGroups, photoId, effectiveConfig, hasConfigOverride, prompt, extraInitial, onSaved, mobileExtras]);

  const addableSteps: AddableStep[] = STEP_ORDER.filter((t) => t !== "ai").map((t) => ({
    type: t,
    label: STEP_LABELS[t],
    icon: <StepIcon type={t} className="w-4 h-4" />,
  }));

  if (!hasVersion) {
    return (
      <div className="text-sm text-neutral-500">
        Genera una versione per attivare il grade colore.
      </div>
    );
  }

  return (
    <EditorShell
          title={
            photoNav && photoNav.index >= 0
              ? `${photoId} · ${photoNav.index + 1}/${photoNav.total}`
              : photoId
          }
          leftAction={
            <div className="flex items-center gap-0.5">
              <button
                onClick={onExit}
                className="p-1.5 rounded text-neutral-400 hover:text-white"
                aria-label="torna alla libreria"
              >
                <IconClose />
              </button>
              {photoNav && (
                <>
                  <button
                    onClick={photoNav.onPrev}
                    disabled={!photoNav.prev}
                    className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-30"
                    aria-label="foto precedente"
                  >
                    <IconChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={photoNav.onNext}
                    disabled={!photoNav.next}
                    className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-30"
                    aria-label="foto successiva"
                  >
                    <IconChevronLeft className="w-4 h-4 rotate-180" />
                  </button>
                </>
              )}
            </div>
          }
          rightAction={
            <div className="flex items-center gap-1.5">
              <button
                disabled={!canUndo}
                onClick={undo}
                aria-label="annulla"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-25"
              >
                <IconUndo />
              </button>
              <button
                disabled={!canRedo}
                onClick={redo}
                aria-label="ripristina"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-25"
              >
                <IconRedo />
              </button>
              {dirty && <span className="text-[10px] text-amber-400">•</span>}
              <button
                onClick={doExport}
                aria-label="esporta immagine gradata (full-res)"
                title="Esporta full-res"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white"
              >
                <IconDownload />
              </button>
              {hasGradeOverride && (
                <button
                  disabled={saving}
                  onClick={doReset}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 disabled:opacity-50"
                >
                  Reset
                </button>
              )}
              <button
                disabled={baking || dirty}
                onClick={doBake}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-violet-700 text-violet-200 disabled:opacity-50"
              >
                {baking ? "…" : "Bake"}
              </button>
              <button
                disabled={saving || !dirty}
                onClick={doSave}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white disabled:opacity-50"
              >
                {saving ? "…" : "Salva"}
              </button>
            </div>
          }
          master={{
            enabled: draft.enabled,
            onToggle: (val) => setDraft({ ...draft, enabled: val }),
            compare,
            onCompare: setCompare,
            info: bakeMsg ?? (hasGradeOverride ? "override locale" : "eredita il grade globale"),
          }}
          addable={addableSteps}
          onAdd={(t) => addStep(t as GradeStepType)}
          photo={
            <div
              className="absolute inset-0 select-none"
              onMouseDown={() => setCompare(true)}
              onMouseUp={() => setCompare(false)}
              onTouchStart={() => setCompare(true)}
              onTouchEnd={() => setCompare(false)}
            >
              <img
                src={displaySrc}
                alt="anteprima gradata"
                className="absolute inset-0 w-full h-full object-contain"
                draggable={false}
              />
              <img
                src={baseSrc}
                alt="base"
                className={
                  "absolute inset-0 w-full h-full object-contain transition-opacity " +
                  (showBase ? "opacity-100" : "opacity-0")
                }
                draggable={false}
              />
              <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-200 pointer-events-none">
                {showBase ? "originale ChatGPT (no grade)" : "grade completo"}
              </span>
            </div>
          }
          groups={mobileGroups}
        />
  );
}

function PhotoConfigCard({
  photoId,
  config,
  hasOverride,
  prompt,
  onSaved,
}: {
  photoId: string;
  config: PromptConfig;
  hasOverride: boolean;
  prompt: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [draft, setDraft] = useState<PromptConfig>(config);
  const [saving, setSaving] = useState(false);
  // Re-sync if the upstream config changes (e.g. after refresh)
  useEffect(() => setDraft(config), [config]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
          Input
        </span>
        <h2 className="text-sm font-semibold">Generazione — ChatGPT</h2>
        {hasOverride ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">override attivo</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">eredita default</span>
        )}
      </div>
      <PromptBuilder value={draft} onChange={setDraft} previewPrompt={prompt} />
      <div className="flex gap-2 justify-end">
        {hasOverride && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.setPhotoConfig(photoId, null);
                await onSaved();
              } finally {
                setSaving(false);
              }
            }}
            className="text-sm px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50"
          >
            Reset al default
          </button>
        )}
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.setPhotoConfig(photoId, draft);
              await onSaved();
            } finally {
              setSaving(false);
            }
          }}
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
        >
          {saving ? "Salvo…" : "Salva override"}
        </button>
      </div>
    </div>
  );
}
