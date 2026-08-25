import { useMemo, useState } from "react";
import { api, pq, type VideoShot } from "../../api";

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
  inScena: Map<string, number>;
  setShots: (s: VideoShot[]) => void;
  apri: (id: string) => void;
};

type Filtro = "tutti" | "in montaggio" | "tenuti" | "scartati" | "annotati";

export default function Libreria({ shots, inScena, setShots, apri }: Props) {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("tutti");
  const [scrivo, setScrivo] = useState<string | null>(null);
  const [testo, setTesto] = useState("");

  const visibili = useMemo(() => {
    const t = q.trim().toLowerCase();
    return shots.filter((s) => {
      if (t && !s.id.toLowerCase().includes(t) && !(s.prompt ?? "").toLowerCase().includes(t)) return false;
      if (filtro === "tenuti") return s.kept;
      if (filtro === "scartati") return !s.kept;
      if (filtro === "in montaggio") return (inScena.get(s.id) ?? 0) > 0;
      if (filtro === "annotati") return s.problemi.length > 0;
      return true;
    });
  }, [shots, q, filtro, inScena]);

  const pick = async (id: string, kept: boolean) => {
    setShots(shots.map((s) => (s.id === id ? { ...s, kept } : s)));
    try { setShots((await api.videoPick(id, kept)).shots); } catch { /* niente */ }
  };
  const segnala = async (id: string) => {
    const t = testo.trim();
    setScrivo(null); setTesto("");
    if (!t) return;
    try { setShots((await api.videoProblema(id, t)).shots); } catch { /* niente */ }
  };

  const F = (k: Filtro) => (
    <button key={k} onClick={() => setFiltro(k)}
      className={`px-1.5 py-0.5 rounded-sm border text-[9.5px] ${
        filtro === k ? "border-neutral-500 text-neutral-200" : "border-neutral-900 text-neutral-400 hover:text-neutral-400"}`}>
      {k}
    </button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-2 py-1.5 border-b border-neutral-900 space-y-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`cerca fra ${shots.length} piani…`}
          className="w-full bg-neutral-950 border border-neutral-900 rounded-sm px-1.5 py-1
                     text-[11px] text-neutral-200 outline-none focus:border-neutral-700"
        />
        <div className="flex flex-wrap gap-1">
          {(["tutti", "in montaggio", "tenuti", "scartati", "annotati"] as const).map(F)}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibili.map((s) => {
          const tk = s.takes.find((x) => x.kept) ?? s.takes[0];
          const dentro = (inScena.get(s.id) ?? 0) > 0;
          return (
            <div key={s.id}
                 className={`flex gap-2 px-2 py-1.5 border-b border-neutral-900/70 hover:bg-neutral-900/50
                             ${s.kept ? "" : "opacity-45"}`}>
              <button onClick={() => apri(s.id)} className="shrink-0" title={dentro ? "vai al taglio" : "non è nel montaggio"}>
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
                    {dentro ? `${(inScena.get(s.id) ?? 0).toFixed(1)}s` : "—"}
                  </span>
                </div>
                <div className="mt-1 h-[3px] bg-neutral-900 rounded-full overflow-hidden">
                  <div className="h-full bg-[#9a6a4a]" style={{ width: `${(s.durezza ?? 0) * 100}%` }} />
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-[9px] text-neutral-400 tabular-nums">
                    dur {s.durezza?.toFixed(2) ?? "—"}
                  </span>
                  {s.takes.length > 1 && (
                    <span className="text-[9px] text-neutral-400">· {s.takes.length} riprese</span>
                  )}
                  <button
                    onClick={() => { setScrivo(scrivo === s.id ? null : s.id); setTesto(""); }}
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
                  <input
                    autoFocus value={testo}
                    onChange={(e) => setTesto(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") void segnala(s.id);
                      if (e.key === "Escape") setScrivo(null);
                    }}
                    onBlur={() => void segnala(s.id)}
                    placeholder="cosa non va — invio"
                    className="mt-1 w-full bg-neutral-950 border border-amber-900/60 rounded-sm
                               px-1 py-0.5 text-[10px] text-neutral-200 outline-none"
                  />
                )}
                {s.problemi.map((p, i) => (
                  <div key={i} className="mt-0.5 flex items-start gap-1 text-[9.5px] leading-tight text-amber-500/80">
                    <button onClick={async () => {
                      try { setShots((await api.videoProblema(s.id, undefined, i)).shots); } catch { /* niente */ }
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
