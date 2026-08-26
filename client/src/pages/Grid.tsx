import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scegli } from "../ui";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  currentProject,
  rawUrl,
  type Collage,
  type Collection,
  type PhotoListItem,
  type Run,
} from "../api";
import type { OutletCtx } from "../App";
import PhotoCard from "../components/PhotoCard";
import CollageCard from "../components/CollageCard";
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
  Sparkles,
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
  | "recent"
  | "pro"
  | "pro_todo"
  | "covers"
  | "covers_todo";

// accent = colored emphasis when the filter has matches (queue amber, failed red,
// favorites amber-star). Others use the neutral active style.
type Accent = "amber" | "red" | "star" | "rose" | "emerald";

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
/**
 * I filtri raggruppati per DOMANDA, non messi in fila.
 *
 * Tredici pulsanti affiancati non entrano in una barra e obbligano a scorrere
 * lateralmente per trovarne uno. Qui restano fuori solo i tre che si usano di
 * continuo (tutte, mi piace, da guardare); gli altri stanno in tre menu che
 * rispondono ognuno a una domanda diversa: dove sta questa foto? a che punto è
 * la lavorazione? cosa devo ancora sistemare?
 */
const FILTER_GROUPS: { label: string; ids: Filter[] }[] = [
  { label: "Nei post", ids: ["covers", "covers_todo", "assigned", "unassigned"] },
  { label: "Stato", ids: ["pro_todo", "pro", "recent", "with_versions", "no_versions", "in_queue"] },
  { label: "Da fare", ids: ["no_favorite", "with_favorite", "failed", "with_override"] },
];
/** Sempre visibili: sono le tre viste con cui si lavora davvero. */
const PRIMARY_FILTERS: Filter[] = ["all", "picked", "not_picked"];

