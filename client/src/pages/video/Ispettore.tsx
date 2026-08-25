import { useMemo, useState } from "react";
import { api, pq, type VideoCut, type VideoShot } from "../../api";

/**
 * Il taglio scelto: perché sta lì, e come cambiarlo.
 *
 * Le alternative erano una tendina di nomi. Ma "x19" non dice niente: la
 * domanda è se quell'immagine, su quella battuta, regge il suono — e quella si
 * guarda. Qui i candidati sono provini, ordinati per quanto la loro durezza si
 * avvicina a quella del suono in questo punto, che è lo stesso criterio con cui
 * il piano ha scelto: si vede la classifica che ha deciso, e la si scavalca a
 * ragion veduta.
 *
 * Niente `alert()`: una forzatura si annota sotto al bottone e si può disfare
 * lì, senza una finestra da chiudere per ogni clic.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

type Props = {
  sel: VideoCut;
  shots: VideoShot[];
  candidati: VideoShot[];
  chiudi: () => void;
};

type Fatto = { testo: string; disfa: () => Promise<unknown> };

export default function Ispettore({ sel, shots, candidati, chiudi }: Props) {
  const [fatto, setFatto] = useState<Fatto | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const mio = shots.find((s) => s.id === sel.shot) ?? null;

  /** Ordinati come li ha ordinati il piano: per distanza fra la durezza
   *  dell'immagine e quella del suono su questa battuta. */
  const ordinati = useMemo(() => {
    const bersaglio = sel.durezzaSuono;
    return [...candidati]
      .map((s) => ({ s, d: Math.abs((s.durezza ?? 0.5) - bersaglio) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 24);
  }, [candidati, sel.durezzaSuono]);

  const agisci = async (testo: string, fa: () => Promise<unknown>, disfa: () => Promise<unknown>) => {
    setErrore(null);
    try { await fa(); setFatto({ testo, disfa }); }
    catch (e) { setErrore(e instanceof Error ? e.message : String(e)); }
  };

  const stacco = sel.durezzaPiano !== null && Math.abs(sel.durezzaSuono - sel.durezzaPiano) > 0.35;

  return (
    <div className="p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] text-neutral-100">{sel.shot}</span>
        <button onClick={chiudi} className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-300">chiudi</button>
      </div>
      <div className="mt-0.5 text-[10px] text-neutral-400 tabular-nums leading-relaxed">
        batt {sel.bar} · {mmss(sel.t)} · {sel.dur.toFixed(2)}s · {sel.velocita.toFixed(2)}x
        {sel.rovescio ? " · rovescio" : ""}<br />
        presa {sel.origine}{sel.atto ? ` · atto ${sel.atto}` : ""}
      </div>

      <div className="mt-2.5 flex gap-2.5 items-start">
        {mio?.takes[0] && (
          <video
            key={mio.takes[0].clip}
            src={pq(mio.takes[0].clip)}
            poster={pq(mio.takes[0].poster)}
            autoPlay muted loop playsInline
            className="w-[86px] shrink-0 aspect-[9/16] object-cover bg-black border border-orange-500/60 rounded-sm"
          />
        )}
        <div className="min-w-0 text-[10.5px] leading-relaxed">
          <div className="text-neutral-400 tabular-nums">
            durezza suono <span className="text-neutral-300">{sel.durezzaSuono.toFixed(2)}</span><br />
            durezza immagine <span className="text-neutral-300">{sel.durezzaPiano?.toFixed(2) ?? "—"}</span>
          </div>
          {stacco && <div className="mt-1 text-amber-500/90">si staccano parecchio</div>}
          {/* Le riprese dello stesso piano: `a` non e' per forza la migliore, e
              fin qui si potevano confrontare solo dalla libreria. */}
          {mio && mio.takes.length > 1 && (
            <div className="mt-1.5">
              <div className="text-neutral-400">riprese</div>
              <div className="mt-0.5 flex gap-1">
                {mio.takes.map((tk) => (
                  <span key={tk.take}
                        title={`${tk.frames} fotogrammi${tk.kept ? "" : " · scartata"}`}
                        className={`px-1 rounded-sm border text-[9.5px] ${
                          tk.kept ? "border-neutral-700 text-neutral-300" : "border-neutral-900 text-neutral-400 line-through"}`}>
                    {tk.take}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 text-[10.5px] text-neutral-400 leading-snug">
        al posto suo, dal proprio atto — i più vicini al suono per primi:
      </div>
      <div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))" }}>
        {ordinati.map(({ s, d }) => (
          <button
            key={s.id}
            title={`${s.id} · durezza ${(s.durezza ?? 0).toFixed(2)} · scarto ${d.toFixed(2)}`}
            onClick={() => agisci(
              `${s.id} inchiodato alla battuta ${sel.bar} — ricostruisci per vederlo`,
              () => api.videoPin(sel.bar, s.id),
              () => api.videoPin(sel.bar, null),
            )}
            className="group">
            <div className="w-full aspect-[9/16] bg-cover bg-center bg-neutral-900 rounded-sm
                            border border-neutral-800 group-hover:border-neutral-300"
                 style={{ backgroundImage: s.takes[0]?.poster ? `url(${pq(s.takes[0].poster)})` : undefined }} />
            <div className="text-[8.5px] text-neutral-400 group-hover:text-neutral-200 truncate leading-tight">{s.id}</div>
            <div className="text-[8.5px] text-neutral-400 tabular-nums leading-tight">+{d.toFixed(2)}</div>
          </button>
        ))}
        {!ordinati.length && (
          <span className="col-span-full text-[10.5px] text-neutral-400">nessun altro piano tenuto in questo atto</span>
        )}
      </div>

      <div className="mt-3 flex gap-1.5 items-center flex-wrap text-[10.5px]">
        <span className="text-neutral-400">durata</span>
        {[0.5, 1, 1.5, 2].map((b) => (
          <button key={b}
            onClick={() => agisci(
              `battuta ${sel.bar}: ${b} battute — ricostruisci per vederlo`,
              () => api.videoDurata(sel.bar, b),
              () => api.videoDurata(sel.bar, null),
            )}
            className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:border-neutral-500">
            {b}
          </button>
        ))}
        <button
          onClick={() => agisci("durata riportata a quella derivata", () => api.videoDurata(sel.bar, null), async () => {})}
          className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400">auto</button>
      </div>

      <button
        onClick={() => agisci(
          `${sel.shot} fuori dal montaggio — ricostruisci per vederlo`,
          () => api.videoPick(sel.shot, false, "tolto dalla timeline"),
          () => api.videoPick(sel.shot, true),
        )}
        className="mt-2 w-full px-1.5 py-1 rounded-sm border border-rose-900/70 text-rose-300 text-[10.5px]
                   hover:bg-rose-950/40">
        scarta {sel.shot} dal montaggio
      </button>

      {fatto && (
        <div className="mt-2 text-[10.5px] text-neutral-400 leading-snug">
          <span className="text-emerald-500/80">✓</span> {fatto.testo}
          <button
            onClick={async () => { await fatto.disfa().catch(() => {}); setFatto(null); }}
            className="ml-1.5 px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
            disfa
          </button>
        </div>
      )}
      {errore && <div className="mt-2 text-[10.5px] text-rose-400">{errore}</div>}
    </div>
  );
}
