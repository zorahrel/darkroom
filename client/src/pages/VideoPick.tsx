import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { api, pq, type VideoShot, type VideoJob, type VideoAct, type VideoCut } from "../api";
import { Area, NumberField, Scegli } from "./video/ui";
import { Shortcut, VerdictButton } from "../ui";
import { leavesQueue, type PickFilter } from "../videoQueue";

import type { OutletCtx } from "../App";

/** Larghezza della clip nella modalita' Scelta, in pixel. Si trascina, e resta
 *  fra una sessione e l'altra: chi giudica a raffica non vuole ritrovarsi la
 *  misura di default ogni volta che riapre.
 *
 *  `null` non vuol dire "nessuna misura": vuol dire QUANTO CI STA — la clip
 *  prende tutta l'altezza disponibile e si ferma dove finisce. E' il valore di
 *  partenza perche' una misura fissa (erano 300px) lascia mezza colonna vuota
 *  su uno schermo grande e sborda su uno piccolo, cioe' sbaglia sempre da
 *  qualche parte. Un numero c'e' solo dopo che qualcuno ha trascinato. */
const KEY_WIDTH = "darkroom.scelta.larghezzaClip";

/**
 * Giudicare le scene, una alla volta.
 *
 * La griglia serve a sfogliare, questa serve a decidere, e le due cose vogliono
 * layout diversi. Nella griglia due verticali 9:16 dentro una tessera fanno
 * ~80px l'una: a quella dimensione i difetti che contano non si vedono — il
 * buco bianco sulla schiena di `g_scal1` era passato due volte prima che
 * qualcuno aprisse quella ripresa da sola.
 *
 * Il giudizio e' l'unica cosa della catena che una misura non sa dare. Ne sono
 * state provate tre (bilancio tonale, area di dettaglio, salto della sagoma) e
 * nessuna separa una figura che si scioglie da una che entra in un'onda:
 * l'indice di `d02`, che si sfascia a vista, sta in mezzo al gruppo.
 */

/** Una scena e' una PRESA, non un file: `z43_0` e `z43_1` sono due meta' della
 *  stessa generazione e giudicarle separate e' la ragione per cui il montaggio
 *  sembrava pieno di doppioni pur avendo 122 nomi diversi. */
type Scene = {
  origine: string;
  pezzi: VideoShot[];
  act: string | null;
  minute: number | null;
  inEdit: number;
  kept: boolean;
  /** Il verdetto dato, se c'è. `null` vuol dire mai passata sotto gli occhi —
   *  che non è la stessa cosa di "tenuta": tenere è lo stato di partenza. */
  verdict: "tenuta" | "scartata" | null;
  judgedAt: number | null;
  annotated: boolean;
  /** Perché guardarla per prima. Non è un verdetto: è un ordine di lettura. */
  suspect: string | null;
  /** Ogni volta che entra nel montaggio. Un totale di secondi non dice se sono
   *  un blocco solo o tre lampi sparsi, e da giudicare sono due cose diverse. */
  apparizioni: { t: number; dur: number; act: string | null }[];
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function raggruppa(shots: VideoShot[]): Scene[] {
  const per = new Map<string, VideoShot[]>();
  for (const s of shots) per.set(s.origine, [...(per.get(s.origine) ?? []), s]);
  return [...per.entries()]
    .map(([origine, pezzi]) => {
      const inM = pezzi.filter((p) => p.minute !== null);
      return {
        origine,
        pezzi: pezzi.sort((a, b) => a.id.localeCompare(b.id)),
        act: inM[0]?.act ?? null,
        minute: inM.length ? Math.min(...inM.map((p) => p.minute!)) : null,
        inEdit: pezzi.reduce((n, p) => n + p.inEdit, 0),
        // Una presa e' "tenuta" se almeno un pezzo lo e'.
        kept: pezzi.some((p) => p.kept),
        // Il verdetto della presa: basta un pezzo scartato perche' lo sia, e
        // serve almeno un si' esplicito perche' conti come approvata.
        verdict: (pezzi.some((p) => p.verdict === "scartata") ? "scartata"
                 : pezzi.some((p) => p.verdict === "tenuta") ? "tenuta"
                 : null) as Scene["verdict"],
        judgedAt: pezzi.reduce<number | null>(
          (m, p) => (p.judgedAt && (!m || p.judgedAt > m) ? p.judgedAt : m), null),
        annotated: pezzi.some((p) => p.problems.length > 0),
        // Il sospetto della presa e' quello del primo pezzo che ne ha uno.
        suspect: pezzi.find((p) => p.suspect)?.suspect ?? null,
        apparizioni: pezzi.flatMap((p) => p.apparizioni ?? []).sort((x, y) => x.t - y.t),
      };
    })
    .sort((a, b) => (a.minute ?? 1e9) - (b.minute ?? 1e9) || a.origine.localeCompare(b.origine));
}

/** Una sola definizione, accanto alla regola che dice chi esce dall'elenco:
 *  due elenchi di filtri che divergono sono un salto di scena che ritorna. */
type Filter = PickFilter;

/** Dodici istanti in una striscia. Ogni casella porta il video al suo. */
function Take({ shot, take, onVaiA }: {
  shot: string; take: string; onVaiA: (frazione: number) => void;
}) {
  const N = 12;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [shot, take]);
  if (broken) return null;
  return (
    <div className="mt-3 shrink-0">
      <div className="relative rounded-sm overflow-hidden border border-neutral-800 bg-black">
        <img src={pq(`/api/video/provino/${shot}/${take}`)} alt=""
             onError={() => setBroken(true)}
             className="w-full h-[104px] object-cover object-left select-none" draggable={false} />
        {/* Le caselle stanno sopra l'immagine invece di essere ritagliate:
            una sola richiesta al server, e il bersaglio resta esatto anche se
            il provino cambia numero di istanti. */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: N }, (_, k) => (
            <button key={k} onClick={() => onVaiA((k + 0.5) / N)}
                    title={`vai a ${Math.round(((k + 0.5) / N) * 100)}%`}
                    className="flex-1 border-r border-black/40 last:border-r-0
                               hover:bg-neutral-100/15 focus-visible:bg-neutral-100/25 outline-none" />
          ))}
        </div>
      </div>
      <div className="text-[10px] text-neutral-400 mt-0.5">
        dodici istanti della clip — clicca dove qualcosa non torna
      </div>
    </div>
  );
}


/**
 * La durezza: quanto l'immagine picchia, messa in fila con tutte le altre.
 *
 * Il cursore serve perche' la misura sbaglia in un modo preciso: guarda
 * movimento, contrasto e luce, e la forza di un'immagine non sempre sta li'
 * dentro. Una figura ferma che riempie il quadro picchia piu' di un'onda
 * lontana che si agita. Senza cursore l'unico rimedio era scartare la ripresa,
 * cioe' buttarla invece di rimetterla al posto giusto.
 */
