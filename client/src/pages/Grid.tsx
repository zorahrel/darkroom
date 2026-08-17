import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { api, type Collage, type Collection, type PhotoListItem, type Run } from "../api";
import type { OutletCtx } from "../App";
import PhotoCard from "../components/PhotoCard";
import CollageCard from "../components/CollageCard";
import Accordion from "../components/Accordion";
import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  Images,
  ImageOff,
  Star,
  StarOff,
  Clock3,
  AlertTriangle,
  SlidersHorizontal,
  Layers,
  Heart,
  HeartOff,
} from "lucide-react";

type Filter =
  | "all"
  | "no_versions"
  | "with_versions"
  | "no_favorite"
  | "with_favorite"
  | "in_queue"
  | "failed"
  | "with_override"
  | "unassigned"
  | "assigned"
  | "picked"
  | "not_picked"
  | "recent";

// accent = colored emphasis when the filter has matches (queue amber, failed red,
// favorites amber-star). Others use the neutral active style.
type Accent = "amber" | "red" | "star" | "rose";

/**
 * Collage: unire più foto in una sola slide. Spento di default — vale la pena
 * solo quando le foto sono lo stesso soggetto ripetuto (quattro vicoli uguali,
 * un Buddha da tre angoli), e mescolare soggetti diversi peggiora il post
 * invece di accorciarlo. Il codice e le API restano: si riaccende da qui.
 * I collage già creati continuano a mostrarsi comunque.
 */
const COLLAGE_ENABLED = localStorage.getItem("darkroom.collage") === "1";

type GroupMode = "scene" | "day" | "post" | "none";

/** Una slide del carosello: una foto singola, oppure un collage che ne tiene più d'una. */
type Slide =
  | { kind: "photo"; photo: PhotoListItem }
  | { kind: "collage"; collage: Collage };

/** Un blocco della griglia. `slides` c'è solo per i post: altrove non esiste
 *  un ordine di pubblicazione, solo l'ora di scatto. */
type GridGroup = {
  label: string;
  photos: PhotoListItem[];
  collectionId?: string;
  slides?: Slide[];
};
const FILTERS: { id: Filter; label: string; icon: LucideIcon; accent?: Accent }[] = [
  { id: "all", label: "Tutte", icon: LayoutGrid },
  // La curatela viene prima di tutto il resto: è quel che si fa scorrendo.
  { id: "picked", label: "Mi piace", icon: Heart, accent: "rose" },
  { id: "not_picked", label: "Da guardare", icon: HeartOff },
  { id: "recent", label: "Rigenerate ora", icon: Clock3, accent: "amber" },
  { id: "with_versions", label: "Con versioni", icon: Images },
  { id: "no_versions", label: "Senza versioni", icon: ImageOff },
  { id: "with_favorite", label: "Con preferita", icon: Star, accent: "star" },
  { id: "no_favorite", label: "Senza preferita", icon: StarOff },
  { id: "in_queue", label: "In coda", icon: Clock3, accent: "amber" },
  { id: "failed", label: "Falliti", icon: AlertTriangle, accent: "red" },
  { id: "with_override", label: "Con override", icon: SlidersHorizontal },
  // Curatela: quel che non è ancora in un post è il lavoro che resta.
  { id: "unassigned", label: "Non assegnate", icon: Layers },
  { id: "assigned", label: "Nei post", icon: Layers, accent: "star" },
];

