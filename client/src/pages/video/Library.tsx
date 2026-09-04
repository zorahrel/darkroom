import { useMemo, useState } from "react";
import { api, pq, type VideoShot } from "../../api";
import { Field } from "./ui";

/**
 * Il browser dei piani girati.
 *
 * Era una griglia larga sotto l'editor: 272 provini da 230 px che rendevano la
 * pagina alta 28.511 pixel, con l'editor che spariva sopra uno schermo e mezzo
 * di miniature. Qui è una colonna densa che scorre per conto suo, con una
 * ricerca — perché la domanda vera non è "fammi vedere tutto", è "dov'è quella
 * col faro".
 */

type Props = {
  shots: VideoShot[];
  inEdit: Map<string, number>;
  setShots: (s: VideoShot[]) => void;
  open: (id: string) => void;
};

type Filter = "tutti" | "in montaggio" | "tenuti" | "scartati" | "annotati";

export default function Library({ shots, inEdit, setShots, open }: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("tutti");
  const [scrivo, setScrivo] = useState<string | null>(null);
  const [text, setText] = useState("");

  const visibili = useMemo(() => {
    const t = q.trim().toLowerCase();
    return shots.filter((s) => {
      if (t && !s.id.toLowerCase().includes(t) && !(s.prompt ?? "").toLowerCase().includes(t)) return false;
      if (filter === "tenuti") return s.kept;
      if (filter === "scartati") return !s.kept;
      if (filter === "in montaggio") return (inEdit.get(s.id) ?? 0) > 0;
      if (filter === "annotati") return s.problems.length > 0;
      return true;
    });
  }, [shots, q, filter, inEdit]);

  const pick = async (id: string, kept: boolean) => {
    setShots(shots.map((s) => (s.id === id ? { ...s, kept } : s)));
    try { setShots((await api.videoPick(id, kept)).shots); } catch { /* niente */ }
  };
  const flag = async (id: string) => {
    const t = text.trim();
    setScrivo(null); setText("");
    if (!t) return;
    try { setShots((await api.videoProblem(id, t)).shots); } catch { /* niente */ }
  };

  const F = (k: Filter) => (
    <button key={k} onClick={() => setFilter(k)}
      className={`px-1.5 py-0.5 rounded-sm border text-[9.5px] ${
        filter === k ? "border-neutral-500 text-neutral-200" : "border-neutral-900 text-neutral-400 hover:text-neutral-400"}`}>
      {k}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-2 py-1.5 border-b border-neutral-900 space-y-1.5">
        <Field value={q} onChange={setQ} onEsc={() => setQ("")}
               segnaposto={`cerca fra ${shots.length} piani…`}
               className="w-full text-[11px]" />
        <div className="flex flex-wrap gap-1">
          {(["tutti", "in montaggio", "tenuti", "scartati", "annotati"] as const).map(F)}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibili.map((s) => {
          const tk = s.takes.find((x) => x.kept) ?? s.takes[0];
          const dentro = (inEdit.get(s.id) ?? 0) > 0;
          return (
            <div key={s.id}
                 draggable
                 onDragStart={(e) => {
                   // Il tipo e' nostro apposta: cosi' la timeline accetta solo
                   // cio' che viene da qui, e non un file o un testo qualunque.
                   e.dataTransfer.setData("text/darkroom-piano", s.id);
                   e.dataTransfer.effectAllowed = "copy";
                 }}
                 title={`${s.id} — trascinalo su un taglio della timeline per metterlo li'`}
                 className={`flex gap-2 px-2 py-1.5 border-b border-neutral-900/70 hover:bg-neutral-900/50
                             cursor-grab active:cursor-grabbing
                             ${s.kept ? "" : "opacity-45"}`}>
              <button onClick={() => open(s.id)} className="shrink-0" title={dentro ? "vai al taglio" : "non è nel montaggio"}>
                {tk ? (
                  <video
                    key={tk.clip} src={pq(tk.clip)} poster={pq(tk.poster)}
                    muted loop playsInline preload="none"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                    onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    className={`w-[42px] aspect-[9/16] object-cover bg-black rounded-sm border
                                ${dentro ? "border-orange-500/50" : "border-neutral-800"}`}
                  />
                ) : <div className="w-[42px] aspect-[9/16] bg-neutral-900 rounded-sm" />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-neutral-200 truncate">{s.id}</span>
                  <span className="ml-auto text-[9.5px] text-neutral-400 tabular-nums shrink-0">
                    {dentro ? `${(inEdit.get(s.id) ?? 0).toFixed(1)}s` : "—"}
                  </span>
                </div>
                <div className="mt-1 h-[3px] bg-neutral-900 rounded-full overflow-hidden">
                  <div className="h-full bg-[#9a6a4a]" style={{ width: `${(s.intensity ?? 0) * 100}%` }} />
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[9px] text-neutral-400 tabular-nums">
                    dur {s.intensity?.toFixed(2) ?? "—"}
                  </span>
                  {s.takes.length > 1 && (
                    <span className="text-[9px] text-neutral-400">· {s.takes.length} riprese</span>
                  )}
                  <button
                    onClick={() => { setScrivo(scrivo === s.id ? null : s.id); setText(""); }}
                    title="annota un problema"
                    className="ml-auto text-[9.5px] px-1 rounded-sm border border-neutral-900 text-neutral-400
                               hover:text-amber-400 hover:border-amber-800">!</button>
                  <button
                    onClick={() => void pick(s.id, !s.kept)}
                    className={`text-[9.5px] px-1 rounded-sm border ${
                      s.kept ? "border-neutral-800 text-neutral-400" : "border-neutral-900 text-neutral-400"}`}>
                    {s.kept ? "tieni" : "scarta"}
                  </button>
                </div>
                {scrivo === s.id && (
                  <Field autoFuoco value={text} onChange={setText}
                         onInvio={() => void flag(s.id)} onEsc={() => setScrivo(null)}
                         segnaposto="cosa non va — invio"
                         className="mt-1 w-full text-[10px] border-amber-900/60" />
                )}
                {s.problems.map((p, i) => (
                  <div key={i} className="mt-0.5 flex items-start gap-1 text-[9.5px] leading-tight text-amber-500/80">
                    <button onClick={async () => {
                      try { setShots((await api.videoProblem(s.id, undefined, i)).shots); } catch { /* niente */ }
                    }} className="text-neutral-400 hover:text-neutral-400">×</button>
                    <span className="truncate">{p}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!visibili.length && (
          <div className="p-4 text-center text-[11px] text-neutral-400">niente con questi filtri</div>
        )}
      </div>

      <div className="shrink-0 px-2 py-1 border-t border-neutral-900 text-[9.5px] text-neutral-400">
        {visibili.length} di {shots.length} · {shots.filter((s) => s.kept).length} tenuti
      </div>
    </div>
  );
}
