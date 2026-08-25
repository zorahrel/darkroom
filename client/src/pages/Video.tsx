import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  api, pq,
  type VideoAssets, type VideoAtto, type VideoBarra, type VideoCut,
  type VideoMarcatore, type VideoOnda, type VideoRicostruzione,
  type VideoShot, type VideoSospesa,
} from "../api";
import type { OutletCtx } from "../App";
import Timeline from "./video/Timeline";
import Ispettore from "./video/Ispettore";
import Libreria from "./video/Libreria";
import Maniglia from "./video/Maniglia";
import { indiceTaglio } from "./video/tempo";

/**
 * L'editor di un progetto video.
 *
 * Un guscio che sta in uno schermo e non scorre: in alto la barra, poi la
 * riga alta — libreria, monitor, ispettore — e sotto la linea del tempo,
 * separate da una maniglia che si trascina. È la forma di qualunque programma
 * di montaggio, e non per moda: se la pagina scorre, il monitor e la timeline
 * non possono stare sotto gli occhi insieme, e guardare un taglio diventa due
 * gesti invece che uno.
 *
 * L'altezza si misura, non si indovina: `100vh` meno l'intestazione vera,
 * ricalcolata a ogni ridimensionamento.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const FPS = 24;

/** Quanto spazio prende la timeline, in pixel. Sta nel browser perché è una
 *  preferenza di chi guarda, non una proprietà del montaggio. */
const CHIAVE_ALTEZZA = "darkroom.video.altezzaTimeline";
const CHIAVE_SX = "darkroom.video.larghezzaLibreria";
const CHIAVE_DX = "darkroom.video.larghezzaIspettore";

function leggi(chiave: string, difetto: number, min: number): number {
  const v = Number(localStorage.getItem(chiave));
  return Number.isFinite(v) && v >= min ? v : difetto;
}

