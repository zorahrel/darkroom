import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api, pq,
  type VideoAssets, type VideoAtto, type VideoBarra, type VideoCut,
  type VideoRicostruzione,
  type VideoOnda, type VideoMarcatore, type VideoShot, type VideoSospesa,
} from "../api";
import Timeline from "./video/Timeline";
import Ispettore from "./video/Ispettore";

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

/** 24, come il girato. Un montaggio derivato dai beat si giudica al fotogramma:
 *  "il taglio arriva un pelo tardi" e' un quarantesimo di secondo, e con la
 *  barra nativa di `<video controls>` quel pelo non si raggiunge. */
const FPS = 24;

/**
 * Il trasporto.
 *
 * `<video controls>` sa fare play e una barra da trascinare, e su un file
 * finito non serve altro — ma qui il file finito e' l'oggetto in revisione:
 * si guarda un taglio, si torna indietro di un fotogramma, si salta al taglio
 * prima. Sono tre gesti che la barra nativa non ha, e senza si finisce a
 * cercare col mouse un istante che si conosce gia' per numero.
 */
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
    <div className="mt-2 flex items-center gap-1.5 text-[11px] flex-wrap">
      <button className={B} title="taglio prima  [" onClick={() => vaiA(cuts[Math.max(0, i - 1)]?.t ?? 0)}>⏮</button>
      <button className={B} title="un fotogramma indietro  ←" onClick={() => vaiA(t - 1 / FPS, false)}>◀|</button>
      <button className={`${B} w-8`} title="spazio" onClick={() => (gira ? v?.pause() : v?.play())}>{gira ? "❚❚" : "▶"}</button>
      <button className={B} title="un fotogramma avanti  →" onClick={() => vaiA(t + 1 / FPS, false)}>|▶</button>
      <button className={B} title="taglio dopo  ]" onClick={() => vaiA(cuts[Math.min(cuts.length - 1, i + 1)]?.t ?? durata)}>⏭</button>
      <span className="ml-1 tabular-nums text-neutral-500">
        {mmss(t)} / {mmss(durata)} · f{Math.round(t * FPS)}
      </span>
      <select
        value={vel} onChange={(e) => setVel(Number(e.target.value))}
        className="ml-1 bg-neutral-950 border border-neutral-800 rounded-sm px-1 py-0.5 text-neutral-400">
        {[0.25, 0.5, 1, 1.5, 2].map((x) => <option key={x} value={x}>{x}x</option>)}
      </select>
      <span className="ml-auto text-neutral-700">spazio · ←→ fotogramma · ⇧←→ secondo · [ ] taglio · f schermo</span>
    </div>
  );
}

/** Quale taglio sta sotto la testina. Ricerca binaria perche' la chiamano il
 *  player a ogni `timeupdate` e la timeline a ogni ridisegno. */
