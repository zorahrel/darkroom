import { useEffect, useMemo, useState } from "react";
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
  close: () => void;
  /** Chiamato dopo ogni forzatura, perché l'elenco in pagina resti vero. */
  onForzato: () => void;
};

type Done = { text: string; undo: () => Promise<unknown> };

export default function Ispettore({ sel, shots, candidati, close, onForzato }: Props) {
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Il candidato che si sta guardando. Sceglierlo non cambia niente: cambia
   *  il piano solo il bottone sotto, che dice per esteso cosa farà. Un clic
   *  solo, com'era prima, inchiodava una battuta in silenzio — e una modifica
   *  che non si vede è una modifica che non si può disfare. */
  const [trying, setTrying] = useState<VideoShot | null>(null);
  useEffect(() => { setTrying(null); setDone(null); setError(null); }, [sel.bar, sel.shot]);

  const mio = shots.find((s) => s.id === sel.shot) ?? null;

  /** Ordinati come li ha ordinati il piano: per distanza fra la durezza
   *  dell'immagine e quella del suono su questa battuta. */
  const sorted = useMemo(() => {
    const bersaglio = sel.soundIntensity;
    return [...candidati]
      .map((s) => ({ s, d: Math.abs((s.intensity ?? 0.5) - bersaglio) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 24);
  }, [candidati, sel.soundIntensity]);

  const agisci = async (text: string, fa: () => Promise<unknown>, undo: () => Promise<unknown>) => {
    setError(null);
    try { await fa(); setDone({ text, undo }); onForzato(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const stacco = sel.shotIntensity !== null && Math.abs(sel.soundIntensity - sel.shotIntensity) > 0.35;

  return (
    <div className="p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] text-neutral-100">{sel.shot}</span>
        <button onClick={close} className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-300">chiudi</button>
      </div>
      <div className="mt-0.5 text-[10px] text-neutral-400 tabular-nums leading-relaxed">
        batt {sel.bar} · {mmss(sel.t)} · {sel.dur.toFixed(2)}s · {sel.velocita.toFixed(2)}x
        {sel.rovescio ? " · rovescio" : ""}<br />
        presa {sel.origine}{sel.act ? ` · atto ${sel.act}` : ""}
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
            durezza suono <span className="text-neutral-300">{sel.soundIntensity.toFixed(2)}</span><br />
            durezza immagine <span className="text-neutral-300">{sel.shotIntensity?.toFixed(2) ?? "—"}</span>
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
        {sorted.map(({ s, d }) => (
          <button
            key={s.id}
            title={`${s.id} · durezza ${(s.intensity ?? 0).toFixed(2)} · scarto ${d.toFixed(2)}`}
            onClick={() => setTrying((p) => (p?.id === s.id ? null : s))}
            className="group">
            <div className={`w-full aspect-[9/16] bg-cover bg-center bg-neutral-900 rounded-sm border
                            ${trying?.id === s.id ? "border-sky-400" : "border-neutral-800 group-hover:border-neutral-300"}`}
                 style={{ backgroundImage: s.takes[0]?.poster ? `url(${pq(s.takes[0].poster)})` : undefined }} />
            <div className="text-[8.5px] text-neutral-400 group-hover:text-neutral-200 truncate leading-tight">{s.id}</div>
            <div className="text-[8.5px] text-neutral-400 tabular-nums leading-tight">+{d.toFixed(2)}</div>
          </button>
        ))}
        {!sorted.length && (
          <span className="col-span-full text-[10.5px] text-neutral-400">nessun altro piano tenuto in questo atto</span>
        )}
      </div>

      {trying && (
        <div className="mt-2.5 border border-sky-900/70 rounded-sm p-2">
          <div className="flex gap-2.5 items-start">
            <video
              key={trying.takes[0]?.clip}
              src={pq(trying.takes[0]?.clip ?? "")}
              poster={pq(trying.takes[0]?.poster ?? "")}
              autoPlay muted loop playsInline
              className="w-[86px] shrink-0 aspect-[9/16] object-cover bg-black border border-sky-500/60 rounded-sm"
            />
            <div className="min-w-0 text-[10.5px] text-neutral-400 leading-relaxed">
              <span className="text-neutral-100">{trying.id}</span><br />
              durezza {(trying.intensity ?? 0).toFixed(2)} · il suono qui chiede {sel.soundIntensity.toFixed(2)}
              <button
                onClick={() => agisci(
                  `battuta ${sel.bar}: ${trying.id} al posto di ${sel.shot}`,
                  () => api.videoPin(sel.bar, trying.id),
                  () => api.videoPin(sel.bar, null),
                )}
                className="mt-1.5 block w-full px-2 py-1 rounded-sm border border-sky-700 text-sky-200
                           hover:bg-sky-950/50">
                metti {trying.id} al posto di {sel.shot}
              </button>
              <button onClick={() => setTrying(null)}
                      className="mt-1 block w-full text-[10px] text-neutral-400 hover:text-neutral-100">
                lascia stare
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-1.5 items-center flex-wrap text-[10.5px]">
        <span className="text-neutral-400">durata</span>
        {[0.5, 1, 1.5, 2].map((b) => (
          <button key={b}
            onClick={() => agisci(
              `battuta ${sel.bar}: ${b} battute — ricostruisci per vederlo`,
              () => api.videoDuration(sel.bar, b),
              () => api.videoDuration(sel.bar, null),
            )}
            className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:border-neutral-500">
            {b}
          </button>
        ))}
        <button
          onClick={() => agisci("durata riportata a quella derivata", () => api.videoDuration(sel.bar, null), async () => {})}
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

      {done && (
        <div className="mt-2 text-[10.5px] text-neutral-400 leading-snug">
          <span className="text-emerald-500/80">✓</span> {done.text}
          <button
            onClick={async () => { await done.undo().catch(() => {}); setDone(null); }}
            className="ml-1.5 px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
            disfa
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-[10.5px] text-rose-400">{error}</div>}
    </div>
  );
}
