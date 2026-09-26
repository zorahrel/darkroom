import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// La versione a tutto schermo, a piena risoluzione: per guardare la foto in
// grande invece che nel riquadro dell'anteprima.
export function FullscreenView({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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
      className="fixed inset-0 z-[80] bg-black cursor-zoom-out"
      onClick={onClose}
      // Il portale non ferma gli eventi React: senza questo, premere sull'overlay
      // arriverebbe all'anteprima sotto e le farebbe mostrare l'originale.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
      />
      <button
        type="button"
        aria-label="chiudi"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-3 right-3 h-8 w-8 rounded border border-neutral-500 bg-neutral-950/85 text-sm text-neutral-100 hover:border-neutral-200"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
