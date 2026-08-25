import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api, pq,
  type VideoAssets, type VideoAtto, type VideoBarra, type VideoCut,
  type VideoRicostruzione, type VideoShot, type VideoSospesa,
} from "../api";

/**
 * L'editor di un progetto video.
 *
 * Il montaggio non si monta qui: si monta in Python, e la ragione non e'
 * pigrizia. Le garanzie del progetto — i tagli su beat misurati, la
 * correlazione fra durezza del suono e durezza dell'immagine, zero doppioni —
 * sono vere PER COSTRUZIONE, perche' il piano e' derivato da misure. Il giorno
 * in cui i tagli si trascinano a mano quelle proprieta' smettono di essere
 * garantite e nessuna misura puo' piu' difenderle.
 *
 * Quindi qui si fanno le tre cose che la catena non sa fare: si guarda, si
 * decide cosa tenere, e si forzano poche scelte dichiarandole. Le forzature
 * finiscono in `scelte.json`, il pianificatore le rilegge, e se una di esse
 * sospende una garanzia lo scrive nel piano invece di tacere.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Le bande degli atti sopra la linea del tempo. Senza, 64 blocchi grigi sono
 *  indistinguibili e non si vede se la storia regge. */
function BandeAtti({ atti, durata, vai }: { atti: VideoAtto[]; durata: number; vai: (s: number) => void }) {
  if (!atti.length || !durata) return null;
  return (
    <div className="relative h-5 mb-1">
      {atti.map((a, i) => (
        <button
          key={a.nome}
          onClick={() => vai(a.t0 + 0.02)}
          title={`${a.nome} — ${mmss(a.t0)}`}
          className="absolute top-0 bottom-0 border-r border-black/70 text-[9.5px] leading-5
                     text-neutral-400 hover:text-neutral-100 overflow-hidden whitespace-nowrap px-1"
          style={{
            left: `${(a.t0 / durata) * 100}%`,
            width: `${((a.t1 - a.t0) / durata) * 100}%`,
            background: i % 2 ? "#191919" : "#212121",
          }}
        >
          {a.nome}
        </button>
      ))}
    </div>
  );
}

function Barra({ barra, onRifai }: { barra: VideoBarra | null; onRifai: () => void }) {
  if (!barra) return <div className="text-[11px] text-neutral-700">barra non ancora misurata</div>;
  if (barra.calcolo && !barra.righe.length) {
    return <div className="text-[11px] text-neutral-600 border border-neutral-900 rounded-sm p-2.5">
      misuro la barra… (check.py, un minuto e mezzo)
    </div>;
  }
  const col = barra.esito === "verde" ? "text-emerald-400"
            : barra.esito === "rosso" ? "text-rose-400" : "text-neutral-500";
  return (
    <div className="border border-neutral-900 rounded-sm p-2.5">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span className={`text-[11px] tracking-[0.2em] ${col}`}>{barra.esito.toUpperCase()}</span>
        <button onClick={onRifai} className="text-[10.5px] text-neutral-600 hover:text-neutral-300">
          rimisura
        </button>
        {barra.calcolo && <span className="text-[10.5px] text-neutral-700">sto rimisurando…</span>}
      </div>
      <ul className="space-y-0.5">
        {barra.righe.map((r) => (
          <li key={r.n} className="text-[11px] flex gap-2 leading-snug">
            <span className={r.ok ? "text-emerald-500" : "text-rose-500"}>{r.ok ? "✓" : "✗"}</span>
            <span className="text-neutral-400">{r.testo}</span>
          </li>
        ))}
      </ul>
      {barra.fallite.map((f, i) => (
        <div key={i} className="mt-1 text-[11px] text-rose-400">— {f}</div>
      ))}
    </div>
  );
}