/** Il verdetto della barra, in una riga; il dettaglio si apre. */
function Stato({ barra, onRifai }: { barra: VideoBarra | null; onRifai: () => void }) {
  const [aperta, setAperta] = useState(false);
  const esito = barra?.esito ?? "sconosciuto";
  const colore = barra?.calcolo ? "text-neutral-400"
    : esito === "verde" ? "text-emerald-400"
    : esito === "rosso" ? "text-rose-400" : "text-neutral-400";
  const pallino = barra?.calcolo ? "bg-neutral-600 animate-pulse"
    : esito === "verde" ? "bg-emerald-500" : esito === "rosso" ? "bg-rose-500" : "bg-neutral-700";

  return (
    <div className="relative">
      <button onClick={() => setAperta((a) => !a)} className={`flex items-center gap-1.5 text-[11px] ${colore}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${pallino}`} />
        {barra?.calcolo ? "misuro…" : esito}
        {!!barra?.fallite.length && <span className="text-rose-400">· {barra.fallite.length} cadute</span>}
        <span className="text-neutral-400">{aperta ? "▴" : "▾"}</span>
      </button>
      {aperta && (
        <div className="absolute z-40 mt-1 w-[640px] max-w-[86vw] bg-neutral-950 border border-neutral-800
                        rounded-sm p-2.5 shadow-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[11px] ${colore}`}>{esito}</span>
            <button onClick={onRifai} className="text-[10px] text-neutral-400 hover:text-neutral-300">rimisura</button>
          </div>
          {barra?.righe.map((r) => (
            <div key={r.n} className="flex gap-2 text-[11px] leading-relaxed">
              <span className={r.ok === false ? "text-rose-400" : "text-emerald-500/80"}>{r.ok === false ? "✕" : "✓"}</span>
              <span className="text-neutral-400">{r.testo}</span>
            </div>
          ))}
          {barra?.fallite.map((f, i) => <div key={i} className="text-[11px] text-rose-400">— {f}</div>)}
          {!barra?.righe.length && <div className="text-[11px] text-neutral-400">non ancora misurata</div>}
        </div>
      )}
    </div>
  );
}

/** Il trasporto: quello che una barra nativa non sa fare. */
function Trasporto({ v, t, durata, cuts, vaiA }: {
  v: HTMLVideoElement | null; t: number; durata: number;
  cuts: VideoCut[]; vaiA: (s: number, parti?: boolean) => void;
}) {
  const [gira, setGira] = useState(false);
  const [vel, setVel] = useState(1);
  useEffect(() => {
    if (!v) return;
    const a = () => setGira(true), b = () => setGira(false);
    v.addEventListener("play", a); v.addEventListener("pause", b);
    return () => { v.removeEventListener("play", a); v.removeEventListener("pause", b); };
  }, [v]);
  useEffect(() => { if (v) v.playbackRate = vel; }, [v, vel]);

  const i = indiceTaglio(cuts, t);
  const B = "px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600";
  return (
    <div className="mt-1.5 flex items-center gap-1 text-[10.5px] justify-center flex-wrap">
      <button className={B} title="taglio prima  [" onClick={() => vaiA(cuts[Math.max(0, i - 1)]?.t ?? 0)}>⏮</button>
      <button className={B} title="un fotogramma indietro  ←" onClick={() => vaiA(t - 1 / FPS)}>◀|</button>
      <button className={`${B} w-8`} title="spazio" onClick={() => (gira ? v?.pause() : v?.play())}>{gira ? "❚❚" : "▶"}</button>
      <button className={B} title="un fotogramma avanti  →" onClick={() => vaiA(t + 1 / FPS)}>|▶</button>
      <button className={B} title="taglio dopo  ]" onClick={() => vaiA(cuts[Math.min(cuts.length - 1, i + 1)]?.t ?? durata)}>⏭</button>
      <span className="ml-1 tabular-nums text-neutral-400">{mmss(t)} / {mmss(durata)} · f{Math.round(t * FPS)}</span>
      <select value={vel} onChange={(e) => setVel(Number(e.target.value))}
              className="ml-1 bg-neutral-950 border border-neutral-800 rounded-sm px-1 py-0.5 text-neutral-400">
        {[0.25, 0.5, 1, 1.5, 2].map((x) => <option key={x} value={x}>{x}x</option>)}
      </select>
    </div>
  );
}


export default function Video() {
  const { pid } = useParams();
  const ctx = useOutletContext<OutletCtx>();
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [cuts, setCuts] = useState<VideoCut[]>([]);
  const [atti, setAtti] = useState<VideoAtto[]>([]);
  const [sospese, setSospese] = useState<VideoSospesa[]>([]);
  const [assets, setAssets] = useState<VideoAssets | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [durata, setDurata] = useState(0);
  const [t, setT] = useState(0);
  const [barra, setBarra] = useState<VideoBarra | null>(null);
  const [ric, setRic] = useState<VideoRicostruzione | null>(null);
  const [scelto, setScelto] = useState<number | null>(null);
  const [onda, setOnda] = useState<VideoOnda | null>(null);
  const [marcatori, setMarcatori] = useState<VideoMarcatore[]>([]);
  const [inOut, setInOut] = useState<[number, number] | null>(null);
  const [gira, setGira] = useState(false);
  const [ciclo, setCiclo] = useState(false);
  const [appunto, setAppunto] = useState<{ t: number; testo: string } | null>(null);
  const [aiuto, setAiuto] = useState(false);
  const [vEl, setVEl] = useState<HTMLVideoElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);

  /** L'editor vuole tutta la larghezza: il limite a 1280 px è giusto per una
   *  pagina di testo e sbagliato per una timeline. */
  useEffect(() => {
    const prima = ctx?.wide;
    ctx?.setWide?.(true);
    return () => { if (prima === false) ctx?.setWide?.(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- misure del guscio ---------------------------------------------------
  const guscio = useRef<HTMLDivElement>(null);
  const [hGuscio, setHGuscio] = useState(700);
  const [hTimeline, setHTimeline] = useState(() => leggi(CHIAVE_ALTEZZA, 300, 140));
  const [wSx, setWSx] = useState(() => leggi(CHIAVE_SX, 218, 150));
  const [wDx, setWDx] = useState(() => leggi(CHIAVE_DX, 336, 220));

  /** L'intestazione dell'app non ha un'altezza che si possa dare per scontata:
   *  la si misura dove finisce davvero, e si ricalcola quando la finestra
   *  cambia. Un `calc(100vh - 56px)` scritto a mano è giusto finché qualcuno
   *  non aggiunge una riga al menu. */
  useLayoutEffect(() => {
    const misura = () => {
      const el = guscio.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Il padding sotto del contenitore si legge, non si stima: un margine a
      // occhio lascia otto pixel di troppo e la pagina scorre lo stesso — che
      // e' esattamente cio' che questo guscio esiste per evitare.
      const padre = el.parentElement;
      const sotto = padre ? parseFloat(getComputedStyle(padre).paddingBottom) || 0 : 0;
      setHGuscio(Math.max(360, window.innerHeight - top - sotto));
    };
    misura();
    window.addEventListener("resize", misura);
    const ro = new ResizeObserver(misura);
    if (guscio.current?.parentElement) ro.observe(guscio.current.parentElement);
    return () => { window.removeEventListener("resize", misura); ro.disconnect(); };
  }, []);

  const H_MANIGLIA = 6;
  const H_BARRA = 24;
  const hAlto = Math.max(180, hGuscio - H_BARRA - H_MANIGLIA - hTimeline);
  const limiteTimeline = (v: number) => Math.max(140, Math.min(hGuscio - H_BARRA - H_MANIGLIA - 180, v));

  const salva = (k: string) => (v: number) => localStorage.setItem(k, String(Math.round(v)));

  // ---- dati ----------------------------------------------------------------
  const ricarica = useCallback(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
    api.videoCuts().then((r) => {
      setCuts(r.cuts); setBpm(r.bpm); setDurata(r.durata);
      setAtti(r.atti ?? []); setSospese(r.sospese ?? []);
    }).catch(() => {});
    api.videoAssets().then(setAssets).catch(() => {});
    api.videoMarcatori().then((r) => setMarcatori(r.marcatori)).catch(() => {});
  }, []);
  useEffect(() => { ricarica(); }, [ricarica]);

  /** La barra costa un minuto e mezzo di ffmpeg sul PC: il server la mette in
   *  cantiere e risponde subito, la pagina la ripesca finché non è pronta. */
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

  /** I picchi si calcolano al primo giro e restano su disco. */
  useEffect(() => {
    let vivo = true;
    const chiedi = async () => {
      try {
        const o = await api.videoOnda();
        if (!vivo) return;
        setOnda(o);
        if (!o.pronta) setTimeout(chiedi, 2500);
      } catch { /* niente */ }
    };
    void chiedi();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!ric?.attiva) return;
    const h = setInterval(async () => {
      try {
        const r = await api.videoRicostruzione();
        setRic(r);
        if (!r.attiva) { ricarica(); api.videoBarra(true).then(setBarra).catch(() => {}); }
      } catch { /* niente */ }
    }, 1200);
    return () => clearInterval(h);
  }, [ric?.attiva, ricarica]);

  useEffect(() => {
    if (!vEl) return;
    const a = () => setGira(true), b = () => setGira(false);
    vEl.addEventListener("play", a); vEl.addEventListener("pause", b);
    return () => { vEl.removeEventListener("play", a); vEl.removeEventListener("pause", b); };
  }, [vEl]);

  /** Il ciclo sul tratto: si guarda lo stesso passaggio dieci volte di fila
   *  senza toccare niente, che è come si decide se un taglio arriva tardi. */
  useEffect(() => {
    if (!ciclo || !inOut || !vEl) return;
    const h = setInterval(() => {
      if (vEl.currentTime >= inOut[1] || vEl.currentTime < inOut[0] - 0.05) {
        vEl.currentTime = inOut[0];
        void vEl.play().catch(() => {});
      }
    }, 80);
    return () => clearInterval(h);
  }, [ciclo, inOut, vEl]);

  const src = assets?.anteprima ?? assets?.reel ?? null;

  const inScena = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cuts) m.set(c.shot, (m.get(c.shot) ?? 0) + c.dur);
    return m;
  }, [cuts]);

  const poster = useMemo(() => {
    const m = new Map<string, string>();
    for (const sh of shots) {
      const tk = sh.takes.find((x) => x.kept) ?? sh.takes[0];
      if (tk?.poster) m.set(sh.id, tk.poster);
    }
    return m;
  }, [shots]);

  /** Un solo modo di muovere la testina. `parti` distingue "portami lì e fai
   *  vedere" da "portami lì e basta": se anche il passo a fotogramma facesse
   *  partire il video, tenere premuta la freccia scivolerebbe invece di
   *  scorrere quadro per quadro. */
  const vaiA = useCallback((s: number, parti = false) => {
    const v = video.current;
    if (!v || !durata) return;
    v.currentTime = Math.max(0, Math.min(durata - 1 / FPS, s));
    setT(v.currentTime);
    if (parti) void v.play().catch(() => {});
  }, [durata]);

  const apriTaglio = useCallback((i: number) => {
    setScelto(i);
    vaiA((cuts[i]?.t ?? 0) + 0.02, true);
  }, [cuts, vaiA]);

  /** Dalla libreria al montaggio: se quel piano è in scena, ci si va. */
  const apriPiano = useCallback((id: string) => {
    const i = cuts.findIndex((c) => c.shot === id);
    if (i >= 0) apriTaglio(i);
  }, [cuts, apriTaglio]);

  const sel = scelto !== null ? cuts[scelto] ?? null : null;
  const attivo = cuts[indiceTaglio(cuts, t)] ?? null;
  const candidati = useMemo(
    () => (sel ? shots.filter((s) => s.kept && s.atto === sel.atto && s.id !== sel.shot) : []),
    [sel, shots],
  );

  /** La tastiera vale sulla pagina: si guarda il video con le mani ferme sui
   *  tasti e gli occhi sull'immagine, che è l'unico modo di accorgersi di un
   *  taglio che arriva tardi. */
  useEffect(() => {
    const su = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select") || e.metaKey || e.ctrlKey) return;
      const v = video.current;
      if (!v) return;
      const i = indiceTaglio(cuts, t);
      const passo = e.shiftKey ? 1 : 1 / FPS;
      const k = e.key;
      if (k === " ") { e.preventDefault(); v.paused ? void v.play() : v.pause(); }
      else if (k === "ArrowLeft") { e.preventDefault(); vaiA(t - passo); }
      else if (k === "ArrowRight") { e.preventDefault(); vaiA(t + passo); }
      else if (k === "[") { e.preventDefault(); apriTaglio(Math.max(0, i - 1)); }
      else if (k === "]") { e.preventDefault(); apriTaglio(Math.min(cuts.length - 1, i + 1)); }
      else if (k === "Home") { e.preventDefault(); vaiA(0); }
      else if (k === "End") { e.preventDefault(); vaiA(durata - 1 / FPS); }
      else if (k === "f") { e.preventDefault(); void v.requestFullscreen?.().catch(() => {}); }
      else if (k === "i") { e.preventDefault(); setInOut([t, inOut?.[1] ?? durata]); }
      else if (k === "o") { e.preventDefault(); setInOut([inOut?.[0] ?? 0, t]); }
      else if (k === "l") { e.preventDefault(); setCiclo((c) => !c); }
      else if (k === "m") { e.preventDefault(); v.pause(); setAppunto({ t: v.currentTime, testo: "" }); }
      else if (k === "?") { e.preventDefault(); setAiuto((a) => !a); }
      else if (k === "Escape") { setScelto(null); setAiuto(false); setAppunto(null); }
    };
    window.addEventListener("keydown", su);
    return () => window.removeEventListener("keydown", su);
  }, [cuts, t, durata, vaiA, inOut, apriTaglio]);

  const lancia = async () => {
    try { await api.videoRicostruisci(); setRic(await api.videoRicostruzione()); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div ref={guscio} className="flex flex-col text-neutral-200 overflow-hidden" style={{ height: hGuscio }}>
      {/* ---- barra ---- */}
      <div className="shrink-0 flex items-center gap-2.5 px-1 border-b border-neutral-900" style={{ height: H_BARRA }}>
        <span className="tracking-[0.22em] text-[10.5px] text-neutral-400">MONTAGGIO</span>
        <Link to={`/p/${pid}/video/scelta`} className="text-[11px] text-neutral-400 hover:text-neutral-200">scelta →</Link>
        <span className="text-[10.5px] text-neutral-400 tabular-nums">
          {cuts.length} tagli · {shots.length} piani{bpm ? ` · ${bpm.toFixed(1)} BPM` : ""} · {mmss(durata)}
        </span>
        <Stato barra={barra} onRifai={() => api.videoBarra(true).then(setBarra).catch(() => {})} />
        {ciclo && inOut && <span className="text-[10.5px] text-amber-400/80">↻ ciclo</span>}
        {!!sospese.length && (
          <span className="text-[10.5px] text-amber-400/90" title={sospese.map((s) => `batt ${s.battuta}: ${s.garanzia}`).join(" · ")}>
            {sospese.length} garanzie sospese
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAiuto((a) => !a)} className="text-[10.5px] text-neutral-400 hover:text-neutral-200">tasti ?</button>
          <button onClick={lancia} disabled={!!ric?.attiva}
                  className={`text-[10.5px] px-2 py-0.5 rounded-sm border ${
                    ric?.attiva ? "border-neutral-800 text-neutral-400" : "border-neutral-600 text-neutral-200 hover:bg-neutral-900"}`}>
            {ric?.attiva ? "ricostruisco…" : "ricostruisci"}
          </button>
        </div>
      </div>

      {/* ---- riga alta: libreria · monitor · ispettore ---- */}
      <div className="flex min-h-0" style={{ height: hAlto }}>
        <aside className="shrink-0 min-w-0" style={{ width: wSx }}>
          <Libreria shots={shots} inScena={inScena} setShots={setShots} apri={apriPiano} />
        </aside>
        <Maniglia verso="col" valore={wSx} titolo="larghezza della libreria"
                  calcola={(v0, d) => Math.max(150, Math.min(460, v0 + d))}
                  onCambia={setWSx} onFine={salva(CHIAVE_SX)} />

        <main className="shrink-0 flex flex-col items-center justify-center px-2 py-1.5 gap-0 relative">
          {src ? (
            <video
              ref={(el) => { video.current = el; setVEl(el); }}
              src={pq(`/api/video/asset/${src}`)}
              playsInline loop preload="metadata"
              /* Un video fermo a 0 è un rettangolo nero: il primo quadro è
                 notte sul mare, quindi la pagina si apriva su un buco. Mezzo
                 secondo dopo i metadati e la locandina è un fotogramma vero. */
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.5; }}
              onClick={(e) => { const v = e.currentTarget; v.paused ? void v.play() : v.pause(); }}
              onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
              className="max-h-[calc(100%-40px)] max-w-full aspect-[9/16] object-contain bg-black
                         border border-neutral-800 rounded-sm cursor-pointer"
            />
          ) : (
            <div className="h-[70%] aspect-[9/16] bg-black border border-neutral-800 rounded-sm
                            grid place-items-center text-neutral-400 text-xs">nessun montaggio ancora</div>
          )}
          <Trasporto v={vEl} t={t} durata={durata} cuts={cuts} vaiA={vaiA} />
          {attivo && (
            <div className="text-[10px] text-neutral-400 tabular-nums">
              {attivo.shot} · {attivo.dur.toFixed(2)}s · {attivo.velocita.toFixed(2)}x
              {attivo.rovescio ? " · rovescio" : ""}{attivo.atto ? ` · ${attivo.atto}` : ""}
            </div>
          )}

          {appunto && (
            <div className="absolute inset-x-6 bottom-4 border border-amber-900/70 bg-neutral-950 rounded-sm p-2">
              <div className="text-[10px] text-amber-400/80 tabular-nums mb-1">
                appunto a {mmss(appunto.t)} — f{Math.round(appunto.t * FPS)}
              </div>
              <input
                autoFocus value={appunto.testo}
                onChange={(e) => setAppunto({ ...appunto, testo: e.target.value })}
                onKeyDown={async (e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setAppunto(null);
                  if (e.key === "Enter" && appunto.testo.trim()) {
                    const r = await api.videoMarcatore(appunto.t, appunto.testo.trim()).catch(() => null);
                    if (r) setMarcatori(r.marcatori);
                    setAppunto(null);
                  }
                }}
                placeholder="cosa non va — invio per segnarlo, esc per lasciar perdere"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-sm px-2 py-1 text-[11.5px] text-neutral-200"
              />
            </div>
          )}
        </main>

        <Maniglia verso="col" valore={wDx} titolo="larghezza dell'ispettore"
                  calcola={(v0, d) => Math.max(240, Math.min(720, v0 - d))}
                  onCambia={setWDx} onFine={salva(CHIAVE_DX)} />
        <aside className="flex-1 min-w-0 overflow-y-auto" style={{ minWidth: Math.min(wDx, 720) }}>
          {sel ? (
            <Ispettore sel={sel} shots={shots} candidati={candidati} chiudi={() => setScelto(null)} />
          ) : (
            <div className="p-2.5 space-y-2.5">
              <div className="text-[11px] text-neutral-400 leading-relaxed">
                clicca un taglio sulla timeline per vedere perché sta lì — e per metterne un
                altro al suo posto, allungarlo o toglierlo.
              </div>
              {!!marcatori.length && (
                <div>
                  <div className="text-[10px] text-neutral-400 mb-1">appunti</div>
                  <div className="space-y-1">
                    {marcatori.map((m) => (
                      <div key={m.t} className="flex items-start gap-1.5 text-[11px]">
                        <button onClick={() => vaiA(m.t, true)} className="text-amber-500/70 tabular-nums shrink-0 hover:text-amber-300">
                          {mmss(m.t)}
                        </button>
                        <span className="text-neutral-400 leading-tight">{m.nota}</span>
                        <button onClick={() => void api.videoMarcatore(m.t, null).then((r) => setMarcatori(r.marcatori))}
                                className="ml-auto text-neutral-400 hover:text-neutral-300">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ric && (ric.attiva || ric.finita) && (
                <div>
                  <div className="text-[10px] text-neutral-400 mb-1">
                    ricostruzione {ric.uscita !== null && `(uscita ${ric.uscita})`}
                  </div>
                  <pre className="max-h-52 overflow-auto bg-neutral-950 border border-neutral-900 rounded-sm
                                  p-1.5 text-[9.5px] leading-tight text-neutral-400 whitespace-pre-wrap">
                    {ric.log.slice(-3000) || "…"}
                  </pre>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* ---- maniglia ---- */}
      <Maniglia verso="riga" valore={hTimeline} titolo="quanto spazio prende la timeline"
                calcola={(v0, d) => limiteTimeline(v0 - d)}
                onCambia={setHTimeline} onFine={salva(CHIAVE_ALTEZZA)} />

      {/* ---- timeline ---- */}
      <div className="shrink-0 min-h-0" style={{ height: hTimeline }}>
        <Timeline
          cuts={cuts} atti={atti} onda={onda} durata={durata} t={t}
          poster={poster} scelto={scelto} inOut={inOut} setInOut={setInOut}
          gira={gira} vaiA={vaiA} marcatori={marcatori}
          togliMarcatore={(m) => { void api.videoMarcatore(m, null).then((r) => setMarcatori(r.marcatori)); }}
          apri={apriTaglio}
        />
      </div>

      {aiuto && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center" onClick={() => setAiuto(false)}>
          <div className="bg-neutral-950 border border-neutral-800 rounded-sm p-4 max-w-[640px]"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[12px] text-neutral-300 mb-2">tasti</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[11.5px]">
              {[["spazio", "avvia e ferma"], ["← →", "un fotogramma"], ["⇧ ← →", "un secondo"],
                ["[ ]", "taglio prima / dopo"], ["inizio · fine", "capo e coda"], ["f", "schermo intero"],
                ["i · o", "inizio e fine del tratto"], ["l", "ripeti il tratto"],
                ["m", "appunto sull'istante"], ["esc", "chiudi"],
                ["⌥ rotellina", "zoom della timeline"], ["?", "questo elenco"]].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-28 shrink-0 text-neutral-200">{k}</span>
                  <span className="text-neutral-400">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10.5px] text-neutral-400">
              la maniglia sopra la timeline si trascina: la timeline cresce e le corsie con lei.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
