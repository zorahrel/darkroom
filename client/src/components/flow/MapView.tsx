import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { thumbGenUrl } from "../../api";
import { type ViewProps } from "./NodeThumb";
import { ancestors, layoutMap, mainDescendants, nodeOf, sisters, type Ref } from "./tree";
import { anchoredScroll, canvasSize, fitZoom, margin, scrollToCenter } from "./viewport";

/**
 * La MAPPA: tutti i rami insieme, da sinistra (le radici) a destra (le foglie).
 *
 * Una riga per foglia, il genitore a meta' fra i suoi figli. La strada della selezione e' in
 * giallo, il resto resta in grigio: si vede dove si e' dentro la foresta senza perdere la foresta.
 * Le versioni senza storia dichiarata non si disegnano (sarebbero 170 puntini): restano un numero.
 */
/** Fino a dove si puo' ingrandire: a 16x un nodo e' alto oltre mille pixel, abbastanza per vedere la foto per bene. */
const MAX_Z = 16;
/** Larghezze di miniatura disponibili: si sceglie la prima che copre i pixel veri a schermo. */
const THUMB_STEPS = [100, 200, 400, 800, 1600, 3200];
const W = 40;
const H = 71; // 9:16
const COL = 66;
const ROW = 84;
const PAD = 24;

