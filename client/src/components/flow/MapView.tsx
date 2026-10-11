import { useEffect, useMemo, useRef, useState } from "react";
import { thumbGenUrl } from "../../api";
import { type ViewProps } from "./NodeThumb";
import { ancestors, layoutMap, mainDescendants, nodeOf, sisters, type Ref } from "./tree";

/**
 * La MAPPA: tutti i rami insieme, da sinistra (le radici) a destra (le foglie).
 *
 * Una riga per foglia, il genitore a meta' fra i suoi figli. La strada della selezione e' in
 * giallo, il resto resta in grigio: si vede dove si e' dentro la foresta senza perdere la foresta.
 * Le versioni senza storia dichiarata non si disegnano (sarebbero 170 puntini): restano un numero.
 */
const W = 40;
const H = 71; // 9:16
const COL = 66;
const ROW = 84;
const PAD = 24;

export default function MapView({ photoId, flow, sel, onSelect, onOpenLeaf }: ViewProps) {
  const layout = useMemo(() => layoutMap(flow), [flow]);
  const [z, setZ] = useState(0.6);
  const [showOrphans, setShowOrphans] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    const box = boxRef.current;
    const p = selKey ? pos.get(selKey) : null;
    if (!box || !p) return;
    box.scrollLeft = Math.max(0, p.x * z - box.clientWidth / 2);
    box.scrollTop = Math.max(0, p.y * z - box.clientHeight / 2);
    // Solo quando cambia la selezione o lo zoom: non a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, z]);

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
        <button
          type="button"
          data-testid="map-fit"
          title="Adatta la mappa allo spazio"
          onClick={() => {
            const box = boxRef.current;
            if (!box) return;
            const fit = Math.min(box.clientWidth / width, box.clientHeight / height);
            setZ(Math.min(1.5, Math.max(0.2, Math.round(fit * 20) / 20)));
          }}
          className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700"
        >
          Adatta
        </button>
        <span className="tabular-nums text-neutral-500" data-testid="map-zoom">{Math.round(z * 100)}%</span>
        {[0.6, 1, 1.5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setZ(v)}
            className={`rounded px-2 py-0.5 ${z === v ? "bg-amber-500 text-black" : "bg-neutral-800 hover:bg-neutral-700"}`}
          >
            {Math.round(v * 100)}%
          </button>
        ))}
      </div>

      <div ref={boxRef} className="min-h-0 flex-1 overflow-auto bg-neutral-950" data-testid="map-scroll">
        <div className="relative" style={{ width: width * z, height: height * z }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(${z})` }}>
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
                    <img src={thumbGenUrl(photoId, frame, 100)} alt="" loading="lazy" className="h-full w-full object-cover" />
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
