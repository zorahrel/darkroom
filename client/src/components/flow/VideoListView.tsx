import { useMemo, useState } from "react";
import { clipFileUrl, thumbGenUrl } from "../../api";
import type { Clip } from "../../api";
import { type ViewProps } from "./NodeThumb";
import { type Ref } from "./tree";

/** I timestamp del database sono in millisecondi, ma qualche riga vecchia li ha in secondi. */
const ms = (t: number) => (t < 1e12 ? t * 1000 : t);

const giorno = (t: number) =>
  new Date(ms(t)).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
const ora = (t: number) => new Date(ms(t)).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

/**
 * I video in fila, uno per riga, in ordine di tempo. Pensata per scegliere: ogni riga dice da quale
 * versione parte, con quale modello, quanto dura e quanto e' costata, e il prompt e' a portata di clic.
 * Il video si carica solo quando lo apri (un solo player alla volta): con dieci clip da 20 MB la pagina
 * non deve scaricarne dieci per mostrare una lista.
 */
export default function VideoListView({
  photoId,
  flow,
  sel,
  onSelect,
  onOpenLeaf,
  clips,
  onMark,
}: ViewProps & { clips: Clip[]; onMark: (what: "final" | "discarded", r: Ref) => void }) {
  const [nuoviPrima, setNuoviPrima] = useState(true);
  const [conScartati, setConScartati] = useState(false);
  const [aperto, setAperto] = useState<number | null>(() => (sel?.kind === "clip" ? sel.id : null));
  const [prompt, setPrompt] = useState<Set<number>>(new Set());

  // Finale / scartato stanno nel flusso, non nel clip: li leggo da li'.
  const stato = useMemo(() => {
    const m = new Map<number, { final: boolean; discarded: boolean }>();
    for (const n of flow.clips.values()) m.set(n.clip_id, { final: n.final, discarded: n.discarded });
    return m;
  }, [flow]);

  const lista = useMemo(() => {
    const v = clips
      .filter((c) => conScartati || !stato.get(c.id)?.discarded)
      .sort((a, b) => (nuoviPrima ? b.created_at - a.created_at : a.created_at - b.created_at));
    return v;
  }, [clips, stato, conScartati, nuoviPrima]);

  const nascosti = clips.length - clips.filter((c) => !stato.get(c.id)?.discarded).length;
  const crediti = lista.reduce((s, c) => s + (c.credits ?? 0), 0);

  let ultimoGiorno = "";
  return (
    <div className="flex h-full flex-col" data-testid="videolist-view">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-400">
        <span className="font-semibold text-neutral-200">{lista.length} video</span>
        {crediti > 0 && <span>{crediti} crediti</span>}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNuoviPrima((x) => !x)}
            data-testid="videolist-sort"
            className="rounded bg-neutral-800 px-2 py-0.5 hover:bg-neutral-700"
            title="Cambia l'ordine"
          >
            {nuoviPrima ? "↓ più recenti prima" : "↑ dal primo"}
          </button>
          {nascosti > 0 && (
            <button
              type="button"
              onClick={() => setConScartati((x) => !x)}
              aria-pressed={conScartati}
              data-testid="videolist-discarded"
              className={`rounded px-2 py-0.5 ${conScartati ? "bg-amber-400 text-black" : "bg-neutral-800 hover:bg-neutral-700"}`}
            >
              ⊘ scartati ({nascosti})
            </button>
          )}
        </span>
      </div>

      <ol className="min-h-0 flex-1 divide-y divide-neutral-800/70 overflow-y-auto">
        {lista.map((c) => {
          const st = stato.get(c.id);
          const on = sel?.kind === "clip" && sel.id === c.id;
          const apri = aperto === c.id;
          const g = giorno(c.created_at);
          const nuovoGiorno = g !== ultimoGiorno;
          ultimoGiorno = g;
          const lungo = (c.prompt ?? "").length > 140;
          const prompOn = prompt.has(c.id);
          return (
            <li key={c.id} data-clip={c.id} data-selected={on ? "1" : undefined}>
              {nuovoGiorno && (
                <div className="sticky top-0 z-10 bg-neutral-950/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 backdrop-blur">
                  {g}
                </div>
              )}
              <div className={`flex gap-2.5 px-3 py-2 ${on ? "bg-amber-400/10" : ""} ${st?.discarded ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect({ kind: "clip", id: c.id });
                    setAperto(apri ? null : c.id);
                  }}
                  className="group relative aspect-video w-32 shrink-0 self-start overflow-hidden rounded bg-black sm:w-44"
                  title={apri ? "Chiudi il player" : "Apri il player"}
                  data-testid={`videolist-thumb-c${c.id}`}
                >
                  {c.version_number != null && (
                    <img
                      src={thumbGenUrl(photoId, c.version_number, 320)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-black/25 text-xl text-white/90 group-hover:bg-black/10">
                    {apri ? "✕" : "▶"}
                  </span>
                  {c.duration != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">
                      {Math.round(c.duration)}s
                    </span>
                  )}
                </button>

                <div className="min-w-0 flex-1 text-xs">
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-semibold text-neutral-100">{c.model ?? "video"}</span>
                    <span className="text-neutral-500">#{c.id} · {ora(c.created_at)}</span>
                    {st?.final && <span className="text-amber-400">★ finale</span>}
                    {st?.discarded && <span className="text-neutral-500">⊘ scartato</span>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-neutral-400">
                    {c.version_number != null && (
                      <button
                        type="button"
                        onClick={() => onOpenLeaf({ kind: "version", id: c.version_number! })}
                        className="rounded bg-neutral-800 px-1.5 hover:bg-neutral-700"
                        title="Apri la versione di partenza"
                      >
                        da v{c.version_number}
                      </button>
                    )}
                    {c.width && c.height && (
                      <span>
                        {Math.min(c.width, c.height)}p · {c.height > c.width ? "verticale" : "orizzontale"}
                      </span>
                    )}
                    {c.has_audio && <span>audio</span>}
                    {c.credits != null && <span>{c.credits} cr</span>}
                    {!c.available && <span className="text-red-400">file mancante</span>}
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        data-testid={`videolist-final-c${c.id}`}
                        aria-pressed={!!st?.final}
                        title={st?.final ? "Togli da foglie finali" : "Segna come foglia finale"}
                        onClick={() => onMark("final", { kind: "clip", id: c.id })}
                        className={`rounded px-1.5 ${st?.final ? "bg-amber-500 text-black" : "bg-neutral-800 hover:bg-neutral-700"}`}
                      >
                        {st?.final ? "★" : "☆"}
                      </button>
                      <button
                        type="button"
                        data-testid={`videolist-discard-c${c.id}`}
                        aria-pressed={!!st?.discarded}
                        title={st?.discarded ? "Rimetti in lista" : "Scarta: resta nel flusso, sbiadito"}
                        onClick={() => onMark("discarded", { kind: "clip", id: c.id })}
                        className={`rounded px-1.5 ${st?.discarded ? "bg-neutral-600 text-white" : "bg-neutral-800 hover:bg-neutral-700"}`}
                      >
                        ⊘
                      </button>
                    </span>
                  </p>
                  {c.prompt && (
                    <p
                      className={`mt-1 text-neutral-500 ${prompOn ? "" : "line-clamp-2"}`}
                      data-testid={`videolist-prompt-c${c.id}`}
                    >
                      {c.prompt}
                    </p>
                  )}
                  {lungo && (
                    <button
                      type="button"
                      onClick={() =>
                        setPrompt((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                      className="mt-0.5 text-[11px] text-neutral-400 underline-offset-2 hover:underline"
                    >
                      {prompOn ? "meno" : "prompt intero"}
                    </button>
                  )}
                </div>
              </div>

              {apri && (
                <div className="px-3 pb-3">
                  <video
                    src={clipFileUrl(c.id)}
                    poster={c.version_number != null ? thumbGenUrl(photoId, c.version_number, 960) : undefined}
                    controls
                    autoPlay
                    playsInline
                    loop
                    preload="metadata"
                    data-testid={`videolist-video-c${c.id}`}
                    className="w-full rounded bg-black"
                  />
                </div>
              )}
            </li>
          );
        })}
        {lista.length === 0 && <li className="p-4 text-xs text-neutral-500">Nessun video per questa foto.</li>}
      </ol>
    </div>
  );
}