function Intensity({ shot, value, measured, manual, moto, dettaglio, onChange }: {
  shot: string;
  value: number | null; measured: number | null; manual: number | null;
  moto: number | null; dettaglio: number | null;
  onChange: (v: number | null) => void;
}) {
  const [tocco, setTocco] = useState<number | null>(null);

  /**
   * Si salva UNA volta, quando il cursore si ferma.
   *
   * Salvando a ogni scatto le scritture si sorpassano fra loro: dodici colpi di
   * freccia da 0.60 partono come dodici POST, e sul server resta l'ultima che
   * ARRIVA, non l'ultima che parte. Misurato: il cursore diceva 0.48, dopo la
   * ricarica tornava 0.53. Con l'attesa parte una scrittura sola, quella
   * giusta, e non c'e' nessuna corsa da vincere.
   */
  const attesa = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (v: number) => {
    if (attesa.current) clearTimeout(attesa.current);
    attesa.current = setTimeout(() => { attesa.current = null; onChange(v); }, 300);
  };
  useEffect(() => () => { if (attesa.current) clearTimeout(attesa.current); }, []);
  useEffect(() => {
    if (attesa.current) { clearTimeout(attesa.current); attesa.current = null; }
    setTocco(null);
  }, [shot]);
  const shown = tocco ?? value;

  if (shown === null) {
    return (
      <div className="mt-3 text-[11px] text-neutral-400">
        Mai misurata: il montaggio non la può scegliere. La misura <code>misura.sh</code>.
      </div>
    );
  }
  const label = shown >= 0.8 ? "picchia forte" : shown >= 0.55 ? "dura"
                  : shown >= 0.3 ? "media" : shown >= 0.12 ? "molle" : "quasi ferma";
  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] text-neutral-400">durezza</span>
        <span className="text-[13px] text-neutral-100 tabular-nums">{shown.toFixed(2)}</span>
        <span className="text-[11px] text-neutral-200">{label}</span>
        {manual !== null && (
          <button onClick={() => onChange(null)}
                  className="text-[10px] px-1.5 py-0.5 rounded-sm border border-amber-700/70
                             text-amber-200/90 hover:bg-amber-950/40">
            a mano — rimetti {measured?.toFixed(2) ?? "la misura"}
          </button>
        )}
      </div>
      <input
        type="range" min={0} max={1} step={0.01} value={shown}
        onChange={(e) => { const v = Number(e.currentTarget.value); setTocco(v); save(v); }}
        className="dr-hue w-full mt-1"
      />
      <div className="flex justify-between text-[9.5px] text-neutral-400">
        <span>ferma</span><span>picchia</span>
      </div>
      <p className="mt-1 text-[10.5px] text-neutral-400 leading-snug">
        Decide <b>dove</b> cade nel brano, non se è bella: dura sui colpi, molle sui respiri.
        {(moto !== null || dettaglio !== null) && (
          <span className="tabular-nums">
            {" "}Da movimento {moto?.toFixed(1) ?? "—"} · dettaglio{" "}
            {dettaglio !== null ? `${Math.round(dettaglio * 100)}%` : "—"}.
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Cosa si vede, in una riga.
 *
 * Quella automatica e' il prompt meno le frasi che hanno tutte le riprese:
 * resta l'inquadratura, che e' l'unica parte che distingue questa dalle altre
 * trecento. Si puo' riscrivere, e allora vince la tua — perche' un ritaglio
 * dice cosa e' stato CHIESTO, e dopo aver guardato la clip si sa cosa e'
 * VENUTO, che non e' la stessa cosa.
 */
function Descrizione({ shot, text, manual, onSave }: {
  shot: string; text: string | null; manual: boolean; onSave: (t: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [bozza, setBozza] = useState("");
  useEffect(() => { setEdit(false); setBozza(""); }, [shot]);

  if (edit) {
    return (
      <div className="mt-1.5">
        <textarea
          autoFocus value={bozza} onChange={(e) => setBozza(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEdit(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault(); onSave(bozza); setEdit(false);
            }
          }}
          placeholder="cosa si vede, in una riga"
          className="w-full h-14 bg-neutral-900 border border-neutral-700 rounded-sm px-2 py-1
                     text-[12px] outline-none focus:border-neutral-500"
        />
        <div className="flex gap-2 text-[11px] mt-1">
          <button onClick={() => { onSave(bozza); setEdit(false); }}
                  className="px-2 py-0.5 rounded-sm border border-neutral-600 text-neutral-200
                             inline-flex items-center gap-1.5">
            salva <Shortcut>⌘↵</Shortcut>
          </button>
          <button onClick={() => setEdit(false)}
                  className="px-2 py-0.5 rounded-sm border border-neutral-800 text-neutral-400
                             inline-flex items-center gap-1.5">
            lascia stare <Shortcut>esc</Shortcut>
          </button>
          {manual && (
            <button onClick={() => { onSave(""); setEdit(false); }}
                    className="px-2 py-0.5 rounded-sm border border-neutral-800 text-neutral-400">
              torna a quella del prompt
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-start gap-2">
      <p className={`text-[12.5px] leading-snug ${text ? "text-neutral-200" : "text-neutral-400 italic"}`}>
        {text ?? "nessuna descrizione"}
      </p>
      <button
        onClick={() => { setBozza(manual ? (text ?? "") : ""); setEdit(true); }}
        title="scrivi cosa si vede"
        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm border border-neutral-800
                   text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
      >
        ✎
      </button>
    </div>
  );
}

/** Se la ripresa sta bene dov'e' finita. E' il metro che alla durezza manca:
 *  0.95 e' tanto se li' il brano respira, giusto se li' picchia. Soglia 0.20,
 *  che e' dove lo scarto comincia a vedersi guardando. */
/**
 * Il trasporto della clip.
 *
 * Prima c'era `autoPlay muted loop` e basta: la clip girava e non si poteva
 * fare niente. Ma qui non si guarda una clip, la si ESAMINA — «si sfalda a
 * fine giro», «la mano sparisce a meta'» — e per dirlo bisogna poterla
 * fermare sul fotogramma in cui succede. Un giudizio dato al volo su un ciclo
 * che scorre e' un'impressione, non un'osservazione.
 *
 * Il passo di un fotogramma si ricava da `fotogrammi / durata`, non da un 24
 * scritto qui: la durata la dice il file e i fotogrammi li dice il server, e
 * una costante sarebbe muta proprio sulle riprese generate a lunghezza
 * diversa (2.5s contro 3.4s).
 */
function Transport({ video, fotogrammi }: {
  video: React.RefObject<HTMLVideoElement | null>;
  fotogrammi: number | null;
}) {
  const [tempo, setTempo] = useState(0);
  const [duration, setDuration] = useState(0);
  const [gira, setGira] = useState(true);
  const [velocita, setVelocita] = useState(1);
  const [ciclo, setCiclo] = useState(true);

  // I listener si riagganciano a ogni cambio di clip: `key` sul <video> lo fa
  // ricreare, quindi un effetto agganciato una volta sola parlerebbe a un nodo
  // che non e' piu' nel documento.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const t = () => setTempo(v.currentTime);
    const d = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const p = () => setGira(true);
    const f = () => setGira(false);
    v.addEventListener("timeupdate", t);
    v.addEventListener("durationchange", d);
    v.addEventListener("loadedmetadata", d);
    v.addEventListener("play", p);
    v.addEventListener("pause", f);
    d(); t(); setGira(!v.paused);
    return () => {
      v.removeEventListener("timeupdate", t);
      v.removeEventListener("durationchange", d);
      v.removeEventListener("loadedmetadata", d);
      v.removeEventListener("play", p);
      v.removeEventListener("pause", f);
    };
  });

  useEffect(() => { if (video.current) video.current.playbackRate = velocita; }, [velocita, video]);
  useEffect(() => { if (video.current) video.current.loop = ciclo; }, [ciclo, video]);

  const step = fotogrammi && duration ? duration / fotogrammi : 1 / 24;
  const vaiA = (t: number) => {
    const v = video.current;
    if (!v || !duration) return;
    v.currentTime = Math.min(duration - 1e-3, Math.max(0, t));
    setTempo(v.currentTime);
  };
  const scatto = (n: number) => { video.current?.pause(); vaiA((video.current?.currentTime ?? 0) + n * step); };
  const startStop = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  // Le frecce giudicano, quindi il fotogramma si sposta con `,` e `.` — gli
  // stessi tasti di ogni programma di montaggio — e `k` ferma e riparte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (e.key === ",") { e.preventDefault(); scatto(-1); }
      else if (e.key === ".") { e.preventDefault(); scatto(1); }
      else if (e.key === "k") { e.preventDefault(); startStop(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Tosato all'ultimo fotogramma: a clip finita `tempo` vale esattamente la
  // durata, e la divisione dava "f82/81" — un fotogramma che non esiste.
  const n = step > 0 && fotogrammi
    ? Math.min(fotogrammi, Math.floor(tempo / step) + 1)
    : step > 0 ? Math.floor(tempo / step) + 1 : 0;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-neutral-400">
      <button onClick={startStop} title="ferma o riparti (k)"
              className="w-6 h-6 shrink-0 grid place-items-center rounded-sm border border-neutral-800
                         hover:border-neutral-600 text-neutral-200 text-[11px]">
        {gira ? "❚❚" : "▶"}
      </button>
      <button onClick={() => scatto(-1)} title="un fotogramma indietro (,)"
              className="px-1 h-6 shrink-0 rounded-sm border border-neutral-800 hover:border-neutral-600">◀|</button>
      <button onClick={() => scatto(1)} title="un fotogramma avanti (.)"
              className="px-1 h-6 shrink-0 rounded-sm border border-neutral-800 hover:border-neutral-600">|▶</button>
      <input
        type="range" min={0} max={Math.max(duration, 0.001)} step={step} value={tempo}
        onChange={(e) => { video.current?.pause(); vaiA(Number(e.currentTarget.value)); }}
        className="dr-hue flex-1 min-w-0"
        aria-label="posizione nella clip"
      />
      <span className="shrink-0 tabular-nums text-neutral-300">
        {tempo.toFixed(2)}<span className="text-neutral-500">/{duration.toFixed(2)}s</span>
      </span>
      {fotogrammi ? (
        <span className="shrink-0 tabular-nums text-neutral-500">f{n}/{fotogrammi}</span>
      ) : null}
      <span className="shrink-0 flex gap-px">
        {[0.25, 0.5, 1].map((x) => (
          <button key={x} onClick={() => setVelocita(x)}
                  className={`px-1 h-6 rounded-sm border tabular-nums ${
                    velocita === x ? "border-neutral-500 text-neutral-200" : "border-neutral-800 hover:border-neutral-600"}`}>
            {x}×
          </button>
        ))}
      </span>
      <button onClick={() => setCiclo((c) => !c)} title="ripeti da capo"
              className={`px-1 h-6 shrink-0 rounded-sm border ${
                ciclo ? "border-neutral-500 text-neutral-200" : "border-neutral-800 hover:border-neutral-600"}`}>
        ↻
      </button>
    </div>
  );
}

function Combacia({ suono, shot }: { suono: number | null; shot: number | null }) {
  if (suono === null || shot === null) return null;
  const d = shot - suono;
  if (Math.abs(d) <= 0.2) {
    return <span className="text-[10.5px] text-emerald-400/80" title={`brano ${suono.toFixed(2)}`}>combacia</span>;
  }
  return (
    <span className={`text-[10.5px] ${d > 0 ? "text-amber-400/90" : "text-sky-400/80"}`}
          title={`brano ${suono.toFixed(2)} · ripresa ${shot.toFixed(2)}`}>
      {d > 0 ? "più dura del brano" : "più molle del brano"} ({d > 0 ? "+" : ""}{d.toFixed(2)})
    </span>
  );
}

/** Lo stato come selezione fra tre, non come frase. Si vede dov'e' messo e si
 *  sposta da qui: prima "scorda il voto" era un tastino in coda a una riga di
 *  testo, e cambiare idea voleva dire cercarlo. */
function State({ value, onChange }: {
  value: "tenuta" | "scartata" | null;
  onChange: (v: "tenuta" | "scartata" | null) => void;
}) {
  const items: { v: "scartata" | null | "tenuta"; text: string; active: string }[] = [
    { v: "scartata", text: "scartata", active: "bg-rose-950/60 border-rose-700 text-rose-200" },
    { v: null, text: "da vedere", active: "bg-neutral-800 border-neutral-600 text-neutral-100" },
    { v: "tenuta", text: "tenuta", active: "bg-emerald-950/60 border-emerald-700 text-emerald-200" },
  ];
  return (
    <div className="inline-flex rounded-sm overflow-hidden border border-neutral-800">
      {items.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`px-2 py-0.5 text-[11px] border-r last:border-r-0 border-neutral-800 transition-colors ${
            value === o.v ? o.active : "text-neutral-400 hover:text-neutral-200"}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

export default function VideoPick() {
  const ctx = useOutletContext<OutletCtx>();
  const { pid } = useParams();
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [filter, setFilter] = useState<Filter>("da giudicare");
  const [act, setAct] = useState<string>("");
  const [i, setI] = useState(0);
  const [piece, setPiece] = useState(0);
  const [note, setNota] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [rigen, setRigen] = useState(false);
  const [promptMod, setPromptMod] = useState("");
  const [par, setPar] = useState({ width: 640, height: 1152, length: 61, steps: 20 });
  const [jobs, setJobs] = useState<VideoJob[]>([]);

  /** Anche qui l'altezza si misura: la clip deve prendere lo schermo che c'è,
   *  e la pagina non deve scorrere mentre si giudica a raffica. */
  const shell = useRef<HTMLDivElement>(null);
  const [shellHeight, setHGuscio] = useState(700);
  useLayoutEffect(() => {
    // Anche questa pagina si prende tutta l'altezza: lo spazio che il guscio
    // dell'app mette sopra le altre, qui e' altezza rubata alla clip.
    ctx?.setFlush?.(true);
    const measure = () => {
      const el = shell.current;
      if (!el) return;
      const parent = el.parentElement;
      const below = parent ? parseFloat(getComputedStyle(parent).paddingBottom) || 0 : 0;
      setHGuscio(Math.max(360, window.innerHeight - el.getBoundingClientRect().top - below));
    };
    measure();
    window.addEventListener("resize", measure);
    // La misura va rifatta anche quando cambia il contenitore, non solo la
    // finestra: navigando da Montaggio a Scelta il padding cambia sotto i piedi.
    const ro = new ResizeObserver(measure);
    if (shell.current?.parentElement) ro.observe(shell.current.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
      ctx?.setFlush?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const video = useRef<HTMLVideoElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const area = useRef<HTMLDivElement | null>(null);
  const osservatore = useRef<ResizeObserver | null>(null);
  const pannello = useRef<HTMLDivElement>(null);
  const trascino = useRef<{ x0: number; w0: number } | null>(null);

  /** Quanto e' larga la clip, in pixel. La sceglie chi guarda, trascinando. */
  const [wantedWidth, setWantedWidth] = useState<number | null>(() => {
    const g = localStorage.getItem(KEY_WIDTH);
    const n = Number(g);
    return g !== null && Number.isFinite(n) && n >= 160 ? n : null;
  });
  useEffect(() => {
    try {
      if (wantedWidth === null) localStorage.removeItem(KEY_WIDTH);
      else localStorage.setItem(KEY_WIDTH, String(wantedWidth));
    } catch { /* niente */ }
  }, [wantedWidth]);

  /** Il rapporto VERO del fotogramma, letto dal file quando parte.
   *  Non si suppone 9:16: le anteprime stanno fra 0.550 e 0.556, e supporlo
   *  vuol dire deformare la figura fino al 2% proprio mentre la si giudica. */
  const [rapporto, setRapporto] = useState(9 / 16);

  /** L'altezza si misura sull'AREA DEL VIDEO, non sul pannello: sotto la clip
   *  c'e' la fila degli spezzoni, e misurare il pannello intero regalerebbe
   *  alla clip un'altezza che non ha — cioe' la farebbe sbordare esattamente
   *  sulle prese in due pezzi. */
  const [areaHeight, setHArea] = useState(0);
  const [wPannello, setWPannello] = useState(0);

  /**
   * L'osservatore si aggancia con un ref-callback, NON con un effetto.
   *
   * Con `useLayoutEffect(..., [])` c'era un difetto vero e silenzioso: l'area
   * del video vive dentro il ramo `{!scena ? ... : ...}`, quindi al primo
   * render — quando le riprese non sono ancora arrivate dal server — il
   * riferimento e' nullo, l'effetto esce subito e non viene mai rieseguito.
   * Risultato: `hArea` restava 0, il limite d'altezza spariva del tutto
   * (`hArea || Infinity`) e trascinando la clip cresceva fino a finire sotto
   * la finestra. Un ref-callback viene invece chiamato ogni volta che il nodo
   * entra o esce dal DOM, che e' proprio la cosa da seguire.
   */
  const snapArea = useCallback((el: HTMLDivElement | null) => {
    osservatore.current?.disconnect();
    area.current = el;
    if (!el) return;
    const measure = () => {
      setHArea(el.clientHeight);
      const row = pannello.current;
      if (row) setWPannello(row.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (pannello.current) ro.observe(pannello.current);
    osservatore.current = ro;
  }, []);

  /** Quanto spazio resta al pannello di destra, come minimo. Sotto questa
   *  soglia il prompt e il provino diventano illeggibili, e allargare la clip
   *  fino a schiacciarli non e' una scelta che valga la pena poter fare. */
  const MIN_RIGHT = 320;

  /**
   * Si fissa l'ALTEZZA, non la larghezza, e la larghezza resta `auto`.
   *
   * Sembra un dettaglio ed e' la differenza fra "non sborda" e "sborda del
   * 2%". Fissando la larghezza, l'altezza esce da una divisione per
   * `rapporto` — e `rapporto` e' una stima finche' il file non ha caricato i
   * metadati: parte da 9/16 (0.5625) mentre le anteprime vere stanno a 0.550.
   * Basta quel 2% e la clip finisce sotto il bordo e viene tagliata, che e'
   * esattamente cio' che si vedeva.
   *
   * Fissando l'altezza il vincolo diventa esatto: `hArea` e' misurato, non
   * stimato, e la clip non puo' essere piu' alta dello spazio che ha. Il
   * `rapporto` resta usato solo per tradurre la larghezza VOLUTA in
   * un'altezza: se e' un po' sbagliato la clip esce leggermente piu' stretta
   * o piu' larga di quanto chiesto — cosa che non si nota — invece di
   * sbordare, che si nota subito.
   *
   * E la larghezza `auto` la deduce il fotogramma dal suo rapporto vero:
   * niente deformazione e niente bande, perche' non c'e' nessun riquadro con
   * una forma decisa da noi da riempire.
   */
  const clipHeight = Math.max(
    120,
    Math.min(
      ...[
        areaHeight || Infinity,                                    // non piu' alta dell'area
        wantedWidth === null ? Infinity : wantedWidth / rapporto, // se e' stata chiesta
        wPannello ? (wPannello - MIN_RIGHT) / rapporto : Infinity, // lascia vivere la colonna destra
      ],
    ),
  );

  useEffect(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
  }, []);

  const scenes = useMemo(() => raggruppa(shots), [shots]);
  /** Gli atti col loro `perche`. Vengono dal piano, non dedotti dalle riprese:
   *  e' li' che sta la riga di storia. */
  const [fullActs, setFullActs] = useState<VideoAct[]>([]);
  /** I tagli servono per una cosa sola qui: dire quanto e' duro il BRANO nel
   *  punto in cui la ripresa cade. Senza, la durezza della ripresa e' un
   *  numero senza metro — 0.95 e' tanto o poco? Dipende da cosa chiede il
   *  brano li', ed e' esattamente l'aggancio su cui il montaggio e' costruito. */
  const [cuts, setTagli] = useState<VideoCut[]>([]);
  useEffect(() => {
    api.videoCuts().then((r) => { setFullActs(r.acts ?? []); setTagli(r.cuts ?? []); }).catch(() => {});
  }, []);
  /** La durezza del suono al secondo `t`, dal taglio che ci cade sopra. */
  const suonoA = useCallback(
    (t: number) => cuts.find((c) => Math.abs(c.t - t) < 0.25)?.soundIntensity ?? null,
    [cuts],
  );
  const acts = useMemo(
    () => [...new Set(scenes.map((s) => s.act).filter(Boolean))] as string[],
    [scenes],
  );
  const explainAct = useCallback(
    (n: string | null) => (n ? fullActs.find((a) => a.name === n)?.why ?? null : null),
    [fullActs],
  );

  const queue = useMemo(
    () =>
      scenes.filter((s) => {
        if (act && s.act !== act) return false;
        if (filter === "da giudicare") return s.verdict === null && !s.annotated;
        if (filter === "sospette") return !!s.suspect && s.verdict === null;
        if (filter === "tenute") return s.verdict === "tenuta";
        if (filter === "scartate") return s.verdict === "scartata" || !s.kept;
        if (filter === "annotate") return s.annotated;
        if (filter === "in montaggio") return s.minute !== null;
        return true;
      }),
    [scenes, filter, act],
  );

  const scene = queue[Math.min(i, Math.max(0, queue.length - 1))] ?? null;
  const current = scene?.pezzi[Math.min(piece, scene.pezzi.length - 1)] ?? null;

  // Le generazioni si guardano solo mentre ce n'e' una viva: una scheda sola,
  // e un sondaggio a vuoto ogni tre secondi per tutta la sessione non serve.
  useEffect(() => {
    let alive = true;
    const pass = async () => {
      try {
        const r = await api.videoGenerazioni();
        if (!alive) return;
        setJobs(r.jobs);
        if (r.jobs.some((j) => j.status === "running" || j.status === "pending")) setTimeout(pass, 3000);
      } catch { /* il server puo' non essere un progetto video */ }
    };
    void pass();
    return () => { alive = false; };
  }, [rigen]);

  useEffect(() => { setPiece(0); }, [scene?.origine]);
  useEffect(() => { if (i >= queue.length) setI(Math.max(0, queue.length - 1)); }, [queue.length, i]);

  const avanti = useCallback(() => setI((k) => Math.min(k + 1, Math.max(0, queue.length - 1))), [queue.length]);

  /**
   * L'ultimo verdetto, con com'era prima.
   *
   * Si giudica a raffica con le frecce, quindi prima o poi si preme quella
   * sbagliata — e la scena e' gia' passata. Finche' l'unica traccia era una
   * riga in `scelte.json`, "ho scartato qualcosa per sbaglio?" era una domanda
   * a cui si poteva rispondere solo aprendo il file. Adesso l'ultimo resta
   * scritto in pagina, con il suo annulla, finche' non se ne fa un altro.
   */
  /**
   * Si ricorda il GIUDIZIO di prima, non `kept`.
   *
   * `kept` è un booleano, e una ripresa mai giudicata ce l'ha vero — nessuno
   * l'ha scartata. Ripristinando quello, l'annulla di uno scarto la scriveva
   * fra le tenute: premevi «annulla» e al posto di tornare indietro davi un sì.
   * Il terzo stato (`null` = mai giudicata) è l'unico che sa disfare davvero.
   */
  const [last, setLast] = useState<
    { ids: string[]; name: string; kept: boolean; before: Map<string, VideoShot["verdict"]>; indice: number } | null
  >(null);

  const judge = useCallback(
    async (kept: boolean, why?: string) => {
      if (!scene) return;
      const ids = scene.pezzi.map((p) => p.id);
      const before = new Map(scene.pezzi.map((p) => [p.id, p.verdict]));
      // Ottimismo: la riga resta come l'utente l'ha messa anche se la rete tarda.
      setShots((prev) =>
        prev.map((s) =>
          ids.includes(s.id) ? { ...s, kept, verdict: kept ? "tenuta" : "scartata" } : s));
      setLast({ ids, name: scene.origine, kept, before, indice: i });
      try {
        let u = shots;
        for (const id of ids) u = (await api.videoPick(id, kept, why)).shots;
        setShots(u);
      } catch { /* la riga resta come l'utente l'ha messa */ }
      // Avanzare DOPO aver giudicato salta una scena, e la salta in silenzio:
      // la giudicata e' gia' uscita dall'elenco e quella dopo e' scalata da
      // sola in posizione `i`. La regola sta in `videoCoda.ts`, con il suo test.
      if (!leavesQueue(filter, kept)) avanti();
    },
    [scene, shots, avanti, i, filter],
  );

  /** Rimette ogni pezzo com'era e torna sulla scena, così la si può riguardare. */
  const undoLast = useCallback(async () => {
    if (!last) return;
    const u = last;
    setLast(null);
    /** "tenuta" -> sì · "scartata" -> no · mai giudicata -> nessun verdetto. */
    const toward = (g: VideoShot["verdict"]) => (g === null ? null : g === "tenuta");
    setShots((prev) =>
      prev.map((s) => {
        if (!u.before.has(s.id)) return s;
        const g = u.before.get(s.id) ?? null;
        return { ...s, verdict: g, kept: g !== "scartata" };
      }));
    try {
      let r = shots;
      for (const id of u.ids) r = (await api.videoPick(id, toward(u.before.get(id) ?? null))).shots;
      setShots(r);
    } catch { /* niente */ }
    setI(u.indice); setPiece(0);
  }, [last, shots]);

  const annota = useCallback(async () => {
    const t = text.trim();
    setNota(null); setText("");
    if (!t || !scene) return;
    try { setShots((await api.videoProblem(scene.pezzi[0]!.id, t)).shots); } catch { /* niente */ }
  }, [text, scene]);

  // Tastiera: le mani restano ferme e si giudica a raffica.
  //
  // DOVE si sta scrivendo o si sta muovendo un cursore, pero', i tasti tornano
  // a essere tasti. Senza questa guardia il difetto non e' estetico: il cursore
  // della durezza non si muoveva affatto (la freccia sinistra apriva "scarta" e
  // faceva preventDefault), e portare il cursore dentro la descrizione con le
  // frecce SCARTAVA la ripresa che si stava descrivendo. Trovato provando il
  // cursore da fuori, non leggendo il codice.
  const onOneField = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onOneField(e.target)) return;
      if (note !== null) {
        if (e.key === "Escape") { setNota(null); setText(""); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void annota();
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); setNota("scarto"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void judge(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setNota("nota"); }
      else if (e.key === "z") { e.preventDefault(); void undoLast(); }
      else if (e.key === " ") { e.preventDefault(); const v = video.current; if (v) { v.currentTime = 0; void v.play(); } }
      else if (e.key === "ArrowDown") { e.preventDefault(); avanti(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, annota, judge, avanti, undoLast]);

  useEffect(() => { if (note !== null) field.current?.focus(); }, [note]);

  const toJudge = scenes.filter((s) => s.verdict === null && !s.annotated).length;
  const suspect = scenes.filter((s) => !!s.suspect && s.verdict === null).length;
  const kept = scenes.filter((s) => s.verdict === "tenuta").length;
  const discarded = scenes.filter((s) => s.verdict === "scartata").length;

  return (
    <div ref={shell} className="flex flex-col text-neutral-200 overflow-hidden" style={{ height: shellHeight }}>
      {/* Altezza AUTO e non 24px fissi: su tablet dentro 24px non ci sta
          niente e la barra si sfascia. Va a capo in modo pulito, e il gruppo
          dei filtri scorre di lato invece di spingere fuori il resto. */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 py-1
                      border-b border-neutral-900">
        <span className="tracking-[0.22em] text-[10.5px] text-neutral-400">SCELTA</span>
        <Link to={`/p/${pid}/video`} className="text-[11px] text-neutral-400 hover:text-neutral-200">
          ← montaggio
        </Link>
        <span className="text-[10.5px] text-neutral-400 tabular-nums">
          {queue.length} in coda · su {scenes.length}:
          <span className="text-emerald-300"> {kept}</span> ·
          <span className="text-rose-300"> {discarded}</span> ·
          <span className="text-neutral-100"> {toJudge} mai viste</span>
        </span>
        {last && (
          <span className={`text-[10.5px] flex items-center gap-1.5 ${last.kept ? "text-emerald-300" : "text-rose-300"}`}>
            {last.kept ? "tenuta" : "scartata"} <span className="text-neutral-100">{last.name}</span>
            <button onClick={() => void undoLast()}
                    className="px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400
                               hover:text-neutral-100 inline-flex items-center gap-1.5">
              annulla
              <Shortcut>z</Shortcut>
            </button>
          </span>
        )}
        <div className="ml-auto flex gap-1.5 items-center overflow-x-auto max-w-full
                        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(["da giudicare", "sospette", "tenute", "scartate", "annotate", "in montaggio", "tutte"] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setFilter(k); setI(0); }}
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm border ${
              filter === k ? "border-neutral-500 text-neutral-200" : "border-neutral-900 text-neutral-400"
            }`}
          >
            {k}{k === "da giudicare" ? ` ${toJudge}` : k === "sospette" ? ` ${suspect}` : ""}
          </button>
        ))}
        <Scegli value={act} width={108} title="filtra per atto"
                items={[{ v: "", text: "ogni atto" }, ...acts.map((a) => ({ v: a, text: a }))]}
                onChange={(v) => { setAct(v); setI(0); }} />
        </div>
      </div>

      {/* La mappa di TUTTE le prese, una tacca ciascuna, nell'ordine in cui
          cadono nel montaggio.
          I numeri in testa dicono QUANTE sono tenute e quante scartate; questa
          dice QUALI, e sono due domande diverse. Serve soprattutto a vedere i
          buchi — un tratto di grigio e' un pezzo di brano su cui non ha ancora
          guardato nessuno, e con il filtro "da giudicare" quel tratto e'
          invisibile perche' li' dentro c'e' solo cio' che manca, mai dove
          manca. */}
      {scenes.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-1 py-1 border-b border-neutral-900">
          {/* `overflow-hidden` e tacche senza larghezza minima, e non e' una
              rifinitura: con `min-w-[2px]` 274 tacche chiedono 820px, che su un
              tablet non ci sono. La riga sbordava dalla sua scatola e i numeri
              della legenda finivano stampati SOPRA le tacche (visto a 834px).
              Senza pavimento le tacche si stringono e la mappa resta intera e
              in proporzione a ogni larghezza — che e' cio' per cui esiste. */}
          <div className="flex-1 min-w-0 flex gap-px h-3.5 overflow-hidden">
            {scenes.map((s) => {
              const color =
                s.verdict === "tenuta" ? "bg-emerald-500/70 hover:bg-emerald-400"
                : s.verdict === "scartata" ? "bg-rose-500/60 hover:bg-rose-400"
                : s.suspect ? "bg-amber-500/50 hover:bg-amber-400"
                : "bg-neutral-700/70 hover:bg-neutral-500";
              const suo = scene?.origine === s.origine;
              return (
                <button
                  key={s.origine}
                  title={`${s.origine} — ${s.verdict ?? "mai giudicata"}${
                    s.minute !== null ? ` · ${mmss(s.minute)}` : " · non in montaggio"}`}
                  onClick={() => {
                    // Saltare a una presa che il filtro corrente nasconde non
                    // puo' fallire in silenzio: si allarga il filtro e ci si
                    // va. Il contrario — un clic che non fa niente — e' il modo
                    // piu' rapido per far credere che la mappa sia decorativa.
                    const where = queue.findIndex((c) => c.origine === s.origine);
                    if (where >= 0) setI(where);
                    else { setFilter("tutte"); setAct(""); setI(scenes.indexOf(s)); }
                  }}
                  className={`flex-1 min-w-0 rounded-[1px] transition-colors ${color} ${
                    suo ? "ring-1 ring-neutral-100 ring-inset" : ""}`}
                />
              );
            })}
          </div>
          <span className="shrink-0 text-[10px] text-neutral-400 tabular-nums flex items-center gap-2">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-emerald-500/70" />{kept}</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-rose-500/60" />{discarded}</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-amber-500/50" />{suspect}</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-neutral-700/70" />{toJudge}</span>
          </span>
        </div>
      )}

      {!scene || !current ? (
        <div className="flex-1 min-h-0 grid place-items-center text-neutral-400 text-sm">
          {shots.length ? "niente da giudicare con questi filtri" : "nessuna ripresa nel progetto"}
        </div>
      ) : (
        <div ref={pannello} className="flex-1 min-h-0 flex flex-col md:flex-row gap-1 pt-2 pb-1">
          <div className="shrink-0 flex flex-col min-w-0">
            {/* Il fotogramma non sta MAI dentro un riquadro con una forma
                decisa da noi, e i due difetti visti oggi spiegano perche':

                - `aspect-[9/16]` lo deformava. Le anteprime non sono tutte
                  9:16 — misurate, stanno fra 360x648 (0.556) e 360x654
                  (0.550) — e qui si giudica proprio la forma della figura:
                  una donna piu' magra del 2% e' esattamente l'errore che non
                  ci si puo' permettere;
                - `object-contain` dentro un riquadro largo metteva le bande
                  nere, perche' in una colonna flex `align-items` vale
                  `stretch` e il video veniva allargato a tutta la colonna.

                Quindi: nessun `object-fit`, larghezza esplicita, altezza
                `auto`. La larghezza la decide il ridimensionatore, ma viene
                tosata a `altezza * rapporto` — cosi' il fotogramma non puo'
                ne' deformarsi ne' sbordare, e non resta mai avanzo da
                riempire di nero.

                Il `max-h-full` sul video NON e' ridondante rispetto alla
                tosatura: e' la stessa cosa detta al browser invece che a un
                calcolo mio. Se la mia misura arriva tardi — al primo
                fotogramma, mentre la finestra si ridimensiona, o se il
                rapporto non e' ancora stato letto — la tosatura sbaglia per un
                istante e il video sborda. Il `max-h-full` no, e per un
                elemento sostituito con larghezza data e altezza `auto` il
                browser ricalcola ANCHE la larghezza, quindi il rapporto resta
                giusto. Due difese contro lo stesso sbordamento, e quella che
                non dipende da me e' l'ultima parola. */}
            <div ref={snapArea} className="flex-1 min-h-0 grid place-items-center overflow-hidden">
              <video
                ref={video}
                key={current.id}
                src={pq(current.takes[0]?.clip ?? "")}
                poster={pq(current.takes[0]?.poster ?? "")}
                autoPlay muted loop playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setRapporto(v.videoWidth / v.videoHeight);
                }}
                onClick={(e) => { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); }}
                style={{ height: clipHeight, width: "auto" }}
                className="max-h-full max-w-full bg-black border border-neutral-800 rounded-sm cursor-pointer"
              />
            </div>
            <Transport video={video} fotogrammi={current.takes[0]?.frames ?? null} />
            {scene.pezzi.length > 1 && (
              <div className="mt-2 flex gap-1.5">
                {scene.pezzi.map((p, k) => (
                  <button
                    key={p.id}
                    onClick={() => setPiece(k)}
                    className={`text-[10.5px] px-1.5 py-0.5 rounded-sm border ${
                      k === piece ? "border-neutral-500 text-neutral-200" : "border-neutral-800 text-neutral-400"
                    }`}
                  >
                    {p.id}
                  </button>
                ))}
                <span className="text-[10.5px] text-neutral-400 self-center ml-1">
                  spezzoni della stessa presa
                </span>
              </div>
            )}
          </div>

          {/* Il ridimensionatore. Non e' un vezzo: la stessa passata di
              giudizio vuole due larghezze diverse — larga per vedere se la
              figura si disfa, stretta quando si sta leggendo il prompt o si
              guarda il provino. Trascinare costa meno che rimpicciolire la
              finestra. La misura resta fra una sessione e l'altra. */}
          <div
            role="separator"
            aria-orientation="vertical"
            title="trascina per stringere o allargare · doppio clic: quanto ci sta"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              // Si parte dalla larghezza VISIBILE, non da quella voluta: finche'
              // nessuno ha trascinato la voluta e' `null`, e il trascinamento
              // deve continuare da dove la clip sta adesso, non da un numero.
              trascino.current = { x0: e.clientX, w0: wantedWidth ?? clipHeight * rapporto };
            }}
            onPointerMove={(e) => {
              const t = trascino.current;
              if (!t) return;
              setWantedWidth(Math.max(160, Math.min(1200, t.w0 + (e.clientX - t.x0))));
            }}
            onPointerUp={(e) => {
              trascino.current = null;
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            }}
            onDoubleClick={() => setWantedWidth(null)}
            className="hidden md:grid shrink-0 w-2 -mx-0.5 cursor-col-resize group place-items-center
                       touch-none select-none"
          >
            <div className="w-px h-16 rounded bg-neutral-800 group-hover:bg-neutral-500
                            group-active:bg-neutral-400 transition-colors" />
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="text-[15px] text-neutral-200">{scene.origine}</div>
              {/* Lo stato e' una SCELTA fra tre, non una frase da leggere: si
                  vede dov'e' messo adesso e si sposta da qui senza tornare in
                  fondo ai tasti. */}
              <State
                value={scene.verdict}
                onChange={async (v) => {
                  if (v === null) {
                    for (const pz of scene.pezzi) setShots((await api.videoClearVerdict(pz.id)).shots);
                  } else if (v === "tenuta") await judge(true);
                  else setNota("scarto");
                }}
              />
              {scene.verdict && scene.judgedAt && (
                <span className="text-[10.5px] text-neutral-400">
                  {new Date(scene.judgedAt).toLocaleString("it-IT",
                    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {/* Cosa si vede, in una riga. E' la prima cosa che serve e non
                c'era: si aveva il nome, i numeri e il prompt intero, cioe'
                tutto tranne la risposta a "che roba e' questa". */}
            <Descrizione
              shot={current.id}
              text={current.descrizione}
              manual={current.descrizioneAMano}
              onSave={async (t) => setShots((await api.videoDescrizione(current.id, t)).shots)}
            />

            {scene.verdict === "scartata" && current.why && (
              <div className="mt-1 text-[11.5px] text-rose-300/90">scartata — {current.why}</div>
            )}
            {!scene.verdict && scene.kept && (
              <div className="mt-1 text-[11px] text-neutral-400">
                È nel montaggio senza che nessuno l'abbia guardata: tenere è il valore di partenza.
              </div>
            )}
            {current.excluded && (
              <div className="mt-1 text-[11px] text-amber-500/80">
                esclusa dal piano: {current.excluded}
              </div>
            )}

            {current.suspect && (
              <div className="mt-3 border-l-2 border-amber-500/50 pl-2">
                <div className="text-[11px] text-amber-500/80">da guardare per prima</div>
                <div className="text-[12px] text-amber-200/90">{current.suspect}</div>
                <div className="text-[10.5px] text-neutral-400 leading-snug mt-0.5">
                  Su materiale nuovo sbaglia 4 volte su 5: è un avviso, non un verdetto.
                </div>
                {/* Fra "tieni" e "scarta" manca la terza cosa che si vuole fare
                    davvero quando una ripresa e' segnalata: aggiustarla. Il
                    pannello del prompt c'era gia' ma stava chiuso in fondo alla
                    colonna, quindi la strada era: leggo il problema, scorro,
                    apro, cerco il prompt. Da qui e' un tasto. */}
                <button
                  onClick={() => { setPromptMod(current.prompt ?? ""); setRigen(true); }}
                  className="mt-1.5 px-2 py-0.5 rounded-sm border border-amber-700/70 text-amber-200/90
                             text-[11px] hover:bg-amber-950/40"
                >
                  ✎ correggi il prompt e rigenera
                </button>
              </div>
            )}

            <Intensity
              shot={current.id}
              value={current.intensity}
              measured={current.measuredIntensity}
              manual={current.manualIntensity}
              moto={current.moto}
              dettaglio={current.dettaglio}
              onChange={async (v) => setShots((await api.videoIntensity(current.id, v)).shots)}
            />

            {/* «in scena 6.6s a 1:10» nascondeva la cosa piu' utile: quante
                volte entra. Una ripresa mediocre che passa tre volte pesa piu'
                di una bella che passa una volta sola, e il totale non lo dice. */}
            <div className="mt-3">
              <div className="text-[11px] text-neutral-400">
                {scene.apparizioni.length === 0
                  ? "non è nel montaggio"
                  : scene.apparizioni.length === 1
                  ? "entra una volta"
                  : `entra ${scene.apparizioni.length} volte · ${scene.inEdit.toFixed(1)}s in tutto`}
              </div>
              {scene.apparizioni.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {scene.apparizioni.map((ap, k) => (
                    <li key={k} className="text-[12px] flex flex-wrap items-baseline gap-x-2">
                      <span className="tabular-nums text-neutral-200">{mmss(ap.t)}</span>
                      <span className="tabular-nums text-neutral-400">{ap.dur.toFixed(1)}s</span>
                      {ap.act && (
                        <>
                          <span className="text-neutral-200">{ap.act}</span>
                          {explainAct(ap.act) && (
                            <span className="text-[11px] text-neutral-400">— {explainAct(ap.act)}</span>
                          )}
                        </>
                      )}
                      <Combacia suono={suonoA(ap.t)} shot={current.intensity} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {current.problems.length > 0 && (
              <ul className="mt-3 space-y-1">
                {current.problems.map((p, k) => (
                  <li key={k} className="text-[11.5px] text-amber-400/90 flex gap-2">
                    <span>▸ {p}</span>
                    <button
                      className="text-neutral-400 hover:text-neutral-400"
                      onClick={async () => {
                        try { setShots((await api.videoProblem(current.id, undefined, k)).shots); } catch { /* niente */ }
                      }}
                    >
                      togli
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Il prompt e' il posto dove si corregge cio' che la nota dice.
                Finche' erano in due finestre diverse, il giro "questa si
                deforma" -> prompt nuovo -> generazione si chiudeva a mano. */}
            <details className="mt-3" open={rigen} onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setRigen(open);
              if (open && !promptMod) setPromptMod(current.prompt ?? "");
            }}>
              <summary className="text-[11px] text-neutral-400 cursor-pointer">
                prompt e rigenerazione{current.prompt ? "" : " (nessun prompt registrato)"}
              </summary>
              <div className="mt-2 space-y-2">
                {current.problems.length > 0 && (
                  <div className="text-[11px] text-amber-400/80 border-l-2 border-amber-500/40 pl-2">
                    {current.problems.map((x, k) => <div key={k}>{x}</div>)}
                  </div>
                )}
                <Area value={promptMod} onChange={setPromptMod}
                      placeholder="il prompt che genererà la ripresa"
                      className="h-28 text-[11.5px] leading-relaxed" />
                {/* Non sono costanti nascoste: a 704x1280 con 81 fotogrammi la
                    3090 arriva a 23,9 GB su 24,5 e non scrive niente per un'ora.
                    Chi lancia deve poter vedere il numero che decide. */}
                <div className="flex gap-2 text-[11px]">
                  {(["width", "height", "length", "steps"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1 text-neutral-400">
                      {k}
                      <NumberField value={par[k]} width={58} title={k}
                              min={k === "steps" ? 4 : 64} max={k === "steps" ? 60 : 1536}
                              step={k === "steps" ? 2 : 64}
                              onChange={(n) => setPar({ ...par, [k]: n })} />
                    </label>
                  ))}
                </div>
                <button
                  className="px-2 py-0.5 rounded-sm border border-sky-700 text-sky-300 text-[11px] disabled:opacity-40"
                  disabled={!promptMod.trim() || jobs.some((j) => j.status === "running" || j.status === "pending")}
                  onClick={async () => {
                    try {
                      await api.videoGenera(current.id, promptMod, current.takes[0]?.take ?? "a", par);
                      setJobs((await api.videoGenerazioni()).jobs);
                    } catch (err) { alert(String(err)); }
                  }}
                >
                  rigenera sulla 3090
                </button>
                {jobs.filter((j) => j.shot === current.id).slice(0, 3).map((j) => (
                  <div key={j.id} className="text-[11px] text-neutral-400">
                    #{j.id} {j.status}
                    {j.frames ? ` — ${j.frames} fotogrammi` : ""}
                    {j.error && <span className="text-rose-400"> — {j.error}</span>}
                    {j.log && <pre className="mt-1 max-h-24 overflow-auto text-[10px] text-neutral-400 whitespace-pre-wrap">{j.log.split("\n").slice(-6).join("\n")}</pre>}
                  </div>
                ))}
              </div>
            </details>

            {note !== null ? (
              <div className="mt-4">
                <Area
                  autoFuoco value={text} onChange={setText}
                  onEsc={() => setNota(null)} onInvia={() => void annota()}
                  placeholder={note === "scarto" ? "perché la scarti?" : "cosa c'è da sistemare?"}
                  className="h-20 text-[12px]"
                />
                <div className="mt-1 flex gap-2 text-[11px]">
                  <button
                    className="px-2 py-0.5 rounded-sm border border-neutral-600 text-neutral-200
                               inline-flex items-center gap-1.5"
                    onClick={async () => {
                      const t = text;
                      if (note === "scarto") { setNota(null); setText(""); await judge(false, t); }
                      else await annota();
                    }}
                  >
                    {note === "scarto" ? "scarta" : "annota"}
                    <Shortcut>⌘↵</Shortcut>
                  </button>
                  <button className="px-2 py-0.5 rounded-sm border border-neutral-800 text-neutral-400
                                     inline-flex items-center gap-1.5"
                          onClick={() => { setNota(null); setText(""); }}>
                    lascia stare
                    <Shortcut>esc</Shortcut>
                  </button>
                </div>
              </div>
            ) : (
              /* La scorciatoia sta SUL tasto, non in una legenda a fianco:
                 una legenda si legge una volta e poi diventa arredamento,
                 mentre il tasto lo si guarda ogni volta che si esita. Il
                 tasto la insegna, e chi la impara smette di usarlo. */
              <div className="mt-4 flex gap-2 items-center flex-wrap">
                <VerdictButton onClick={() => setNota("scarto")} tasto="←"
                  className="border-rose-800 text-rose-300 hover:bg-rose-950/50">
                  ✕ scarta
                </VerdictButton>
                <VerdictButton onClick={() => void judge(true)} tasto="→"
                  className="border-emerald-800 text-emerald-300 hover:bg-emerald-950/50">
                  ♥ tieni
                </VerdictButton>
                <VerdictButton onClick={() => setNota("nota")} tasto="↑"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ✎ annota
                </VerdictButton>
                <VerdictButton onClick={() => avanti()} tasto="↓"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ↷ salta
                </VerdictButton>
                <VerdictButton onClick={() => { const v = video.current; if (v) { v.currentTime = 0; void v.play(); } }}
                  tasto="spazio"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ↻ rivedi
                </VerdictButton>
              </div>
            )}

            {/* Quanto manca, e cosa arriva. Un contatore "12 / 176" dice solo
                che la fine e' lontana; le facce dopo dicono se conviene tirare
                dritto o cambiare filtro, e il giudizio va a raffica per questo. */}
            {/* Il provino: dodici istanti della clip, larghi quanto la colonna.
                Serve a rispondere a una domanda che nessuna misura di questo
                progetto ha saputo rispondere — DOVE una ripresa si sminchia.
                Ci hanno provato in cinque modi (bilancio tonale, area di
                dettaglio, salto della sagoma, non-liscezza della traiettoria,
                disaccordo fra soggetto e sfondo) e nessuno separa una figura
                che si disfa da un'onda che esplode: i difetti veri sono
                semantici — «scende in mezzo alle scale», «il gabbiano non e'
                coerente fra un fotogramma e l'altro» — e un modello per
                immagini singole quei quadri li descrive come normalissimi.

                Quindi non si automatizza il giudizio, si rende istantaneo: il
                punto in cui la figura cambia identita' si vede in un secondo, e
                cliccando ci si va. A trenta pixel per casella non si vedeva
                niente, quindi sta qui e non nella colonna della clip. */}
            <Take
              shot={current.id}
              take={current.takes[0]?.take ?? "a"}
              onVaiA={(frazione) => {
                const v = video.current;
                if (!v || !Number.isFinite(v.duration)) return;
                v.pause();
                v.currentTime = frazione * v.duration;
              }}
            />

            <div className="mt-4 flex-1 min-h-0 flex flex-col">
              <div className="h-0.5 bg-neutral-900 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-600"
                     style={{ width: `${queue.length ? ((i + 1) / queue.length) * 100 : 0}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] text-neutral-400 tabular-nums shrink-0">
                {Math.min(i + 1, queue.length)} / {queue.length} · cosa arriva dopo
              </div>
              <div className="mt-3 grid gap-1.5"
                   style={{ gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))" }}>
                {queue.slice(i + 1, i + 61).map((sc, k) => {
                  const pr = sc.pezzi[0];
                  return (
                    <button
                      key={sc.origine}
                      onClick={() => { setI(i + 1 + k); setPiece(0); }}
                      title={`${sc.origine}${sc.act ? ` · ${sc.act}` : ""}`}
                      className="w-full aspect-[9/16] rounded-sm border border-neutral-900 bg-cover bg-center
                                 opacity-45 hover:opacity-100 transition-opacity"
                      style={{ backgroundImage: pr?.takes[0]?.poster ? `url(${pq(pr.takes[0].poster)})` : undefined }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