function indiceTaglio(cuts: VideoCut[], t: number): number {
  let lo = 0, hi = cuts.length - 1, r = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if ((cuts[m]?.t ?? 0) <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
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

  const vai = (s: number) => vaiA(s, true);

  /** Un solo modo di muovere la testina. `parti` distingue "portami li' e fai
   *  vedere" (clic su un taglio) da "portami li' e basta" (passo a fotogramma):
   *  se anche il passo facesse partire il video, tenere premuta la freccia
   *  scivolerebbe invece di scorrere quadro per quadro. */
  const vaiA = useCallback((s: number, parti = false) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(durata - 1 / FPS, s));
    setT(v.currentTime);
    if (parti) v.play().catch(() => {});
  }, [durata]);

  const [vEl, setVEl] = useState<HTMLVideoElement | null>(null);
  const [onda, setOnda] = useState<VideoOnda | null>(null);
  const [marcatori, setMarcatori] = useState<VideoMarcatore[]>([]);
  useEffect(() => { api.videoMarcatori().then((r) => setMarcatori(r.marcatori)).catch(() => {}); }, []);
  const [inOut, setInOut] = useState<[number, number] | null>(null);
  const [gira, setGira] = useState(false);

  /** I picchi si calcolano al primo giro e restano su disco; finche' non ci
   *  sono la corsia del suono lo dice invece di restare vuota. */
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
    if (!vEl) return;
    const a = () => setGira(true), b = () => setGira(false);
    vEl.addEventListener("play", a); vEl.addEventListener("pause", b);
    return () => { vEl.removeEventListener("play", a); vEl.removeEventListener("pause", b); };
  }, [vEl]);

  /** Il ciclo sul tratto: si guarda lo stesso passaggio dieci volte di fila
   *  senza toccare niente, che e' come si decide se un taglio arriva tardi. */
  const [ciclo, setCiclo] = useState(false);
  const [appunto, setAppunto] = useState<{ t: number; testo: string } | null>(null);
  const [aiuto, setAiuto] = useState(false);
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

  /** I poster della striscia: un'immagine per piano, la ripresa tenuta. */
  const poster = useMemo(() => {
    const m = new Map<string, string>();
    for (const sh of shots) {
      const tk = sh.takes.find((x) => x.kept) ?? sh.takes[0];
      if (tk?.poster) m.set(sh.id, tk.poster);
    }
    return m;
  }, [shots]);

  /**
   * La tastiera. Sta qui e non nel trasporto perche' vale sulla pagina: si
   * guarda il video con le mani ferme sui tasti e gli occhi sull'immagine, che
   * e' l'unico modo di accorgersi di un taglio che arriva tardi.
   */
  useEffect(() => {
    const su = (e: KeyboardEvent) => {
      const dentro = (e.target as HTMLElement)?.closest("input, textarea, select");
      if (dentro || e.metaKey || e.ctrlKey) return;
      const v = video.current;
      if (!v) return;
      const i = indiceTaglio(cuts, t);
      const passo = e.shiftKey ? 1 : 1 / FPS;
      if (e.key === " ") { e.preventDefault(); v.paused ? void v.play() : v.pause(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); vaiA(t - passo); }
      else if (e.key === "ArrowRight") { e.preventDefault(); vaiA(t + passo); }
      else if (e.key === "[") { e.preventDefault(); const j = Math.max(0, i - 1); setScelto(j); vaiA(cuts[j]?.t ?? 0); }
      else if (e.key === "]") { e.preventDefault(); const j = Math.min(cuts.length - 1, i + 1); setScelto(j); vaiA(cuts[j]?.t ?? 0); }
      else if (e.key === "Home") { e.preventDefault(); vaiA(0); }
      else if (e.key === "End") { e.preventDefault(); vaiA(durata - 1 / FPS); }
      else if (e.key === "f") { e.preventDefault(); void v.requestFullscreen?.().catch(() => {}); }
      else if (e.key === "i") { e.preventDefault(); setInOut([t, inOut?.[1] ?? durata]); }
      else if (e.key === "o") { e.preventDefault(); setInOut([inOut?.[0] ?? 0, t]); }
      else if (e.key === "l") { e.preventDefault(); setCiclo((c) => !c); }
      else if (e.key === "m") {
        e.preventDefault();
        // Il video si ferma da solo: si scrive guardando il fotogramma che ha
        // fatto scattare l'appunto, non quello di tre secondi dopo.
        v.pause();
        setAppunto({ t: v.currentTime, testo: "" });
      }
      else if (e.key === "?") { e.preventDefault(); setAiuto((a) => !a); }
    };
    window.addEventListener("keydown", su);
    return () => window.removeEventListener("keydown", su);
  }, [cuts, t, durata, vaiA, inOut]);

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

      {/* Sopra: il quadro e cio' che si sta guardando. Sotto: il tempo, per
          tutta la larghezza — una timeline schiacciata in una colonna e' una
          timeline che non si puo' leggere, ed e' la riga in cui questo lavoro
          vive. */}
      <div className="flex gap-5 items-start">
        <div className="shrink-0 w-[300px]">
          {src ? (
            <video
              ref={(el) => { (video as { current: HTMLVideoElement | null }).current = el; setVEl(el); }}
              src={pq(`/api/video/asset/${src}`)}
              playsInline loop preload="metadata"
              /* Un video fermo a 0 e' un rettangolo nero: il primo quadro del
                 montaggio e' notte sul mare, quindi la pagina si apriva su un
                 buco. Un salto di mezzo secondo dopo i metadati e la locandina
                 e' un fotogramma vero, senza far partire niente. */
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.5; }}
              onClick={(e) => { const v = e.currentTarget; v.paused ? void v.play() : v.pause(); }}
              className="w-full aspect-[9/16] object-contain bg-black border border-neutral-800 rounded-sm cursor-pointer"
              onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
            />
          ) : (
            <div className="w-full aspect-[9/16] bg-black border border-neutral-800 rounded-sm
                            grid place-items-center text-neutral-600 text-xs">
              nessun montaggio ancora
            </div>
          )}
          <Trasporto v={vEl} t={t} durata={durata} cuts={cuts} vaiA={vaiA} />
          {attivo && (
            <div className="mt-1.5 text-[11px] text-neutral-500 tabular-nums">
              {attivo.shot} · {attivo.dur.toFixed(2)}s · {attivo.velocita.toFixed(2)}x
              {attivo.rovescio ? " · rovescio" : ""}{attivo.atto ? ` · ${attivo.atto}` : ""}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {!sel && (
            <div className="border border-dashed border-neutral-900 rounded-sm p-8 text-center
                            text-[11.5px] text-neutral-700">
              clicca un taglio sulla timeline qui sotto per vedere perche' sta li',
              e per metterne un altro al suo posto, allungarlo o toglierlo
            </div>
          )}
          {sel && (
            <Ispettore sel={sel} shots={shots} candidati={candidati} chiudi={() => setScelto(null)} />
          )}
        </div>
      </div>

      {/* Scrivere l'appunto: il video e' fermo sul fotogramma che l'ha fatto
          scattare, e l'istante e' gia' quello — non c'e' da ritrovarlo. */}
      {appunto && (
        <div className="mt-4 border border-amber-900/60 rounded-sm p-3">
          <div className="text-[11px] text-amber-400/80 tabular-nums mb-1.5">
            appunto a {mmss(appunto.t)} — f{Math.round(appunto.t * FPS)}
          </div>
          <input
            autoFocus
            value={appunto.testo}
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
            placeholder="cosa non va, o cosa ricordarsi — invio per segnarlo, esc per lasciar perdere"
            className="w-full bg-neutral-950 border border-neutral-800 rounded-sm px-2 py-1 text-[12px] text-neutral-200"
          />
        </div>
      )}

      {marcatori.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {marcatori.map((m) => (
            <button key={m.t} onClick={() => vaiA(m.t, true)}
                    className="text-[11px] px-2 py-0.5 rounded-sm border border-amber-900/50
                               text-amber-300/80 hover:border-amber-600">
              <span className="tabular-nums text-amber-500/60">{mmss(m.t)}</span> {m.nota}
              <span onClick={(e) => { e.stopPropagation(); void api.videoMarcatore(m.t, null).then((r) => setMarcatori(r.marcatori)); }}
                    className="ml-1.5 text-neutral-700 hover:text-neutral-300">×</span>
            </button>
          ))}
        </div>
      )}

      {aiuto && (
        <div className="mt-3 border border-neutral-800 rounded-sm p-3 text-[11.5px] text-neutral-400">
          <div className="text-neutral-500 mb-1.5">tasti</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 max-w-[720px]">
            {[["spazio", "avvia e ferma"], ["← →", "un fotogramma"], ["⇧ ← →", "un secondo"],
              ["[ ]", "taglio prima / dopo"], ["inizio · fine", "capo e coda"], ["f", "schermo intero"],
              ["i · o", "segna inizio e fine del tratto"], ["l", "ripeti il tratto"],
              ["m", "appunto sull'istante"], ["?", "questo elenco"],
              ["⌥ rotellina", "zoom della timeline"], ["clic su un taglio", "aprilo nell'ispettore"]]
              .map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-28 shrink-0 text-neutral-200">{k}</span>
                  <span className="text-neutral-600">{v}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Timeline
          cuts={cuts} atti={atti} onda={onda} durata={durata} t={t}
          poster={poster} scelto={scelto} inOut={inOut} setInOut={setInOut}
          gira={gira} vaiA={vaiA} marcatori={marcatori}
          togliMarcatore={(m) => { void api.videoMarcatore(m, null).then((r) => setMarcatori(r.marcatori)); }}
          apri={(i: number) => { setScelto(i); vai((cuts[i]?.t ?? 0) + 0.02); }}
        />
      </div>

      {/* La libreria dei 272 piani sta chiusa. Aperta la pagina misurava 28.511
          pixel di altezza: l'editor — barra, player, timeline — spariva sopra
          uno schermo e mezzo di provini, e il pezzo che si guarda ogni volta
          era quello che bisognava scorrere via. */}
      <details className="mt-6">
        <summary className="cursor-pointer text-[11px] text-neutral-600 hover:text-neutral-400">
          libreria dei piani girati ({shots.length}, {tenuti} tenuti)
        </summary>
      <div className="mt-3 flex items-center gap-3">
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
      </details>
    </div>
  );
}
