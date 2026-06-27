import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PhotoListItem } from "../api";
import { thumbRawUrl, thumbGenUrl } from "../api";

type JobStatus = "pending" | "running" | "failed";

export default function PhotoCard({
  photo,
  jobStatus,
  onFavoriteChange,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  photo: PhotoListItem;
  jobStatus?: JobStatus;
  onFavoriteChange?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [isFavorite, setIsFavorite] = useState(photo.favorite_version_id !== null);
  const [busy, setBusy] = useState(false);

  // Serve a single high-res thumb regardless of card/zoom — keeps it sharp at
  // any zoom level without srcset complexity. 2400px max-dim covers full screen
  // even on retina @ 200% browser zoom.
  const FULL_W = 2400;
  const previewVersion = photo.favorite_version_number ?? photo.latest_version_number;
  const previewUrl = previewVersion
    ? thumbGenUrl(photo.id, previewVersion, FULL_W)
    : thumbRawUrl(photo.id, FULL_W);
  const rawUrl = thumbRawUrl(photo.id, FULL_W);
  const hasEdit = previewVersion !== null;

  // When a new version is generated, previewUrl changes but its thumbnail isn't
  // cached yet — swapping the src immediately leaves a blank flash while the
  // server renders it. Preload the new image and only swap once it's ready, so
  // the current image stays visible (no flicker in the grid during the batch).
  const [displayedUrl, setDisplayedUrl] = useState(previewUrl);
  useEffect(() => {
    if (previewUrl === displayedUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setDisplayedUrl(previewUrl);
    };
    img.src = previewUrl;
    return () => {
      cancelled = true;
    };
  }, [previewUrl, displayedUrl]);

  const targetFavoriteId = photo.favorite_version_id ?? photo.latest_version_id;

  async function toggleFavorite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!targetFavoriteId && !isFavorite) return; // nothing to favorite
    setBusy(true);
    try {
      const newFav = isFavorite ? null : targetFavoriteId;
      await api.setFavorite(photo.id, newFav);
      setIsFavorite(!isFavorite);
      onFavoriteChange?.();
    } finally {
      setBusy(false);
    }
  }

  const ringClass = selected
    ? "ring-2 ring-blue-400"
    : jobStatus === "running"
      ? "ring-2 ring-amber-400"
      : jobStatus === "pending"
        ? "ring-1 ring-blue-400/60"
        : jobStatus === "failed"
          ? "ring-2 ring-red-500"
          : "";

  return (
    <Link
      to={`/photo/${encodeURIComponent(photo.id)}`}
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault();
          onToggleSelect?.();
        }
      }}
      className={`group relative block aspect-square overflow-hidden rounded-md bg-neutral-900 border ${selected ? "border-blue-500" : "border-neutral-800"} hover:border-neutral-600 transition-colors ${ringClass}`}
    >
      {/* Base layer: best preview (favorite/latest or RAW) */}
      <img
        src={displayedUrl}
        alt={photo.id}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Hover layer: RAW (only if we have an edit to compare against) */}
      {hasEdit && (
        <img
          src={rawUrl}
          alt={`${photo.id} (originale)`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        />
      )}

      {/* Selection check (visible in selectMode) */}
      {selectMode && (
        <div
          className={`absolute top-1 left-1 z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            selected ? "bg-blue-500 text-white" : "bg-black/60 text-neutral-400 border border-neutral-500"
          }`}
        >
          {selected ? "✓" : ""}
        </div>
      )}
      {/* Dim non-selected cards in select mode */}
      {selectMode && !selected && (
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      )}

      {/* Top-left version badge */}
      <div className={`absolute top-1 ${selectMode ? "left-9" : "left-1"} flex items-center gap-1 pointer-events-none`}>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            photo.version_count === 0
              ? "bg-red-900/70 text-red-100"
              : "bg-black/60 text-neutral-200"
          }`}
        >
          {photo.version_count}v
        </span>
      </div>

      {/* Centered status icon (big & animated) */}
      {jobStatus && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px] pointer-events-none">
          {jobStatus === "running" && (
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-10 h-10 text-amber-300 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[10px] font-medium tracking-wider text-amber-100 uppercase">generando</span>
            </div>
          )}
          {jobStatus === "pending" && (
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-9 h-9 text-blue-300 animate-pulse"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span className="text-[10px] font-medium tracking-wider text-blue-100 uppercase">in coda</span>
            </div>
          )}
          {jobStatus === "failed" && (
            <div className="flex flex-col items-center gap-1">
              <svg
                className="w-10 h-10 text-red-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-[10px] font-medium tracking-wider text-red-100 uppercase">errore</span>
            </div>
          )}
        </div>
      )}

      {/* Top-right: favorite toggle */}
      {(hasEdit || isFavorite) && (
        <button
          onClick={toggleFavorite}
          disabled={busy}
          aria-label={isFavorite ? "Rimuovi preferita" : "Segna preferita"}
          className={`absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
            isFavorite
              ? "bg-amber-400 text-amber-950 shadow"
              : "bg-black/40 text-neutral-300 opacity-0 group-hover:opacity-100 hover:bg-black/70 hover:text-amber-300"
          }`}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      )}

      {/* Bottom hint: hover reveals "vedi originale" */}
      {hasEdit && (
        <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          hover = RAW
        </div>
      )}
    </Link>
  );
}
