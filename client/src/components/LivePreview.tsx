import { useEffect, useMemo, useRef, useState } from "react";
import { api, gradedPreviewUrl, type ColorGrade, type PhotoListItem } from "../api";
import { useDebouncedImage } from "../lib/useDebouncedImage";
import { IconCompare, IconChevronLeft, IconChevronRight } from "./mobile/icons";

// A single focused, LIVE preview of one reference photo, rendered with the
// current (possibly unsaved) grade so a slider drag is visible immediately —
// the grid repaints only after the debounced save, which is neither live nor
// focused. Used inside the pipeline dock (Home) where the page has no big
// preview of its own. Hold to compare against the ungraded original; the ‹ ›
// cycle the reference through the favorites so you can land on one that shows
// the step you're tuning (e.g. a sky-heavy shot for the Cielo step).
type Ref = { id: string; ver: number };

const LS_KEY = "darkroom.livePreview.refId";
const PREVIEW_W = 1000;

export default function LivePreview({ grade }: { grade: ColorGrade }) {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [idx, setIdx] = useState(0);
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listPhotos("all")
      .then((r) => {
        if (!alive) return;
        // Prefer favorites (the look is tuned on them); fall back to any photo
        // that has a version to render.
        const pick = (p: PhotoListItem) =>
          p.favorite_version_number ?? p.latest_version_number ?? null;
        const favs = r.photos.filter((p) => p.favorite_version_number != null);
        const pool = (favs.length ? favs : r.photos.filter((p) => pick(p) != null))
          .map((p) => ({ id: p.id, ver: pick(p)! }))
          .filter((x) => x.ver != null);
        setRefs(pool);
        const saved = localStorage.getItem(LS_KEY);
        const at = saved ? pool.findIndex((x) => x.id === saved) : -1;
        setIdx(at >= 0 ? at : 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const ref = refs[idx] ?? null;

  function move(dir: 1 | -1) {
    if (!refs.length) return;
    const next = (idx + dir + refs.length) % refs.length;
    const nextRef = refs[next];
    setIdx(next);
    if (nextRef) localStorage.setItem(LS_KEY, nextRef.id);
  }

  // Graded (live) src vs. the ungraded original for hold-to-compare.
  const gradedSrc = ref ? gradedPreviewUrl(ref.id, ref.ver, grade, PREVIEW_W) : null;
  const baseGrade = useMemo<ColorGrade>(() => ({ ...grade, enabled: false }), [grade]);
  const baseSrc = ref ? gradedPreviewUrl(ref.id, ref.ver, baseGrade, PREVIEW_W) : null;

  const { shown, loading } = useDebouncedImage(gradedSrc, 150);
  const displaySrc = compare ? baseSrc : shown ?? gradedSrc;
  const showBase = compare || !grade.enabled;

  // Hold-to-compare — pointer + touch, released anywhere.
  const holding = useRef(false);
  useEffect(() => {
    const up = () => {
      if (holding.current) {
        holding.current = false;
        setCompare(false);
      }
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchend", up);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-900">
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        {displaySrc ? (
          <img
            src={displaySrc}
            alt="anteprima live"
            className="max-h-full max-w-full object-contain select-none"
            draggable={false}
          />
        ) : (
          <span className="text-xs text-neutral-600">nessuna preferita da mostrare</span>
        )}
        {loading && !compare && (
          <div className="absolute top-2 right-2 w-4 h-4 rounded-full border-2 border-neutral-600 border-t-white animate-spin" />
        )}
        <span className="absolute bottom-1.5 left-2 text-[10px] text-neutral-400 bg-black/40 rounded px-1.5 py-0.5">
          {showBase ? "originale (senza grade)" : "grade attivo"}
        </span>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-neutral-800 shrink-0">
        <button
          onClick={() => move(-1)}
          disabled={refs.length < 2}
          className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-25"
          aria-label="foto precedente"
        >
          <IconChevronLeft />
        </button>
        <span className="text-[11px] text-neutral-500 tabular-nums flex-1 truncate" title="Usa le frecce per scegliere una foto di riferimento (es. una col cielo)">
          {ref ? `${ref.id}` : "—"}
          {refs.length ? `  ·  ${idx + 1}/${refs.length}` : ""}
        </span>
        <button
          onClick={() => move(1)}
          disabled={refs.length < 2}
          className="p-1 rounded text-neutral-400 hover:text-white disabled:opacity-25"
          aria-label="foto successiva"
        >
          <IconChevronRight />
        </button>
        <button
          onPointerDown={() => {
            holding.current = true;
            setCompare(true);
          }}
          className={
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs " +
            (compare ? "bg-sky-900/50 text-sky-200" : "bg-neutral-800 text-neutral-300")
          }
        >
          <IconCompare />
          Confronta
        </button>
      </div>
    </div>
  );
}
