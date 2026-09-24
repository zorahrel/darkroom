import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Annotation, type AnnotationTarget } from "../api";
import { pq } from "../api/http";
import { Bott } from "../ui";

/**
 * Disegnare sopra un'immagine per dire «qui» e «cosi'» invece di spiegarlo.
 *
 * PERCHE'. Sul Kaumat la striscia della nuca e' stata descritta a parole quattro
 * volte senza uscire giusta. Qui Attilio segna il punto col dito, la Pencil o il
 * mouse, scrive due parole, e il PNG composto finisce in Darkroom dove l'agente
 * lo legge.
 *
 * I tratti sono in coordinate 0..1 dell'immagine: il riquadro cambia dimensione
 * (rotazione dell'iPad, pannello ridimensionato) e il segno resta dov'era.
 */

type Point = { x: number; y: number; p: number };
type Stroke = { color: string; points: Point[] };

const COLORS = [
  { id: "#ff2d2d", name: "rosso" },
  { id: "#ffd400", name: "giallo" },
];
/** Spessore come frazione del lato lungo: uguale a ogni zoom e nel PNG salvato. */
const WIDTH = 0.006;
/** Il PNG salvato non supera questo lato: basta a leggere i segni, pesa poco. */
const MAX_SIDE = 2048;

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  const side = Math.max(w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    ctx.strokeStyle = s.color;
    const pts = s.points;
    const first = pts[0];
    if (!first) continue;
    if (pts.length === 1) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(first.x * w, first.y * h, (WIDTH * side * (0.5 + first.p)) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // Un segmento alla volta: la pressione della Pencil cambia lo spessore lungo
    // il tratto, e un path unico ne avrebbe uno solo.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      ctx.lineWidth = WIDTH * side * (0.5 + b.p);
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }
}

export function AnnotationLayer({
  src,
  target,
  title,
  onClose,
}: {
  src: string;
  target: AnnotationTarget;
  title: string;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [color, setColor] = useState("#ff2d2d");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Annotation[]>([]);
  const [viewing, setViewing] = useState<Annotation | null>(null);

  const key = JSON.stringify(target);
  const reload = useCallback(() => {
    api.annotations(target).then((r) => setSaved(r.annotations)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(reload, [reload]);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawStrokes(ctx, drawing.current ? [...strokes, drawing.current] : strokes, c.width, c.height);
  }, [strokes]);

  // La tela segue le dimensioni mostrate dell'immagine, in pixel veri dello schermo.
  useEffect(() => {
    const img = imgRef.current;
    const c = canvasRef.current;
    if (!img || !c) return;
    const fit = () => {
      const r = img.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      redraw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(img);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(redraw, [redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if ((e.metaKey || e.ctrlKey) && e.key === "z") setStrokes((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const at = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      // Il mouse riporta 0.5 fisso, il dito 0 o 1 secondo il browser: solo la
      // penna ha una pressione vera.
      p: e.pointerType === "pen" ? e.pressure : 0.5,
    };
  };

  const down = (e: React.PointerEvent) => {
    // La cattura tiene il tratto anche se il dito esce dall'immagine; su un
    // evento sintetico (le prove) non c'e' un puntatore da catturare.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* niente da catturare */
    }
    drawing.current = { color, points: [at(e)] };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current.points.push(at(e));
    redraw();
  };
  const up = () => {
    const s = drawing.current;
    drawing.current = null;
    if (s) setStrokes((all) => [...all, s]);
  };

  async function save(): Promise<boolean> {
    const img = imgRef.current;
    if (!img || (!strokes.length && !note.trim())) return true;
    setSaving(true);
    setError(null);
    try {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k);
      const h = Math.round(img.naturalHeight * k);
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const ctx = out.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      drawStrokes(ctx, strokes, w, h);
      await api.saveAnnotation(target, out.toDataURL("image/png"), note);
      setStrokes([]);
      setNote("");
      reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const empty = !strokes.length && !note.trim();

  // Chiudere salva: il 24/09 Attilio ha disegnato, ha chiuso senza premere
  // «salva» e il segno non e' mai arrivato. Se il salvataggio fallisce si resta
  // aperti, con l'errore in vista, invece di buttare il disegno.
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    if (empty) return onClose();
    void save().then((ok) => ok && onClose());
  };
  const close = () => closeRef.current();

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-neutral-100">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <Bott weight="quiet" size="s" onClick={close} aria-label="chiudi e salva">
          ✕
        </Bott>
        <span className="text-sm font-medium truncate">Annota · {title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={c.name}
              title={c.name}
              onClick={() => setColor(c.id)}
              className={
                "h-8 w-8 rounded-full border-2 " +
                (color === c.id ? "border-white" : "border-neutral-700")
              }
              style={{ background: c.id }}
            />
          ))}
          <Bott size="s" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
            annulla
          </Bott>
          <Bott size="s" onClick={() => setStrokes([])} disabled={!strokes.length}>
            cancella
          </Bott>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        <div className="relative inline-block max-h-full">
          <img
            ref={imgRef}
            src={src}
            alt={title}
            draggable={false}
            onLoad={redraw}
            className="block max-w-full max-h-[calc(100dvh-190px)] object-contain select-none"
          />
          <canvas
            ref={canvasRef}
            data-testid="annotation-canvas"
            className="absolute inset-0 h-full w-full cursor-crosshair"
            style={{ touchAction: "none" }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-neutral-800">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !empty && save()}
          placeholder="Nota: cosa va cambiato qui…"
          className="flex-1 min-w-[12rem] h-9 rounded border border-neutral-700 bg-neutral-900 px-2 text-sm"
        />
        <Bott size="s" weight="primary" onClick={save} disabled={saving || empty}>
          {saving ? "salvo…" : "salva"}
        </Bott>
        {error && <span className="text-xs text-red-400">{error}</span>}
        {saved.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[11px] text-neutral-400">{saved.length} salvate</span>
            {saved.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setViewing(a)}
                title={a.note || new Date(a.created_at).toLocaleString()}
                className="h-10 w-10 shrink-0 overflow-hidden rounded border border-neutral-700 hover:border-neutral-300"
              >
                <img src={pq(a.url)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {viewing && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/95 p-4"
          onClick={() => setViewing(null)}
        >
          <img src={pq(viewing.url)} alt="" className="max-h-[80dvh] max-w-full object-contain" />
          <p className="max-w-xl text-center text-sm text-neutral-200">
            {viewing.note || "nessuna nota"} · {new Date(viewing.created_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
