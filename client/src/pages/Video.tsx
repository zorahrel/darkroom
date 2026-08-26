import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  api, pq,
  type VideoAssets, type VideoAtto, type VideoBarra, type VideoCut,
  type VideoForzature, type VideoMarcatore, type VideoOnda, type VideoRicostruzione,
  type VideoShot, type VideoSospesa,
} from "../api";
import type { OutletCtx } from "../App";
import Timeline from "./video/Timeline";
import Ispettore from "./video/Ispettore";
import Libreria from "./video/Libreria";
import Maniglia from "./video/Maniglia";
import { Bott, Campo, Scegli } from "./video/ui";
import { indiceTaglio, navetta, timecode } from "./video/tempo";

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

/**
 * Cosa controlla ognuna delle verifiche.
 *
 * `check.py` stampa la misura — "rho = 0.914", "quadri nuovi al secondo: 15.0" —
 * e la misura e' il punto: e' cio' che si puo' discutere. Ma da sola non dice
 * *cosa* si stia misurando, e chi apre la pagina non deve andarselo a cercare
 * nel sorgente. Qui c'e' la frase; il numero resta quello che dice il Python.
 */
const COSA_CONTROLLA: Record<string, string> = {
  "1": "ogni taglio cade su un battito della canzone",
  "2": "nessuna ripresa viene rallentata più di quanto regga",
  "3": "le luci dei piani sono confrontabili fra loro",
  "4": "il video dura quanto il montaggio dice",
  "5": "l'immagine si muove davvero, non è fatta di fermi",
  "5b": "la grana della pellicola è viva",
  "6": "dove il suono è più duro, l'immagine è più dura",
};

/**
 * Lo stato del video, in una riga che si capisce da sola.
 *
 * Diceva "verde", che e' il colore del semaforo di chi ha scritto il controllo:
 * fuori da quella testa non vuol dire niente. Adesso dice quante verifiche
 * passano su quante, e aperto dice cosa verifica ognuna.
 */