const FILTERS: { id: Filter; label: string; icon: LucideIcon; accent?: Accent }[] = [
  { id: "all", label: "Tutte", icon: LayoutGrid },
  // La curatela viene prima di tutto il resto: è quel che si fa scorrendo.
  { id: "picked", label: "Mi piace", icon: Heart, accent: "rose" },
  { id: "not_picked", label: "Da guardare", icon: HeartOff },
  { id: "recent", label: "Rigenerate ora", icon: Clock3, accent: "amber" },
  { id: "covers", label: "Copertine", icon: Star, accent: "star" },
  // Il primo lotto sensato da pagare: la copertina decide se il carosello
  // viene aperto, quindi viene prima di ogni altra foto del post.
  { id: "covers_todo", label: "Copertine da fare pro", icon: Star, accent: "amber" },
  { id: "pro", label: "Ha un master pro", icon: Sparkles, accent: "emerald" },
  // La domanda che ci si fa prima di spendere: cosa manca da rifinire. Solo
  // foto che usciranno davvero (in un post, non saltate) e guardando la
  // PREFERITA, perche' e' quella che finisce nel carosello.
  { id: "pro_todo", label: "Da fare in pro", icon: Sparkles, accent: "amber" },
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
  // Quale foto detta il colore di ciascun post, indicizzata per lookup diretto
  // durante il render della griglia.
  const refByCollection = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const c of collections) if (c.reference_photo_id) m[c.id] = c.reference_photo_id;
    return m;
  }, [collections]);
  const [collectionsBusy, setCollectionsBusy] = useState(false);
  // Riordino dentro un post: l'ordine È il carosello, quindi si sistema
  // trascinando le foto, non da un file. HTML5 drag nativo: nessuna dipendenza,
  // e la griglia resta una griglia.
  const [dragging, setDragging] = useState<{ collectionId: string; photoId: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Post evidenziato quando ci si trascina sopra l'intestazione.
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  /** Quale menu di filtri è aperto (uno per volta). */
  const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);
  // Altezza reale della barra: le intestazioni dei post ci si agganciano sotto,
  // e un valore fisso sbaglierebbe appena compare la riga di selezione.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barH, setBarH] = useState(48);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // offsetHeight, non contentRect: serve l'altezza REALE occupata, padding e
    // bordo compresi. Con contentRect le intestazioni si agganciavano troppo in
    // alto e sparivano sotto la barra.
    const ro = new ResizeObserver(() => setBarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Menu contestuale: le stesse azioni dei bottoni, ma raggiungibili con il
  // tasto destro — che è dove le cerca chiunque abbia mai usato un gestore di
  // foto, e che finora non faceva nulla.
  const [menu, setMenu] = useState<
    { x: number; y: number; photoId: string; collectionId: string | null } | null
  >(null);
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

  // Esc chiude il menu contestuale: cliccare fuori funziona, ma non è quello
  // che fanno le dita quando si vuole annullare.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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
      const nSkipped = photos.filter((p) => p.skipped === 1).length;
      groups.push({
        // Il conteggio che conta è quello delle SLIDE (il carosello ha un
        // limite di 20), con le foto fra parentesi quando un collage ne
        // assorbe più d'una.
        // Le foto saltate (ChatGPT le rifiuta, non avranno mai un render) non
        // usciranno nel post: dirlo qui evita di scoprire a pubblicazione che
        // il carosello ha una slide in meno di quelle annunciate.
        label:
          `${col.title} · ${slides.length} slide` +
          (nCollages ? ` (${photos.length} foto, ${nCollages} collage)` : "") +
          (nSkipped ? ` — ${nSkipped} saltata${nSkipped > 1 ? "e" : ""}` : ""),
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
    // Un filtro stretto (3 copertine, 2 fallite) unito al raggruppamento per
    // scena produce gruppetti da una foto ciascuno, separati da intestazioni:
    // sembra che il filtro non abbia trovato niente. Sotto una manciata di
    // risultati la divisione non informa piu', li nasconde.
    if (allPhotos.length <= 8 && filter !== "all") {
      return [{ label: "", photos: allPhotos }];
    }
    if (groupMode === "day") return dayGroups;
    if (groupMode === "post") return postGroups;
    return sceneGroups;
  }, [groupMode, allPhotos, dayGroups, sceneGroups, postGroups, filter]);

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

  /**
   * Sposta una foto in un ALTRO post. `beforeId` è la foto su cui è stata
   * lasciata: la nuova arriva al suo posto, non in fondo, perché chi trascina
   * sta indicando una posizione. Con `null` va in coda (drop sull'intestazione).
   */
  const moveAcross = useCallback(
    async (photoId: string, toCollection: string, beforeId: string | null) => {
      const dest = [...(collectionPhotos[toCollection] ?? [])];
      const from = Object.entries(collectionPhotos).find(([, ids]) => ids.includes(photoId));
      // Ottimistico: il trascinamento deve sembrare istantaneo, il server
      // conferma dopo.
      setCollectionPhotos((m) => {
        const next = { ...m };
        if (from) next[from[0]] = from[1].filter((x) => x !== photoId);
        const at = beforeId ? dest.indexOf(beforeId) : -1;
        const list = dest.filter((x) => x !== photoId);
        if (at >= 0) list.splice(at, 0, photoId);
        else list.push(photoId);
        next[toCollection] = list;
        return next;
      });
      try {
        await api.assignToCollection([photoId], toCollection);
        if (beforeId) {
          const list = [...(collectionPhotos[toCollection] ?? [])].filter((x) => x !== photoId);
          const at = list.indexOf(beforeId);
          if (at >= 0) {
            list.splice(at, 0, photoId);
            await api.setCollectionPhotos(toCollection, list);
          }
        }
      } finally {
        await refreshCollections();
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
      {/* Tutto ciò che comanda la vista sta in UNA barra appiccicata
          all'header: prima c'erano una riga di riepilogo, una di azioni e una
          di filtri, tre fasce che si mangiavano il primo schermo di foto e
          scorrevano via. Il riepilogo è diventato una riga sola qui dentro. */}
      <div
        ref={barRef}
        // Niente sconfinamento orizzontale: `-mx-4` faceva finire la barra
        // SOTTO la colonna della pipeline, e il "+" dello zoom spariva.
        className="sticky top-[var(--h-testata,57px)] z-20 border-b border-neutral-800
                   bg-neutral-950/95 py-1.5 backdrop-blur"
      >
      {selectMode && (
        <div className="flex flex-wrap items-center gap-1.5 rounded bg-neutral-900 border border-neutral-700 px-2.5 py-1.5 text-[12px] mb-1.5">
          <span className="text-neutral-100 font-medium">{selectedCount}</span>
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
            className="text-[12px] h-7 px-2.5 rounded border border-transparent bg-neutral-100 font-medium
                       text-neutral-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
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
              <span className="text-neutral-400 tabular-nums">{col.photo_count}</span>
            </button>
          ))}
          <Scegli
            valore=""
            larghezza={150}
            titolo={collectionsBusy ? "Assegno…" : "Metti le foto scelte in un post"}
            voci={[
              { v: "", testo: collectionsBusy ? "Assegno…" : "Assegna a post…" },
              { v: "__new__", testo: "＋ Nuovo post…" },
              ...collections.map((c) => ({ v: c.id, testo: c.title, nota: String(c.photo_count) })),
              { v: "__none__", testo: "— Togli dal post" },
            ]}
            onCambia={(v) => { if (v) assignSelection(v === "__none__" ? null : v); }}
          />
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
            className="text-[12px] h-7 px-2.5 rounded border border-rose-900 text-rose-200
                       hover:bg-rose-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Annulla coda
          </button>
        </div>
      )}

      <div className="flex flex-nowrap items-center gap-1.5 text-xs">
        <div className="flex flex-nowrap items-center gap-1">
          {FILTERS.filter((f) => PRIMARY_FILTERS.includes(f.id)).map((f) => {
            const Icon = f.icon;
            const n = filterCounts[f.id];
            const known = n !== undefined;
            const empty = known && n === 0;
            const isActive = filter === f.id;
            const hot = !!f.accent && !!n && n > 0; // colored emphasis when non-empty
            // `h-7` e `whitespace-nowrap`: senza, "Mi piace" e "Da guardare"
            // andavano a capo dentro il bottone e la barra si ritrovava con
            // tre altezze diverse sulla stessa riga.
            const base =
              "inline-flex h-7 items-center gap-1 px-2 rounded border transition-colors whitespace-nowrap ";
            let cls: string;
            if (isActive) {
              cls =
                f.accent === "red"
                  ? "bg-red-600/90 border-red-500 text-white"
                  : f.accent === "emerald"
                    ? "bg-emerald-500/90 border-emerald-400 text-emerald-950"
                    : f.accent === "rose"
                    ? "bg-rose-500/90 border-rose-400 text-white"
                    : f.accent === "amber" || f.accent === "star"
                      ? "bg-amber-500/90 border-amber-400 text-black"
                      : "bg-neutral-700 border-neutral-500 text-white";
            } else if (empty) {
              cls = "bg-transparent border-neutral-900 text-neutral-400 opacity-50";
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
                title={`${f.label}${known ? ` — ${n} foto` : ""}`}
                className={base + cls + (empty && !isActive ? " cursor-not-allowed" : "")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {/* Su una barra stretta resta la sola icona: il conteggio e il
                    tooltip bastano a riconoscere il filtro, e l'alternativa era
                    lo scroll orizzontale. */}
                <span className="hidden xl:inline">{f.label}</span>
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

        {/* Gli altri filtri, in tre menu per famiglia. Un menu che porta il
            conteggio del filtro attivo dice già tutto senza doverlo aprire. */}
        {FILTER_GROUPS.map((grp) => {
          const active = grp.ids.includes(filter);
          const cur = FILTERS.find((f) => f.id === filter);
          return (
            <div key={grp.label} className="relative">
              <button
                onClick={() => setOpenFilterMenu(openFilterMenu === grp.label ? null : grp.label)}
                className={
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 transition-colors whitespace-nowrap " +
                  (active
                    ? "border-neutral-500 bg-neutral-700 text-white"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-white")
                }
              >
                {active && cur ? cur.label : grp.label}
                <span className="text-neutral-400">▾</span>
              </button>
              {openFilterMenu === grp.label && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
                  <div className="absolute left-0 z-50 mt-1 min-w-[13rem] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-2xl">
                    {grp.ids.map((id) => {
                      const f = FILTERS.find((x) => x.id === id);
                      if (!f) return null;
                      const n = filterCounts[id];
                      const Icon = f.icon;
                      return (
                        <button
                          key={id}
                          onClick={() => {
                            setFilter(id);
                            setOpenFilterMenu(null);
                          }}
                          disabled={n === 0 && filter !== id}
                          className={
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors " +
                            (filter === id
                              ? "bg-neutral-800 text-white"
                              : n === 0
                                ? "cursor-not-allowed text-neutral-400"
                                : "text-neutral-200 hover:bg-neutral-800")
                          }
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                          <span className="flex-1">{f.label}</span>
                          <span className="tabular-nums text-neutral-400">{n ?? ""}</span>
                        </button>
                      );
                    })}
                    {/* Le run vivono qui, sotto "Lavorazione": è la stessa
                        domanda (a che punto è la generazione?) e non serve
                        tenerle sempre in barra. */}
                    {grp.label === "Stato" && runs.length > 0 && (
                      <>
                        <div className="my-1 border-t border-neutral-800" />
                        <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-400">
                          Generazioni
                        </div>
                        {runs.slice(0, 8).map((r) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              setSelectedRun(selectedRun === r.id ? null : r.id);
                              setOpenFilterMenu(null);
                            }}
                            className={
                              "block w-full px-3 py-1.5 text-left transition-colors " +
                              (selectedRun === r.id
                                ? "bg-sky-900/50 text-sky-200"
                                : "text-neutral-300 hover:bg-neutral-800")
                            }
                          >
                            {runLabel(r)}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Raggruppamento: un select nativo invece di quattro bottoni. Sono
            300px risparmiati, ed è una scelta fra alternative esclusive —
            esattamente ciò per cui un menu a tendina esiste. */}
        {/* Menu proprio, non una select nativa: quella eredita il widget di
            sistema — su macOS chiaro, col suo font e la sua freccia — e in
            mezzo a una barra scura si vede solo lui. Stessa forma dei menu dei
            filtri, così la barra ha una grammatica sola. */}
        <div className="relative shrink-0">
          <button
            onClick={() => setOpenFilterMenu(openFilterMenu === "__group" ? null : "__group")}
            title="Come raggruppare le foto"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-neutral-800 px-2 py-1.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
          >
            {groupLabel}
            <span className="text-neutral-400">▾</span>
          </button>
          {openFilterMenu === "__group" && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpenFilterMenu(null)} />
              <div className="absolute left-0 z-50 mt-1 min-w-[9rem] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-2xl">
                {([
                  { id: "post", label: "Post" },
                  { id: "scene", label: "Scena" },
                  { id: "day", label: "Giorno" },
                  { id: "none", label: "Nessuno" },
                ] as const).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setGroupMode(g.id);
                      localStorage.setItem("darkroom.grid.group", g.id);
                      setOpenFilterMenu(null);
                    }}
                    className={
                      "block w-full px-3 py-1.5 text-left transition-colors " +
                      (groupMode === g.id
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-200 hover:bg-neutral-800")
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Il selettore di run è un attrezzo di diagnosi, non di curatela: sta
            in barra solo quando è già in uso, altrimenti ruba 220px a chi sta
            semplicemente guardando le foto. */}
        {runs.length > 0 && selectedRun != null && (
          <div className="flex items-center gap-1 rounded-lg border border-neutral-800/70 bg-neutral-900/40 px-2 py-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400 mr-1">
              Run
            </span>
            <Scegli
              valore={selectedRun == null ? "" : String(selectedRun)}
              larghezza={190}
              voci={[
                { v: "", testo: "Tutte le versioni" },
                ...runs.map((r) => ({ v: String(r.id), testo: runLabel(r) })),
              ]}
              onCambia={(v) => setSelectedRun(v ? Number(v) : null)}
            />
          </div>
        )}
        {/* Azioni e conteggio in coda alla stessa riga: erano una fascia a
            parte sopra i filtri, e su una griglia di foto ogni fascia in più è
            una fila di foto in meno sul primo schermo. */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {counts.missing > 0 && (
            <button
              disabled={activeJobs > 0}
              onClick={async () => {
                if (!confirm(`Enqueue ${counts.missing} job?`)) return;
                const r = await api.generateMissing();
                alert(`Enqueued ${r.enqueued} job. Apri il pannello Jobs per seguire.`);
              }}
              title={
                activeJobs > 0
                  ? `${activeJobs} job già in coda`
                  : `Genera le ${counts.missing} foto senza versioni`
              }
              className="shrink-0 h-7 rounded border border-transparent bg-neutral-100 px-2.5 font-medium
                         text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activeJobs > 0 ? `Coda ${activeJobs}` : `Genera ${counts.missing}`}
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
              "shrink-0 h-7 rounded border px-2 whitespace-nowrap transition-colors " +
              (selectMode
                ? "border-neutral-400 bg-neutral-800 text-neutral-100"
                : "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:text-neutral-100")
            }
          >
            {selectMode ? "Esci" : "Selezione"}
          </button>
        </div>

        {/* Zoom a passi invece che a cursore: un range da 100 a 400 occupa
            140px per una scelta che nella pratica è fra quattro dimensioni.
            Due bottoni ne prendono 50 e si usano senza mirare. */}
        <div className="flex h-7 shrink-0 items-center rounded border border-neutral-800">
          <button
            onClick={() => {
              const v = Math.max(100, zoom - 40);
              setZoom(v);
              localStorage.setItem("darkroom.grid.zoom", String(v));
            }}
            disabled={zoom <= 100}
            title="Foto più piccole"
            className="h-full px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
          >
            −
          </button>
          <span className="w-7 text-center font-mono text-[10px] tabular-nums text-neutral-400">
            {zoom}
          </span>
          <button
            onClick={() => {
              const v = Math.min(400, zoom + 40);
              setZoom(v);
              localStorage.setItem("darkroom.grid.zoom", String(v));
            }}
            disabled={zoom >= 400}
            title="Foto più grandi"
            className="h-full px-2 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
          >
            +
          </button>
        </div>
      </div>
      </div>

      {selectedRun != null ? (
        runData === null ? (
          <div className="py-20 text-center text-neutral-400">Carico run…</div>
        ) : runData.length === 0 ? (
          <div className="py-20 text-center text-neutral-400">Run vuota.</div>
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
        <div className="py-20 text-center text-neutral-400">Carico…</div>
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
          <div className="py-20 text-center text-neutral-400">
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
            // Nessuno space-y: lo stacco fra intestazione e foto lo mette il
            // padding dell'intestazione stessa. Con space-y restava una fascia
            // trasparente sotto il titolo mentre era sticky, e ci si vedeva
            // scorrere la griglia sotto.
            <section key={i}>
              {g.label && (
              <header
                // top-[104px]: subito sotto la barra unificata (header 57 +
                // barra ~47). Un valore fisso è fragile ma l'alternativa —
                // misurare a runtime — introdurrebbe un salto a ogni render.
                // L'intestazione è anche una zona di rilascio: trascinarci sopra una
                // foto la sposta in fondo a quel post. Serve per spostare in un
                // post che in quel momento è scrollato fuori vista, o vuoto.
                onDragOver={(e) => {
                  if (!dragging || !g.collectionId || dragging.collectionId === g.collectionId) return;
                  e.preventDefault();
                  setDragOverGroup(g.collectionId);
                }}
                onDragLeave={() => setDragOverGroup(null)}
                onDrop={(e) => {
                  if (!dragging || !g.collectionId) return;
                  e.preventDefault();
                  if (dragging.collectionId !== g.collectionId) {
                    moveAcross(dragging.photoId, g.collectionId, null);
                  }
                  setDragging(null);
                  setDragOver(null);
                  setDragOverGroup(null);
                }}
                style={{ top: barH + 57 }}
                className={
                  "flex items-center gap-2.5 text-xs text-neutral-400 sticky bg-neutral-950/95 backdrop-blur pb-2 pt-2.5 z-10 border-b transition-colors mb-2 " +
                  (dragOverGroup === g.collectionId
                    ? "border-sky-400 bg-sky-950/40"
                    : "border-neutral-800/80")
                }
              >
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
                  <span className="text-[10px] text-neutral-400">
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
                      className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600"
                    >
                      rinomina
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Sciogliere il post "${g.label}"? Le foto restano, tornano fra le non assegnate.`)) return;
                        await api.deleteCollection(g.collectionId!);
                        await refreshCollections();
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-neutral-800 text-neutral-400 hover:text-red-300 hover:border-red-800"
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
                      onDragStart={(e) => {
                        if (!g.collectionId) return;
                        setDragging({ collectionId: g.collectionId, photoId: p.id });
                        // Anteprima: la miniatura della foto, non il rettangolo
                        // dell'intera cella coi suoi controlli — così mentre
                        // trascini vedi COSA stai spostando.
                        const img = e.currentTarget.querySelector("img");
                        if (img instanceof HTMLImageElement && img.complete) {
                          e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
                        }
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDragOver(null);
                      }}
                      onDragOver={(e) => {
                        // Si accetta anche il trascinamento da un ALTRO post:
                        // spostare una foto fra due gruppi è il gesto naturale,
                        // e prima era bloccato senza dirlo — restava lì e basta.
                        if (!dragging || !g.collectionId) return;
                        e.preventDefault();
                        setDragOver(p.id);
                      }}
                      onDrop={(e) => {
                        if (!dragging || !g.collectionId) return;
                        e.preventDefault();
                        if (dragging.collectionId === g.collectionId) {
                          reorderWithin(g.collectionId, dragging.photoId, p.id);
                        } else {
                          // Da un altro post: si sposta E si mette nel punto
                          // dove è stata lasciata, non in fondo.
                          moveAcross(dragging.photoId, g.collectionId, p.id);
                        }
                        setDragging(null);
                        setDragOver(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          photoId: p.id,
                          collectionId: g.collectionId ?? null,
                        });
                      }}
                      className={
                        // `group/tile`: un gruppo NOMINATO. Senza nome,
                        // group-hover risaliva al `group` di PhotoCard più
                        // vicino trovato nel DOM e i comandi comparivano su
                        // tutte le foto insieme invece che su quella sotto il
                        // mouse.
                        "relative group/tile " +
                        (inPost ? "cursor-grab active:cursor-grabbing " : "") +
                        // La foto trascinata sbiadisce: si vede che è "in mano"
                        // e non più al suo posto.
                        (dragging?.photoId === p.id ? " opacity-30" : "")
                      }
                    >
                      {/* Barra di inserimento: dice DOVE finirà la foto, non
                          solo su quale cella sei sopra. Un anello attorno alla
                          cella è ambiguo — prima o dopo? — mentre una barra sul
                          bordo sinistro indica il punto esatto. */}
                      {dragOver === p.id && dragging && dragging.photoId !== p.id && (
                        <span className="pointer-events-none absolute -left-1 top-0 z-30 h-full w-1.5 rounded-full bg-sky-400 shadow-[0_0_10px] shadow-sky-400/70" />
                      )}
                      {/* Da un altro post: si evidenzia anche la cella, perché
                          l'azione non è "riordina" ma "sposta qui dentro". */}
                      {dragOver === p.id &&
                        dragging &&
                        dragging.collectionId !== g.collectionId && (
                          <span className="pointer-events-none absolute inset-0 z-20 rounded-md bg-sky-400/15 ring-2 ring-sky-400" />
                        )}
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
      {/* Il numero della slide non sparisce MAI: a zoom basso si guarda la
          griglia proprio per controllare l'ordine di pubblicazione, ed è
          l'unica informazione che conta davvero. */}
                      {g.collectionId && (
                        <span className="pointer-events-none absolute bottom-1 left-1 z-30 min-w-[1.25rem] rounded bg-black/80 px-1 text-center text-[10px] font-semibold tabular-nums text-white">
                          {slot + 1}
                        </span>
                      )}
                      {/* Copertina e riferimento colore: due decisioni, due
                          click. Trascinare una foto in prima posizione funziona,
                          ma è un gesto di precisione per dire "questa apre il
                          carosello" — e il riferimento colore non ha nemmeno un
                          gesto, vive solo nell'ordine invisibile del DB. */}
                      {/* Sotto una certa dimensione i due comandi non ci stanno
                          senza coprire la foto: si collassano in un bottone
                          solo che apre lo stesso menu del tasto destro. */}
                      {g.collectionId && !selectMode && zoom < 150 && (
                        <button
                          title="Azioni su questa foto"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const r = (e.target as HTMLElement).getBoundingClientRect();
                            setMenu({
                              x: r.left,
                              y: r.bottom + 4,
                              photoId: p.id,
                              collectionId: g.collectionId ?? null,
                            });
                          }}
                          className="absolute left-1 top-9 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[11px] leading-none text-white opacity-0 transition-opacity hover:bg-neutral-700 group-hover/tile:opacity-100"
                        >
                          ⋯
                        </button>
                      )}
                      {g.collectionId && !selectMode && zoom >= 150 && (
                        // In alto a sinistra, SOTTO il cuore: in basso passa la
                        // nota (che occupa tutta la larghezza della card) e a
                        // destra c'è la stella della versione preferita. Questi
                        // due comandi riguardano il POST, non la foto, quindi
                        // stanno insieme e lontano dagli altri.
                        <div className="absolute left-1 top-9 z-20 flex flex-col gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100">
                          {slot !== 0 && (
                            <button
                              title="Metti in copertina (prima slide)"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                await api.setCover(g.collectionId!, p.id);
                                await refreshCollections();
                              }}
                              className="rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white hover:bg-amber-500 hover:text-black"
                            >
                              ★ copertina
                            </button>
                          )}
                          <button
                            title={
                              refByCollection[g.collectionId] === p.id
                                ? "Questa foto detta il colore del post: viene allegata a ogni rigenerazione del gruppo, così le altre nascono con la sua stessa luce. Click per toglierla."
                                : "Fai dettare il colore a questa foto: verrà allegata a ogni rigenerazione del post, e le altre foto verranno rifatte accordandosi alla sua luce"
                            }
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const cur = refByCollection[g.collectionId!];
                              await api.updateCollection(g.collectionId!, {
                                reference_photo_id: cur === p.id ? null : p.id,
                              });
                              await refreshCollections();
                            }}
                            className={
                              "rounded px-1.5 py-0.5 text-[10px] " +
                              (refByCollection[g.collectionId] === p.id
                                ? "bg-sky-500 text-white opacity-100"
                                : "bg-black/75 text-white hover:bg-sky-500")
                            }
                          >
                            {refByCollection[g.collectionId] === p.id
                              ? "◉ detta il colore"
                              : "◉ usa come colore"}
                          </button>
                        </div>
                      )}
                      {refByCollection[g.collectionId ?? ""] === p.id && (
                        // Sotto il numero di slide, non in alto a destra: lì
                        // vive la stella della versione preferita.
                        <span
                          title="Questa foto detta il colore del post"
                          className="pointer-events-none absolute bottom-1 left-8 z-30 rounded bg-sky-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        >
                          {zoom < 150 ? "◉" : "colore del post"}
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

      {/* Menu contestuale. Un gestore di foto ha il tasto destro: qui non
          faceva nulla, e le azioni erano raggiungibili solo passando il mouse
          in un punto preciso della card. Le stesse azioni, dove uno le cerca. */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="fixed z-50 min-w-[13rem] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-2xl"
            style={{
              // Il menu non deve uscire dallo schermo quando si clicca vicino
              // al bordo destro o in fondo alla pagina.
              left: Math.min(menu.x, window.innerWidth - 230),
              top: Math.min(menu.y, window.innerHeight - 320),
            }}
          >
            {menu.collectionId && (
              <>
                <MenuItem
                  onClick={async () => {
                    await api.setCover(menu.collectionId!, menu.photoId);
                    await refreshCollections();
                    setMenu(null);
                  }}
                >
                  ★ Metti in copertina
                </MenuItem>
                <MenuItem
                  onClick={async () => {
                    const cur = refByCollection[menu.collectionId!];
                    await api.updateCollection(menu.collectionId!, {
                      reference_photo_id: cur === menu.photoId ? null : menu.photoId,
                    });
                    await refreshCollections();
                    setMenu(null);
                  }}
                >
                  {refByCollection[menu.collectionId] === menu.photoId
                    ? "◉ Non dettare più il colore"
                    : "◉ Fai dettare il colore a questa"}
                </MenuItem>
                <div className="my-1 border-t border-neutral-800" />
              </>
            )}

            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-neutral-400">
              Sposta in
            </div>
            {collections
              .filter((c) => c.id !== menu.collectionId)
              .map((c) => (
                <MenuItem
                  key={c.id}
                  onClick={async () => {
                    await api.assignToCollection([menu.photoId], c.id);
                    await refreshCollections();
                    const r = await api.listPhotos(filter);
                    setPhotos(r.photos);
                    setMenu(null);
                  }}
                >
                  → {c.title}
                </MenuItem>
              ))}
            <MenuItem
              onClick={async () => {
                const title = prompt("Titolo del nuovo post");
                if (!title?.trim()) return setMenu(null);
                await api.createCollection({ title: title.trim(), photo_ids: [menu.photoId] });
                await refreshCollections();
                setMenu(null);
              }}
            >
              ＋ Nuovo post…
            </MenuItem>
            <div className="my-1 border-t border-neutral-800" />
            <MenuItem
              onClick={() => {
                void navigator.clipboard.writeText(menu.photoId);
                setMenu(null);
              }}
            >
              ⧉ Copia ID <span className="text-neutral-400">{menu.photoId.slice(0, 14)}</span>
            </MenuItem>
            <MenuItem
              onClick={() => {
                // URL assoluto: serve a incollarlo altrove, e un percorso
                // relativo fuori da qui non significherebbe niente.
                const url = `${window.location.origin}/p/${currentProject()}/photo/${encodeURIComponent(menu.photoId)}`;
                void navigator.clipboard.writeText(url);
                setMenu(null);
              }}
            >
              🔗 Copia link alla foto
            </MenuItem>
            <MenuItem
              onClick={() => {
                // L'immagine servita, non il file su disco: è quella che si
                // vede, con il grade applicato.
                void navigator.clipboard.writeText(
                  `${window.location.origin}${rawUrl(menu.photoId)}`,
                );
                setMenu(null);
              }}
            >
              🖼 Copia URL dell'originale
            </MenuItem>
            {menu.collectionId && (
              <>
                <div className="my-1 border-t border-neutral-800" />
                <MenuItem
                  danger
                onClick={async () => {
                  await api.assignToCollection([menu.photoId], null);
                  await refreshCollections();
                  const r = await api.listPhotos(filter);
                  setPhotos(r.photos);
                  setMenu(null);
                }}
              >
                  — Togli dal post
                </MenuItem>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "block w-full px-3 py-1.5 text-left transition-colors " +
        (danger
          ? "text-red-300 hover:bg-red-950/60"
          : "text-neutral-200 hover:bg-neutral-800")
      }
    >
      {children}
    </button>
  );
}
