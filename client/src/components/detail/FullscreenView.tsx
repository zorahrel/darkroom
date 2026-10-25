import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// La versione a tutto schermo, a piena risoluzione: per guardare la foto in
// grande invece che nel riquadro dell'anteprima.
export function FullscreenView({
  src,
  alt,
  onClose,
  zoomable = false,
  gallery,
  index = 0,
  onIndex,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  /** Un clic sull'immagine la porta a 1:1 nel punto cliccato, un altro la
   *  rimette intera; si chiude con ✕ o Esc. Serve dove il dettaglio e' il
   *  punto: sulle foto di identita' i nei sono pochi pixel, e a schermo
   *  intero adattato un selfie 1440x2560 li riduce a mezzo pixel. */
  zoomable?: boolean;
  /** Piu' foto da scorrere nello stesso lightbox (i riferimenti di una
   *  versione): frecce, tasti ←/→ e una striscia in basso. Senza, si comporta
   *  come prima. `src`/`alt` restano quelli della foto corrente. */
  gallery?: { src: string; alt: string }[];
  index?: number;
  onIndex?: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** Dove portare lo scroll dopo il passaggio a 1:1: la frazione cliccata. */
  const [zoom, setZoom] = useState<{ fx: number; fy: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!zoom || !el) return;
    el.scrollLeft = zoom.fx * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = zoom.fy * el.scrollHeight - el.clientHeight / 2;
  }, [zoom]);

  /** Frazione dell'immagine sotto il clic, tenendo conto delle bande di
   *  `object-contain`: un clic sulla banda nera non cade su nessun pixel. */
  function puntoCliccato(e: React.MouseEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const box = img.getBoundingClientRect();
    const k = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    const fx = (e.clientX - box.left - (box.width - w) / 2) / w;
    const fy = (e.clientY - box.top - (box.height - h) / 2) / h;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return { fx, fy };
  }
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const n = gallery?.length ?? 0;
  const vai = (d: number) => {
    if (n > 1 && onIndex) onIndex((index + d + n) % n);
  };
  const vaiRef = useRef(vai);
  vaiRef.current = vai;
  // Cambiando foto si riparte dall'immagine intera, non dallo zoom della precedente.
  useEffect(() => setZoom(null), [src]);

  useEffect(() => {
    const el = ref.current;
    // Il Fullscreen API e' un di piu': nel pane WebKit incorporato spesso manca
    // o viene rifiutato, e l'overlay fisso basta comunque a riempire la finestra.
    let entered = false;
    if (el?.requestFullscreen) {
      el.requestFullscreen()
        .then(() => {
          entered = true;
        })
        .catch(() => {});
    }
    // In fullscreen vero Esc lo consuma il browser: l'uscita arriva come
    // fullscreenchange, e a quel punto si chiude anche l'overlay.
    const onChange = () => {
      if (entered && !document.fullscreenElement) closeRef.current();
    };
    // In cattura e fermato: sotto c'e' l'EditorRail, che con Esc chiude il dettaglio.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        vaiRef.current(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey, true);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      data-testid="fullscreen-view"
      className={
        "fixed inset-0 z-[80] bg-black " + (zoom ? "overflow-auto cursor-zoom-out" : "cursor-zoom-out")
      }
      onClick={zoomable ? undefined : onClose}
      // Il portale non ferma gli eventi React: senza questo, premere sull'overlay
      // arriverebbe all'anteprima sotto e le farebbe mostrare l'originale.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <img
        src={src}
        alt={alt}
        className={
          zoom
            ? "block max-w-none cursor-zoom-out"
            : "absolute inset-0 w-full h-full object-contain" + (zoomable ? " cursor-zoom-in" : "")
        }
        draggable={false}
        onClick={
          zoomable
            ? (e) => {
                e.stopPropagation();
                if (zoom) return setZoom(null);
                const p = puntoCliccato(e);
                if (p) setZoom(p);
              }
            : undefined
        }
      />
      <button
        type="button"
        aria-label="chiudi"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-3 right-3 z-[81] h-8 w-8 rounded border border-neutral-500 bg-neutral-950/85 text-sm text-neutral-100 hover:border-neutral-200"
      >
        ✕
      </button>
      {n > 1 && (
        <>
          {(["<", ">"] as const).map((v, k) => (
            <button
              key={v}
              type="button"
              aria-label={k === 0 ? "precedente" : "successiva"}
              onClick={(e) => {
                e.stopPropagation();
                vai(k === 0 ? -1 : 1);
              }}
              className={
                "fixed top-1/2 -translate-y-1/2 z-[81] h-12 w-10 rounded border border-neutral-500 bg-neutral-950/85 text-lg text-neutral-100 hover:border-neutral-200 " +
                (k === 0 ? "left-3" : "right-3")
              }
            >
              {v}
            </button>
          ))}
          {/* La striscia: tutte le foto del set, intere, la corrente evidenziata. */}
          <div
            className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[81] flex max-w-[92vw] gap-2 overflow-x-auto rounded border border-neutral-700 bg-neutral-950/85 p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {gallery!.map((g, k) => (
              <button
                key={g.src}
                type="button"
                title={g.alt}
                onClick={() => onIndex?.(k)}
                className={
                  "h-16 w-16 flex-none rounded bg-black " +
                  (k === index ? "ring-2 ring-white" : "ring-1 ring-white/20 hover:ring-white/60")
                }
              >
                <img src={g.src} alt={g.alt} className="h-full w-full object-contain" draggable={false} />
              </button>
            ))}
          </div>
          <div className="fixed top-3 left-3 z-[81] rounded bg-neutral-950/85 px-2 py-1 text-xs text-neutral-100">
            {index + 1}/{n} · {alt}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
