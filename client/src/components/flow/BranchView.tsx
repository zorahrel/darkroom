import { useEffect, useMemo, useRef, useState } from "react";
import NodeThumb, { type ViewProps } from "./NodeThumb";
import { ancestors, children, groupRuns, mainDescendants, nodeOf, sisters, type Ref } from "./tree";

/**
 * Il RAMO: la strada dalla radice alla versione scelta, e poi giu' lungo il ramo principale.
 *
 * Le biforcazioni sono dichiarate: una riga con sorelle ha il tasto «⑂ N sorelle» che le apre
 * subito sotto, e sceglierne una sposta la strada su di lei. Le tratte dritte (senza sorelle, video
 * o scelte) si piegano in «⋯ N passi», cosi' una storia di 22 versioni non diventa un muro.
 */
type Row = { v: number; mine: boolean; below: boolean };

export default function BranchView({ photoId, flow, sel, onSelect, onOpenLeaf }: ViewProps) {
  const [openSis, setOpenSis] = useState<Set<number>>(new Set());
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const anchor = sel ? (sel.kind === "version" ? sel.id : (nodeOf(flow, sel)?.parent ?? null)) : null;

  const rows: Row[] = useMemo(() => {
    if (anchor == null || !flow.versions.has(anchor)) return [];
    return [
      ...ancestors(flow, anchor).map((v) => ({ v, mine: false, below: false })),
      { v: anchor, mine: true, below: false },
      ...mainDescendants(flow, anchor).map((v) => ({ v, mine: false, below: true })),
    ];
  }, [flow, anchor]);

  const interesting = (r: Row, i: number) => {
    const n = flow.versions.get(r.v)!;
    const c = children(flow, r.v);
    return (
      all ||
      r.mine ||
      i === 0 ||
      i === rows.length - 1 ||
      sisters(flow, { kind: "version", id: r.v }).length > 0 ||
      c.clips.length > 0 ||
      n.favorite ||
      n.final ||
      n.discarded
    );
  };

  const items = useMemo(
    () => groupRuns(rows, interesting, (r) => r.v, openRuns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, openRuns, all, flow],
  );

  // La riga scelta deve stare in vista: a mano, perche' scrollIntoView su WebKit trascina anche i contenitori sopra.
  useEffect(() => {
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>('[data-mine="1"]');
    if (!box || !el) return;
    box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 3);
  }, [anchor, rows.length]);

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-neutral-400">Questa versione non ha una strada dichiarata: nessun genitore.</p>;
  }
  const forks = rows.filter((r) => sisters(flow, { kind: "version", id: r.v }).length > 0).length;
  const thumb = (r: Ref, size = "h-14") => (
    <NodeThumb key={`${r.kind}${r.id}`} photoId={photoId} flow={flow} r={r} sel={sel} onSelect={onSelect} onOpen={onOpenLeaf} size={size} />
  );

  return (
    <div ref={boxRef} className="relative h-full overflow-y-auto overscroll-contain p-3 pb-10" data-testid="branch-view">
      <div className="mx-auto max-w-md">
        <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
          <span>
            Strada: v{rows[0]!.v} → v{rows[rows.length - 1]!.v} · {rows.length} passi · {forks} biforcazion{forks === 1 ? "e" : "i"}
          </span>
          <span className="flex-1" />
          <button type="button" onClick={() => setAll((a) => !a)} className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700">
            {all ? "Piega le tratte" : "Mostra ogni passo"}
          </button>
        </div>
        <ol className="space-y-2" data-testid="branch-rows">
          {items.map((it) => {
            if (it.kind === "run") {
              return (
                <li key={`run${it.start}`} className="border-l-2 border-dashed border-neutral-700 pl-3">
                  <button
                    type="button"
                    onClick={() => setOpenRuns((s) => new Set(s).add(it.start))}
                    className="rounded bg-neutral-900 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
                  >
                    ⋯ {it.rows.length} passi in linea retta (v{it.rows[0]!.v} → v{it.rows[it.rows.length - 1]!.v})
                  </button>
                </li>
              );
            }
            const { v, mine, below } = it.row;
            const node = flow.versions.get(v)!;
            const sis = sisters(flow, { kind: "version", id: v });
            const vids = children(flow, v).clips;
            const sisOpen = openSis.has(v) || (mine && sis.length > 0);
            return (
              <li
                key={v}
                data-mine={mine ? "1" : undefined}
                data-testid={`branch-row-v${v}`}
                className={`border-l-2 pl-3 ${mine ? "border-amber-400" : below ? "border-neutral-700 opacity-80" : "border-neutral-800"}`}
              >
                <div className="flex items-start gap-2">
                  {thumb({ kind: "version", id: v })}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-xs text-neutral-300">{node.note ?? `v${v}`}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {sis.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenSis((s) => {
                              const n = new Set(s);
                              if (n.has(v)) n.delete(v);
                              else n.add(v);
                              return n;
                            })
                          }
                          className="rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-black"
                        >
                          ⑂ {sis.length} sorell{sis.length === 1 ? "a" : "e"} {sisOpen ? "▾" : "▸"}
                        </button>
                      )}
                      {vids.map((c) => thumb({ kind: "clip", id: c.clip_id }, "h-9"))}
                      {below && <span className="text-[11px] text-neutral-500">prosegue</span>}
                    </div>
                  </div>
                </div>
                {sisOpen && sis.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto rounded bg-neutral-900/60 p-2" data-testid={`branch-sisters-v${v}`}>
                    {sis.map((r) => thumb(r, "h-12"))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
