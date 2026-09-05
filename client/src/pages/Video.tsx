import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  api, pq,
  type VideoAssets, type VideoAct, type VideoGate, type VideoCut,
  type VideoOverrides, type VideoMarker, type VideoWave, type VideoRebuild,
  type VideoShot, type VideoHeld,
} from "../api";
import type { OutletCtx } from "../App";
import Timeline from "./video/Timeline";
import Ispettore from "./video/Inspector";
import Library from "./video/Library";
import Handle from "./video/Handle";
import { Bott, Field, Choose } from "./video/ui";
import { cutIndex, shuttle, timecode } from "./video/time";

/**
 * A video project's editor.
 *
 * A shell that fits one screen and does not scroll: the bar at the top, then
 * the tall row — library, monitor, inspector — and the timeline underneath,
 * separated by a handle you drag. It is the shape of every editing program, and
 * not out of fashion: if the page scrolls, the monitor and the timeline cannot
 * be under your eyes together, and looking at a cut becomes two gestures
 * instead of one.
 *
 * The height is measured, not guessed: `100vh` minus the real header,
 * recomputed on every resize.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const FPS = 24;

/** How much room the timeline takes, in pixels. It lives in the browser
 *  because it is a preference of whoever is watching, not a property of the
 *  cut. */
const KEY_HEIGHT = "darkroom.video.altezzaTimeline";
const KEY_LEFT = "darkroom.video.larghezzaLibreria";
const KEY_RIGHT = "darkroom.video.larghezzaIspettore";

function read(key: string, difetto: number, min: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= min ? v : difetto;
}

/**
 * What each of the checks checks.
 *
 * `check.py` prints the measurement — "rho = 0.914", "new frames per second:
 * 15.0" — and the measurement is the point: it is what can be argued with. But
 * on its own it does not say *what* is being measured, and whoever opens the
 * page should not have to go hunting for it in the source. Here is the
 * sentence; the number stays whatever the Python says.
 */
const WHAT_IT_CHECKS: Record<string, string> = {
  "1": "ogni taglio cade su un battito della canzone",
  "2": "nessuna ripresa viene rallentata più di quanto regga",
  "3": "le luci dei piani sono confrontabili fra loro",
  "4": "il video dura quanto il montaggio dice",
  "5": "l'immagine si muove davvero, non è fatta di fermi",
  "5b": "la grana della pellicola è viva",
  "6": "dove il suono è più duro, l'immagine è più dura",
};

/**
 * The video's state, in a line that stands on its own.
 *
 * It used to say "green", which is the traffic-light colour of whoever wrote
 * the check: outside that head it means nothing. Now it says how many checks
 * pass out of how many, and opened it says what each one checks.
 */