function Stato({ barra, onRifai }: { barra: VideoBarra | null; onRifai: () => void }) {
  const [aperta, setAperta] = useState(false);
  const righe = barra?.righe ?? [];
  const cadute = barra?.fallite.length ?? 0;
  const esito = barra?.esito ?? "sconosciuto";

  const [testo, colore, pallino] =
    barra?.calcolo ? ["controllo il video…", "text-neutral-400", "bg-neutral-500 animate-pulse"]
    : esito === "verde" ? [`il video passa tutti i ${righe.length} controlli`, "text-emerald-300", "bg-emerald-500"]
    : esito === "rosso" ? [`${cadute} ${cadute === 1 ? "controllo non passa" : "controlli non passano"}`, "text-rose-300", "bg-rose-500"]
    : ["video mai controllato", "text-neutral-400", "bg-neutral-600"];

  return (
    <div className="relative">
      <button onClick={() => setAperta((a) => !a)}
              title="cosa è stato verificato sul video costruito"
              className={`flex items-center gap-1.5 text-[10.5px] ${colore} hover:brightness-125`}>
        <span className={`w-1.5 h-1.5 rounded-full ${pallino}`} />
        {testo}
        <span className="text-neutral-400">{aperta ? "▴" : "▾"}</span>
      </button>
      {aperta && (
        <div className="absolute z-40 mt-1 w-[720px] max-w-[88vw] bg-neutral-950 border border-neutral-700
                        rounded-sm p-3 shadow-2xl">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[12px] text-neutral-100">controlli sul video costruito</span>
            <span className="text-[10.5px] text-neutral-400">
              girano su <span className="text-neutral-300">LUNGOMARE.mp4</span>, non sul piano
            </span>
            <button onClick={onRifai} className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-100">
              ricontrolla
            </button>
            <button onClick={() => setAperta(false)} className="text-[10.5px] text-neutral-400 hover:text-neutral-100">
              chiudi
            </button>
          </div>

          {righe.map((r) => (
            <div key={r.n} className="flex gap-2 py-1 border-t border-neutral-900 text-[11px] items-baseline">
              <span className={`shrink-0 ${r.ok === false ? "text-rose-400" : "text-emerald-400"}`}>
                {r.ok === false ? "✕" : "✓"}
              </span>
              <div className="min-w-0">
                <div className="text-neutral-200">{COSA_CONTROLLA[r.n] ?? `controllo ${r.n}`}</div>
                <div className="text-neutral-400 leading-snug">{r.testo}</div>
              </div>
            </div>
          ))}
          {barra?.fallite.map((f, i) => (
            <div key={i} className="text-[11px] text-rose-300 pt-1">non passa: {f}</div>
          ))}
          {!righe.length && !barra?.calcolo && (
            <div className="text-[11px] text-neutral-400">
              nessun controllo ancora: si misurano sul video costruito, quindi servono un
              montaggio e una ricostruzione.
            </div>
          )}
          {barra?.calcolo && (
            <div className="text-[11px] text-neutral-400">
              sto rileggendo il video sul PC — un minuto e mezzo.
            </div>
          )}
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
      <span className="ml-1.5 tabular-nums text-neutral-100 text-[11.5px] tracking-tight">{timecode(t)}</span>
      <span className="tabular-nums text-neutral-400">/ {timecode(durata)}</span>
      <div className="ml-1">
        <Scegli
          valore={String(vel)} larghezza={62} titolo="velocità di riproduzione"
          voci={[0.25, 0.5, 1, 1.5, 2].map((x) => ({ v: String(x), testo: `${x}x` }))}
          onCambia={(v) => setVel(Number(v))}
        />
      </div>
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
  /** Piu' tagli insieme. Serve a fare in un gesto solo quello che altrimenti si
   *  fa venti volte: scartare le riprese di un atto che non funziona, dare la
   *  stessa durata a una serie, guardare da vicino un pezzo. */
  const [selezione, setSelezione] = useState<Set<number>>(new Set());
  const [inquadra, setInquadra] = useState<{ da: number; a: number; n: number } | null>(null);
  const [onda, setOnda] = useState<VideoOnda | null>(null);
  const [marcatori, setMarcatori] = useState<VideoMarcatore[]>([]);
  const [forz, setForz] = useState<VideoForzature | null>(null);
  const leggiForzature = useCallback(() => {
    api.videoForzature().then(setForz).catch(() => {});
  }, []);
  const [inOut, setInOut] = useState<[number, number] | null>(null);
  const [gira, setGira] = useState(false);
  const [ciclo, setCiclo] = useState(false);
  const [appunto, setAppunto] = useState<{ t: number; testo: string } | null>(null);
  const [aiuto, setAiuto] = useState(false);
  const [vediForz, setVediForz] = useState(false);
  const [vEl, setVEl] = useState<HTMLVideoElement | null>(null);
  /** La velocità della navetta: 0 ferma, negativa all'indietro. All'indietro il
   *  browser non sa andare da solo, quindi la testina la muoviamo noi. */
  const [spola, setSpola] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);

  /** L'editor disegna fino al bordo: lo spazio che il guscio dell'app mette
   *  sopra le altre pagine, qui è altezza rubata alla timeline. */
  useEffect(() => {
    ctx?.setFlush?.(true);
    return () => ctx?.setFlush?.(false);
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
    api.videoForzature().then(setForz).catch(() => {});
  }, []);
  useEffect(() => { ricarica(); }, [ricarica]);

  /**
   * La pila dell'annulla.
   *
   * Ogni modifica alla timeline sa rifarsi al contrario, quindi l'annulla non è
   * uno stato da ricostruire: è la mossa inversa, messa da parte quando la
   * mossa si fa. Vale per scambi, durate e inchiodature — tutto ciò che finisce
   * in `scelte.json`.
   */
  type Mossa = { cosa: string; fa: () => Promise<unknown>; disfa: () => Promise<unknown> };
  const [pila, setPila] = useState<Mossa[]>([]);
  const [rifai, setRifai] = useState<Mossa[]>([]);

  const compi = useCallback(async (
    cosa: string, fa: () => Promise<unknown>, disfa: () => Promise<unknown>,
  ) => {
    try {
      await fa();
      setPila((p) => [...p.slice(-49), { cosa, fa, disfa }]);
      setRifai([]);
      ricarica();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  }, [ricarica]);

  const annulla = useCallback(async () => {
    const ultimo = pila[pila.length - 1];
    if (!ultimo) return;
    setPila((p) => p.slice(0, -1));
    setRifai((r) => [...r.slice(-49), ultimo]);
    try { await ultimo.disfa(); ricarica(); } catch { /* niente */ }
  }, [pila, ricarica]);

  /** Annullato per sbaglio: la mossa non si perde, torna al suo posto. */
  const rifaiUltimo = useCallback(async () => {
    const m = rifai[rifai.length - 1];
    if (!m) return;
    setRifai((r) => r.slice(0, -1));
    setPila((p) => [...p.slice(-49), m]);
    try { await m.fa(); ricarica(); } catch { /* niente */ }
  }, [rifai, ricarica]);

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

  /**
   * J K L, la navetta del banco di montaggio.
   *
   * Avanti la fa il player cambiando velocità. Indietro no: `playbackRate`
   * negativo non lo sa fare nessun browser, quindi la testina la spostiamo noi
   * a ogni quadro. Sono due strade diverse per un gesto solo, e chi lo usa non
   * deve accorgersene.
   */
  useEffect(() => {
    if (!vEl) return;
    if (spola === 0) { vEl.playbackRate = 1; return; }
    if (spola > 0) { vEl.playbackRate = spola; void vEl.play().catch(() => {}); return; }
    vEl.pause();
    const h = setInterval(() => {
      const nuovo = Math.max(0, vEl.currentTime + (spola / FPS));
      vEl.currentTime = nuovo;
      setT(nuovo);
      if (nuovo <= 0) setSpola(0);
    }, 1000 / FPS);
    return () => clearInterval(h);
  }, [vEl, spola]);

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

  /** Quante cose sono state messe a mano sopra il piano derivato. Sta nella
   *  barra perche' e' l'unica parte del montaggio che nessuna misura difende. */
  const nForzature = (forz?.pin.length ?? 0) + (forz?.durata.length ?? 0) + (forz?.scartatiAMano.length ?? 0);

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

  const apriTaglio = useCallback((i: number, mod?: { estendi?: boolean; aggiungi?: boolean }) => {
    if (mod?.estendi || mod?.aggiungi) {
      setSelezione((s0) => {
        const n = new Set(s0);
        if (mod.estendi && scelto !== null) {
          for (let k = Math.min(scelto, i); k <= Math.max(scelto, i); k++) n.add(k);
        } else if (n.has(i)) n.delete(i);
        else n.add(i);
        if (scelto !== null) n.add(scelto);
        return n;
      });
      setScelto(i);
      return;
    }
    setSelezione(new Set());
    setScelto(i);
    vaiA((cuts[i]?.t ?? 0) + 0.02, true);
  }, [cuts, vaiA, scelto]);

  /** Dalla libreria al montaggio: se quel piano è in scena, ci si va. */
  const apriPiano = useCallback((id: string) => {
    const i = cuts.findIndex((c) => c.shot === id);
    if (i >= 0) apriTaglio(i);
  }, [cuts, apriTaglio]);

  /** Trascinato un blocco sopra un altro: si scambiano di posto. L'annulla
   *  rimette le due battute come stavano, cioè sgancia i due pin. */
  const scambia = useCallback((i: number, j: number) => {
    const a = cuts[i], b = cuts[j];
    if (!a || !b) return;
    const primaA = forz?.pin.find((f) => f.battuta === a.bar)?.piano ?? null;
    const primaB = forz?.pin.find((f) => f.battuta === b.bar)?.piano ?? null;
    void compi(
      `${a.shot} ⇄ ${b.shot}`,
      () => api.videoScambia(a.bar, a.shot, b.bar, b.shot),
      async () => {
        if (primaA) await api.videoPin(a.bar, primaA); else await api.videoPin(a.bar, null);
        if (primaB) await api.videoPin(b.bar, primaB); else await api.videoPin(b.bar, null);
      },
    );
  }, [cuts, forz, compi]);

  const cambiaDurata = useCallback((bar: number, battute: number) => {
    const prima = forz?.durata.find((f) => f.battuta === bar)?.battute ?? null;
    void compi(
      `battuta ${bar}: ${battute} battute`,
      () => api.videoDurata(bar, battute),
      () => api.videoDurata(bar, prima),
    );
  }, [forz, compi]);

  const posa = useCallback((i: number, piano: string) => {
    const c = cuts[i];
    if (!c) return;
    const prima = forz?.pin.find((f) => f.battuta === c.bar)?.piano ?? null;
    void compi(
      `${piano} sulla battuta ${c.bar}`,
      () => api.videoPin(c.bar, piano),
      () => api.videoPin(c.bar, prima),
    );
  }, [cuts, forz, compi]);

  /**
   * Il piano come sarà dopo la ricostruzione.
   *
   * Le forzature vivono in `scelte.json` e il piano si rifà solo quando si
   * ricostruisce: scambiati due blocchi, sul disco cambiavano due righe e a
   * schermo non si muoveva niente. Un editor in cui il gesto non si vede non è
   * un editor.
   *
   * Quello che si può mostrare esatto si mostra: un'inchiodatura sostituisce il
   * piano su quella battuta, e basta — i tempi non cambiano. Una durata forzata
   * invece sposterebbe tutto ciò che viene dopo, e fingere quel ricalcolo
   * mostrerebbe un montaggio che non esiste: quella si dichiara e basta, con
   * l'etichetta sul blocco.
   */
  const cutsMostrati = useMemo(() => {
    if (!forz?.pin.length) return cuts;
    const perBattuta = new Map(forz.pin.map((f) => [f.battuta, f.piano]));
    const datiPiano = new Map(shots.map((sh) => [sh.id, sh]));
    return cuts.map((c) => {
      const nuovo = perBattuta.get(c.bar);
      if (!nuovo || nuovo === c.shot) return c;
      const d = datiPiano.get(nuovo);
      return { ...c, shot: nuovo, origine: nuovo.replace(/_?\d$/, ""), durezzaPiano: d?.durezza ?? null };
    });
  }, [cuts, forz, shots]);

  const durataForzata = useMemo(
    () => new Map((forz?.durata ?? []).map((f) => [f.battuta, f.battute])),
    [forz],
  );

  /** I tagli selezionati, in ordine di tempo. */
  const molti = useMemo(
    () => [...selezione].filter((i) => cutsMostrati[i]).sort((a, b) => a - b),
    [selezione, cutsMostrati],
  );

  /** Il tratto che la selezione copre, da un capo all'altro. */
  const tratto = useMemo((): [number, number] | null => {
    if (!molti.length) return null;
    const a = cutsMostrati[molti[0]!]!, b = cutsMostrati[molti[molti.length - 1]!]!;
    return [a.t, b.t + b.dur];
  }, [molti, cutsMostrati]);

  /** Le riprese distinte sotto la selezione: due battute possono mostrare lo
   *  stesso piano, e scartarlo due volte non vuol dire niente. */
  const pianiSelezionati = useMemo(
    () => [...new Set(molti.map((i) => cutsMostrati[i]!.shot))],
    [molti, cutsMostrati],
  );

  const scartaSelezione = useCallback(() => {
    const piani = pianiSelezionati;
    if (!piani.length) return;
    void compi(
      piani.length === 1 ? `scarta ${piani[0]}` : `scarta ${piani.length} riprese`,
      async () => { for (const sh of piani) await api.videoPick(sh, false, "scartato dalla timeline"); },
      async () => { for (const sh of piani) await api.videoScordaGiudizio(sh); },
    );
    setSelezione(new Set());
  }, [pianiSelezionati, compi]);

  const durataSelezione = useCallback((battute: number) => {
    const barre = molti.map((i) => cutsMostrati[i]!.bar);
    if (!barre.length) return;
    const prima = new Map(barre.map((b) => [b, forz?.durata.find((f) => f.battuta === b)?.battute ?? null]));
    void compi(
      `${barre.length} tagli: ${battute} battute`,
      async () => { for (const b of barre) await api.videoDurata(b, battute); },
      async () => { for (const b of barre) await api.videoDurata(b, prima.get(b) ?? null); },
    );
  }, [molti, cutsMostrati, forz, compi]);

  const sel = scelto !== null ? cutsMostrati[scelto] ?? null : null;
  const attivo = cutsMostrati[indiceTaglio(cutsMostrati, t)] ?? null;
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
      if (k === " ") { e.preventDefault(); setSpola(0); v.paused ? void v.play() : v.pause(); }
      else if (k === "ArrowLeft") { e.preventDefault(); setSpola(0); vaiA(t - passo); }
      else if (k === "ArrowRight") { e.preventDefault(); setSpola(0); vaiA(t + passo); }
      else if (k === "[") { e.preventDefault(); apriTaglio(Math.max(0, i - 1)); }
      else if (k === "]") { e.preventDefault(); apriTaglio(Math.min(cuts.length - 1, i + 1)); }
      else if (k === "Home") { e.preventDefault(); vaiA(0); }
      else if (k === "End") { e.preventDefault(); vaiA(durata - 1 / FPS); }
      else if (k === "f") { e.preventDefault(); void v.requestFullscreen?.().catch(() => {}); }
      else if (k === "i") { e.preventDefault(); setInOut([t, inOut?.[1] ?? durata]); }
      else if (k === "o") { e.preventDefault(); setInOut([inOut?.[0] ?? 0, t]); }
      else if (k === "r") { e.preventDefault(); setCiclo((c) => !c); }
      else if (k === "m") { e.preventDefault(); v.pause(); setAppunto({ t: v.currentTime, testo: "" }); }
      else if (k === "?") { e.preventDefault(); setAiuto((a) => !a); }
      else if (k === "z") { e.preventDefault(); void annulla(); }
      else if (k === "Z") { e.preventDefault(); void rifaiUltimo(); }
      else if (k === "F") {
        e.preventDefault();
        const r = inOut ?? tratto ?? (attivo ? [attivo.t, attivo.t + attivo.dur] as [number, number] : null);
        if (r) setInquadra({ da: r[0], a: r[1], n: Date.now() });
      }
      else if (k === "a") {
        // Tutto l'atto in cui sta la testina: e' l'unita' con cui questo
        // montaggio ragiona, e sceglierla a mano vuol dire venti scatti.
        e.preventDefault();
        const at = cuts[i]?.atto;
        if (at) setSelezione(new Set(cuts.map((c, n) => (c.atto === at ? n : -1)).filter((n) => n >= 0)));
      }
      else if (k === "Backspace" || k === "Delete") {
        if (selezione.size) { e.preventDefault(); scartaSelezione(); }
      }
      else if (k === "j" || k === "l") { e.preventDefault(); setSpola((v2) => navetta(v2, k)); }
      else if (k === "k") { e.preventDefault(); setSpola(0); v.pause(); }
      else if (k === "Escape") { setScelto(null); setSelezione(new Set()); setAiuto(false); setAppunto(null); }
    };
    window.addEventListener("keydown", su);
    return () => window.removeEventListener("keydown", su);
  }, [cuts, t, durata, vaiA, inOut, apriTaglio, annulla, rifaiUltimo, tratto, attivo, selezione, scartaSelezione]);

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
        {spola !== 0 && (
          <span className="text-[10.5px] text-sky-300 tabular-nums">
            {spola > 0 ? "▶▶" : "◀◀"} {Math.abs(spola)}x
          </span>
        )}
        {!!rifai.length && (
          <button onClick={() => void rifaiUltimo()}
                  title={`rifai: ${rifai[rifai.length - 1]?.cosa}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">
            rifai
          </button>
        )}
        {!!pila.length && (
          <button onClick={() => void annulla()}
                  title={`annulla: ${pila[pila.length - 1]?.cosa}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:text-neutral-100 hover:border-neutral-500">
            ⌫ {pila[pila.length - 1]?.cosa}
          </button>
        )}
        {!!nForzature && (
          <button onClick={() => setVediForz((v) => !v)}
                  title="cose che hai deciso tu, che scavalcano il montaggio calcolato"
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-sky-800 text-sky-300
                             hover:bg-sky-950/50">
            {nForzature} {nForzature === 1 ? "tua scelta" : "tue scelte"}
            {ric?.attiva ? "" : " · da ricostruire"}
          </button>
        )}
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
              <Campo
                autoFuoco valore={appunto.testo}
                onCambia={(v) => setAppunto({ ...appunto, testo: v })}
                onEsc={() => setAppunto(null)}
                onInvio={async () => {
                  if (!appunto.testo.trim()) return;
                  const r = await api.videoMarcatore(appunto.t, appunto.testo.trim()).catch(() => null);
                  if (r) setMarcatori(r.marcatori);
                  setAppunto(null);
                }}
                segnaposto="cosa non va — invio per segnarlo, esc per lasciar perdere"
                className="w-full text-[11.5px]"
              />
            </div>
          )}
        </main>

        <Maniglia verso="col" valore={wDx} titolo="larghezza dell'ispettore"
                  calcola={(v0, d) => Math.max(240, Math.min(720, v0 - d))}
                  onCambia={setWDx} onFine={salva(CHIAVE_DX)} />
        <aside className="flex-1 min-w-0 overflow-y-auto" style={{ minWidth: Math.min(wDx, 720) }}>
          {molti.length > 1 ? (
            <div className="p-2.5 space-y-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-neutral-100">{molti.length} tagli scelti</span>
                <button onClick={() => setSelezione(new Set())}
                        className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-100">
                  lascia
                </button>
              </div>
              {tratto && (
                <div className="text-[11px] text-neutral-400">
                  da {timecode(tratto[0])} a {timecode(tratto[1])} · {(tratto[1] - tratto[0]).toFixed(1)}s ·{" "}
                  {pianiSelezionati.length} {pianiSelezionati.length === 1 ? "ripresa" : "riprese"}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {tratto && (
                  <Bott onClick={() => setInquadra({ da: tratto[0], a: tratto[1], n: Date.now() })}>
                    guarda da vicino
                  </Bott>
                )}
                {tratto && <Bott onClick={() => setInOut(tratto)}>segna il tratto</Bott>}
                <Bott peso="pericolo" onClick={scartaSelezione}>
                  scarta {pianiSelezionati.length === 1 ? "la ripresa" : `le ${pianiSelezionati.length} riprese`}
                </Bott>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] text-neutral-400">durata di tutti:</span>
                {[0.5, 1, 2, 4].map((b) => (
                  <Bott key={b} onClick={() => durataSelezione(b)}>{b}</Bott>
                ))}
                <span className="text-[10.5px] text-neutral-400">battute</span>
              </div>
              <div className="border-t border-neutral-900 pt-2 space-y-0.5">
                {molti.map((i) => {
                  const c = cutsMostrati[i]!;
                  return (
                    <button key={i} onClick={() => apriTaglio(i)}
                            className="flex w-full items-baseline gap-1.5 text-[10.5px] text-left
                                       hover:bg-neutral-900 rounded-sm px-1 py-0.5">
                      <span className="text-neutral-400 tabular-nums w-11 shrink-0">{mmss(c.t)}</span>
                      <span className="text-neutral-100 truncate">{c.shot}</span>
                      <span className="ml-auto text-neutral-400 tabular-nums shrink-0">{c.dur.toFixed(2)}s</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : sel ? (
            <Ispettore sel={sel} shots={shots} candidati={candidati} chiudi={() => setScelto(null)}
                       onForzato={leggiForzature} />
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
          cuts={cutsMostrati} atti={atti} onda={onda} durata={durata} t={t}
          poster={poster} scelto={scelto} selezione={selezione} inquadra={inquadra}
          inOut={inOut} setInOut={setInOut}
          gira={gira} vaiA={vaiA} marcatori={marcatori}
          togliMarcatore={(m) => { void api.videoMarcatore(m, null).then((r) => setMarcatori(r.marcatori)); }}
          apri={apriTaglio}
          inchiodate={new Set((forz?.pin ?? []).map((f) => f.battuta))}
          onScambia={scambia} onDurata={cambiaDurata} onPosa={posa}
          durataForzata={durataForzata}
        />
      </div>

      {/* Ogni cosa messa a mano, in un posto solo e con il suo × accanto. È la
          risposta a "ho toccato qualcosa per sbaglio?": prima quella domanda si
          poteva rispondere solo aprendo `scelte.json`. */}
      {vediForz && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center" onClick={() => setVediForz(false)}>
          <div className="bg-neutral-950 border border-neutral-800 rounded-sm p-4 w-[560px] max-w-[92vw]"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[12px] text-neutral-100">le tue scelte</span>
              <span className="text-[10.5px] text-neutral-400">
                scavalcano il montaggio calcolato
              </span>
              <button onClick={() => setVediForz(false)} className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-100">chiudi</button>
            </div>

            <p className="text-[11px] text-neutral-400 leading-relaxed mb-2">
              Il montaggio si calcola dalle misure: dove cadono i tagli, quale ripresa su
              quale battuta, quanto dura ognuna. Qui sotto c'è quello che hai deciso tu al
              posto del calcolo — e finché non ricostruisci, nel video non c'è.
            </p>

            {!nForzature && (
              <div className="text-[11px] text-neutral-400">
                Non hai ancora scavalcato niente: il montaggio è tutto calcolato.
              </div>
            )}

            {forz?.pin.map((f) => (
              <div key={`p${f.battuta}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-sky-300 w-28 shrink-0">ripresa scelta</span>
                <span className="text-neutral-100">{f.piano}</span>
                <span className="text-neutral-400">sulla battuta {f.battuta}</span>
                <button onClick={async () => { await api.videoPin(f.battuta, null); leggiForzature(); }}
                        className="ml-auto px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  togli
                </button>
              </div>
            ))}
            {forz?.durata.map((f) => (
              <div key={`d${f.battuta}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-sky-300 w-28 shrink-0">durata cambiata</span>
                <span className="text-neutral-400">
                  battuta {f.battuta}: {f.battute} {f.battute === 1 ? "battuta" : "battute"}
                </span>
                <button onClick={async () => { await api.videoDurata(f.battuta, null); leggiForzature(); }}
                        className="ml-auto px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  togli
                </button>
              </div>
            ))}
            {forz?.scartatiAMano.map((f) => (
              <div key={`s${f.piano}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-rose-300 w-28 shrink-0">ripresa scartata</span>
                <span className="text-neutral-100">{f.piano}</span>
                <span className="text-neutral-400 truncate">{f.motivo}</span>
                <button onClick={async () => {
                          setShots((await api.videoPick(f.piano, true)).shots); leggiForzature();
                        }}
                        className="ml-auto shrink-0 px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  rimetti
                </button>
              </div>
            ))}

            {!!rifai.length && (
          <button onClick={() => void rifaiUltimo()}
                  title={`rifai: ${rifai[rifai.length - 1]?.cosa}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">
            rifai
          </button>
        )}
        {!!pila.length && (
          <button onClick={() => void annulla()}
                  title={`annulla: ${pila[pila.length - 1]?.cosa}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:text-neutral-100 hover:border-neutral-500">
            ⌫ {pila[pila.length - 1]?.cosa}
          </button>
        )}
        {!!nForzature && (
              <div className="mt-3 flex items-center gap-2">
                <Bott peso="primario" onClick={() => { setVediForz(false); void lancia(); }}
                      disabilitato={!!ric?.attiva}>
                  ricostruisci il video con queste scelte
                </Bott>
                <span className="text-[10.5px] text-neutral-400">circa dodici minuti, sul PC</span>
              </div>
            )}
          </div>
        </div>
      )}

      {aiuto && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center" onClick={() => setAiuto(false)}>
          <div className="bg-neutral-950 border border-neutral-800 rounded-sm p-4 max-w-[640px]"
               onClick={(e) => e.stopPropagation()}>
            <div className="text-[12px] text-neutral-300 mb-2">tasti</div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[11.5px]">
              {[["spazio", "avvia e ferma"], ["← →", "un fotogramma"], ["⇧ ← →", "un secondo"],
                ["[ ]", "taglio prima / dopo"], ["inizio · fine", "capo e coda"], ["f", "schermo intero"],
                ["i · o", "inizio e fine del tratto"], ["r", "ripeti il tratto"],
                ["m", "appunto sull'istante"], ["z", "annulla l'ultima modifica"],
                ["⇧Z", "rifai quello che hai annullato"], ["⇧F", "guarda da vicino il tratto"],
                ["a", "scegli tutto l'atto"], ["⌫", "scarta le riprese scelte"],
                ["⇧clic", "estendi la scelta"], ["⌘clic", "aggiungi un taglio alla scelta"],
                ["j · k · l", "navetta indietro · ferma · avanti (premi più volte)"],
                ["trascina un blocco", "sopra un altro: si scambiano"],
                ["tira il bordo destro", "quante battute dura"],
                ["trascina dalla libreria", "mettilo su quel taglio"],
                ["esc", "chiudi"],
                ["⌥ rotellina", "zoom della timeline"], ["?", "questo elenco"]].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-28 shrink-0 text-neutral-200">{k}</span>
                  <span className="text-neutral-400">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10.5px] text-neutral-400">
              la maniglia sopra la timeline si trascina: la timeline cresce e le corsie con lei.
              Ogni modifica alla timeline è una forzatura dichiarata: la trovi nell'elenco in
              cima, e non è nel video finché non ricostruisci.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
