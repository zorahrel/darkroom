import { useEffect, useMemo, useRef, useState } from "react";
import { clipFileUrl, genUrl, thumbGenUrl } from "../../api";
import { type ViewProps } from "./NodeThumb";
import { ancestors, children, nodeOf, type Flow } from "./tree";

/** Il nodo (versione o video) piu' recente che sta sotto una versione, lei compresa. */
function newestUnder(f: Flow, v: number, seen: Set<number>): number {
  if (seen.has(v)) return 0;
  seen.add(v);
  const c = children(f, v);
  let best = f.versions.get(v)?.created_at ?? 0;
  for (const k of c.clips) best = Math.max(best, k.created_at);
  for (const k of c.versions) best = Math.max(best, newestUnder(f, k.version_number, seen));
  return best;
}

/**
 * La strada che continua sotto una versione, verso il lavoro PIU' RECENTE: a ogni passo il figlio sotto
 * cui c'e' il nodo creato per ultimo. Non il ramo con piu' storia (come nel Ramo): qui si vuole vedere
 * dove si e' arrivati, non da dove si e' passati piu' volte.
 */
function latestDescendants(f: Flow, v: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([v]);
  let cur = v;
  for (;;) {
    const kids = children(f, cur).versions.filter((k) => !seen.has(k.version_number));
    if (kids.length === 0) break;
    const best = [...kids].sort(
      (a, b) => newestUnder(f, b.version_number, new Set(seen)) - newestUnder(f, a.version_number, new Set(seen)),
    )[0]!;
    seen.add(best.version_number);
    out.push(best.version_number);
    cur = best.version_number;
  }
  return out;
}

/**
 * La SEQUENZA: la strada in colonna, una cosa sotto l'altra, a partire da una foto a scelta.
 *
 * Ogni passo e' l'immagine grande a tutta larghezza con sotto la nota per intero (cosa e' cambiato
 * rispetto al passo prima). I video nati da quel passo stanno subito sotto come player veri.
 * Le versioni messe da parte non compaiono, salvo quella che stai guardando.
 */
