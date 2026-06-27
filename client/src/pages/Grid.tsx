import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, type PhotoListItem, type PromptConfig } from "../api";
import type { OutletCtx } from "../App";
import PhotoCard from "../components/PhotoCard";
import PromptBuilder from "../components/PromptBuilder";

type Filter =
  | "all"
  | "no_versions"
  | "with_versions"
  | "no_favorite"
  | "with_favorite"
  | "in_queue"
  | "failed"
  | "with_override";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tutte" },
  { id: "no_versions", label: "Senza versioni" },
  { id: "with_versions", label: "Con versioni" },
  { id: "with_favorite", label: "Con preferita" },
  { id: "no_favorite", label: "Senza preferita" },
  { id: "in_queue", label: "In coda" },
  { id: "failed", label: "Falliti" },
  { id: "with_override", label: "Con override" },
];

function formatSceneLabel(photos: PhotoListItem[]): string {
  if (photos.length === 0) return "";
  const first = photos[0]?.taken_at ?? 0;
  const last = photos[photos.length - 1]?.taken_at ?? first;
  const dFirst = new Date(first);
  const dLast = new Date(last);
  const sameDay = dFirst.toDateString() === dLast.toDateString();
  const datePart = dFirst.toLocaleDateString([], { day: "2-digit", month: "short" });
  const timeFirst = dFirst.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const timeLast = dLast.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const time = timeFirst === timeLast ? timeFirst : `${timeFirst}–${timeLast}`;
  return `${datePart} ${time}${sameDay ? "" : " (multi-day)"} · ${photos.length} foto`;
}

