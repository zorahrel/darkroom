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
import EditorRail, { type ToolGroup, type AddableStep } from "../components/mobile/EditorRail";
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
  IconInfo,
  IconText,
} from "../components/mobile/icons";
import { useHistory } from "../lib/useHistory";
import Spinner from "../components/detail/Spinner";
import { JobStatusBadge, JobStatusBanner } from "../components/detail/JobStatus";
import { ExtraInstructionsCard } from "../components/detail/ExtraInstructionsCard";
import { FinalPromptView } from "../components/detail/FinalPromptView";
import { PhotoPipeline } from "../components/detail/PhotoPipeline";
import { PhotoConfigCard } from "../components/detail/PhotoConfigCard";


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
  // Warm cache of adjacent photos so prev/next switches instantly instead of
  // showing the previous photo while the fetch is in flight.
  const cacheRef = useRef<Map<string, PhotoDetail>>(new Map());

  const refresh = useCallback(async () => {
    if (!id) return;
    const d = await api.getPhoto(id);
    cacheRef.current.set(id, d);
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
    // Switch to the cached photo immediately (no stale-photo flash), then
    // refresh in the background.
    if (id) {
      const cached = cacheRef.current.get(id);
      if (cached) setData(cached);
    }
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

  // Prefetch the adjacent photos' data so prev/next feels instant.
  useEffect(() => {
    for (const sid of [siblings.prev, siblings.next]) {
      if (sid && !cacheRef.current.has(sid)) {
        api
          .getPhoto(sid)
          .then((d) => cacheRef.current.set(sid, d))
          .catch(() => {});
      }
    }
  }, [siblings.prev, siblings.next]);

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
  // Route id changed but the loaded photo hasn't caught up yet → show a spinner
  // instead of the previous photo.
  const navigating = photo.id !== id;
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

  // The full-screen editor also hid the page's metadata, the exact prompt that
  // was sent, and the generation log. They all move into an "Info" panel in the
  // dock so nothing is lost on the single-photo view.
  const fmtTs = (t?: number | null) => {
    if (!t) return "—";
    const d = new Date(t < 1e12 ? t * 1000 : t);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT");
  };
  const infoRow = (k: string, val: string) => (
    <div className="flex justify-between gap-3 py-1 border-b border-neutral-800/60">
      <span className="text-neutral-500">{k}</span>
      <span className="text-neutral-200 text-right break-all">{val}</span>
    </div>
  );
  const infoPanel = (
    <div className="space-y-4 text-sm">
      <div className="tabular-nums">
        {infoRow("ID", photo.id)}
        {infoRow("Aggiunta", fmtTs(photo.created_at))}
        {infoRow("Versioni", String(versions.length))}
        {infoRow(
          "Versione mostrata",
          v ? `v${v.version_number}${v.provider ? ` · ${v.provider}` : ""}` : "—",
        )}
        {infoRow("Generata", v ? fmtTs(v.created_at) : "—")}
        {v?.credits != null && infoRow("Crediti", String(v.credits))}
        {infoRow("Preferita", isFavorite ? "sì" : "no")}
        {infoRow("Override generazione", has_override ? "sì" : "eredita globale")}
        {infoRow("Override colore", data.has_grade_override ? "sì" : "eredita globale")}
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300">
          Prompt inviato (effettivo)
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400 bg-neutral-950 border border-neutral-800 rounded p-2">
          {effective_prompt || "—"}
        </pre>
      </details>

      <div>
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
          Log generazioni
        </div>
        <PhotoJobsLog photoId={photo.id} />
      </div>
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

      {/* Pipeline della foto: EditorShell (barra unica) a tutte le larghezze —
          mobile fullscreen, desktop dock in basso con l'anteprima grande sopra.
          Input = generazione ChatGPT · Step = colore locale. */}
      <PhotoPipeline
        photoId={photo.id}
        versionNumber={v ? v.version_number : null}
        versionId={v ? v.id : null}
        favoriteVersionId={photo.favorite_version_id}
        effectiveConfig={effective_config}
        hasConfigOverride={has_override}
        prompt={effective_prompt}
        extraInitial={photo.extra_instructions ?? ""}
        effectiveGrade={data.effective_grade}
        hasGradeOverride={data.has_grade_override}
        luts={luts}
        onSaved={refresh}
        navigating={navigating}
        onExit={() => navigate(base || "/")}
        mobileExtras={versionsPanel}
        infoPanel={infoPanel}
        openStepId={searchParams.get("step")}
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
