import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type PhotoDetail, type PromptConfig, type Job, rawUrl, genUrl } from "../api";
import VersionCarousel from "../components/VersionCarousel";
import PromptEditor from "../components/PromptEditor";
import PromptBuilder from "../components/PromptBuilder";
import HiggsfieldButton from "../components/HiggsfieldButton";
import PhotoJobsLog from "../components/PhotoJobsLog";

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PhotoDetail | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [allIds, setAllIds] = useState<string[]>([]);
  const [latestJob, setLatestJob] = useState<Job | null>(null);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);

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
      // First load of this photo: prefer the favorite, else the newest version.
      initedRef.current = id;
      setCurrentVersion(favIdx >= 0 ? favIdx : lastIdx);
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
        navigate(`/photo/${encodeURIComponent(siblings.prev)}`);
      } else if ((e.key === "]" || e.key === "ArrowRight") && siblings.next) {
        navigate(`/photo/${encodeURIComponent(siblings.next)}`);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-neutral-400 hover:text-white">
          ← Indietro
        </Link>
        <span className="font-mono text-sm text-neutral-300">{photo.id}</span>
        <JobStatusBadge job={latestJob} />
        <div className="flex-1" />
        <div className="text-xs text-neutral-500 flex items-center gap-2">
          <button
            onClick={() =>
              siblings.prev &&
              navigate(`/photo/${encodeURIComponent(siblings.prev)}`)
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
              navigate(`/photo/${encodeURIComponent(siblings.next)}`)
            }
            disabled={!siblings.next}
            title={siblings.next ?? undefined}
            className="w-7 h-7 rounded border border-neutral-700 hover:border-neutral-500 hover:text-white disabled:opacity-30 disabled:hover:border-neutral-700 flex items-center justify-center"
            aria-label="foto successiva"
          >
            ▶
          </button>
          <span className="ml-3 text-neutral-600">[g] genera · ←/→ o [/] foto</span>
        </div>
      </div>

      <JobStatusBanner pausedUntil={pausedUntil} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
            <div className="flex items-center gap-2">
              <button
                onClick={onGenerate}
                disabled={generating}
                className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 normal-case font-medium tracking-normal text-white"
              >
                {generating ? "Enqueue…" : "🔁 ChatGPT"}
              </button>
              <HiggsfieldButton
                photoId={photo.id}
                initialSelection={photo.higgsfield_selection}
                onEnqueued={refresh}
              />
            </div>
          </div>
          <VersionCarousel
            versions={versions}
            current={Math.min(currentVersion, Math.max(0, versions.length - 1))}
            onChange={setCurrentVersion}
            isFavorite={isFavorite}
            beforeSrc={rawUrl(photo.id, photo.original_ext)}
            onFavoriteToggle={async () => {
              if (!v) return;
              await api.setFavorite(photo.id, isFavorite ? null : v.id);
              await refresh();
            }}
            onDelete={async () => {
              if (!v) return;
              await api.deleteVersion(photo.id, v.id);
              setCurrentVersion(0);
              await refresh();
            }}
          />
        </div>
      </div>

      <ExtraInstructionsCard
        photoId={photo.id}
        initial={photo.extra_instructions ?? ""}
        onSaved={refresh}
      />

      <PhotoConfigCard
        photoId={photo.id}
        config={effective_config}
        hasOverride={has_override}
        prompt={effective_prompt}
        onSaved={refresh}
      />

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
      ⏸ Coda in pausa (rate-limit ChatGPT) — riprende{" "}
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-2">
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-neutral-300">
          Configurazione prompt per questa foto
        </div>
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