export default function MapView({ photoId, flow, sel, onSelect, onOpenLeaf }: ViewProps) {
  const layout = useMemo(() => layoutMap(flow), [flow]);
  const [z, setZ] = useState(0.6);
  const [showOrphans, setShowOrphans] = useState(false);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ cw: 0, ch: 0 });
  const boxState = useRef(box);
  boxState.current = box;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const thumbW = useMemo(() => THUMB_STEPS.find((w) => w >= W * z * dpr) ?? THUMB_STEPS[THUMB_STEPS.length - 1], [z, dpr]);
  const zRef = useRef(z);
  zRef.current = z;
  /** Dove deve stare lo scroll dopo il prossimo cambio di zoom (cosi' lo zoom tiene fermo il punto sotto il dito). */
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const i of layout.items) m.set(i.key, { x: PAD + i.x * COL, y: PAD + i.y * ROW });
    return m;
  }, [layout]);
  const width = PAD * 2 + layout.cols * COL;
  const height = PAD * 2 + layout.rows * ROW;

  // La strada della selezione: antenati, lei e il ramo principale sotto.
  const lit = useMemo(() => {
    const s = new Set<string>();
    if (!sel) return s;
    const v = sel.kind === "version" ? sel.id : (nodeOf(flow, sel)?.parent ?? null);
    if (v != null && flow.versions.has(v)) {
      for (const a of ancestors(flow, v)) s.add(`v${a}`);
      s.add(`v${v}`);
      for (const d of mainDescendants(flow, v)) s.add(`v${d}`);
    }
    if (sel.kind === "clip") s.add(`c${sel.id}`);
    return s;
  }, [flow, sel]);

  const selKey = sel ? (sel.kind === "version" ? `v${sel.id}` : `c${sel.id}`) : null;

  // La finestra visibile: serve per il margine (mezza finestra per lato) e per centrare.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const read = () => setBox({ cw: el.clientWidth, ch: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Porta il nodo scelto (o un punto) al centro della finestra, allo zoom attuale. */
  const centerOn = useCallback(
    (x: number, y: number, zz = zRef.current) => {
      const el = boxRef.current;
      if (!el) return;
      const t = scrollToCenter(x, y, zz);
      el.scrollLeft = t.left;
      el.scrollTop = t.top;
    },
    [],
  );
  const centerSelection = useCallback(() => {
    const p = selKey ? pos.get(selKey) : null;
    if (p) centerOn(p.x + W / 2, p.y + H / 2);
  }, [selKey, pos, centerOn]);

  /** Ingrandisce il nodo selezionato fino a riempire la finestra, e lo mette al centro. */
  const zoomToSelection = useCallback(() => {
    const p = selKey ? pos.get(selKey) : null;
    if (!p) return;
    const b = boxState.current;
    const nz = fitZoom(W, H, b, { min: 0.15, max: MAX_Z, breathe: 0.94 });
    const target = scrollToCenter(p.x + W / 2, p.y + H / 2, nz);
    if (nz === zRef.current) {
      const el = boxRef.current;
      if (el) {
        el.scrollLeft = target.left;
        el.scrollTop = target.top;
      }
    } else {
      pendingScroll.current = target;
      setZ(nz);
    }
  }, [selKey, pos]);

  // Cambia la selezione (frecce, clic, altra vista): la mappa la porta al centro. Lo zoom, no.
  const centeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!box.cw || !selKey) return;
    if (centeredFor.current === selKey) return;
    centeredFor.current = selKey;
    centerSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, box.cw]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    const want = pendingScroll.current;
    if (!el || !want) return;
    el.scrollLeft = want.left;
    el.scrollTop = want.top;
    pendingScroll.current = null;
  }, [z, box.cw, box.ch]);

  /** Zoom che tiene fermo il punto (ox, oy) della finestra: il cursore, o il centro. */
  const zoomTo = useCallback((next: number, ox?: number, oy?: number) => {
    const el = boxRef.current;
    const nz = Math.min(MAX_Z, Math.max(0.15, Math.round(next * 100) / 100));
    if (!el || nz === zRef.current) return;
    const b = boxState.current;
    pendingScroll.current = anchoredScroll(
      ox ?? el.clientWidth / 2,
      oy ?? el.clientHeight / 2,
      { left: el.scrollLeft, top: el.scrollTop },
      zRef.current,
      nz,
      b,
    );
    setZ(nz);
  }, []);

  /** I nodi veri, senza il vuoto in fondo alle colonne e alle righe: e' quello che deve stare al centro. */
  const bbox = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pos.values()) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + W);
      y1 = Math.max(y1, p.y + H);
    }
    return x0 === Infinity ? { x0: 0, y0: 0, x1: width, y1: height } : { x0, y0, x1, y1 };
  }, [pos, width, height]);

  /** Tutta la mappa nella finestra, centrata. */
  const fit = useCallback(() => {
    const b = boxState.current;
    const nz = fitZoom(bbox.x1 - bbox.x0 + PAD * 2, bbox.y1 - bbox.y0 + PAD * 2, b);
    const target = scrollToCenter((bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2, nz);
    if (nz === zRef.current) {
      const el = boxRef.current;
      if (el) {
        el.scrollLeft = target.left;
        el.scrollTop = target.top;
      }
    } else {
      pendingScroll.current = target;
      setZ(nz);
    }
  }, [bbox]);

  // Pizzico del trackpad e Ctrl/Cmd + rotella = zoom sul cursore. La rotella semplice scorre come sempre.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zRef.current * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // Tasti della mappa: + − zoom, 0 adatta, c centra sulla selezione.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "+" || e.key === "=") zoomTo(zRef.current * 1.25);
      else if (e.key === "-" || e.key === "_") zoomTo(zRef.current / 1.25);
      else if (e.key === "0") fit();
      else if (e.key === "c" || e.key === "C") centerSelection();
      else if (e.key === "z" || e.key === "Z") zoomToSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomTo, fit, centerSelection, zoomToSelection]);

  // Trascinare lo sfondo (o un nodo, appena ci si muove) sposta la mappa. Un clic fermo sceglie il nodo.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = boxRef.current!;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = boxRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* il puntatore e' gia' finito: si trascina comunque finche' arrivano gli eventi */
      }
    }
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      suppressClick.current = true; // il clic che chiude il trascinamento non deve scegliere il nodo sotto
      setTimeout(() => (suppressClick.current = false), 0);
      try {
        boxRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* non era catturato */
      }
    }
    setDragging(false);
  };

  const edgePath = (from: string, to: string) => {
    const a = pos.get(from);
    const b = pos.get(to);
    if (!a || !b) return "";
    const x1 = a.x + W;
    const y1 = a.y + H / 2;
    const x2 = b.x;
    const y2 = b.y + H / 2;
    const mid = (x2 - x1) / 2;
    return `M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`;
  };

  return (
    <div className="flex h-full flex-col" data-testid="map-view">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-neutral-400">
        <span>
          {layout.items.filter((i) => i.ref.kind === "version").length} versioni · {layout.items.filter((i) => i.ref.kind === "clip").length} video
        </span>
        <span className="flex-1" />
        <button type="button" data-testid="map-center" title="Centra la selezione (c)" onClick={centerSelection} className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700">
          ◎ Centra
        </button>
        <button type="button" data-testid="map-photo" title="Ingrandisci la selezione fino a riempire la finestra (z)" onClick={zoomToSelection} className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700">
          ⌕ Foto
        </button>
        <button type="button" data-testid="map-fit" title="Tutta la mappa nello schermo (0)" onClick={fit} className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700">
          ⤢ Adatta
        </button>
        <span className="flex items-center overflow-hidden rounded bg-neutral-800">
          <button type="button" data-testid="map-out" title="Rimpicciolisci (−)" onClick={() => zoomTo(z / 1.25)} className="px-2 py-0.5 hover:bg-neutral-700">
            −
          </button>
          <span className="min-w-[4ch] text-center tabular-nums text-neutral-300" data-testid="map-zoom">{Math.round(z * 100)}%</span>
          <button type="button" data-testid="map-in" title="Ingrandisci (+)" onClick={() => zoomTo(z * 1.25)} className="px-2 py-0.5 hover:bg-neutral-700">
            +
          </button>
        </span>
      </div>

      <div
        ref={boxRef}
        className={`min-h-0 flex-1 overflow-auto overscroll-contain bg-neutral-950 ${dragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
        data-testid="map-scroll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {(() => {
          const size = canvasSize(width, height, z, box);
          const m = margin(box);
          return (
            <div className="relative" style={{ width: size.width, height: size.height }} data-testid="map-canvas">
              <div
                className="absolute origin-top-left"
                style={{ left: m.px, top: m.py, width, height, transform: `scale(${z})` }}
              >
            <svg width={width} height={height} className="absolute inset-0" aria-hidden>
              {layout.edges.map((e) => {
                const on = lit.has(e.from) && lit.has(e.to);
                return (
                  <path
                    key={`${e.from}>${e.to}`}
                    d={edgePath(e.from, e.to)}
                    fill="none"
                    stroke={on ? "#fbbf24" : "#404040"}
                    strokeWidth={on ? 2.5 : 1.2}
                  />
                );
              })}
            </svg>
            {layout.items.map((i) => {
              const p = pos.get(i.key)!;
              const node = nodeOf(flow, i.ref)!;
              const on = !!sel && sel.kind === i.ref.kind && sel.id === i.ref.id;
              const nSis = sisters(flow, i.ref).length;
              const frame = i.ref.kind === "version" ? i.ref.id : node.parent;
              return (
                <button
                  key={i.key}
                  type="button"
                  data-testid={`map-${i.key}`}
                  onClick={() => onSelect(i.ref)}
                  onDoubleClick={() => onOpenLeaf(i.ref)}
                  title={`${i.key}${nSis ? ` · ${nSis} sorelle` : ""}${node.final ? " · finale" : ""}${node.discarded ? " · scartata" : ""}`}
                  style={{ left: p.x, top: p.y, width: W, height: H }}
                  className={`absolute overflow-hidden rounded bg-neutral-900 ${
                    on ? "ring-2 ring-amber-400" : lit.has(i.key) ? "ring-1 ring-amber-700" : "ring-1 ring-neutral-800"
                  } ${node.discarded ? "opacity-35 grayscale" : lit.size && !lit.has(i.key) ? "opacity-70" : ""}`}
                >
                  {frame != null && (
                    <img src={thumbGenUrl(photoId, frame, thumbW)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                  {i.ref.kind === "clip" && (
                    <span className="absolute inset-0 flex items-center justify-center text-sm text-white drop-shadow">▶</span>
                  )}
                  <span className="absolute bottom-0 left-0 bg-black/70 px-0.5 text-[9px] text-neutral-100">{i.key}</span>
                  {node.final && <span className="absolute right-0 top-0 text-xs text-amber-400">★</span>}
                  {node.kind === "version" && node.favorite && <span className="absolute left-0 top-0 text-[9px] text-sky-300">♥</span>}
                  {nSis > 0 && (
                    <span className="absolute bottom-0 right-0 bg-amber-500 px-0.5 text-[9px] font-semibold text-black">⑂{nSis}</span>
                  )}
                </button>
              );
            })}
              </div>
            </div>
          );
        })()}
      </div>

      {layout.orphans.length > 0 && (
        <div className="shrink-0 border-t border-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
          <button type="button" onClick={() => setShowOrphans((s) => !s)} className="hover:text-neutral-200">
            {showOrphans ? "▾" : "▸"} +{layout.orphans.length} versioni senza storia dichiarata (non disegnate)
          </button>
          {showOrphans && (
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {layout.orphans.map((n) => {
                const r: Ref = { kind: "version", id: n };
                return (
                  <button key={n} type="button" onClick={() => onSelect(r)} title={`v${n}`} className="h-12 overflow-hidden rounded ring-1 ring-neutral-800 aspect-[9/16] hover:ring-neutral-500">
                    <img src={thumbGenUrl(photoId, n, 80)} alt={`v${n}`} loading="lazy" className="h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
