import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Il player di Darkroom: serve a GIUDICARE un video, non solo a guardarlo.
 *
 * Quello che il tag nativo non da': lo zoom (per vedere se una zampa o una coda si fonde con
 * l'altra, o se una scaglia "ribolle"), il passo-fotogramma, la velocita' lenta e il fullscreen
 * con gli stessi comandi. Il file resta quello originale: qui non si ricodifica niente.
 *
 * Tastiera (con il player a fuoco, o in fullscreen):
 *   spazio play/pausa · ←/→ ±1 s (maiusc ±5 s) · , e . un fotogramma · [ e ] velocita'
 *   f fullscreen · m muto · l loop · + e - zoom · 0 azzera lo zoom
 * Rotella (o pizzico sul trackpad) zooma sul punto sotto il cursore, trascinare sposta, doppio
 * clic alterna 1x e 3x.
 */

const RATES = [0.1, 0.25, 0.5, 1, 1.5, 2];
const MAX_ZOOM = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "0:00.0";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export default function VideoPlayer({
  src,
  poster,
  fps = 24,
  title,
  autoPlay = false,
}: {
  src: string;
  poster?: string;
  fps?: number | null;
  title?: string;
  autoPlay?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [muted, setMuted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fs, setFs] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const frameRate = fps && fps > 0 ? fps : 24;

  /** Tiene il contenuto dentro lo stage: con zoom 1 non c'e' niente da spostare. */
  const clampPan = useCallback((x: number, y: number, z: number) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    return {
      x: clamp(x, el.clientWidth * (1 - z), 0),
      y: clamp(y, el.clientHeight * (1 - z), 0),
    };
  }, []);

  const zoomAt = useCallback(
    (nextZoom: number, cx: number, cy: number) => {
      setZoom((z) => {
        const nz = clamp(nextZoom, 1, MAX_ZOOM);
        setPan((p) => {
          // Il punto sotto il cursore resta fermo: e' cio' che fa sentire lo zoom "su" qualcosa.
          const lx = (cx - p.x) / z;
          const ly = (cy - p.y) / z;
          return nz === 1 ? { x: 0, y: 0 } : clampPan(cx - nz * lx, cy - nz * ly, nz);
        });
        return nz;
      });
    },
    [clampPan],
  );

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = useCallback((to: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clamp(to, 0, Number.isFinite(v.duration) ? v.duration : to);
    setT(v.currentTime);
  }, []);

  const step = useCallback(
    (frames: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      seek(v.currentTime + frames / frameRate);
    },
    [frameRate, seek],
  );

  /**
   * Il fullscreen e' a due livelli. Il primo e' sempre uno schermo pieno in CSS (`fixed inset-0`):
   * funziona in qualunque riquadro. Il secondo e' quello nativo, che copre anche la barra del
   * sistema: lo provo sopra al primo e lo lascio solo se la pagina resta visibile (se il nativo
   * lasciasse il player a 0x0, resta il livello CSS). Verificato nel riquadro di Topics: 3440x1440.
   */
  const ignoreNativeExit = useRef(false);
  const nativeEl = () => {
    const doc = document as FsDoc;
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  };
  const exitNative = useCallback(() => {
    const doc = document as FsDoc;
    if (!nativeEl()) return;
    ignoreNativeExit.current = true;
    void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    setTimeout(() => (ignoreNativeExit.current = false), 300);
  }, []);
  const exitFs = useCallback(() => {
    setFs(false);
    exitNative();
    resetZoom();
  }, [exitNative, resetZoom]);
  const enterFs = useCallback(() => {
    setFs(true);
    resetZoom();
    const box = boxRef.current as FsEl | null;
    try {
      void (box?.requestFullscreen?.() ?? box?.webkitRequestFullscreen?.());
    } catch {
      return; // il CSS basta
    }
    setTimeout(() => {
      if (nativeEl() === boxRef.current && (boxRef.current?.getBoundingClientRect().width ?? 0) === 0) exitNative();
    }, 500);
  }, [exitNative, resetZoom]);
  const toggleFs = useCallback(() => (fs ? exitFs() : enterFs()), [fs, enterFs, exitFs]);

  // Il tempo a schermo segue il fotogramma, non solo `timeupdate` (4 volte al secondo).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setT(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onFs = () => {
      if (nativeEl()) return;
      // L'utente e' uscito dal nativo (Esc del sistema): esce tutto. Se l'ho chiuso io perche'
      // la pagina era vuota, il livello CSS resta.
      if (!ignoreNativeExit.current) {
        setFs(false);
        resetZoom();
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, [resetZoom]);

  // Esc chiude il fullscreen CSS prima di chiunque altro: sopra il player puo' esserci un
  // visore che con Esc si chiude, e non deve portarsi via anche il video.
  useEffect(() => {
    if (!fs) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Immediate: se l'evento arriva direttamente alla finestra, gli altri ascoltatori della
      // stessa finestra non si fermano con il solo stopPropagation.
      e.stopImmediatePropagation();
      exitFs();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [fs, exitFs]);

  // La rotella va agganciata a mano: React la registra "passive" e non potrebbe fermare lo scroll.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // Il pizzico del trackpad arriva con ctrlKey e deltaY piccolo: va amplificato.
      const k = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(zoom * Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, zoomAt]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "SELECT") return;
    const big = e.shiftKey ? 5 : 1;
    let used = true;
    switch (e.key) {
      case " ":
      case "k":
        toggle();
        break;
      case "ArrowLeft":
        seek((videoRef.current?.currentTime ?? 0) - big);
        break;
      case "ArrowRight":
        seek((videoRef.current?.currentTime ?? 0) + big);
        break;
      case ",":
        step(-1);
        break;
      case ".":
        step(1);
        break;
      case "[":
        setRate((r) => RATES[Math.max(0, RATES.indexOf(r) - 1)] ?? r);
        break;
      case "]":
        setRate((r) => RATES[Math.min(RATES.length - 1, RATES.indexOf(r) + 1)] ?? r);
        break;
      case "f":
        toggleFs();
        break;
      case "m":
        setMuted((m) => !m);
        break;
      case "l":
        setLoop((l) => !l);
        break;
      case "+":
      case "=": {
        const el = stageRef.current;
        if (el) zoomAt(zoom * 1.5, el.clientWidth / 2, el.clientHeight / 2);
        break;
      }
      case "-": {
        const el = stageRef.current;
        if (el) zoomAt(zoom / 1.5, el.clientWidth / 2, el.clientHeight / 2);
        break;
      }
      case "0":
        resetZoom();
        break;
      default:
        used = false;
    }
    // Il dettaglio foto ha le sue frecce (versione precedente/successiva): qui non devono passare.
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setPan(clampPan(d.px + dx, d.py + dy, zoom));
  };
  const onPointerUp = () => {
    // `moved` resta fino al click che segue: trascinare non deve mettere in pausa.
    setTimeout(() => (drag.current = null), 0);
  };
  const onStageClick = () => {
    if (drag.current?.moved) return;
    toggle();
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    if (zoom > 1) resetZoom();
    else zoomAt(3, e.clientX - r.left, e.clientY - r.top);
  };

  const frame = Math.round(t * frameRate);
  const btn =
    "px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-100 disabled:opacity-40";

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="video-player"
      data-fullscreen={fs ? "1" : "0"}
      className={`group bg-black outline-none focus-visible:ring-1 focus-visible:ring-amber-500 ${
        fs ? "fixed inset-0 z-[70] flex flex-col" : "rounded"
      }`}
    >
      <div
        ref={stageRef}
        className={`relative overflow-hidden select-none ${fs ? "flex-1 min-h-0" : "w-full mx-auto"} ${
          zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        }`}
        style={fs ? undefined : { aspectRatio: size ? `${size.w} / ${size.h}` : "9 / 16", maxHeight: "60vh" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onStageClick}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
        >
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            title={title}
            className="h-full w-full object-contain pointer-events-none"
            playsInline
            preload="metadata"
            loop={loop}
            muted={muted}
            autoPlay={autoPlay}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDur(v.duration);
              if (v.videoWidth) setSize({ w: v.videoWidth, h: v.videoHeight });
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => !playing && setT(e.currentTarget.currentTime)}
            onSeeked={(e) => setT(e.currentTarget.currentTime)}
          />
        </div>
        {!playing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-black/55 px-5 py-3 text-2xl text-white">▶</span>
          </div>
        )}
        {zoom > 1 && (
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-0.5 text-xs text-amber-300">
            {zoom.toFixed(1)}×
          </span>
        )}
      </div>

      <div className="space-y-1.5 bg-neutral-950 px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="range"
          aria-label="Posizione"
          min={0}
          max={dur || 0}
          step="any"
          value={Math.min(t, dur || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full accent-amber-500"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={btn} onClick={toggle} aria-label={playing ? "Pausa" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" className={btn} onClick={() => step(-1)} aria-label="Fotogramma indietro" title="Fotogramma indietro ( , )">
            ◀|
          </button>
          <button type="button" className={btn} onClick={() => step(1)} aria-label="Fotogramma avanti" title="Fotogramma avanti ( . )">
            |▶
          </button>
          <span className="px-1 text-xs tabular-nums text-neutral-300" data-testid="player-time">
            {fmt(t)} / {fmt(dur)} · f{frame}
          </span>
          <span className="flex-1" />
          <select
            aria-label="Velocità"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="rounded bg-neutral-800 px-1 py-1 text-xs text-neutral-100"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          <button type="button" className={btn} onClick={() => setLoop((l) => !l)} aria-pressed={loop} title="Loop ( l )">
            {loop ? "↻ loop" : "→ una volta"}
          </button>
          <button type="button" className={btn} onClick={() => setMuted((m) => !m)} aria-pressed={muted} title="Muto ( m )">
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            className={btn}
            onClick={resetZoom}
            disabled={zoom === 1}
            title="Azzera lo zoom ( 0 )"
          >
            {zoom === 1 ? "1×" : `${zoom.toFixed(1)}× ⟲`}
          </button>
          <button type="button" className={btn} onClick={toggleFs} title="Schermo intero ( f )" data-testid="player-fullscreen">
            {fs ? "Esci ⤡" : "Schermo intero ⤢"}
          </button>
        </div>
      </div>
    </div>
  );
}