function State({ gate, master, onRedo }: { gate: VideoGate | null; master: string | null; onRedo: () => void }) {
  const [aperta, setAperta] = useState(false);
  const rows = gate?.rows ?? [];
  const cadute = gate?.failed.length ?? 0;
  const outcome = gate?.outcome ?? "sconosciuto";

  const [text, color, pallino] =
    gate?.computing ? ["controllo il video…", "text-neutral-400", "bg-neutral-500 animate-pulse"]
    : outcome === "verde" ? [`il video passa tutti i ${rows.length} controlli`, "text-emerald-300", "bg-emerald-500"]
    : outcome === "rosso" ? [`${cadute} ${cadute === 1 ? "controllo non passa" : "controlli non passano"}`, "text-rose-300", "bg-rose-500"]
    : ["video mai controllato", "text-neutral-400", "bg-neutral-600"];

  return (
    <div className="relative">
      <button onClick={() => setAperta((a) => !a)}
              title="cosa è stato verificato sul video costruito"
              className={`flex items-center gap-1.5 text-[10.5px] ${color} hover:brightness-125`}>
        <span className={`w-1.5 h-1.5 rounded-full ${pallino}`} />
        {text}
        <span className="text-neutral-400">{aperta ? "▴" : "▾"}</span>
      </button>
      {aperta && (
        <div className="absolute z-40 mt-1 w-[720px] max-w-[88vw] bg-neutral-950 border border-neutral-700
                        rounded-sm p-3 shadow-2xl">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[12px] text-neutral-100">controlli sul video costruito</span>
            <span className="text-[10.5px] text-neutral-400">
              girano su <span className="text-neutral-300">{master ?? "il master"}</span>, non sul piano
            </span>
            <button onClick={onRedo} className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-100">
              ricontrolla
            </button>
            <button onClick={() => setAperta(false)} className="text-[10.5px] text-neutral-400 hover:text-neutral-100">
              chiudi
            </button>
          </div>

          {rows.map((r) => (
            <div key={r.n} className="flex gap-2 py-1 border-t border-neutral-900 text-[11px] items-baseline">
              <span className={`shrink-0 ${r.ok === false ? "text-rose-400" : "text-emerald-400"}`}>
                {r.ok === false ? "✕" : "✓"}
              </span>
              <div className="min-w-0">
                <div className="text-neutral-200">{WHAT_IT_CHECKS[r.n] ?? `controllo ${r.n}`}</div>
                <div className="text-neutral-400 leading-snug">{r.text}</div>
              </div>
            </div>
          ))}
          {gate?.failed.map((f, i) => (
            <div key={i} className="text-[11px] text-rose-300 pt-1">non passa: {f}</div>
          ))}
          {!rows.length && !gate?.computing && (
            <div className="text-[11px] text-neutral-400">
              nessun controllo ancora: si misurano sul video costruito, quindi servono un
              montaggio e una ricostruzione.
            </div>
          )}
          {gate?.computing && (
            <div className="text-[11px] text-neutral-400">
              sto rileggendo il video sul PC — un minuto e mezzo.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The transport: what a native bar cannot do. */
function Transport({ v, t, duration, cuts, vaiA }: {
  v: HTMLVideoElement | null; t: number; duration: number;
  cuts: VideoCut[]; vaiA: (s: number, parts?: boolean) => void;
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

  const i = cutIndex(cuts, t);
  const B = "px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600";
  return (
    <div className="mt-1.5 flex items-center gap-1 text-[10.5px] justify-center flex-wrap">
      <button className={B} title="taglio prima  [" onClick={() => vaiA(cuts[Math.max(0, i - 1)]?.t ?? 0)}>⏮</button>
      <button className={B} title="un fotogramma indietro  ←" onClick={() => vaiA(t - 1 / FPS)}>◀|</button>
      <button className={`${B} w-8`} title="spazio" onClick={() => (gira ? v?.pause() : v?.play())}>{gira ? "❚❚" : "▶"}</button>
      <button className={B} title="un fotogramma avanti  →" onClick={() => vaiA(t + 1 / FPS)}>|▶</button>
      <button className={B} title="taglio dopo  ]" onClick={() => vaiA(cuts[Math.min(cuts.length - 1, i + 1)]?.t ?? duration)}>⏭</button>
      <span className="ml-1.5 tabular-nums text-neutral-100 text-[11.5px] tracking-tight">{timecode(t)}</span>
      <span className="tabular-nums text-neutral-400">/ {timecode(duration)}</span>
      <div className="ml-1">
        <Choose
          value={String(vel)} width={62} title="velocità di riproduzione"
          items={[0.25, 0.5, 1, 1.5, 2].map((x) => ({ v: String(x), text: `${x}x` }))}
          onChange={(v) => setVel(Number(v))}
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
  const [acts, setActs] = useState<VideoAct[]>([]);
  const [held, setHeld] = useState<VideoHeld[]>([]);
  const [assets, setAssets] = useState<VideoAssets | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(0);
  const [gate, setGate] = useState<VideoGate | null>(null);
  const [ric, setRic] = useState<VideoRebuild | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  /** Several cuts at once. It is for doing in one gesture what is otherwise
   *  done twenty times: discarding the shots of a beat that does not work,
   *  giving the same duration to a series, looking closely at a stretch. */
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [inquadra, setInquadra] = useState<{ da: number; a: number; n: number } | null>(null);
  const [wave, setWave] = useState<VideoWave | null>(null);
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [forz, setForz] = useState<VideoOverrides | null>(null);
  const readOverrides = useCallback(() => {
    api.videoOverrides().then(setForz).catch(() => {});
  }, []);
  const [inOut, setInOut] = useState<[number, number] | null>(null);
  const [gira, setGira] = useState(false);
  const [ciclo, setCiclo] = useState(false);
  const [appunto, setAppunto] = useState<{ t: number; text: string } | null>(null);
  const [aiuto, setAiuto] = useState(false);
  const [vediForz, setVediForz] = useState(false);
  const [vEl, setVEl] = useState<HTMLVideoElement | null>(null);
  /** The shuttle's speed: 0 stopped, negative backwards. Backwards the browser
   *  cannot go on its own, so we move the playhead ourselves. */
  const [spola, setSpola] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);

  /** The editor draws to the edge: the space the app shell puts above the other
   *  pages is, here, height stolen from the timeline. */
  useEffect(() => {
    ctx?.setFlush?.(true);
    return () => ctx?.setFlush?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- shell measurements --------------------------------------------------
  const shell = useRef<HTMLDivElement>(null);
  const [shellHeight, setHGuscio] = useState(700);
  const [hTimeline, setHTimeline] = useState(() => read(KEY_HEIGHT, 300, 140));
  const [wSx, setWSx] = useState(() => read(KEY_LEFT, 218, 150));
  const [wDx, setWDx] = useState(() => read(KEY_RIGHT, 336, 220));

  /** The app header has no height that can be taken for granted: it is measured
   *  where it really ends, and recomputed when the window changes. A
   *  hand-written `calc(100vh - 56px)` is right until somebody adds a row to
   *  the menu. */
  useLayoutEffect(() => {
    const measure = () => {
      const el = shell.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // The container's bottom padding is read, not estimated: a margin by eye
      // leaves eight pixels too many and the page scrolls anyway — which is
      // exactly what this shell exists to prevent.
      const parent = el.parentElement;
      const below = parent ? parseFloat(getComputedStyle(parent).paddingBottom) || 0 : 0;
      setHGuscio(Math.max(360, window.innerHeight - top - below));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (shell.current?.parentElement) ro.observe(shell.current.parentElement);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); };
  }, []);

  const H_HANDLE = 6;
  const H_GATE = 24;
  const topHeight = Math.max(180, shellHeight - H_GATE - H_HANDLE - hTimeline);
  const timelineLimit = (v: number) => Math.max(140, Math.min(shellHeight - H_GATE - H_HANDLE - 180, v));

  const save = (k: string) => (v: number) => localStorage.setItem(k, String(Math.round(v)));

  // ---- dati ----------------------------------------------------------------
  const ricarica = useCallback(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
    api.videoCuts().then((r) => {
      setCuts(r.cuts); setBpm(r.bpm); setDuration(r.duration);
      setActs(r.acts ?? []); setHeld(r.held ?? []);
    }).catch(() => {});
    api.videoAssets().then(setAssets).catch(() => {});
    api.videoMarkers().then((r) => setMarkers(r.markers)).catch(() => {});
    api.videoOverrides().then(setForz).catch(() => {});
  }, []);
  useEffect(() => { ricarica(); }, [ricarica]);

  /**
   * The undo stack.
   *
   * Every change to the timeline knows how to redo itself in reverse, so undo
   * is not a state to reconstruct: it is the inverse move, set aside when the
   * move is made. It holds for swaps, durations and pins — everything that ends
   * up in `scelte.json`.
   */
  type Move = { what: string; fa: () => Promise<unknown>; undo: () => Promise<unknown> };
  const [pila, setPila] = useState<Move[]>([]);
  const [redo, setRedo] = useState<Move[]>([]);

  const compi = useCallback(async (
    what: string, fa: () => Promise<unknown>, undo: () => Promise<unknown>,
  ) => {
    try {
      await fa();
      setPila((p) => [...p.slice(-49), { what, fa, undo }]);
      setRedo([]);
      ricarica();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  }, [ricarica]);

  const cancel = useCallback(async () => {
    const last = pila[pila.length - 1];
    if (!last) return;
    setPila((p) => p.slice(0, -1));
    setRedo((r) => [...r.slice(-49), last]);
    try { await last.undo(); ricarica(); } catch { /* niente */ }
  }, [pila, ricarica]);

  /** Undone by mistake: the move is not lost, it goes back in place. */
  const redoLast = useCallback(async () => {
    const m = redo[redo.length - 1];
    if (!m) return;
    setRedo((r) => r.slice(0, -1));
    setPila((p) => [...p.slice(-49), m]);
    try { await m.fa(); ricarica(); } catch { /* niente */ }
  }, [redo, ricarica]);

  /** The waveform costs a minute and a half of ffmpeg on the PC: the server
   *  puts it in the works and answers at once, the page fishes for it until it
   *  is ready. */
  useEffect(() => {
    let alive = true;
    const ask = async () => {
      try {
        const b = await api.videoGate();
        if (!alive) return;
        setGate(b);
        if (b.computing) setTimeout(ask, 3000);
      } catch { /* niente */ }
    };
    void ask();
    return () => { alive = false; };
  }, []);

  /** The peaks are computed on the first pass and stay on disk. */
  useEffect(() => {
    let alive = true;
    const ask = async () => {
      try {
        const o = await api.videoWave();
        if (!alive) return;
        setWave(o);
        if (!o.ready) setTimeout(ask, 2500);
      } catch { /* niente */ }
    };
    void ask();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ric?.active) return;
    const h = setInterval(async () => {
      try {
        const r = await api.videoRebuild();
        setRic(r);
        if (!r.active) { ricarica(); api.videoGate(true).then(setGate).catch(() => {}); }
      } catch { /* niente */ }
    }, 1200);
    return () => clearInterval(h);
  }, [ric?.active, ricarica]);

  /**
   * J K L, the edit bench's shuttle.
   *
   * Forwards the player does it by changing speed. Backwards it does not: no
   * browser can do a negative `playbackRate`, so we move the playhead ourselves
   * on every frame. They are two different roads for one gesture, and whoever
   * uses it should not have to notice.
   */
  useEffect(() => {
    if (!vEl) return;
    if (spola === 0) { vEl.playbackRate = 1; return; }
    if (spola > 0) { vEl.playbackRate = spola; void vEl.play().catch(() => {}); return; }
    vEl.pause();
    const h = setInterval(() => {
      const isNew = Math.max(0, vEl.currentTime + (spola / FPS));
      vEl.currentTime = isNew;
      setT(isNew);
      if (isNew <= 0) setSpola(0);
    }, 1000 / FPS);
    return () => clearInterval(h);
  }, [vEl, spola]);

  useEffect(() => {
    if (!vEl) return;
    const a = () => setGira(true), b = () => setGira(false);
    vEl.addEventListener("play", a); vEl.addEventListener("pause", b);
    return () => { vEl.removeEventListener("play", a); vEl.removeEventListener("pause", b); };
  }, [vEl]);

  /** The loop over the stretch: you watch the same passage ten times in a row
   *  without touching anything, which is how you decide whether a cut lands
   *  late. */
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

  /** How many things have been set by hand over the derived plan. It sits in
   *  the bar because it is the only part of the cut no measurement defends. */
  const overrideCount = (forz?.pin.length ?? 0) + (forz?.duration.length ?? 0) + (forz?.discardedByHand.length ?? 0);

  const src = assets?.preview ?? assets?.reel ?? null;

  const inEdit = useMemo(() => {
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

  /** One single way of moving the playhead. `play` distinguishes "take me there
   *  and show me" from "take me there, that's all": if the frame step started
   *  playback too, holding the arrow down would slide instead of stepping frame
   *  by frame. */
  const vaiA = useCallback((s: number, parts = false) => {
    const v = video.current;
    if (!v || !duration) return;
    v.currentTime = Math.max(0, Math.min(duration - 1 / FPS, s));
    setT(v.currentTime);
    if (parts) void v.play().catch(() => {});
  }, [duration]);

  const openCut = useCallback((i: number, mod?: { estendi?: boolean; add?: boolean }) => {
    if (mod?.estendi || mod?.add) {
      setSelection((s0) => {
        const n = new Set(s0);
        if (mod.estendi && picked !== null) {
          for (let k = Math.min(picked, i); k <= Math.max(picked, i); k++) n.add(k);
        } else if (n.has(i)) n.delete(i);
        else n.add(i);
        if (picked !== null) n.add(picked);
        return n;
      });
      setPicked(i);
      return;
    }
    setSelection(new Set());
    setPicked(i);
    vaiA((cuts[i]?.t ?? 0) + 0.02, true);
  }, [cuts, vaiA, picked]);

  /** From the library to the cut: if that shot is on screen, you go to it. */
  const openShot = useCallback((id: string) => {
    const i = cuts.findIndex((c) => c.shot === id);
    if (i >= 0) openCut(i);
  }, [cuts, openCut]);

  /** A block dragged over another: they swap places. Undo puts the two beats
   *  back as they were, i.e. unpins both. */
  const swap = useCallback((i: number, j: number) => {
    const a = cuts[i], b = cuts[j];
    if (!a || !b) return;
    const beforeA = forz?.pin.find((f) => f.bar === a.bar)?.shot ?? null;
    const beforeB = forz?.pin.find((f) => f.bar === b.bar)?.shot ?? null;
    void compi(
      `${a.shot} ⇄ ${b.shot}`,
      () => api.videoSwap(a.bar, a.shot, b.bar, b.shot),
      async () => {
        if (beforeA) await api.videoPin(a.bar, beforeA); else await api.videoPin(a.bar, null);
        if (beforeB) await api.videoPin(b.bar, beforeB); else await api.videoPin(b.bar, null);
      },
    );
  }, [cuts, forz, compi]);

  const changeDuration = useCallback((bar: number, bars: number) => {
    const before = forz?.duration.find((f) => f.bar === bar)?.bars ?? null;
    void compi(
      `battuta ${bar}: ${bars} battute`,
      () => api.videoDuration(bar, bars),
      () => api.videoDuration(bar, before),
    );
  }, [forz, compi]);

  const pose = useCallback((i: number, shot: string) => {
    const c = cuts[i];
    if (!c) return;
    const before = forz?.pin.find((f) => f.bar === c.bar)?.shot ?? null;
    void compi(
      `${shot} sulla battuta ${c.bar}`,
      () => api.videoPin(c.bar, shot),
      () => api.videoPin(c.bar, before),
    );
  }, [cuts, forz, compi]);

  /**
   * The plan as it will be after the rebuild.
   *
   * The forcings live in `scelte.json` and the plan is only redone on a rebuild:
   * with two blocks swapped, two lines changed on disk and nothing moved on
   * screen. An editor in which the gesture is invisible is not an editor.
   *
   * What can be shown exactly is shown: a pin replaces the plan on that beat,
   * and that is all — the timings do not change. A forced duration would
   * instead move everything after it, and faking that recomputation would show
   * a cut that does not exist: that one is simply declared, with the label on
   * the block.
   */
  const shownCuts = useMemo(() => {
    if (!forz?.pin.length) return cuts;
    const perBar = new Map(forz.pin.map((f) => [f.bar, f.shot]));
    const shotData = new Map(shots.map((sh) => [sh.id, sh]));
    return cuts.map((c) => {
      const isNew = perBar.get(c.bar);
      if (!isNew || isNew === c.shot) return c;
      const d = shotData.get(isNew);
      return { ...c, shot: isNew, origine: isNew.replace(/_?\d$/, ""), shotIntensity: d?.intensity ?? null };
    });
  }, [cuts, forz, shots]);

  const forcedDuration = useMemo(
    () => new Map((forz?.duration ?? []).map((f) => [f.bar, f.bars])),
    [forz],
  );

  /** I tagli selezionati, in ordine di tempo. */
  const molti = useMemo(
    () => [...selection].filter((i) => shownCuts[i]).sort((a, b) => a - b),
    [selection, shownCuts],
  );

  /** The stretch the selection covers, end to end. */
  const tratto = useMemo((): [number, number] | null => {
    if (!molti.length) return null;
    const a = shownCuts[molti[0]!]!, b = shownCuts[molti[molti.length - 1]!]!;
    return [a.t, b.t + b.dur];
  }, [molti, shownCuts]);

  /** The distinct shots under the selection: two beats can show the same shot,
   *  and discarding it twice means nothing. */
  const selectedShots = useMemo(
    () => [...new Set(molti.map((i) => shownCuts[i]!.shot))],
    [molti, shownCuts],
  );

  const discardSelection = useCallback(() => {
    const shots = selectedShots;
    if (!shots.length) return;
    void compi(
      shots.length === 1 ? `scarta ${shots[0]}` : `scarta ${shots.length} riprese`,
      async () => { for (const sh of shots) await api.videoPick(sh, false, "scartato dalla timeline"); },
      async () => { for (const sh of shots) await api.videoClearVerdict(sh); },
    );
    setSelection(new Set());
  }, [selectedShots, compi]);

  const selectionDuration = useCallback((bars: number) => {
    // `bars` is the length being SET; `atBars` are the bars it is set on. The
    // two were `bars` and `barre`, which the rename would have collapsed into
    // one name -- and the shorter one silently wins.
    const atBars = molti.map((i) => shownCuts[i]!.bar);
    if (!atBars.length) return;
    const before = new Map(atBars.map((b) => [b, forz?.duration.find((f) => f.bar === b)?.bars ?? null]));
    void compi(
      `${atBars.length} tagli: ${bars} battute`,
      async () => { for (const b of atBars) await api.videoDuration(b, bars); },
      async () => { for (const b of atBars) await api.videoDuration(b, before.get(b) ?? null); },
    );
  }, [molti, shownCuts, forz, compi]);

  const sel = picked !== null ? shownCuts[picked] ?? null : null;
  const active = shownCuts[cutIndex(shownCuts, t)] ?? null;
  const candidati = useMemo(
    () => (sel ? shots.filter((s) => s.kept && s.act === sel.act && s.id !== sel.shot) : []),
    [sel, shots],
  );

  /** The keyboard works on the page: you watch the video with your hands still
   *  on the keys and your eyes on the image, which is the only way to notice a
   *  cut that lands late. */
  useEffect(() => {
    const su = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select") || e.metaKey || e.ctrlKey) return;
      const v = video.current;
      if (!v) return;
      const i = cutIndex(cuts, t);
      const step = e.shiftKey ? 1 : 1 / FPS;
      const k = e.key;
      if (k === " ") { e.preventDefault(); setSpola(0); v.paused ? void v.play() : v.pause(); }
      else if (k === "ArrowLeft") { e.preventDefault(); setSpola(0); vaiA(t - step); }
      else if (k === "ArrowRight") { e.preventDefault(); setSpola(0); vaiA(t + step); }
      else if (k === "[") { e.preventDefault(); openCut(Math.max(0, i - 1)); }
      else if (k === "]") { e.preventDefault(); openCut(Math.min(cuts.length - 1, i + 1)); }
      else if (k === "Home") { e.preventDefault(); vaiA(0); }
      else if (k === "End") { e.preventDefault(); vaiA(duration - 1 / FPS); }
      else if (k === "f") { e.preventDefault(); void v.requestFullscreen?.().catch(() => {}); }
      else if (k === "i") { e.preventDefault(); setInOut([t, inOut?.[1] ?? duration]); }
      else if (k === "o") { e.preventDefault(); setInOut([inOut?.[0] ?? 0, t]); }
      else if (k === "r") { e.preventDefault(); setCiclo((c) => !c); }
      else if (k === "m") { e.preventDefault(); v.pause(); setAppunto({ t: v.currentTime, text: "" }); }
      else if (k === "?") { e.preventDefault(); setAiuto((a) => !a); }
      else if (k === "z") { e.preventDefault(); void cancel(); }
      else if (k === "Z") { e.preventDefault(); void redoLast(); }
      else if (k === "F") {
        e.preventDefault();
        const r = inOut ?? tratto ?? (active ? [active.t, active.t + active.dur] as [number, number] : null);
        if (r) setInquadra({ da: r[0], a: r[1], n: Date.now() });
      }
      else if (k === "a") {
        // The whole beat the playhead is in: it is the unit this cut thinks in,
        // and choosing it by hand means twenty clicks.
        e.preventDefault();
        const at = cuts[i]?.act;
        if (at) setSelection(new Set(cuts.map((c, n) => (c.act === at ? n : -1)).filter((n) => n >= 0)));
      }
      else if (k === "Backspace" || k === "Delete") {
        if (selection.size) { e.preventDefault(); discardSelection(); }
      }
      else if (k === "j" || k === "l") { e.preventDefault(); setSpola((v2) => shuttle(v2, k)); }
      else if (k === "k") { e.preventDefault(); setSpola(0); v.pause(); }
      else if (k === "Escape") { setPicked(null); setSelection(new Set()); setAiuto(false); setAppunto(null); }
    };
    window.addEventListener("keydown", su);
    return () => window.removeEventListener("keydown", su);
  }, [cuts, t, duration, vaiA, inOut, openCut, cancel, redoLast, tratto, active, selection, discardSelection]);

  const launch = async () => {
    try { await api.videoRicostruisci(); setRic(await api.videoRebuild()); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div ref={shell} className="flex flex-col text-neutral-200 overflow-hidden" style={{ height: shellHeight }}>
      {/* ---- barra ---- */}
      <div className="shrink-0 flex items-center gap-2.5 px-1 border-b border-neutral-900" style={{ height: H_GATE }}>
        <span className="tracking-[0.22em] text-[10.5px] text-neutral-400">MONTAGGIO</span>
        <Link to={`/p/${pid}/video/pick`} className="text-[11px] text-neutral-400 hover:text-neutral-200">scelta →</Link>
        <span className="text-[10.5px] text-neutral-400 tabular-nums">
          {cuts.length} tagli · {shots.length} piani{bpm ? ` · ${bpm.toFixed(1)} BPM` : ""} · {mmss(duration)}
        </span>
        <State gate={gate} master={assets?.master ?? null}
               onRedo={() => api.videoGate(true).then(setGate).catch(() => {})} />
        {ciclo && inOut && <span className="text-[10.5px] text-amber-400/80">↻ ciclo</span>}
        {spola !== 0 && (
          <span className="text-[10.5px] text-sky-300 tabular-nums">
            {spola > 0 ? "▶▶" : "◀◀"} {Math.abs(spola)}x
          </span>
        )}
        {!!redo.length && (
          <button onClick={() => void redoLast()}
                  title={`rifai: ${redo[redo.length - 1]?.what}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">
            rifai
          </button>
        )}
        {!!pila.length && (
          <button onClick={() => void cancel()}
                  title={`annulla: ${pila[pila.length - 1]?.what}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:text-neutral-100 hover:border-neutral-500">
            ⌫ {pila[pila.length - 1]?.what}
          </button>
        )}
        {!!overrideCount && (
          <button onClick={() => setVediForz((v) => !v)}
                  title="cose che hai deciso tu, che scavalcano il montaggio calcolato"
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-sky-800 text-sky-300
                             hover:bg-sky-950/50">
            {overrideCount} {overrideCount === 1 ? "tua scelta" : "tue scelte"}
            {ric?.active ? "" : " · da ricostruire"}
          </button>
        )}
        {!!held.length && (
          <span className="text-[10.5px] text-amber-400/90" title={held.map((s) => `batt ${s.bar}: ${s.guarantee}`).join(" · ")}>
            {held.length} garanzie sospese
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAiuto((a) => !a)} className="text-[10.5px] text-neutral-400 hover:text-neutral-200">tasti ?</button>
          <button onClick={launch} disabled={!!ric?.active}
                  className={`text-[10.5px] px-2 py-0.5 rounded-sm border ${
                    ric?.active ? "border-neutral-800 text-neutral-400" : "border-neutral-600 text-neutral-200 hover:bg-neutral-900"}`}>
            {ric?.active ? "ricostruisco…" : "ricostruisci"}
          </button>
        </div>
      </div>

      {/* ---- riga alta: libreria · monitor · ispettore ---- */}
      <div className="flex min-h-0" style={{ height: topHeight }}>
        <aside className="shrink-0 min-w-0" style={{ width: wSx }}>
          <Library shots={shots} inEdit={inEdit} setShots={setShots} open={openShot} />
        </aside>
        <Handle toward="col" value={wSx} title="larghezza della libreria"
                  compute={(v0, d) => Math.max(150, Math.min(460, v0 + d))}
                  onChange={setWSx} onEnd={save(KEY_LEFT)} />

        <main className="shrink-0 flex flex-col items-center justify-center px-2 py-1.5 gap-0 relative">
          {src ? (
            <video
              ref={(el) => { video.current = el; setVEl(el); }}
              src={pq(`/api/video/asset/${src}`)}
              playsInline loop preload="metadata"
              /* A video stopped at 0 is a black rectangle: the first frame is
                 night over the sea, so the page opened on a hole. Half a second
                 in, the metadata is loaded and the poster is a real frame. */
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
          <Transport v={vEl} t={t} duration={duration} cuts={cuts} vaiA={vaiA} />
          {active && (
            <div className="text-[10px] text-neutral-400 tabular-nums">
              {active.shot} · {active.dur.toFixed(2)}s · {active.velocita.toFixed(2)}x
              {active.rovescio ? " · rovescio" : ""}{active.act ? ` · ${active.act}` : ""}
            </div>
          )}

          {appunto && (
            <div className="absolute inset-x-6 bottom-4 border border-amber-900/70 bg-neutral-950 rounded-sm p-2">
              <div className="text-[10px] text-amber-400/80 tabular-nums mb-1">
                appunto a {mmss(appunto.t)} — f{Math.round(appunto.t * FPS)}
              </div>
              <Field
                autoFocus value={appunto.text}
                onChange={(v) => setAppunto({ ...appunto, text: v })}
                onEsc={() => setAppunto(null)}
                onInvio={async () => {
                  if (!appunto.text.trim()) return;
                  const r = await api.videoMarker(appunto.t, appunto.text.trim()).catch(() => null);
                  if (r) setMarkers(r.markers);
                  setAppunto(null);
                }}
                placeholder="cosa non va — invio per segnarlo, esc per lasciar perdere"
                className="w-full text-[11.5px]"
              />
            </div>
          )}
        </main>

        <Handle toward="col" value={wDx} title="larghezza dell'ispettore"
                  compute={(v0, d) => Math.max(240, Math.min(720, v0 - d))}
                  onChange={setWDx} onEnd={save(KEY_RIGHT)} />
        <aside className="flex-1 min-w-0 overflow-y-auto" style={{ minWidth: Math.min(wDx, 720) }}>
          {molti.length > 1 ? (
            <div className="p-2.5 space-y-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-neutral-100">{molti.length} tagli scelti</span>
                <button onClick={() => setSelection(new Set())}
                        className="ml-auto text-[10.5px] text-neutral-400 hover:text-neutral-100">
                  lascia
                </button>
              </div>
              {tratto && (
                <div className="text-[11px] text-neutral-400">
                  da {timecode(tratto[0])} a {timecode(tratto[1])} · {(tratto[1] - tratto[0]).toFixed(1)}s ·{" "}
                  {selectedShots.length} {selectedShots.length === 1 ? "ripresa" : "riprese"}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {tratto && (
                  <Bott onClick={() => setInquadra({ da: tratto[0], a: tratto[1], n: Date.now() })}>
                    guarda da vicino
                  </Bott>
                )}
                {tratto && <Bott onClick={() => setInOut(tratto)}>segna il tratto</Bott>}
                <Bott weight="pericolo" onClick={discardSelection}>
                  scarta {selectedShots.length === 1 ? "la ripresa" : `le ${selectedShots.length} riprese`}
                </Bott>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] text-neutral-400">durata di tutti:</span>
                {[0.5, 1, 2, 4].map((b) => (
                  <Bott key={b} onClick={() => selectionDuration(b)}>{b}</Bott>
                ))}
                <span className="text-[10.5px] text-neutral-400">battute</span>
              </div>
              <div className="border-t border-neutral-900 pt-2 space-y-0.5">
                {molti.map((i) => {
                  const c = shownCuts[i]!;
                  return (
                    <button key={i} onClick={() => openCut(i)}
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
            <Ispettore sel={sel} shots={shots} candidati={candidati} close={() => setPicked(null)}
                       onForzato={readOverrides} />
          ) : (
            <div className="p-2.5 space-y-2.5">
              <div className="text-[11px] text-neutral-400 leading-relaxed">
                clicca un taglio sulla timeline per vedere perché sta lì — e per metterne un
                altro al suo posto, allungarlo o toglierlo.
              </div>
              {!!markers.length && (
                <div>
                  <div className="text-[10px] text-neutral-400 mb-1">appunti</div>
                  <div className="space-y-1">
                    {markers.map((m) => (
                      <div key={m.t} className="flex items-start gap-1.5 text-[11px]">
                        <button onClick={() => vaiA(m.t, true)} className="text-amber-500/70 tabular-nums shrink-0 hover:text-amber-300">
                          {mmss(m.t)}
                        </button>
                        <span className="text-neutral-400 leading-tight">{m.note}</span>
                        <button onClick={() => void api.videoMarker(m.t, null).then((r) => setMarkers(r.markers))}
                                className="ml-auto text-neutral-400 hover:text-neutral-300">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ric && (ric.active || ric.finita) && (
                <div>
                  <div className="text-[10px] text-neutral-400 mb-1">
                    ricostruzione {ric.output !== null && `(uscita ${ric.output})`}
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
      <Handle toward="row" value={hTimeline} title="quanto spazio prende la timeline"
                compute={(v0, d) => timelineLimit(v0 - d)}
                onChange={setHTimeline} onEnd={save(KEY_HEIGHT)} />

      {/* ---- timeline ---- */}
      <div className="shrink-0 min-h-0" style={{ height: hTimeline }}>
        <Timeline
          cuts={shownCuts} acts={acts} wave={wave} duration={duration} t={t}
          poster={poster} picked={picked} selection={selection} inquadra={inquadra}
          inOut={inOut} setInOut={setInOut}
          gira={gira} vaiA={vaiA} markers={markers}
          removeMarker={(m) => { void api.videoMarker(m, null).then((r) => setMarkers(r.markers)); }}
          open={openCut}
          inchiodate={new Set((forz?.pin ?? []).map((f) => f.bar))}
          onSwap={swap} onDuration={changeDuration} onPose={pose}
          forcedDuration={forcedDuration}
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

            {!overrideCount && (
              <div className="text-[11px] text-neutral-400">
                Non hai ancora scavalcato niente: il montaggio è tutto calcolato.
              </div>
            )}

            {forz?.pin.map((f) => (
              <div key={`p${f.bar}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-sky-300 w-28 shrink-0">ripresa scelta</span>
                <span className="text-neutral-100">{f.shot}</span>
                <span className="text-neutral-400">sulla battuta {f.bar}</span>
                <button onClick={async () => { await api.videoPin(f.bar, null); readOverrides(); }}
                        className="ml-auto px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  togli
                </button>
              </div>
            ))}
            {forz?.duration.map((f) => (
              <div key={`d${f.bar}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-sky-300 w-28 shrink-0">durata cambiata</span>
                <span className="text-neutral-400">
                  battuta {f.bar}: {f.bars} {f.bars === 1 ? "battuta" : "battute"}
                </span>
                <button onClick={async () => { await api.videoDuration(f.bar, null); readOverrides(); }}
                        className="ml-auto px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  togli
                </button>
              </div>
            ))}
            {forz?.discardedByHand.map((f) => (
              <div key={`s${f.shot}`} className="flex items-center gap-2 py-1 border-t border-neutral-900 text-[11px]">
                <span className="text-rose-300 w-28 shrink-0">ripresa scartata</span>
                <span className="text-neutral-100">{f.shot}</span>
                <span className="text-neutral-400 truncate">{f.reason}</span>
                <button onClick={async () => {
                          setShots((await api.videoPick(f.shot, true)).shots); readOverrides();
                        }}
                        className="ml-auto shrink-0 px-1.5 py-0.5 rounded-sm border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  rimetti
                </button>
              </div>
            ))}

            {!!redo.length && (
          <button onClick={() => void redoLast()}
                  title={`rifai: ${redo[redo.length - 1]?.what}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:border-neutral-500 hover:text-neutral-100">
            rifai
          </button>
        )}
        {!!pila.length && (
          <button onClick={() => void cancel()}
                  title={`annulla: ${pila[pila.length - 1]?.what}`}
                  className="text-[10.5px] px-1.5 py-0.5 rounded-sm border border-neutral-700
                             text-neutral-300 hover:text-neutral-100 hover:border-neutral-500">
            ⌫ {pila[pila.length - 1]?.what}
          </button>
        )}
        {!!overrideCount && (
              <div className="mt-3 flex items-center gap-2">
                <Bott weight="primario" onClick={() => { setVediForz(false); void launch(); }}
                      disabled={!!ric?.active}>
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