export default function SequenceView({ photoId, flow, sel, onSelect }: ViewProps) {
  const [from, setFrom] = useState<number | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const anchor =
    sel == null ? null : sel.kind === "version" ? sel.id : (nodeOf(flow, sel)?.parent ?? null);

  const road = useMemo(() => {
    if (anchor == null || !flow.versions.has(anchor)) return [];
    return [...ancestors(flow, anchor), anchor, ...latestDescendants(flow, anchor)];
  }, [flow, anchor]);

  // Il punto di partenza di default: due passi prima di quello scelto, cosi' si vede la storia recente
  // senza una colonna di venti immagini. L'utente lo cambia dal menu «Parti da».
  const defaultStart = road[Math.max(0, (anchor != null ? road.indexOf(anchor) : 0) - 2)] ?? null;
  const start = from != null && road.includes(from) ? from : defaultStart;
  const shown = useMemo(() => {
    const i = start == null ? 0 : Math.max(0, road.indexOf(start));
    return road
      .slice(i)
      .filter((v) => showDiscarded || v === anchor || !flow.versions.get(v)?.discarded);
  }, [road, start, showDiscarded, anchor, flow]);

  // Il passo scelto deve stare in vista, a mano: scrollIntoView su WebKit trascina anche i contenitori sopra.
  useEffect(() => {
    const box = boxRef.current;
    const el = box?.querySelector<HTMLElement>('[data-mine="1"]');
    if (!box || !el) return;
    box.scrollTop = Math.max(0, el.offsetTop - 12);
  }, [anchor, start, showDiscarded]);

  if (road.length === 0) {
    return <p className="p-4 text-sm text-neutral-400">Questa versione non ha una strada dichiarata: nessun genitore.</p>;
  }

  return (
    <div ref={boxRef} className="relative h-full overflow-y-auto overscroll-contain p-3 pb-16" data-testid="sequence-view">
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <label className="flex items-center gap-1.5">
            Parti da
            <select
              value={start ?? ""}
              onChange={(e) => setFrom(Number(e.target.value))}
              data-testid="sequence-from"
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-200"
            >
              {road.map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          </label>
          <span>
            {shown.length} passi
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setShowDiscarded((s) => !s)}
            aria-pressed={showDiscarded}
            className={`rounded px-2 py-0.5 ${showDiscarded ? "bg-neutral-700 text-neutral-100" : "bg-neutral-800 hover:bg-neutral-700"}`}
          >
            {showDiscarded ? "Nascondi scartate" : "Mostra scartate"}
          </button>
        </div>

        <ol className="space-y-8" data-testid="sequence-steps">
          {shown.map((v, i) => {
            const node = flow.versions.get(v)!;
            const mine = v === anchor;
            const clips = children(flow, v).clips.filter((c) => showDiscarded || c.clip_id === (sel?.kind === "clip" ? sel.id : -1) || !c.discarded);
            return (
              <li
                key={v}
                data-mine={mine ? "1" : undefined}
                data-testid={`sequence-step-v${v}`}
                className="relative"
              >
                <div className="mb-1.5 flex items-center gap-2 text-sm">
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-300">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "version", id: v })}
                    className={`font-semibold hover:underline ${mine ? "text-amber-400" : "text-neutral-100"}`}
                  >
                    v{v}
                  </button>
                  {node.final && <span className="text-amber-400">★ finale</span>}
                  {node.favorite && <span className="text-rose-400">♥</span>}
                  {node.discarded && <span className="text-neutral-500">⊘ scartata</span>}
                </div>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "version", id: v })}
                  className={`block w-full overflow-hidden rounded bg-neutral-900 ${
                    mine ? "ring-2 ring-amber-400" : "ring-1 ring-neutral-800 hover:ring-neutral-500"
                  } ${node.discarded ? "opacity-50 grayscale" : ""}`}
                >
                  <img
                    src={genUrl(photoId, v)}
                    alt={`v${v}`}
                    loading="lazy"
                    className="mx-auto block max-h-[70vh] w-full object-contain"
                  />
                </button>
                <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-neutral-300">
                  {node.note ?? `v${v}`}
                </p>
                {node.refs.length > 0 && (
                  <p className="mt-1 text-[11px] text-neutral-500">Riferimenti allegati: {node.refs.join(" · ")}</p>
                )}
                {clips.length > 0 && (
                  <div className="mt-3 space-y-4 border-l-2 border-amber-400/60 pl-3" data-testid={`sequence-clips-v${v}`}>
                    {clips.map((c) => {
                      const on = sel?.kind === "clip" && sel.id === c.clip_id;
                      return (
                        <div key={c.clip_id} data-mine={on ? "1" : undefined}>
                          <p className="mb-1 text-xs text-neutral-300">
                            <button
                              type="button"
                              onClick={() => onSelect({ kind: "clip", id: c.clip_id })}
                              className={`font-semibold hover:underline ${on ? "text-amber-400" : ""}`}
                            >
                              ▶ {c.model ?? "video"} · #{c.clip_id}
                            </button>
                            {c.duration != null && <span className="text-neutral-500"> · {Math.round(c.duration)} s</span>}
                            {c.has_audio && <span className="text-neutral-500"> · audio</span>}
                            {c.final && <span className="text-amber-400"> · ★ finale</span>}
                            {c.discarded && <span className="text-neutral-500"> · ⊘ scartato</span>}
                          </p>
                          <video
                            src={clipFileUrl(c.clip_id)}
                            poster={thumbGenUrl(photoId, v, 640)}
                            controls
                            preload="metadata"
                            playsInline
                            loop
                            data-testid={`sequence-video-c${c.clip_id}`}
                            className={`w-full rounded bg-black ${c.discarded ? "opacity-50" : ""}`}
                          />
                        </div>
                      );
                    })}
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
