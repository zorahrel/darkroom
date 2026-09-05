import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, currentProject, type PhotoListItem } from "../api";
import { thumbRawUrl, thumbGenUrl, gradedUrl } from "../api";

type JobStatus = "pending" | "running" | "failed";

/** Below this width the cell has no room for multiple badges: only the
 *  essentials are kept (heart and star) and the rest disappears. Better nothing
 *  than three unreadable overlapping labels. */
const COMPACT_PX = 150;

export default function PhotoCard({
  photo,
  jobStatus,
  onFavoriteChange,
  onPickedChange,
  selectMode = false,
  selected = false,
  onToggleSelect,
  graded = false,
  bust = 0,
  previewVersionOverride,
}: {
  photo: PhotoListItem;
  jobStatus?: JobStatus;
  onFavoriteChange?: () => void;
  onPickedChange?: (id: string, picked: boolean) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  graded?: boolean;
  bust?: number;
  previewVersionOverride?: number;
}) {
  const [isFavorite, setIsFavorite] = useState(photo.favorite_version_id !== null);
  const [busy, setBusy] = useState(false);
  // "Like": the choice made while scrolling the grid. Optimistic — choosing
  // 190 photos is a repeated gesture, it must not wait for the network.
  const [picked, setPicked] = useState(photo.picked === 1);
  // The cell's real width: the badges are shown only if they fit.
  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setCompact(e.contentRect.width < COMPACT_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setPicked(photo.picked === 1);
  }, [photo.picked]);

  // One thumb size for every zoom level (no srcset complexity). The grid tile
  // maxes at 400px (zoom slider), so 1000px stays crisp even at max zoom on
  // retina while rendering/transferring ~6x less than the old 2400px — the grid
  // (esp. the on-the-fly /graded pass) was the load bottleneck.
  const FULL_W = 1000;
  const previewVersion =
    previewVersionOverride ??
    photo.favorite_version_number ??
    photo.latest_version_number;
  // When graded view is on, the base layer renders the version with the global
  // color look baked in (on the fly). `bust` busts the cache after grade edits.
  const previewUrl = previewVersion
    ? graded
      ? gradedUrl(photo.id, previewVersion, FULL_W, bust)
      : thumbGenUrl(photo.id, previewVersion, FULL_W)
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

  // ---- Feedback note (hover-revealed, ⏎ saves) ----------------------------
  // Freeform review jot per photo. Read in bulk later to steer the next run;
  // deliberately NOT injected into the prompt (that's extra_instructions).
  //
  // CHANGE (old note in preview): the textarea used to be pre-filled with the
  // saved note, so reviewing a run's result you found the old note already in
  // the field and edited over it. Now the saved ("old") note is shown read-only
  // above the field (see the overlay further down) and the box ALWAYS starts
  // empty: it is for writing the NEW note for the current round. Saving a new
  // note replaces the one on record; an empty box is a no-op (it does not clear
  // the existing note) — which is why a note can no longer be "deleted" from
  // the grid, a deliberate choice so they are not lost for nothing.
  const [fb, setFb] = useState("");
  const [savedFb, setSavedFb] = useState(photo.feedback ?? "");
  const [fbSaving, setFbSaving] = useState(false);
  const [fbSaved, setFbSaved] = useState(false);
  const [fbFocused, setFbFocused] = useState(false);
  // Adopt the server's truth when the list refreshes — but only the saved
  // (read-only) note. The `fb` box (the new note) is never touched here: it
  // stays empty, or whatever you are typing, so the old note does not reappear
  // inside it.
  useEffect(() => {
    if (fbFocused) return;
    setSavedFb(photo.feedback ?? "");
  }, [photo.feedback]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveFb() {
    const value = fb.trim();
    if (!value) return; // empty box = no new note → do not clear the old one
    if (value === savedFb.trim()) {
      setFb("");
      return;
    }
    setFbSaving(true);
    try {
      await api.setFeedback(photo.id, value);
      setSavedFb(value);
      setFb(""); // svuota il box: pronto per la prossima nota, la salvata sta in preview
      setFbSaved(true);
      setTimeout(() => setFbSaved(false), 1200);
    } finally {
      setFbSaving(false);
    }
  }

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

  async function togglePicked(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !picked;
    setPicked(next);
    try {
      await api.setPicked(photo.id, next);
      onPickedChange?.(photo.id, next);
    } catch {
      setPicked(!next); // the network said no: put it back the way it was
    }
  }

  const ringClass = selected
    ? "ring-2 ring-blue-400"
    : jobStatus === "running"
      ? "ring-2 ring-amber-400"
      : jobStatus === "pending"
        ? "ring-1 ring-blue-400/60"
        : jobStatus === "failed"
          // Thin and muted, not `ring-2 ring-red-500`: a failure is to be known
          // about, not chased. At the same intensity as a SELECTED element,
          // twelve failed cells shouted louder than the one cell being worked
          // on.
          ? "ring-1 ring-red-500/50"
          : "";

  return (
    <Link
      ref={cardRef}
      to={`/p/${currentProject()}/photo/${encodeURIComponent(photo.id)}`}
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault();
          onToggleSelect?.();
        }
      }}
      // 4:5, not square. The generated versions come out vertical (the prompt
      // asks for a 4:5 crop), so a square cell with object-cover cut a fifth
      // off: you judged a photo without seeing its edge, and the edge is
      // precisely what the AI's reframe changes.
      className={`group relative block aspect-[4/5] overflow-hidden rounded-md bg-neutral-900 border ${selected ? "border-blue-500" : "border-neutral-800"} hover:border-neutral-600 transition-colors ${ringClass}`}
    >
      {/* Base layer: best preview (favorite/latest or RAW) */}
      <img
        src={displayedUrl}
        alt={photo.id}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-contain"
      />
      {/* Hover layer: RAW (only if we have an edit to compare against) */}
      {hasEdit && (
        <img
          src={rawUrl}
          alt={`${photo.id} (originale)`}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
            fbFocused ? "opacity-0" : "opacity-0 group-hover:opacity-100"
          }`}
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

      {/* PRO badge: this render comes from the paid model (GPT Image 2 via
          Higgsfield), not the web version. The web one is a draft — 1 MP,
          crushed blacks — and without a visible mark there is no telling which
          photos have already been taken to master. */}
      {/* Render from the pro model: a green dot beside the star, not a
          label. It is for telling master and draft apart out of the corner of
          the eye while scrolling — and unlike a word it stays readable even on
          the smallest cell, where everything else disappears. */}
      {/* Cover: in the "Covers" view the photos come from different posts
          and without the title there is no telling what they promise.
          NOT top left: the "like" heart (z-20) and the slot number (z-10) are
          already there, and at z-30 it covered both. Here it sits at the
          BOTTOM, as wide as the cell minus the margins, above the note's strip
          but below the loading overlay. */}
      {photo.cover_of && (
        <span
          // Reaching the right edge it covered the version counter on all 7
          // cards (measured: ~500px of overlap). It stops earlier, leaving it
          // its corner.
          className={
            "pointer-events-none absolute bottom-1 left-1 z-20 truncate rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black " +
            (selectMode ? "right-16" : "right-9")
          }
          title={`Copertina di: ${photo.cover_of}`}
        >
          ★ {photo.cover_of}
        </span>
      )}
      {photo.shown_provider === "higgsfield" && (
        <span
          title="Foto pronta: render dal modello pro (GPT Image 2)"
          // On the "Covers" filter they coexist with the title's yellow band:
          // same bottom edge, they would cover each other. Here they rise above
          // it.
          className={`pointer-events-none absolute ${photo.cover_of ? "bottom-7" : "bottom-1"} left-1/2 z-30 -translate-x-1/2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-emerald-950 shadow ring-1 ring-emerald-300/60`}
        >
          ✓ PRONTA
        </span>
      )}

      {/* Version counter. It sits BOTTOM right: top left is the heart, and
          the two overlapped — you glimpsed the badge from under the button,
          without understanding what it was. In selection it shifts so as not to
          end up under the tick. */}
      <div
        className={
          "absolute bottom-1 flex items-center gap-1 pointer-events-none " +
          (selectMode ? "right-9 " : "right-1 ") +
          // On a small cell it disappears: the number of versions is a service
          // detail, not worth the room it would steal from the photo.
          ""
        }
      >
        <span
          className={`font-mono rounded ${compact ? "px-1 text-[9px]" : "px-1.5 py-0.5 text-[10px]"} ${
            photo.skipped === 1
              ? "bg-amber-900/80 text-amber-100"
              : photo.version_count === 0
                ? "bg-red-900/70 text-red-100"
                : "bg-black/60 text-neutral-200"
          }`}
          // Zero versions is red because it is work to do. A photo refused by
          // ChatGPT has zero versions for ever: if it stays red it looks like
          // an error to chase, and every time you reopen it to discover the
          // same thing. Amber = it is stopped, and you know why.
          title={photo.skipped === 1 ? (photo.skip_reason ?? "saltata") : undefined}
        >
          {photo.skipped === 1 ? "skip" : `${photo.version_count}${compact ? "" : "v"}`}
        </span>
      </div>

      {/* An error is a DOT at the bottom, not a red sign in the middle.

          It used to be a filled red pill, centred on the top edge: the cell's
          point of maximum attention, right on the face, and with a dozen
          failures the grid became a row of red signs in which the photos
          disappeared. But a failure is almost always a stumble of the
          generator, and meanwhile the photo stays the only thing to look at to
          decide whether to keep it: it has to stay visible.

          It sits bottom left, opposite the version count, so the two pieces of
          information do not pile up. The colour is enough to find it while
          scrolling; the word appears on hover, which is when you really want to
          know what it is. The cell's red border (`ringClass`) already says
          something went wrong. */}
      {jobStatus === "failed" && (
        <span
          title="L'ultima generazione è fallita"
          className="pointer-events-none absolute left-1 bottom-1 z-20 flex items-center gap-1
                     rounded bg-black/70 px-1 py-px text-[9px] font-medium text-red-300/90
                     opacity-70 group-hover:opacity-100 transition-opacity"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="hidden group-hover:inline uppercase tracking-wide">errore</span>
        </span>
      )}

      {/* Work in progress: here the veil makes sense, because the photo is
          about to change and is not the final one yet. */}
      {jobStatus && jobStatus !== "failed" && (
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
        </div>
      )}

      {/* Top left: "like". It is the grid's most frequent action (you scroll
          and you choose), so it gets the best spot and requires neither
          selection nor a menu. Distinct from the star, which is about which
          RENDER of this photo is the good one. */}
      <button
        onClick={togglePicked}
        aria-label={picked ? "Non mi piace più" : "Mi piace"}
        aria-pressed={picked}
        className={`absolute top-1 left-1 z-20 w-7 h-7 rounded-full flex items-center justify-center text-sm transition-all ${
          picked
            ? "bg-rose-500/85 text-white shadow backdrop-blur-sm"
            : "bg-black/40 text-neutral-300 opacity-0 group-hover:opacity-100 hover:bg-black/70 hover:text-rose-300"
        }`}
      >
        {picked ? "♥" : "♡"}
      </button>

      {/* Top-right: favorite toggle.
          NB on this card's z-indexes: they all stay below z-30, which is the
          level of the app's sticky header. At equal z-index whoever comes later
          in the DOM wins — and the grid comes after the header — so a control
          at z-30 in here jumped over the top bar while scrolling. */}
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

      {/* Feedback note: hover/focus reveals a field; ⏎ salva, ⇧⏎ a capo. */}
      <div
        onClick={(e) => {
          // Keep clicks inside the note from navigating to the detail page.
          e.preventDefault();
          e.stopPropagation();
        }}
        // bottom-7, not bottom-0: underneath runs the strip with the slide
        // number, the colour badge and the version counter. A note reaching the
        // edge covers them, and those are the two facts read while scrolling.
        className={`absolute inset-x-0 bottom-7 z-10 p-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity ${compact ? "hidden " : ""}${
          fbFocused
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        }`}
      >
        <div className="relative">
          {/* Old note (already saved): read-only, as a reference while you
              write the new one. It lives in the preview, not inside the box. */}
          {savedFb.trim().length > 0 && (
            <div className="mb-1 max-h-16 overflow-y-auto whitespace-pre-wrap rounded border border-amber-500/30 bg-black/50 px-1.5 py-1 text-[10px] leading-snug text-amber-200/80">
              <span className="font-semibold text-amber-300/90">nota vecchia</span>{" "}
              {savedFb}
            </div>
          )}
          <textarea
            value={fb}
            rows={2}
            placeholder={savedFb.trim() ? "nota nuova… ⏎ salva" : "feedback… ⏎ salva"}
            onChange={(e) => setFb(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              // Interactive child of the card's <Link>: cancel the anchor's
              // native navigation, else clicking the field opens the photo.
              e.preventDefault();
              e.stopPropagation();
            }}
            onFocus={() => setFbFocused(true)}
            onBlur={() => {
              setFbFocused(false);
              void saveFb();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void saveFb();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className="w-full resize-none rounded bg-black/70 border border-neutral-600 focus:border-amber-400 outline-none px-1.5 py-1 text-[11px] leading-snug text-neutral-100 placeholder:text-neutral-400"
          />
          {(fbSaving || fbSaved) && (
            <span className="absolute right-1 bottom-1.5 text-[9px] font-medium text-amber-300 pointer-events-none">
              {fbSaving ? "…" : "salvato ✓"}
            </span>
          )}
        </div>
      </div>

      {/* Persistent badge: this photo carries a note (hidden while editing) */}
      {savedFb.trim().length > 0 && !fbFocused && (
        <div className={`absolute ${photo.cover_of ? "bottom-7" : "bottom-1"} left-1 z-10 flex items-center gap-1 rounded bg-amber-400/90 text-amber-950 text-[9px] font-semibold px-1 py-0.5 opacity-100 group-hover:opacity-0 transition-opacity pointer-events-none`}>
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor">
            <path d="M4 4h16v11H8l-4 4V4z" />
          </svg>
          nota
        </div>
      )}
    </Link>
  );
}