export default function Video() {
  const { pid } = useParams();
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [cuts, setCuts] = useState<VideoCut[]>([]);
  const [atti, setAtti] = useState<VideoAtto[]>([]);
  const [sospese, setSospese] = useState<VideoSospesa[]>([]);
  const [assets, setAssets] = useState<VideoAssets | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [durata, setDurata] = useState(0);
  const [t, setT] = useState(0);
  const [solo, setSolo] = useState<"tutti" | "tenuti" | "scartati">("tutti");
  const [barra, setBarra] = useState<VideoBarra | null>(null);
  const [ric, setRic] = useState<VideoRicostruzione | null>(null);
  const [scelto, setScelto] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const ricarica = useCallback(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
    api.videoCuts().then((r) => {
      setCuts(r.cuts); setBpm(r.bpm); setDurata(r.durata);
      setAtti(r.atti ?? []); setSospese(r.sospese ?? []);
    }).catch(() => {});
    api.videoAssets().then(setAssets).catch(() => {});
  }, []);

  useEffect(() => { ricarica(); }, [ricarica]);
  // La barra costa un minuto e mezzo di ffmpeg: il server la mette in cantiere
  // e risponde subito, la pagina la ripesca finche' non e' pronta.
  useEffect(() => {
    let vivo = true;
    const chiedi = async () => {
      try {
        const b = await api.videoBarra();
        if (!vivo) return;
        setBarra(b);
        if (b.calcolo) setTimeout(chiedi, 3000);
      } catch { /* niente */ }
    };
    void chiedi();
    return () => { vivo = false; };
  }, []);

  // La ricostruzione si segue col polling, come il bake: e' lo stesso problema
  // (un processo lungo con un log che cresce) e la casa ha gia' questa forma.
  useEffect(() => {
    if (!ric?.attiva) return;
    const h = setInterval(async () => {
      try {
        const r = await api.videoRicostruzione();
        setRic(r);
        if (!r.attiva) {
          ricarica();
          api.videoBarra(true).then(setBarra).catch(() => {});
        }
      } catch { /* niente */ }
    }, 1200);
    return () => clearInterval(h);
  }, [ric?.attiva, ricarica]);

  const src = assets?.anteprima ?? assets?.reel ?? null;
  const tenuti = shots.filter((s) => s.kept).length;
  const inScena = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cuts) m.set(c.shot, (m.get(c.shot) ?? 0) + c.dur);
    return m;
  }, [cuts]);

  const vai = (s: number) => {
    if (!video.current) return;
    video.current.currentTime = s;
    video.current.play().catch(() => {});
  };

  const [ripresa, setRipresa] = useState<Record<string, number>>({});
  const [scrivo, setScrivo] = useState<string | null>(null);
  const [testo, setTesto] = useState("");

  const segnala = async (shot: string) => {
    const t2 = testo.trim();
    if (!t2) { setScrivo(null); return; }
    setScrivo(null); setTesto("");
    try { setShots((await api.videoProblema(shot, t2)).shots); } catch { /* niente */ }
  };
  const togli = async (shot: string, i: number) => {
    try { setShots((await api.videoProblema(shot, undefined, i)).shots); } catch { /* niente */ }
  };
  const pickTake = async (shot: string, take: string, kept: boolean) => {
    setShots((prev) => prev.map((s) => s.id === shot
      ? { ...s, takes: s.takes.map((t2) => (t2.take === take ? { ...t2, kept } : t2)) } : s));
    try { setShots((await api.videoRipresa(shot, take, kept)).shots); } catch { /* niente */ }
  };
  const pick = async (shot: string, kept: boolean) => {
    setShots((prev) => prev.map((s) => (s.id === shot ? { ...s, kept } : s)));
    try { setShots((await api.videoPick(shot, kept)).shots); } catch { /* niente */ }
  };

  const visibili = shots.filter((s) =>
    solo === "tutti" ? true : solo === "tenuti" ? s.kept : !s.kept);

  const attivo = cuts.find((c) => t >= c.t && t < c.t + c.dur);
  const sel = scelto !== null ? cuts[scelto] ?? null : null;
  // Chi puo' prendere il posto di questo taglio: le riprese tenute dello stesso
  // atto. Fuori dall'atto non e' una scelta di montaggio, e' un'altra storia.
  const candidati = useMemo(
    () => (sel ? shots.filter((s) => s.kept && s.atto === sel.atto && s.id !== sel.shot) : []),
    [sel, shots],
  );

  const lancia = async () => {
    try { await api.videoRicostruisci(); setRic(await api.videoRicostruzione()); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="mx-auto max-w-[1500px] px-5 py-4 text-neutral-200">
      <div className="flex items-baseline gap-4 mb-3 flex-wrap">
        <h1 className="tracking-[0.3em] text-[13px] text-neutral-400">MONTAGGIO</h1>
        <Link to={`/p/${pid}/video/scelta`} className="text-[11px] text-neutral-500 hover:text-neutral-300">
          → scelta
        </Link>
        <span className="text-[12px] text-neutral-600">
          {cuts.length} tagli · {shots.length} piani girati · {tenuti} tenuti
          {bpm ? ` · ${bpm.toFixed(1)} BPM` : ""} · {durata.toFixed(1)}s
        </span>
        <button
          onClick={lancia}
          disabled={!!ric?.attiva}
          className={`text-[11px] px-2 py-0.5 rounded-sm border ${
            ric?.attiva ? "border-neutral-800 text-neutral-700"
                        : "border-neutral-600 text-neutral-200 hover:bg-neutral-900"}`}>
          {ric?.attiva ? "ricostruisco…" : "ricostruisci"}
        </button>
      </div>

      {sospese.length > 0 && (
        <div className="mb-3 border border-amber-900/60 rounded-sm p-2 text-[11px] text-amber-400/90">
          garanzie sospese da una forzatura:
          {sospese.map((s, i) => (
            <span key={i}> · batt {s.battuta}: {s.garanzia}</span>
          ))}
        </div>
      )}

      {ric && (ric.attiva || ric.finita) && (
        <details open={ric.attiva} className="mb-3">
          <summary className="text-[11px] text-neutral-600 cursor-pointer">
            log della ricostruzione {ric.uscita !== null && `(uscita ${ric.uscita})`}
          </summary>
          <pre className="mt-1 max-h-52 overflow-auto bg-neutral-950 border border-neutral-900 rounded-sm
                          p-2 text-[10.5px] leading-tight text-neutral-500 whitespace-pre-wrap">
            {ric.log.slice(-4000) || "…"}
          </pre>
        </details>
      )}

      <div className="mb-4">
        <Barra barra={barra} onRifai={() => api.videoBarra(true).then(setBarra).catch(() => {})} />
      </div>

      <div className="flex gap-5 items-start">
        {/* --- il reel --- */}
        <div className="shrink-0 w-[300px]">
          {src ? (
            <video
              ref={video}
              src={pq(`/api/video/asset/${src}`)}
              controls playsInline loop
              className="w-full bg-black border border-neutral-800 rounded-sm"
              onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
            />
          ) : (
            <div className="w-full aspect-[9/16] bg-black border border-neutral-800 rounded-sm
                            grid place-items-center text-neutral-600 text-xs">
              nessun montaggio ancora
            </div>
          )}
          {attivo && (
            <div className="mt-2 text-[11px] text-neutral-500 tabular-nums">
              {attivo.shot} · {attivo.dur.toFixed(2)}s · {attivo.velocita.toFixed(2)}x
              {attivo.rovescio ? " · rovescio" : ""}{attivo.atto ? ` · ${attivo.atto}` : ""}
            </div>
          )}
        </div>

        {/* --- la linea del tempo --- */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-neutral-600 mb-1">
            atti sopra · blocchi alti quanto e' duro il suono · clic per aprire il taglio
          </div>
          <BandeAtti atti={atti} durata={durata} vai={vai} />
          <div className="relative h-24 bg-neutral-950 border border-neutral-900 rounded-sm overflow-hidden">
            {cuts.map((c, i) => (
              <button
                key={i}
                title={`${c.shot} · ${mmss(c.t)} · ${c.velocita.toFixed(2)}x`}
                onClick={() => { setScelto(i); vai(c.t + 0.02); }}
                className={`absolute bottom-0 border-r border-black/60 hover:brightness-150 ${
                  scelto === i ? "outline outline-1 outline-orange-400" : ""}`}
                style={{
                  left: `${(c.t / durata) * 100}%`,
                  width: `${Math.max(0.25, (c.dur / durata) * 100)}%`,
                  height: `${18 + c.durezzaSuono * 82}%`,
                  background: c.rovescio ? "#8a5a3a" : "#3f6076",
                }}
              />
            ))}
            {/* la durezza dell'IMMAGINE, sopra quella del suono: dove le due
                curve si staccano si vede a colpo d'occhio */}
            {cuts.map((c, i) => (
              c.durezzaPiano === null ? null : (
                <div key={`p${i}`} className="absolute bg-[#c9a227]/70 pointer-events-none"
                     style={{
                       left: `${(c.t / durata) * 100}%`,
                       width: `${Math.max(0.25, (c.dur / durata) * 100)}%`,
                       bottom: `${18 + c.durezzaPiano * 82}%`,
                       height: "1.5px",
                     }} />
              )
            ))}
            {durata > 0 && (
              <div className="absolute top-0 bottom-0 w-px bg-orange-400/90 pointer-events-none"
                   style={{ left: `${(t / durata) * 100}%` }} />
            )}
          </div>
          <div className="mt-1 flex gap-4 text-[10.5px] text-neutral-600">
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#3f6076"}} />durezza del suono</span>
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#c9a227"}} />durezza dell'immagine</span>
            <span><i className="inline-block w-2 h-2 mr-1 align-middle" style={{background:"#8a5a3a"}} />rovescio</span>
          </div>

          {/* --- il taglio scelto: perche' e' li', e le tre forzature --- */}
          {sel && (
            <div className="mt-3 border border-neutral-800 rounded-sm p-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[13px]">{sel.shot}</span>
                <span className="text-[11px] text-neutral-600 tabular-nums">
                  batt {sel.bar} · {mmss(sel.t)} · {sel.dur.toFixed(2)}s · presa {sel.origine}
                  {sel.atto ? ` · atto ${sel.atto}` : ""}
                </span>
                <button onClick={() => setScelto(null)} className="text-[11px] text-neutral-700 hover:text-neutral-400">chiudi</button>
              </div>
              <div className="mt-1.5 text-[11px] text-neutral-500 tabular-nums">
                durezza del suono {sel.durezzaSuono.toFixed(2)} · dell'immagine{" "}
                {sel.durezzaPiano?.toFixed(2) ?? "—"}
                {sel.durezzaPiano !== null && Math.abs(sel.durezzaSuono - sel.durezzaPiano) > 0.35 && (
                  <span className="text-amber-500/90"> — si staccano parecchio</span>
                )}
              </div>
              <div className="mt-2.5 flex gap-2 items-center flex-wrap text-[11px]">
                <span className="text-neutral-600">inchioda</span>
                <select
                  defaultValue=""
                  onChange={async (e) => {
                    const v = e.target.value;
                    if (!v) return;
                    await api.videoPin(sel.bar, v);
                    alert(`${v} inchiodato alla battuta ${sel.bar}. Ricostruisci per vederlo.`);
                  }}
                  className="bg-neutral-950 border border-neutral-800 rounded-sm px-1.5 py-0.5 text-neutral-300 max-w-[240px]">
                  <option value="">un altro piano dell'atto…</option>
                  {candidati.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
                <button
                  onClick={() => api.videoPin(sel.bar, null).then(() => alert("forzatura tolta"))}
                  className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-500">
                  togli il pin
                </button>
                <span className="text-neutral-600 ml-2">durata</span>
                {[0.5, 1, 1.5, 2].map((b) => (
                  <button key={b}
                    onClick={() => api.videoDurata(sel.bar, b).then(() => alert(`battuta ${sel.bar}: ${b} battute. Ricostruisci per vederlo.`))}
                    className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:border-neutral-600">
                    {b}
                  </button>
                ))}
                <button
                  onClick={() => api.videoDurata(sel.bar, null).then(() => alert("durata rimessa a quella misurata"))}
                  className="px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-500">
                  auto
                </button>
                <button
                  onClick={() => pick(sel.shot, false)}
                  className="ml-2 px-1.5 py-0.5 rounded-sm border border-rose-900/70 text-rose-300">
                  scarta {sel.shot}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- i piani --- */}
      <div className="mt-6 flex items-center gap-3">
        <h2 className="tracking-[0.22em] text-[12px] text-neutral-400">PIANI</h2>
        {(["tutti", "tenuti", "scartati"] as const).map((k) => (
          <button key={k} onClick={() => setSolo(k)}
            className={`text-[11px] px-2 py-0.5 rounded-sm border ${
              solo === k ? "border-neutral-500 text-neutral-200" : "border-neutral-800 text-neutral-600"}`}>
            {k}
          </button>
        ))}
        <span className="text-[11px] text-neutral-600">
          passa sopra per farlo partire · clic su tieni/scarta
        </span>
      </div>

      <div className="mt-3 grid gap-3"
           style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
        {visibili.map((s) => (
          <div key={s.id}
               className={`rounded-sm border ${s.kept ? "border-neutral-800" : "border-neutral-900 opacity-45"}`}>
            {(() => {
              const i = Math.min(ripresa[s.id] ?? 0, Math.max(0, s.takes.length - 1));
              const tk = s.takes[i];
              if (!tk) return null;
              return (
                <div className="relative">
                  <video
                    key={tk.clip}
                    src={pq(tk.clip)}
                    poster={pq(tk.poster)}
                    muted loop playsInline preload="none"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                    onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                    className={`w-full bg-black ${tk.kept ? "" : "opacity-30 grayscale"}`}
                  />
                  {s.takes.length > 1 && (
                    <div className="absolute top-1 right-1 flex gap-0.5">
                      {s.takes.map((t2, k) => (
                        <button
                          key={t2.take}
                          onClick={() => setRipresa((r) => ({ ...r, [s.id]: k }))}
                          title={`ripresa ${t2.take}${t2.kept ? "" : " (scartata)"}`}
                          className={`w-4 h-4 text-[9px] leading-none rounded-sm border
                            ${k === i ? "bg-neutral-200 text-black border-neutral-200"
                                      : "bg-black/70 text-neutral-400 border-neutral-700"}
                            ${t2.kept ? "" : "line-through opacity-50"}`}>
                          {t2.take}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => pickTake(s.id, tk.take, !tk.kept)}
                    className={`absolute bottom-1 left-1 text-[9.5px] leading-none px-1.5 py-0.5 rounded-sm border
                      ${tk.kept ? "bg-black/70 border-neutral-600 text-neutral-200"
                                : "bg-black/85 border-amber-800 text-amber-500"}`}>
                    {tk.kept ? `ripresa ${tk.take} · in uso` : `ripresa ${tk.take} · scartata`}
                  </button>
                </div>
              );
            })()}
            <div className="px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-neutral-200 truncate">{s.id}</span>
                <span className="text-[10px] text-neutral-600 tabular-nums">
                  {(inScena.get(s.id) ?? 0).toFixed(1)}s
                </span>
              </div>
              <div className="mt-1 h-1 bg-neutral-900">
                <div className="h-full bg-[#9a6a4a]" style={{ width: `${(s.durezza ?? 0) * 100}%` }} />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-neutral-600 tabular-nums">
                  dur {s.durezza?.toFixed(2) ?? "—"} · mot {s.moto?.toFixed(1) ?? "—"}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setScrivo(scrivo === s.id ? null : s.id); setTesto(""); }}
                    title="segnala un problema"
                    className="text-[10px] px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-500 hover:text-amber-400 hover:border-amber-700">
                    !
                  </button>
                  <button
                    onClick={() => pick(s.id, !s.kept)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${
                      s.kept ? "border-neutral-700 text-neutral-300" : "border-neutral-800 text-neutral-500"}`}>
                    {s.kept ? "tieni" : "scarta"}
                  </button>
                </div>
              </div>
              {scrivo === s.id && (
                <input
                  autoFocus
                  value={testo}
                  onChange={(e) => setTesto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") segnala(s.id);
                    if (e.key === "Escape") setScrivo(null);
                  }}
                  onBlur={() => segnala(s.id)}
                  placeholder="cosa non va — invio per salvare"
                  className="mt-1 w-full bg-neutral-950 border border-amber-900/60 rounded-sm
                             px-1.5 py-1 text-[10.5px] text-neutral-200 outline-none"
                />
              )}
              {s.problemi.map((q, i) => (
                <div key={i} className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-amber-500/80">
                  <button onClick={() => togli(s.id, i)} title="risolto" className="text-neutral-700 hover:text-neutral-400">×</button>
                  <span>{q}</span>
                </div>
              ))}
              {s.perche && <div className="mt-1 text-[10px] text-neutral-600 leading-tight">{s.perche}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
