import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, currentProject, type PhotoListItem } from "../api";
import { thumbRawUrl, thumbGenUrl, gradedUrl } from "../api";

type JobStatus = "pending" | "running" | "failed";

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
  // "Mi piace": la scelta che si prende scorrendo la griglia. Ottimistica —
  // scegliere 190 foto è un gesto ripetuto, non deve aspettare la rete.
  const [picked, setPicked] = useState(photo.picked === 1);
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
  // MODIFICA (nota vecchia in preview): prima il box textarea si pre-riempiva
  // con la nota salvata, quindi rivedendo il risultato di una run ti ritrovavi
  // la vecchia nota già dentro il campo e la editavi sopra. Ora la nota salvata
  // ("vecchia") è mostrata read-only sopra il campo (vedi overlay più sotto) e
  // il box parte SEMPRE vuoto: serve a scrivere la nota NUOVA per il giro
  // corrente. Salvare una nota nuova sostituisce quella di record; il box vuoto
  // è un no-op (non azzera la nota esistente) — per questo non si può più
  // "cancellare" una nota dalla griglia, scelta voluta per non perderle a vuoto.
  const [fb, setFb] = useState("");
  const [savedFb, setSavedFb] = useState(photo.feedback ?? "");
  const [fbSaving, setFbSaving] = useState(false);
  const [fbSaved, setFbSaved] = useState(false);
  const [fbFocused, setFbFocused] = useState(false);
  // Adotta la verità del server quando la lista si aggiorna — ma solo la nota
  // salvata (read-only). Il box `fb` (nota nuova) non si tocca mai qui: resta
  // vuoto/quello che stai scrivendo, così non ti ricompare la nota vecchia dentro.
  useEffect(() => {
    if (fbFocused) return;
    setSavedFb(photo.feedback ?? "");
  }, [photo.feedback]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveFb() {
    const value = fb.trim();
    if (!value) return; // box vuoto = nessuna nota nuova → non azzerare la vecchia
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
      setPicked(!next); // la rete ha detto no: torna com'era
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
      to={`/p/${currentProject()}/photo/${encodeURIComponent(photo.id)}`}
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault();
          onToggleSelect?.();
        }
      }}
      // 4:5, non quadrata. Le versioni generate escono verticali (il prompt
      // chiede un crop 4:5), quindi una cella quadrata con object-cover ne
      // tagliava via un quinto: si giudicava una foto senza vederne il bordo,
      // ed e' proprio il bordo che il reframe dell'AI cambia.
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

      {/* Badge PRO: questo render viene dal modello a pagamento (GPT Image 2 via
          Higgsfield), non dalla versione web. La web è una bozza — 1 MP, neri
          schiacciati — e senza un segno visibile non si sa quali foto sono già
          state portate a master. */}
      {photo.shown_provider === "higgsfield" && (
        <span className="pointer-events-none absolute bottom-1 left-1 z-20 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-emerald-950">
          PRO
        </span>
      )}

      {/* Contatore versioni. Sta in BASSO a destra: in alto a sinistra c'è il
          cuore, e i due si sovrapponevano — si intravedeva il badge da sotto il
          bottone, senza capire cosa fosse. In selezione scala per non finire
          sotto la spunta. */}
      <div className={`absolute bottom-1 ${selectMode ? "right-9" : "right-1"} flex items-center gap-1 pointer-events-none`}>
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

      {/* In alto a sinistra: "mi piace". È l'azione più frequente della
          griglia (si scorre e si sceglie), quindi ha il posto migliore e non
          richiede né selezione né menu. Distinta dalla stella, che riguarda
          quale RENDER di questa foto è quello buono. */}
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
          NB sugli z-index di questa card: restano tutti sotto z-30, che è il
          livello dell'header sticky dell'app. A parità di z-index vince chi
          viene dopo nel DOM — e la griglia viene dopo l'header — quindi un
          controllo a z-30 qui dentro scavalcava la barra in alto mentre si
          scorreva. */}
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
        className={`absolute inset-x-0 bottom-0 z-10 p-1.5 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity ${
          fbFocused
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
        }`}
      >
        <div className="relative">
          {/* Nota vecchia (già salvata): read-only, come riferimento mentre
              scrivi quella nuova. Sta nella preview, non dentro il box. */}
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
            className="w-full resize-none rounded bg-black/70 border border-neutral-600 focus:border-amber-400 outline-none px-1.5 py-1 text-[11px] leading-snug text-neutral-100 placeholder:text-neutral-500"
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
        <div className="absolute bottom-1 left-1 z-10 flex items-center gap-1 rounded bg-amber-400/90 text-amber-950 text-[9px] font-semibold px-1 py-0.5 opacity-100 group-hover:opacity-0 transition-opacity pointer-events-none">
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor">
            <path d="M4 4h16v11H8l-4 4V4z" />
          </svg>
          nota
        </div>
      )}
    </Link>
  );
}
