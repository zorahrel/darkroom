import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import type { OutletCtx } from "../App";
import { api, type PhotoDetail, type Lut, type Job, type Clip, rawUrl } from "../api";
import { Bott, Header, Page, SectionHeader } from "../ui";
import VersionCarousel from "../components/VersionCarousel";
import PromptEditor from "../components/PromptEditor";
import HiggsfieldButton from "../components/HiggsfieldButton";
import ClipsCard from "../components/ClipsCard";
import FlowViewer from "../components/FlowViewer";
import PhotoJobsLog from "../components/PhotoJobsLog";
import { IconRefresh } from "../components/mobile/icons";
import { JobStatusBadge, JobStatusBanner } from "../components/detail/JobStatus";
import { PhotoPipeline } from "../components/detail/PhotoPipeline";
import { VersionStrip, versionLabel } from "../components/detail/VersionStrip";
import { FullscreenView } from "../components/detail/FullscreenView";


// Prev/next only ever needs the neighbours; a handful of entries covers the
// back-and-forth without holding the whole library in memory.
const CACHE_MAX = 12;

export default function DetailPage() {
  const { pid, id } = useParams<{ pid: string; id: string }>();
  const { jobs } = useOutletContext<OutletCtx>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const base = pid ? `/p/${pid}` : "";
  const [data, setData] = useState<PhotoDetail | null>(null);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  /** L'originale a tutto schermo con zoom 1:1: serve alle tavole di confronto, che non hanno versioni. */
  const [originaleGrande, setOriginaleGrande] = useState(false);
  const [allIds, setAllIds] = useState<string[]>([]);
  const [latestJob, setLatestJob] = useState<Job | null>(null);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [luts, setLuts] = useState<Lut[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  /** Il lettore dei video e' fuori dal dock: aprendo la pagina i clip erano dietro Pipeline > Versioni. */
  const [videoOpen, setVideoOpen] = useState(() => searchParams.get("clip") != null || searchParams.get("flow") != null);

  useEffect(() => {
    api.luts().then((r) => setLuts(r.luts)).catch(() => {});
  }, []);

  const initedRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);
  // Warm cache of adjacent photos so prev/next switches instantly instead of
  // showing the previous photo while the fetch is in flight.
  const cacheRef = useRef<Map<string, PhotoDetail>>(new Map());
  // Bounded: browsing the whole library with [ / ] would otherwise pin one full
  // PhotoDetail (photo + every version + config) per visited photo for the life
  // of the tab. Insertion order = eviction order, so re-setting a key refreshes
  // its position too.
  const cacheSet = useCallback((key: string, d: PhotoDetail) => {
    const c = cacheRef.current;
    c.delete(key);
    c.set(key, d);
    while (c.size > CACHE_MAX) {
      const oldest = c.keys().next().value;
      if (oldest === undefined) break;
      c.delete(oldest);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    const d = await api.getPhoto(id);
    cacheSet(id, d);
    setData(d);
    const lastIdx = Math.max(0, d.versions.length - 1);
    if (initedRef.current !== id) {
      // First load of this photo: honor ?v=<version_number> deep-link,
      // else the newest version. Non la preferita: si apre una foto per
      // giudicare l'ultima uscita, e prima serviva un link ?v= per ognuna
      // (la preferita resta segnata con la stellina nella striscia).
      initedRef.current = id;
      const vParam = searchParams.get("v");
      const vIdx = vParam
        ? d.versions.findIndex((v) => v.version_number === Number(vParam))
        : -1;
      setCurrentVersion(vIdx >= 0 ? vIdx : lastIdx);
    } else if (d.versions.length > prevCountRef.current) {
      // A new version was just generated → jump to it.
      setCurrentVersion(lastIdx);
    }
    prevCountRef.current = d.versions.length;
  }, [id, cacheSet]);

  useEffect(() => {
    // Switch to the cached photo immediately (no stale-photo flash), then
    // refresh in the background.
    if (id) {
      const cached = cacheRef.current.get(id);
      if (cached) setData(cached);
    }
    refresh();
  }, [refresh]);

  // I video nati da questa foto: se non si caricano l'elenco resta vuoto e la scheda sparisce,
  // senza disturbare il resto della pagina.
  const loadClips = useCallback(async () => {
    if (!id) return;
    try {
      setClips((await api.clips(id)).clips);
    } catch {
      setClips([]);
    }
  }, [id]);
  useEffect(() => {
    setClips([]);
    loadClips();
  }, [loadClips]);

  // `?v=` cambia anche da fuori (la miniatura «partenza» in alto, un link): prima l'indirizzo
  // si aggiornava ma la pagina restava sulla versione di prima, perche' `?v=` si leggeva solo
  // al primo caricamento. Con le nostre scelte lo stato e l'indirizzo coincidono gia': nessun effetto.
  const vParam = searchParams.get("v");
  useEffect(() => {
    if (!data || !vParam) return;
    const idx = data.versions.findIndex((x) => x.version_number === Number(vParam));
    if (idx >= 0) setCurrentVersion((cur) => (cur === idx ? cur : idx));
  }, [vParam, data]);

  // Job status for this photo. The jobs payload is already polled once by the
  // app shell — read it from the outlet instead of opening a second poller on
  // the same endpoint.
  //
  // The refresh trigger must NOT depend on `data`: refresh() replaces `data`
  // with a fresh object, so an effect that both depends on `data` and calls
  // refresh() re-arms itself on its own result and hammers the API as fast as
  // the network answers (measured: ~3.4 req/s on /api/jobs AND /api/photos/:id,
  // instead of one every 2s). The last-consumed timestamp lives in a ref and
  // only lets a *newly finished* job pull the photo again — once per finish,
  // which also survives the fact that a completed job does not bump
  // photos.updated_at.
  const updatedAtRef = useRef(0);
  useEffect(() => {
    updatedAtRef.current = data?.photo.updated_at ?? 0;
  }, [data]);
  const consumedFinishRef = useRef(0);
  useEffect(() => {
    consumedFinishRef.current = 0;
  }, [id]);

  useEffect(() => {
    if (!id || !jobs) return;
    const mine = jobs.items.filter((j) => j.photo_id === id);
    // Prefer an active job; otherwise the most recently created one.
    const active = mine.find(
      (j) => j.status === "pending" || j.status === "running",
    );
    const newest = mine.reduce<Job | null>(
      (acc, j) => (!acc || j.created_at > acc.created_at ? j : acc),
      null,
    );
    const shown = active ?? newest;
    // Same job, same state → keep the object identity so the page doesn't
    // re-render on every poll.
    setLatestJob((prev) =>
      prev?.id === shown?.id &&
      prev?.status === shown?.status &&
      prev?.progress === shown?.progress
        ? prev
        : shown,
    );
    setPausedUntil(jobs.runner?.paused ? jobs.runner.paused_until : null);

    const lastFinish = mine.reduce(
      (max, j) =>
        j.status === "done" && j.finished_at && j.finished_at > max
          ? j.finished_at
          : max,
      0,
    );
    if (lastFinish > updatedAtRef.current && lastFinish > consumedFinishRef.current) {
      consumedFinishRef.current = lastFinish;
      refresh();
    }
  }, [jobs, id, refresh]);

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
          .then((d) => cacheSet(sid, d))
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
      // Con il flusso (o il lettore video) aperto le frecce e «g» sono suoi: senza questo
      // ← → saltavano alla foto accanto dietro lo schermo, e «g» lanciava una generazione.
      if (videoOpen) return;
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
  }, [generating, siblings.prev, siblings.next, navigate, videoOpen]);

  if (!id) return null;
  if (!data) return <div className="py-20 text-center text-neutral-400">Carico…</div>;

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
      <Bott weight={versions.length ? "normal" : "primary"}
        onClick={onGenerate}
        disabled={generating}
      >
        <IconRefresh />
        {generating ? "Accodo…" : "ChatGPT"}
      </Bott>
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
      {/* I video prima del carosello: nel pannello stretto il carosello e' alto e il tasto
          «Salva in Download» finirebbe sotto una schermata di scorrimento. */}
      <ClipsCard clips={clips} onChanged={loadClips} />
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
      <span className="text-neutral-400">{k}</span>
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
          v ? `${versionLabel(v, versions)}${v.parent_version_id != null ? ` (file v${v.version_number})` : ""}${v.provider ? ` · ${v.provider}` : ""}` : "—",
        )}
        {infoRow("Generata", v ? fmtTs(v.created_at) : "—")}
        {v?.credits != null && infoRow("Crediti", String(v.credits))}
        {infoRow("Preferita", isFavorite ? "sì" : "no")}
        {infoRow("Override generazione", has_override ? "sì" : "eredita globale")}
        {infoRow("Override colore", data.has_grade_override ? "sì" : "eredita globale")}
      </div>

      <details>
        <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-300">
          Prompt inviato (effettivo)
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400 bg-neutral-950 border border-neutral-800 rounded p-2">
          {effective_prompt || "—"}
        </pre>
      </details>

      <div>
        <div className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
          Log generazioni
        </div>
        <PhotoJobsLog photoId={photo.id} />
      </div>
    </div>
  );

  return (
    <Page>
      {versions.length === 0 && <Header title={photo.id} below={<JobStatusBadge job={latestJob} />}>
        <Link to={base || "/"} className="text-sm text-neutral-400 hover:text-white">
          ← Indietro
        </Link>
        <div className="text-xs text-neutral-400 flex items-center gap-2">
          <Bott size="s"
            onClick={() =>
              siblings.prev &&
              navigate(`${base}/photo/${encodeURIComponent(siblings.prev)}`)
            }
            disabled={!siblings.prev}
            title={siblings.prev ?? undefined}
            aria-label="foto precedente"
          >
            ◀
          </Bott>
          <span className="tabular-nums text-neutral-300 min-w-[4.5rem] text-center">
            {siblings.index >= 0 ? siblings.index + 1 : "—"} / {siblings.total}
          </span>
          <Bott size="s"
            onClick={() =>
              siblings.next &&
              navigate(`${base}/photo/${encodeURIComponent(siblings.next)}`)
            }
            disabled={!siblings.next}
            title={siblings.next ?? undefined}
            aria-label="foto successiva"
          >
            ▶
          </Bott>
          <span className="ml-3 text-neutral-400 hidden md:inline">[g] genera · ←/→ o [/] foto</span>
        </div>
      </Header>}

      <JobStatusBanner pausedUntil={pausedUntil} />

      {/* With a version, the full-screen editor (EditorShell) covers the page
          and shows the generations in the "Versions" group: here we hide
          Original+Generations so as not to render the carousel twice. With no
          version, it stays visible so you can generate. */}
      <div
        className={
          (versions.length > 0 ? "hidden" : "grid") +
          " grid-cols-1 lg:grid-cols-2 gap-4 items-start"
        }
      >
        {/* Original */}
        <div className="space-y-2">
          <SectionHeader title="Originale" />
          <div className="aspect-square w-full rounded-lg overflow-hidden bg-black border border-neutral-800">
            <img
              src={rawUrl(photo.id, photo.original_ext)}
              alt={photo.id}
              className="w-full h-full object-contain cursor-zoom-in"
              onClick={() => setOriginaleGrande(true)}
            />
          </div>
          {originaleGrande && (
            <FullscreenView
              src={rawUrl(photo.id, photo.original_ext)}
              alt={photo.id}
              zoomable
              onClose={() => setOriginaleGrande(false)}
            />
          )}
        </div>

        {/* Generations */}
        <div className="space-y-2">
          <SectionHeader title="Generazioni">{generateButtons}</SectionHeader>
          {versionCarousel}
          <ClipsCard clips={clips} onChanged={loadClips} />
        </div>
      </div>

      {/* The photo's pipeline: EditorShell (one bar) at every width — mobile
          fullscreen, desktop dock at the bottom with the big preview above.
          Input = ChatGPT generation · Step = local colour. */}
      <PhotoPipeline
        photoId={photo.id}
        versionNumber={v ? v.version_number : null}
        versionLabel={v ? versionLabel(v, versions) : null}
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
        ingressi={v ? { voci: data.ingressi?.[v.id] ?? [], prompt: v.prompt_used } : null}
        infoPanel={infoPanel}
        openStepId={searchParams.get("step")}
        versionStrip={
          <>
            {(clips.length > 0 || versions.length > 1) && (
              <button
                type="button"
                data-testid="open-clips"
                onClick={() => setVideoOpen(true)}
                // Neutro come gli altri comandi, accento solo sul simbolo: la fascia arancione piena
                // si leggeva come un avviso. Il conteggio dice cosa conta, non un numero nudo.
                className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-neutral-900 text-neutral-200 hover:bg-neutral-800 hover:text-white border-t border-neutral-800 transition-colors"
              >
                <span className="text-amber-400">◈</span> Flusso
                <span className="text-neutral-500 font-normal">
                  · rami{clips.length > 0 ? ` e ${clips.length} video` : ""}
                </span>
              </button>
            )}
            <VersionStrip
              photoId={photo.id}
              versions={versions}
              current={currentVersion}
              favoriteVersionId={photo.favorite_version_id}
              onSelect={onVersionChange}
            />
          </>
        }
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

      {/* Il flusso: versioni e video sullo stesso albero, a tutto schermo sopra l'editor. */}
      {videoOpen && (
        <FlowViewer
          photoId={photo.id}
          clips={clips}
          currentVersion={v ? v.version_number : null}
          initialClipId={Number(searchParams.get("clip")) || null}
          onClose={() => setVideoOpen(false)}
          onClipsChanged={loadClips}
          onPickVersion={(n) => {
            const idx = versions.findIndex((x) => x.version_number === n);
            if (idx >= 0) onVersionChange(idx);
          }}
        />
      )}

      {/* With a version the full-screen editor covers the page: the job log and
          the legacy prompt stay only when there is nothing to edit yet. */}
      {versions.length === 0 && (
        <>
          <PhotoJobsLog photoId={photo.id} />

          <details className="border border-neutral-800 rounded-lg">
            <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-400 hover:text-neutral-300">
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
    </Page>
  );
}