function runLabel(r: Run): string {
  const d = new Date(r.from);
  const day = d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time} · ${r.photos} foto`;
}

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

export default function GridPage({
  graded = false,
  gradeReady = false,
  bust = 0,
  reloadKey = 0,
}: {
  graded?: boolean;
  /** Il grade è stato caricato: prima di allora `graded` è solo il default. */
  gradeReady?: boolean;
  bust?: number;
  reloadKey?: number;
} = {}) {
  // URL is the source of truth for filter/group/zoom, so state survives reload
  // and is shareable. localStorage stays as a fallback default when the URL is bare.
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState<PhotoListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>(() => {
    const f = searchParams.get("filter");
    return FILTERS.some((x) => x.id === f) ? (f as Filter) : "all";
  });
  const [groupMode, setGroupMode] = useState<GroupMode>(() => {
    const g =
      searchParams.get("group") ?? localStorage.getItem("darkroom.grid.group");
    return g === "day" || g === "none" || g === "scene" || g === "post" ? g : "scene";
  });
  // Collections = posts/caroselli. Loaded once and refreshed after every edit,
  // so the "Post" grouping and the bulk assign bar always agree.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionPhotos, setCollectionPhotos] = useState<Record<string, string[]>>({});
  const [collages, setCollages] = useState<Collage[]>([]);
  const [collectionsBusy, setCollectionsBusy] = useState(false);
  // Riordino dentro un post: l'ordine È il carosello, quindi si sistema
  // trascinando le foto, non da un file. HTML5 drag nativo: nessuna dipendenza,
  // e la griglia resta una griglia.
  const [dragging, setDragging] = useState<{ collectionId: string; photoId: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Run browser: pick a generation batch to view its output across the set.
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [runData, setRunData] = useState<
    { item: PhotoListItem; v: number }[] | null
  >(null);
  const [zoom, setZoom] = useState<number>(() => {
    const z = searchParams.get("zoom") ?? localStorage.getItem("darkroom.grid.zoom");
    const n = Number(z);
    return n >= 80 && n <= 400 ? n : 180;
  });
  const { jobs, activeJobs } = useOutletContext<OutletCtx>();
  const { pid } = useParams<{ pid: string }>();
  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});

  // Per-filter counts for the bar. Refetch when jobs move (in_queue/failed
  // shift) or the pipeline commits, so badges stay live without hammering.
  useEffect(() => {
    api.photoCounts().then((r) => setFilterCounts(r.counts)).catch(() => {});
  }, [jobs?.summary?.done, jobs?.summary?.failed, activeJobs, reloadKey]);

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

  // Keep the URL in sync with filter/group/zoom (non-default values only).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== "all") next.set("filter", filter);
    if (groupMode !== "scene") next.set("group", groupMode);
    if (zoom !== 180) next.set("zoom", String(zoom));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, groupMode, zoom]);

  useEffect(() => {
    api.listPhotos(filter).then((r) => setPhotos(r.photos));
  }, [filter]);

  // Refresh photos when jobs finish (so version_count badge updates). Skip the
  // very first time jobs data arrives (null -> populated, right after mount) —
  // that's not a completion, just the initial poll landing, and refetching then
  // duplicates the mount effect above for no reason.
  const prevJobsSummaryRef = useRef<{ done: number; failed: number } | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const prev = prevJobsSummaryRef.current;
    const cur = { done: jobs.summary.done ?? 0, failed: jobs.summary.failed ?? 0 };
    prevJobsSummaryRef.current = cur;
    if (!prev || (prev.done === cur.done && prev.failed === cur.failed)) return;
    api.listPhotos(filter).then((r) => setPhotos(r.photos));
  }, [jobs?.summary?.done, jobs?.summary?.failed, filter]);

  // Refresh when the pipeline promotes/commits (favorites moved under us).
  useEffect(() => {
    if (reloadKey === 0) return;
    api.listPhotos(filter).then((r) => setPhotos(r.photos));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Collections + their members. Refetched whenever the photo list reloads, so
  // a photo generated/deleted elsewhere can't leave a stale post membership.
  const refreshCollections = useCallback(async () => {
    try {
      const r = await api.collections();
      setCollections(r.collections);
      setCollectionPhotos(r.photos);
      setCollages(r.collages ?? []);
    } catch {
      /* collections are additive: a failure must not blank the grid */
    }
  }, []);
  useEffect(() => {
    refreshCollections();
  }, [refreshCollections, reloadKey]);

  // List of generation runs (batches). Refreshes when the pipeline runs.
  useEffect(() => {
    api.runs().then((r) => setRuns(r.runs)).catch(() => {});
  }, [reloadKey, jobs?.summary?.done]);

  // When a run is picked, resolve its photos to full items + their run version.
  useEffect(() => {
    if (selectedRun == null) {
      setRunData(null);
      return;
    }
    let alive = true;
    Promise.all([api.runPhotos(selectedRun), api.listPhotos("with_versions")])
      .then(([rp, all]) => {
        if (!alive) return;
        const byId = new Map(all.photos.map((p) => [p.id, p]));
        const rows = rp.photos
          .map((x) => {
            const item = byId.get(x.id);
            return item ? { item, v: x.version_number } : null;
          })
          .filter((x): x is { item: PhotoListItem; v: number } => x !== null);
        setRunData(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedRun, reloadKey]);

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

  // Grouping by collection (post/carosello). Order inside a post is the
  // curated one (collection_photos.position), not the shot time — a carousel
  // has a first slide. Everything unassigned lands in a trailing bucket, which
  // is the working queue while you're still splitting the trip into posts.
  /**
   * Le SLIDE di un post: una foto singola vale una slide, un collage ne vale
   * una sola pur assorbendone diverse. L'ordine è quello di
   * `collection_photos`; il collage prende il posto della sua prima foto e le
   * altre spariscono dalla fila (sono dentro di lui), così quel che vedi nella
   * griglia è esattamente il carosello che pubblichi.
   */
  const slidesFor = useCallback(
    (collectionId: string, byId: Map<string, PhotoListItem>) => {
      const ids = collectionPhotos[collectionId] ?? [];
      const mine = collages.filter((c) => c.collection_id === collectionId);
      const owner = new Map<string, Collage>();
      for (const cg of mine) for (const pid of cg.photo_ids) owner.set(pid, cg);
      const seen = new Set<string>();
      const out: ({ kind: "photo"; photo: PhotoListItem } | { kind: "collage"; collage: Collage })[] =
        [];
      for (const id of ids) {
        const cg = owner.get(id);
        if (cg) {
          if (seen.has(cg.id)) continue; // già emesso alla sua prima foto
          seen.add(cg.id);
          out.push({ kind: "collage", collage: cg });
          continue;
        }
        const p = byId.get(id);
        if (p) out.push({ kind: "photo", photo: p });
      }
      return out;
    },
    [collectionPhotos, collages],
  );

  const postGroups = useMemo(() => {
    const byId = new Map(allPhotos.map((p) => [p.id, p]));
    const assigned = new Set<string>();
    const groups: GridGroup[] = [];
    for (const col of collections) {
      const ids = collectionPhotos[col.id] ?? [];
      const photos: PhotoListItem[] = [];
      for (const id of ids) {
        const p = byId.get(id);
        // Absent = filtered out by the current filter, not missing: skip it
        // here, but still mark it assigned so it can't reappear as "unassigned".
        assigned.add(id);
        if (p) photos.push(p);
      }
      // A post whose photos are all filtered out is noise in this view.
      if (photos.length === 0) continue;
      const slides = slidesFor(col.id, byId);
      const nCollages = slides.filter((x) => x.kind === "collage").length;
      groups.push({
        // Il conteggio che conta è quello delle SLIDE (il carosello ha un
        // limite di 20), con le foto fra parentesi quando un collage ne
        // assorbe più d'una.
        label:
          `${col.title} · ${slides.length} slide` +
          (nCollages ? ` (${photos.length} foto, ${nCollages} collage)` : ""),
        photos,
        collectionId: col.id,
        slides,
      });
    }
    const rest = allPhotos.filter((p) => !assigned.has(p.id));
    if (rest.length) groups.push({ label: `Non assegnate · ${rest.length} foto`, photos: rest });
    return groups;
  }, [allPhotos, collections, collectionPhotos, slidesFor]);

  // Final groups rendered, driven by the selected grouping mode.
  const displayGroups = useMemo<GridGroup[]>(() => {
    if (groupMode === "none") return [{ label: "", photos: allPhotos }];
    if (groupMode === "day") return dayGroups;
    if (groupMode === "post") return postGroups;
    return sceneGroups;
  }, [groupMode, allPhotos, dayGroups, sceneGroups, postGroups]);

  /**
   * Sposta la selezione in un post (o la libera con null, o ne crea uno nuovo
   * con "__new__"). Dopo l'assegnazione la selezione si svuota: il gesto è
   * finito, e chi sta lavorando col filtro "Non assegnate" vede la coda
   * accorciarsi da sola invece di dover deselezionare a mano.
   */
  const assignSelection = useCallback(
    async (target: string | null) => {
      const ids = [...selected];
      if (!ids.length) return;
      setCollectionsBusy(true);
      try {
        if (target === "__new__") {
          const title = prompt(`Titolo del nuovo post (${ids.length} foto)`);
          if (!title?.trim()) return;
          await api.createCollection({ title: title.trim(), photo_ids: ids });
        } else {
          await api.assignToCollection(ids, target);
        }
        await refreshCollections();
        setSelected(new Set());
        // La griglia filtrata su "non assegnate" deve perdere le foto appena
        // assegnate, altrimenti restano lì e sembra che il click non abbia fatto nulla.
        const r = await api.listPhotos(filter);
        setPhotos(r.photos);
        api.photoCounts().then((x) => setFilterCounts(x.counts)).catch(() => {});
      } finally {
        setCollectionsBusy(false);
      }
    },
    [selected, refreshCollections, filter],
  );

  /**
   * Un "mi piace" aggiorna il contatore della barra e lo stato locale della
   * foto, senza rifare la lista: chi sta scorrendo 190 foto non deve vedere la
   * griglia saltare a ogni click. Sotto il filtro "Mi piace"/"Da guardare" la
   * foto che non appartiene più al filtro esce, altrimenti resta dov'è.
   */
  const handlePicked = useCallback(
    (id: string, isPicked: boolean) => {
      setFilterCounts((c) => ({
        ...c,
        picked: (c.picked ?? 0) + (isPicked ? 1 : -1),
        not_picked: (c.not_picked ?? 0) + (isPicked ? -1 : 1),
      }));
      setPhotos((ps) => {
        if (!ps) return ps;
        if (
          (filter === "picked" && !isPicked) ||
          (filter === "not_picked" && isPicked)
        ) {
          return ps.filter((p) => p.id !== id);
        }
        return ps.map((p) => (p.id === id ? { ...p, picked: isPicked ? 1 : 0 } : p));
      });
    },
    [filter],
  );

  /**
   * Sposta `photoId` prima di `beforeId` dentro lo stesso post e persiste il
   * nuovo ordine. Si riordina solo dentro un post: trascinare tra post diversi
   * sarebbe un'assegnazione travestita, e per quella ci sono i bottoni.
   */
  const reorderWithin = useCallback(
    async (collectionId: string, photoId: string, beforeId: string) => {
      if (photoId === beforeId) return;
      const ids = collectionPhotos[collectionId];
      if (!ids) return;
      const next = ids.filter((x) => x !== photoId);
      const at = next.indexOf(beforeId);
      if (at < 0) return;
      next.splice(at, 0, photoId);
      // Ottimistico: il trascinamento deve sembrare istantaneo.
      setCollectionPhotos((m) => ({ ...m, [collectionId]: next }));
      try {
        await api.setCollectionPhotos(collectionId, next);
      } catch {
        await refreshCollections(); // il server ha rifiutato: riallinea
      }
    },
    [collectionPhotos, refreshCollections],
  );

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

  /**
   * Il post in cui stanno TUTTE le foto selezionate, se ce n'è uno solo e
   * nessuna è già dentro un collage. È la condizione perché "unisci in collage"
   * abbia senso: null = il bottone non compare, invece di comparire e fallire.
   */
  const selectedCollectionId = useMemo(() => {
    if (selected.size < 2) return null;
    const inCollage = new Set(collages.flatMap((c) => c.photo_ids));
    let found: string | null = null;
    for (const id of selected) {
      if (inCollage.has(id)) return null;
      const owner = Object.entries(collectionPhotos).find(([, ids]) => ids.includes(id));
      if (!owner) return null;
      if (found && found !== owner[0]) return null;
      found = owner[0];
    }
    return found;
  }, [selected, collectionPhotos, collages]);

  const selectedHasActiveJob = useMemo(() => {
    let n = 0;
    for (const id of selected) {
      const s = jobStatusByPhoto.get(id);
      if (s === "pending" || s === "running") n++;
    }
    return n;
  }, [selected, jobStatusByPhoto]);

  // Compact summary shown on the collapsed Filtri accordion, so the active
  // filter/group/zoom stay visible without expanding the bar.
  const activeFilter = FILTERS.find((f) => f.id === filter);
  const activeFilterN = filterCounts[filter];
  const groupLabel =
    groupMode === "scene"
      ? "Scena"
      : groupMode === "day"
        ? "Giorno"
        : groupMode === "post"
          ? "Post"
          : "Nessuno";
  const activeRun = selectedRun != null ? runs.find((r) => r.id === selectedRun) : null;

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
          {/* Unire in collage vale solo dentro UN post: foto di post diversi non
              fanno una slide. Il bottone è dietro il flag perché nella pratica
              serve di rado — una slide composta regge solo quando le foto sono
              lo STESSO soggetto ripetuto, e capita meno di quanto sembri. */}
          {COLLAGE_ENABLED && selectedCollectionId && selectedCount >= 2 && selectedCount <= 9 && (
            <button
              disabled={collectionsBusy}
              onClick={async () => {
                const ids = [...selected];
                // Default sensato: due foto stanno bene divise a metà, di più
                // vogliono una gerarchia. Si cambia con un click sulla slide.
                const mode = ids.length === 2 ? "split" : ids.length <= 5 ? "hero" : "grid";
                const layout = ids.length <= 6 ? "3x2" : "3x3";
                setCollectionsBusy(true);
                try {
                  await api.createCollage(selectedCollectionId, { photo_ids: ids, mode, layout });
                  await refreshCollections();
                  setSelected(new Set());
                  setSelectMode(false);
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e));
                } finally {
                  setCollectionsBusy(false);
                }
              }}
              className="text-xs px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 border border-fuchsia-600 text-white disabled:opacity-40"
            >
              ▣ Unisci in collage ({selectedCount})
            </button>
          )}
          {/* Assegnare è IL gesto della curatela, quindi è un bottone per post,
              non una tendina da aprire: con pochi post il click è uno solo. La
              tendina resta accanto per crearne uno nuovo o per toglierle. */}
          {collections.map((col) => (
            <button
              key={col.id}
              disabled={collectionsBusy || selectedCount === 0}
              onClick={() => assignSelection(col.id)}
              className="text-xs px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              → {col.title}{" "}
              <span className="text-neutral-500 tabular-nums">{col.photo_count}</span>
            </button>
          ))}
          <select
            disabled={collectionsBusy || selectedCount === 0}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              e.target.value = "";
              assignSelection(v === "__none__" ? null : v);
            }}
            className="text-xs px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="">{collectionsBusy ? "Assegno…" : "Assegna a post…"}</option>
            <option value="__new__">＋ Nuovo post…</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.photo_count})
              </option>
            ))}
            <option value="__none__">— Togli dal post</option>
          </select>
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

      <Accordion
        storageKey="darkroom.grid.filters.open"
        defaultOpen
        title={<h2 className="text-sm font-semibold">Filtri</h2>}
        summary={
          <>
            {activeFilter && (
              <span className="shrink-0 text-neutral-500">
                {activeFilter.label}
                {activeFilterN != null && (
                  <span className="text-neutral-400"> {activeFilterN}</span>
                )}
              </span>
            )}
            <span className="shrink-0 text-neutral-600">· {groupLabel}</span>
            {activeRun && (
              <span className="shrink-0 text-sky-300/80">· run {runLabel(activeRun)}</span>
            )}
            <span className="shrink-0 text-neutral-600">· {zoom}px</span>
          </>
        }
      >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            const n = filterCounts[f.id];
            const known = n !== undefined;
            const empty = known && n === 0;
            const isActive = filter === f.id;
            const hot = !!f.accent && !!n && n > 0; // colored emphasis when non-empty
            const base =
              "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border transition-colors ";
            let cls: string;
            if (isActive) {
              cls =
                f.accent === "red"
                  ? "bg-red-600/90 border-red-500 text-white"
                  : f.accent === "rose"
                    ? "bg-rose-500/90 border-rose-400 text-white"
                    : f.accent === "amber" || f.accent === "star"
                      ? "bg-amber-500/90 border-amber-400 text-black"
                      : "bg-neutral-700 border-neutral-500 text-white";
            } else if (empty) {
              cls = "bg-transparent border-neutral-900 text-neutral-600 opacity-50";
            } else if (hot) {
              cls =
                f.accent === "red"
                  ? "bg-red-950/40 border-red-800 text-red-200 hover:border-red-600"
                  : f.accent === "rose"
                    ? "bg-rose-950/40 border-rose-800/70 text-rose-200 hover:border-rose-600"
                    : "bg-amber-950/30 border-amber-800/70 text-amber-200 hover:border-amber-600";
            } else {
              cls =
                "bg-transparent border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600";
            }
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                disabled={empty && !isActive}
                title={known ? `${n} foto` : undefined}
                className={base + cls + (empty && !isActive ? " cursor-not-allowed" : "")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>{f.label}</span>
                {known && (
                  <span
                    className={
                      "ml-0.5 min-w-[1.1rem] text-center rounded-full px-1 text-[10px] font-semibold tabular-nums " +
                      (isActive
                        ? "bg-black/20"
                        : "bg-neutral-800/80 text-neutral-300")
                    }
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-neutral-800/70 bg-neutral-900/40 px-2 py-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">Gruppo</span>
          {([
            { id: "scene", label: "Scena" },
            { id: "day", label: "Giorno" },
            { id: "post", label: "Post" },
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
        {runs.length > 0 && (
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800/70 bg-neutral-900/40 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 mr-1">
              Run
            </span>
            <select
              value={selectedRun ?? ""}
              onChange={(e) =>
                setSelectedRun(e.target.value ? Number(e.target.value) : null)
              }
              className={
                "bg-neutral-800 border rounded px-2 py-1.5 text-xs " +
                (selectedRun != null
                  ? "border-sky-600 text-sky-200"
                  : "border-neutral-700 text-neutral-300")
              }
            >
              <option value="">Tutte le versioni</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(r)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2 text-neutral-400 ml-auto rounded-lg border border-neutral-800/70 bg-neutral-900/40 px-2 py-1">
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
      </Accordion>

      {selectedRun != null ? (
        runData === null ? (
          <div className="py-20 text-center text-neutral-500">Carico run…</div>
        ) : runData.length === 0 ? (
          <div className="py-20 text-center text-neutral-500">Run vuota.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-sky-300">
              Run selezionata · {runData.length} foto — mostro la versione di
              quella generazione
            </div>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${zoom}px, 1fr))` }}
            >
              {runData.map(({ item, v }) => (
                <PhotoCard
                  key={item.id}
                  photo={item}
                  previewVersionOverride={v}
                  jobStatus={jobStatusByPhoto.get(item.id)}
                  graded={graded}
                  bust={bust}
                />
              ))}
            </div>
          </div>
        )
      ) : photos === null ? (
        <div className="py-20 text-center text-neutral-500">Carico…</div>
      ) : photos.length === 0 ? (
        // A project with nothing in it isn't a filter problem: point at the
        // one thing that fixes it.
        filter === "all" ? (
          <div className="py-20 text-center space-y-3">
            <div className="text-neutral-400">Questo progetto non ha ancora foto.</div>
            <Link
              to={pid ? `/p/${pid}/sources` : "/studio"}
              className="inline-block text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 border border-emerald-700"
            >
              Aggiungi una cartella di foto
            </Link>
          </div>
        ) : (
          <div className="py-20 text-center text-neutral-500">
            Nessuna foto con questo filtro.
          </div>
        )
      ) : (
        <div className="space-y-4">
          {displayGroups.map((g, i) => (
            // Scorrendo 85 foto il titolo del gruppo è l'unico punto di
            // riferimento: deve leggersi senza cercarlo, non essere una riga
            // grigia come tutto il resto. Un post ha anche una barra di colore,
            // così si vede dove finisce uno e comincia l'altro.
            <section key={i} className="space-y-2">
              {g.label && (
              <header className="flex items-center gap-2.5 text-xs text-neutral-400 sticky top-[57px] bg-neutral-950/95 backdrop-blur py-2.5 z-10 border-b border-neutral-800/80">
                {g.collectionId && (
                  <span className="h-6 w-1 shrink-0 rounded-full bg-amber-400/80" />
                )}
                <span
                  className={
                    g.collectionId
                      ? "text-white font-semibold text-lg tracking-tight"
                      : "text-neutral-200 font-semibold text-base"
                  }
                >
                  {g.label}
                </span>
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
                    {g.photos.every((p) => selected.has(p.id)) ? "−" : "+"}{" "}
                    {groupMode === "post" ? "post" : "scena"}
                  </button>
                )}
                {/* Un post si gestisce da dove lo vedi: rinomina e cancella
                    stanno sull'intestazione del gruppo, non in una pagina a parte. */}
                {g.collectionId && (
                  <span className="text-[10px] text-neutral-600">
                    trascina per riordinare · la 1 è la copertina
                  </span>
                )}
                {g.collectionId && (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={async () => {
                        const cur = collections.find((c) => c.id === g.collectionId);
                        const title = prompt("Titolo del post", cur?.title ?? "");
                        if (!title?.trim() || title.trim() === cur?.title) return;
                        await api.updateCollection(g.collectionId!, { title: title.trim() });
                        await refreshCollections();
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600"
                    >
                      rinomina
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Sciogliere il post "${g.label}"? Le foto restano, tornano fra le non assegnate.`)) return;
                        await api.deleteCollection(g.collectionId!);
                        await refreshCollections();
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 text-neutral-500 hover:text-red-300 hover:border-red-800"
                    >
                      sciogli
                    </button>
                  </span>
                )}
              </header>
              )}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${zoom}px, 1fr))` }}
              >
                {(g.slides ?? g.photos.map((photo) => ({ kind: "photo" as const, photo }))).map(
                  (slide, slot) => {
                  if (slide.kind === "collage") {
                    return (
                      <CollageCard
                        key={slide.collage.id}
                        collage={slide.collage}
                        slot={slot}
                        graded={graded}
                        gradeReady={gradeReady}
                        onChanged={refreshCollections}
                      />
                    );
                  }
                  const p = slide.photo;
                  // Dentro un post ogni foto è una slide numerata e trascinabile;
                  // fuori (scena/giorno/non assegnate) l'ordine è dato dall'ora
                  // di scatto e non c'è niente da riordinare.
                  const inPost = !!g.collectionId && !selectMode;
                  return (
                    <div
                      key={p.id}
                      draggable={inPost}
                      onDragStart={() =>
                        g.collectionId &&
                        setDragging({ collectionId: g.collectionId, photoId: p.id })
                      }
                      onDragEnd={() => {
                        setDragging(null);
                        setDragOver(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragging || dragging.collectionId !== g.collectionId) return;
                        e.preventDefault();
                        setDragOver(p.id);
                      }}
                      onDrop={(e) => {
                        if (!dragging || dragging.collectionId !== g.collectionId) return;
                        e.preventDefault();
                        reorderWithin(g.collectionId!, dragging.photoId, p.id);
                        setDragging(null);
                        setDragOver(null);
                      }}
                      className={
                        "relative " +
                        (inPost ? "cursor-grab active:cursor-grabbing " : "") +
                        (dragOver === p.id && dragging?.photoId !== p.id
                          ? "ring-2 ring-sky-400 rounded-md"
                          : "") +
                        (dragging?.photoId === p.id ? " opacity-40" : "")
                      }
                    >
                      <PhotoCard
                        photo={p}
                        jobStatus={jobStatusByPhoto.get(p.id)}
                        selectMode={selectMode}
                        selected={selected.has(p.id)}
                        graded={graded}
                        bust={bust}
                        onToggleSelect={() => toggleSelect(p.id)}
                        onFavoriteChange={() =>
                          api.listPhotos(filter).then((r) => setPhotos(r.photos))
                        }
                        onPickedChange={handlePicked}
                      />
                      {g.collectionId && (
                        <span className="pointer-events-none absolute bottom-1 left-1 z-20 min-w-[1.25rem] px-1 rounded bg-black/70 text-center text-[10px] font-semibold tabular-nums text-white">
                          {slot + 1}
                        </span>
                      )}
                    </div>
                  );
                },
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