export default function GridPage() {
  const [photos, setPhotos] = useState<PhotoListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [groupMode, setGroupMode] = useState<"scene" | "day" | "none">(
    () => (localStorage.getItem("darkroom.grid.group") as "scene" | "day" | "none") || "scene",
  );
  const [defaultConfig, setDefaultConfig] = useState<PromptConfig | null>(null);
  const [defaultPromptPreview, setDefaultPromptPreview] = useState<string>("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    const stored = localStorage.getItem("darkroom.grid.zoom");
    return stored ? Number(stored) : 180;
  });
  const { jobs, activeJobs } = useOutletContext<OutletCtx>();

  const jobStatusByPhoto = useMemo(() => {
    const m = new Map<string, "pending" | "running" | "failed">();
    if (!jobs?.items) return m;
    // Decide per photo from its MOST RECENT job, so a later success clears an
    // older failure. Active jobs (running/pending) always win.
    const latestByPhoto = new Map<string, (typeof jobs.items)[number]>();
    for (const j of jobs.items) {
      const cur = latestByPhoto.get(j.photo_id);
      if (!cur || j.id > cur.id) latestByPhoto.set(j.photo_id, j);
    }
    for (const j of jobs.items) {
      if (j.status === "running" || j.status === "pending") {
        if (!m.has(j.photo_id)) m.set(j.photo_id, j.status);
      }
    }
    for (const [pid, j] of latestByPhoto) {
      // Only flag as failed if the latest job failed and isn't acknowledged.
      if (!m.has(pid) && j.status === "failed" && !j.seen) {
        m.set(pid, "failed");
      }
    }
    return m;
  }, [jobs]);

  useEffect(() => {
    api.listPhotos(filter).then((r) => setPhotos(r.photos));
  }, [filter]);

  // Refresh photos when jobs finish (so version_count badge updates)
  useEffect(() => {
    if (!jobs) return;
    api.listPhotos(filter).then((r) => setPhotos(r.photos));
  }, [jobs?.summary?.done, jobs?.summary?.failed, filter]);

  useEffect(() => {
    api.getDefaultConfig().then((r) => {
      setDefaultConfig(r.config);
      setDefaultPromptPreview(r.prompt);
    });
  }, []);

  const counts = useMemo(() => {
    if (!photos) return { total: 0, withVersions: 0, withFavorite: 0, missing: 0 };
    return {
      total: photos.length,
      withVersions: photos.filter((p) => p.version_count > 0).length,
      withFavorite: photos.filter((p) => p.favorite_version_id !== null).length,
      missing: photos.filter((p) => p.version_count === 0).length,
    };
  }, [photos]);

  const allPhotos = photos ?? [];

  // Split photos into scene groups by time gap (default 10 min).
  // Photos without taken_at land in a trailing "Senza data" bucket.
  const SCENE_GAP_MS = 10 * 60 * 1000;
  const sceneGroups = useMemo(() => {
    const dated = allPhotos.filter((p) => p.taken_at != null);
    const undated = allPhotos.filter((p) => p.taken_at == null);
    const groups: { label: string; photos: PhotoListItem[] }[] = [];
    let current: PhotoListItem[] = [];
    let lastTs: number | null = null;
    for (const p of dated) {
      if (lastTs != null && (p.taken_at! - lastTs) > SCENE_GAP_MS) {
        groups.push({ label: formatSceneLabel(current), photos: current });
        current = [];
      }
      current.push(p);
      lastTs = p.taken_at!;
    }
    if (current.length) groups.push({ label: formatSceneLabel(current), photos: current });
    if (undated.length) groups.push({ label: `Senza data · ${undated.length} foto`, photos: undated });
    return groups;
  }, [allPhotos]);

  // Grouping by calendar day.
  const dayGroups = useMemo(() => {
    const dated = allPhotos.filter((p) => p.taken_at != null);
    const undated = allPhotos.filter((p) => p.taken_at == null);
    const byDay = new Map<string, PhotoListItem[]>();
    for (const p of dated) {
      const key = new Date(p.taken_at!).toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(p);
    }
    const groups = [...byDay.entries()].map(([key, photos]) => ({
      label: `${new Date(key).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" })} · ${photos.length} foto`,
      photos,
    }));
    if (undated.length) groups.push({ label: `Senza data · ${undated.length} foto`, photos: undated });
    return groups;
  }, [allPhotos]);

  // Final groups rendered, driven by the selected grouping mode.
  const displayGroups = useMemo(() => {
    if (groupMode === "none") return [{ label: "", photos: allPhotos }];
    if (groupMode === "day") return dayGroups;
    return sceneGroups;
  }, [groupMode, allPhotos, dayGroups, sceneGroups]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleIds = allPhotos.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const selectedCount = selected.size;

  const selectedHasActiveJob = useMemo(() => {
    let n = 0;
    for (const id of selected) {
      const s = jobStatusByPhoto.get(id);
      if (s === "pending" || s === "running") n++;
    }
    return n;
  }, [selected, jobStatusByPhoto]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm text-neutral-400">
          <span className="text-white font-medium">{counts.total}</span> foto ·{" "}
          <span className="text-white">{counts.withVersions}</span> con almeno
          1 versione · <span className="text-amber-400">{counts.withFavorite}</span>{" "}
          con preferita
        </div>
        <div className="flex-1" />
        <button
          onClick={async () => {
            const prompt = window.prompt("Describe the image to generate from scratch:");
            if (!prompt || !prompt.trim()) return;
            const n = Number(window.prompt("How many variations?", "1")) || 1;
            const r = await api.generateNew(prompt.trim(), n);
            await api.listPhotos(filter).then((res) => setPhotos(res.photos));
            alert(`Queued ${r.created} generation${r.created === 1 ? "" : "s"}. Open the Jobs panel to follow.`);
          }}
          className="text-sm px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 border border-violet-700"
        >
          + Generate
        </button>
        {counts.missing > 0 && (
          <button
            disabled={activeJobs > 0}
            onClick={async () => {
              if (!confirm(`Enqueue ${counts.missing} job?`)) return;
              const r = await api.generateMissing();
              alert(`Enqueued ${r.enqueued} job. Apri il pannello Jobs per seguire.`);
            }}
            title={activeJobs > 0 ? `${activeJobs} job già in coda — attendi che finisca o usa il pannello Jobs` : ""}
            className="text-sm px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 border border-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {activeJobs > 0
              ? `Coda attiva (${activeJobs})`
              : `Genera mancanti (${counts.missing})`}
          </button>
        )}
        <button
          onClick={() => {
            setSelectMode((m) => {
              const next = !m;
              if (!next) setSelected(new Set());
              return next;
            });
          }}
          className={
            "text-sm px-3 py-1.5 rounded border " +
            (selectMode
              ? "bg-blue-700 hover:bg-blue-600 border-blue-600 text-white"
              : "bg-neutral-800 hover:bg-neutral-700 border-neutral-700")
          }
        >
          {selectMode ? `Esci selezione` : "Selezione"}
        </button>
        <button
          onClick={() => setShowPromptEditor((v) => !v)}
          className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
        >
          {showPromptEditor ? "Chiudi prompt" : "Prompt globale"}
        </button>
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-blue-950/40 border border-blue-900 px-3 py-2 text-sm">
          <span className="text-blue-200 font-medium">{selectedCount}</span>
          <span className="text-neutral-400">selezionate</span>
          {selectedHasActiveJob > 0 && (
            <span className="text-amber-300 text-xs">· {selectedHasActiveJob} in coda/run</span>
          )}
          <div className="flex-1" />
          <button
            onClick={() =>
              setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
            }
            className="text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
          >
            {allVisibleSelected ? "Deseleziona tutte" : `Seleziona tutte visibili (${visibleIds.length})`}
          </button>
          <button
            disabled={bulkBusy || selectedCount === 0}
            onClick={async () => {
              if (!confirm(`Mettere in coda ${selectedCount} foto?`)) return;
              setBulkBusy(true);
              try {
                for (const id of selected) {
                  await api.generate(id).catch(() => {});
                }
              } finally {
                setBulkBusy(false);
                setSelected(new Set());
              }
            }}
            className="text-xs px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {bulkBusy ? "Coda…" : `Genera ${selectedCount}`}
          </button>
          <button
            disabled={bulkBusy || selectedHasActiveJob === 0}
            onClick={async () => {
              if (!jobs?.items) return;
              const cancellable = jobs.items.filter(
                (j) => j.status === "pending" && selected.has(j.photo_id),
              );
              if (cancellable.length === 0) {
                alert("Nessun job pending sui selezionati (solo i pending si possono annullare).");
                return;
              }
              if (!confirm(`Annullare ${cancellable.length} job pending?`)) return;
              setBulkBusy(true);
              try {
                for (const j of cancellable) {
                  await api.cancelJob(j.id).catch(() => {});
                }
              } finally {
                setBulkBusy(false);
              }
            }}
            className="text-xs px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Annulla coda
          </button>
        </div>
      )}

      {showPromptEditor && defaultConfig && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 space-y-3">
          <div className="text-xs font-medium text-neutral-400">
            Configurazione prompt globale (default per tutte le foto)
          </div>
          <PromptBuilder
            value={defaultConfig}
            onChange={setDefaultConfig}
            previewPrompt={defaultPromptPreview}
          />
          <div className="flex justify-end gap-2">
            <button
              disabled={savingPrompt}
              onClick={async () => {
                setSavingPrompt(true);
                try {
                  const res = await api.setDefaultConfig(defaultConfig);
                  setDefaultPromptPreview(res.prompt);
                  setShowPromptEditor(false);
                } finally {
                  setSavingPrompt(false);
                }
              }}
              className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
            >
              {savingPrompt ? "Salvo…" : "Salva default"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "px-3 py-1.5 rounded border transition-colors " +
              (filter === f.id
                ? "bg-neutral-800 border-neutral-600 text-white"
                : "bg-transparent border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600")
            }
          >
            {f.label}
          </button>
        ))}
        </div>
        <div className="flex items-center gap-1 ml-2 border-l border-neutral-800 pl-3">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Gruppo</span>
          {([
            { id: "scene", label: "Scena" },
            { id: "day", label: "Giorno" },
            { id: "none", label: "Nessuno" },
          ] as const).map((g) => (
            <button
              key={g.id}
              onClick={() => {
                setGroupMode(g.id);
                localStorage.setItem("darkroom.grid.group", g.id);
              }}
              className={
                "px-3 py-1.5 rounded border transition-colors " +
                (groupMode === g.id
                  ? "bg-neutral-800 border-neutral-600 text-white"
                  : "bg-transparent border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600")
              }
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-neutral-400">
          <span className="text-[10px] uppercase tracking-wider">Zoom</span>
          <input
            type="range"
            min={100}
            max={400}
            step={10}
            value={zoom}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoom(v);
              localStorage.setItem("darkroom.grid.zoom", String(v));
            }}
            className="w-32 accent-neutral-400"
          />
          <span className="font-mono text-[10px] w-10 tabular-nums">{zoom}px</span>
        </div>
      </div>

      {photos === null ? (
        <div className="py-20 text-center text-neutral-500">Carico…</div>
      ) : photos.length === 0 ? (
        <div className="py-20 text-center text-neutral-500">
          Nessuna foto con questo filtro.
        </div>
      ) : (
        <div className="space-y-4">
          {displayGroups.map((g, i) => (
            <section key={i} className="space-y-2">
              {g.label && (
              <header className="flex items-center gap-2 text-xs text-neutral-400 sticky top-[57px] bg-neutral-950/90 backdrop-blur py-1 z-10">
                <span className="text-neutral-300 font-medium">{g.label}</span>
                {selectMode && (
                  <button
                    onClick={() => {
                      const ids = g.photos.map((p) => p.id);
                      const allOn = ids.every((id) => selected.has(id));
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const id of ids) {
                          if (allOn) next.delete(id);
                          else next.add(id);
                        }
                        return next;
                      });
                    }}
                    className="text-[10px] px-2 py-0.5 rounded border border-neutral-700 hover:bg-neutral-800"
                  >
                    {g.photos.every((p) => selected.has(p.id)) ? "−" : "+"} scena
                  </button>
                )}
              </header>
              )}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${zoom}px, 1fr))` }}
              >
                {g.photos.map((p) => (
                  <PhotoCard
                    key={p.id}
                    photo={p}
                    jobStatus={jobStatusByPhoto.get(p.id)}
                    selectMode={selectMode}
                    selected={selected.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onFavoriteChange={() => api.listPhotos(filter).then((r) => setPhotos(r.photos))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
