import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pq, type VideoAct, type VideoCut, type VideoMarker, type VideoWave } from "../../api";
import { laneHeights, tickStep, timecode, H_RULER, H_ACTS } from "./time";

/**
 * The timeline.
 *
 * Five lanes on the same horizontal scale — ruler, beats, sound, cuts, frames —
 * and a fixed column on the left saying what each one is. That they share the
 * scale is not a graphical detail: it is the only way to see that the cut at
 * 2:18 lands on the beat and not two frames after.
 *
 * The lanes have no fixed heights: they share out the space the panel has.
 * Pulling the divider up, the timeline grows and the waveform, the blocks and
 * the frames grow with it — which is why you enlarge it in the first place.
 *
 * The horizontal zoom exists for the same reason as the height: over two and a
 * half minutes in a thousand pixels a frame is a twentieth of a pixel, and at
 * that scale "the cut lands late" is not something you can look at.
 */

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const FPS = 24;


type Props = {
  cuts: VideoCut[];
  acts: VideoAct[];
  wave: VideoWave | null;
  duration: number;
  t: number;
  poster: Map<string, string>;
  picked: number | null;
  /** I tagli selezionati insieme: ⇧clic estende, ⌘clic aggiunge. */
  selection: Set<number>;
  /** Inquadra un tratto: cambia insieme zoom e scorrimento. */
  inquadra: { da: number; a: number; n: number } | null;
  inOut: [number, number] | null;
  setInOut: (v: [number, number] | null) => void;
  open: (i: number, mod?: { estendi?: boolean; add?: boolean }) => void;
  vaiA: (s: number, parts?: boolean) => void;
  gira: boolean;
  markers: VideoMarker[];
  removeMarker: (t: number) => void;
  /** The beats pinned by hand: visible without opening the inspector. */
  inchiodate: Set<number>;
  /** Dragging a block over another: the two swap places. */
  onSwap: (i: number, j: number) => void;
  /** Tirare il bordo destro di un blocco: quante battute dura. */
  onDuration: (bar: number, bars: number) => void;
  /** Un piano lasciato cadere sopra un taglio dalla libreria. */
  onPose: (i: number, shot: string) => void;
  /** Durations declared but not yet rebuilt: beat -> beats. */
  forcedDuration: Map<number, number>;
};

export default function Timeline(p: Props) {
  const { cuts, acts, wave, duration, t, poster, picked, selection, inquadra, inOut, open, vaiA, gira, markers, removeMarker, inchiodate, onSwap, onDuration, onPose, forcedDuration } = p;
  const [zoom, setZoom] = useState(0);           // 0 = everything in view
  const [above, setAbove] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(1000);
  /** The height is measured on the real body, not passed in as a number.
   *  Subtracting the toolbar's height by hand means getting it wrong by a few
   *  pixels on every font change, and the bottom lane stays cut off. */
  const [height, setHeight] = useState(220);
  /** Where the window sits on the track. It is read by scrolling, not guessed:
   *  it is what the overview map draws as a rectangle. */
  const [scroll, setScroll] = useState(0);

  useEffect(() => {
    const el = scroller.current, c = body.current;
    if (!el || !c) return;
    const measure = () => { setViewWidth(el.clientWidth); setHeight(c.clientHeight); };
    const ro = new ResizeObserver(measure);
    ro.observe(el); ro.observe(c);
    measure();
    return () => ro.disconnect();
  }, []);

  /** The free space is split between sound, cuts and frames. If the panel is
   *  narrow they go down to their minimums and the timeline scrolls
   *  vertically, instead of squashing everything until it is unreadable. */
  const lanes = useMemo(() => laneHeights(height), [height]);

  const base = duration ? viewWidth / duration : 1;
  const pps = zoom === 0 ? base : base * Math.pow(2, zoom);
  const width = Math.max(viewWidth, duration * pps);
  const x = useCallback((s: number) => s * pps, [pps]);

  /** The view chases the playhead only while the video is running: stopped,
   *  every click on a cut would make the timeline jump under your finger. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !gira || zoom === 0) return;
    const px = x(t);
    const m = el.clientWidth * 0.15;
    if (px < el.scrollLeft + m || px > el.scrollLeft + el.clientWidth - m) {
      el.scrollLeft = px - el.clientWidth / 2;
    }
  }, [t, gira, zoom, x]);

  /** While zooming, the point under the cursor stays where it is: zooming in
   *  and then having to find the point again is like not having zoomed. */
  const zoomBy = (toward: number, anchorPx?: number) => {
    const el = scroller.current;
    const anc = anchorPx ?? (el ? el.clientWidth / 2 : 0);
    const secondsUnderAnchor = el ? (el.scrollLeft + anc) / pps : 0;
    setZoom((z) => {
      const nz = Math.max(0, Math.min(8, (z || (toward > 0 ? 0 : 1)) + toward));
      requestAnimationFrame(() => {
        const e2 = scroller.current;
        if (!e2 || !duration) return;
        const p2 = nz === 0 ? e2.clientWidth / duration : (e2.clientWidth / duration) * Math.pow(2, nz);
        e2.scrollLeft = secondsUnderAnchor * p2 - anc;
      });
      return nz;
    });
  };

  /**
   * Framing a stretch.
   *
   * Zoom and scroll are not two separate gestures when you want to look closely
   * at a precise piece: you pick the factor that fits the stretch in the window
   * and you go there. The zoom here is not in power steps — you stop where you
   * need to, not at the nearest notch.
   */
  const fit = useCallback((da: number, a: number) => {
    const el = scroller.current;
    if (!el || !duration || a <= da) return;
    const w = el.clientWidth;
    const b = w / duration;
    const z = Math.max(0, Math.min(8, Math.log2((w * 0.92) / (a - da) / b)));
    setZoom(z);
    requestAnimationFrame(() => {
      const e2 = scroller.current;
      if (!e2) return;
      const p2 = z === 0 ? b : b * Math.pow(2, z);
      e2.scrollLeft = Math.max(0, (da + (a - da) / 2) * p2 - e2.clientWidth / 2);
    });
  }, [duration]);

  useEffect(() => {
    if (inquadra) fit(inquadra.da, inquadra.a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquadra?.n]);

  const position = (e: { clientX: number; currentTarget: EventTarget | null }) => {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (e.clientX - box.left) / pps));
  };

  const search = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const box = el.getBoundingClientRect();
    const where = (cx: number) => vaiA(Math.max(0, Math.min(duration, (cx - box.left) / pps)));
    where(e.clientX);
    const move = (ev: PointerEvent) => where(ev.clientX);
    const su = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", su); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", su);
  };

  /** The ticks thin out by themselves: at full scale one every ten seconds,
   *  close up one a second. Without that they are either unreadable or
   *  useless. */
  const step = useMemo(() => tickStep(pps), [pps]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= duration; s += step) out.push(Math.round(s * 100) / 100);
    return out;
  }, [duration, step]);

  const onde = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = onde.current;
    if (!c || !wave?.peaks.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.min(width, 16000);
    const H = lanes.suono;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const n = wave.peaks.length;
    g.fillStyle = "#4b6b80";
    for (let i = 0; i < W; i++) {
      const k = Math.floor((i / W) * n);
      const h = (wave.peaks[k] ?? 0) * (H - 4);
      g.fillRect(i, (H - h) / 2, 1, Math.max(1, h));
    }
  }, [wave, width, lanes.suono]);

  /**
   * Dragging.
   *
   * Two gestures, because two are what this cut admits: taking a block to
   * another's place — the cuts sit on measured beats and each beat holds one,
   * so "a bit further along" would mean nothing — and pulling the right edge to
   * lengthen it. Both write a declared forcing, which shows up in the list and
   * is undone with ⌘Z. The plan stays derived: what changes is written down,
   * not hidden.
   */
  const [trascino, setTrascino] = useState<
    { kind: "move"; da: number; a: number | null } |
    { kind: "stretch"; i: number; bars: number } | null
  >(null);

  /** How many beats a cut lasts right now: the distance to the next cut's
   *  beat, or the one the plan declares for the last. */
  const barsOf = useCallback((i: number) => {
    const c = cuts[i], d = cuts[i + 1];
    if (!c) return 1;
    if (d) return Math.round((d.bar - c.bar) * 2) / 2;
    return Math.max(0.5, Math.round((c.dur / (cuts[1] ? (cuts[1].t - cuts[0]!.t) : c.dur)) * 2) / 2);
  }, [cuts]);

  const which = useCallback((cx: number, box: DOMRect) => {
    const t2 = (cx - box.left) / pps;
    let r: number | null = null;
    cuts.forEach((c, i) => { if (t2 >= c.t && t2 < c.t + c.dur) r = i; });
    return r;
  }, [cuts, pps]);

  const startDrag = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const lane = (e.currentTarget as HTMLElement).parentElement;
    if (!lane) return;
    const box = lane.getBoundingClientRect();
    const x0 = e.clientX;
    // A threshold, because a pressing finger is never still: without it a
    // click that slipped by one pixel became a swap, and the cut changed
    // because of a tremor. Under six pixels it stays a click.
    const SOGLIA = 6;
    let mosso = false;
    const move = (ev: PointerEvent) => {
      if (!mosso && Math.abs(ev.clientX - x0) < SOGLIA) return;
      mosso = true;
      setTrascino({ kind: "move", da: i, a: which(ev.clientX, box) });
    };
    const su = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", su);
      setTrascino(null);
      if (!mosso) { open(i, { estendi: ev.shiftKey, add: ev.metaKey || ev.ctrlKey }); return; }
      const a = which(ev.clientX, box);
      if (a === null || a === i) return;
      onSwap(i, a);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", su);
  };

  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const c = cuts[i];
    if (!c) return;
    const gateSeconds = c.dur / Math.max(0.5, barsOf(i));   // seconds per beat, here
    const x0 = e.clientX, b0 = barsOf(i);
    let mosso = false;
    const move = (ev: PointerEvent) => {
      // Same threshold as the move handle, same reason.
      if (!mosso && Math.abs(ev.clientX - x0) < 6) return;
      mosso = true;
      const db = (ev.clientX - x0) / pps / gateSeconds;
      // Half a beat is the plan's step: between one and the next there is
      // nothing the cut can represent.
      const b = Math.max(0.5, Math.min(4, Math.round((b0 + db) * 2) / 2));
      setTrascino({ kind: "stretch", i, bars: b });
    };
    const su = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", su);
      setTrascino((t2) => {
        if (mosso && t2?.kind === "stretch" && t2.bars !== b0) onDuration(c.bar, t2.bars);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", su);
  };

  /** The stretch of track in the window right now. */
  const viewport = useMemo(
    () => ({ da: scroll / pps, a: (scroll + viewWidth) / pps }),
    [scroll, viewWidth, pps],
  );

  const viewPort = (e: React.PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const vai = (cx: number) => {
      const el = scroller.current;
      if (!el || !duration) return;
      const sec = Math.max(0, Math.min(duration, ((cx - box.left) / box.width) * duration));
      el.scrollLeft = Math.max(0, sec * pps - el.clientWidth / 2);
    };
    vai(e.clientX);
    const move = (ev: PointerEvent) => vai(ev.clientX);
    const su = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", su); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", su);
  };

  const B = "px-1.5 py-0.5 rounded-sm border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600";
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] shrink-0 border-b border-neutral-900">
        <span className="text-neutral-400">tempo</span>
        <button className={B} onClick={() => setZoom(0)}>tutto</button>
        <button className={B} onClick={() => zoomBy(-1)}>−</button>
        <button className={B} onClick={() => zoomBy(+1)}>+</button>
        <span className="text-neutral-400 tabular-nums w-11">{zoom === 0 ? "tutto" : `${Math.pow(2, zoom).toFixed(Math.pow(2, zoom) < 10 ? 1 : 0)}x`}</span>
        <span className="w-px h-3 bg-neutral-800 mx-0.5" />
        <button className={B} title="segna l'inizio del tratto  i" onClick={() => p.setInOut([t, inOut?.[1] ?? duration])}>in</button>
        <button className={B} title="segna la fine  o" onClick={() => p.setInOut([inOut?.[0] ?? 0, t])}>out</button>
        {inOut && (
          <>
            <button className={`${B} text-amber-400/80`} title="inquadra il tratto  ⇧F"
                    onClick={() => fit(inOut[0], inOut[1])}>
              {mmss(inOut[0])}–{mmss(inOut[1])}
            </button>
            <button className={`${B} text-amber-400/80`} title="togli il tratto"
                    onClick={() => p.setInOut(null)}>×</button>
          </>
        )}
        {trascino?.kind === "move" && trascino.a !== null && trascino.a !== trascino.da && (
          <span className="text-sky-300">
            {cuts[trascino.da]?.shot} ⇄ {cuts[trascino.a]?.shot}
          </span>
        )}
        {trascino?.kind === "stretch" && (
          <span className="text-sky-300">{cuts[trascino.i]?.shot}: {trascino.bars} battute</span>
        )}
        <span className="ml-auto text-neutral-400 tabular-nums">
          <span className="text-neutral-100">{timecode(above ?? t)}</span>
          {above !== null && <span className="text-neutral-400"> (sotto il dito)</span>}
        </span>
      </div>


      {/* La mappa d'insieme.
          Da vicino la finestra vede pochi secondi su due minuti e mezzo: senza
          una vista intera non si sa piu' dove si e' ne' quanto manca, e ci si
          muove a tentoni con la barra di scorrimento. Il rettangolo chiaro e'
          la finestra: si trascina, e la timeline la segue. */}
      {zoom > 0 && (
        <div className="flex shrink-0 border-b border-neutral-900">
          <div className="shrink-0 w-[68px] border-r border-neutral-900 px-1.5
                          text-[9px] text-neutral-400 leading-[18px] select-none">
            tutto
          </div>
          <div data-mappa title="tutto il brano: il rettangolo chiaro e' la finestra, trascinalo"
               className="relative flex-1 min-w-0 h-[18px] bg-black/60 cursor-pointer select-none"
               onPointerDown={viewPort}>
            {acts.map((a, i) => (
              <div key={`a${i}`} className="absolute inset-y-0 border-r border-neutral-800 pointer-events-none"
                   style={{ left: `${(a.t0 / duration) * 100}%`, width: `${((a.t1 - a.t0) / duration) * 100}%` }} />
            ))}
            {cuts.map((c, i) => (
              <div key={i} className="absolute bottom-0 pointer-events-none"
                   style={{
                     left: `${(c.t / duration) * 100}%`,
                     width: `${Math.max(0.12, (c.dur / duration) * 100)}%`,
                     height: `${25 + c.soundIntensity * 75}%`,
                     background: selection.has(i) ? "#e8974a" : c.rovescio ? "#8a5a3a" : "#3f6076",
                   }} />
            ))}
            {markers.map((m) => (
              <div key={m.t} className="absolute top-0 w-[3px] h-[3px] bg-amber-400 -ml-[1px] pointer-events-none"
                   style={{ left: `${(m.t / duration) * 100}%` }} />
            ))}
            <div className="absolute inset-y-0 w-px bg-orange-400 pointer-events-none z-10"
                 style={{ left: `${(t / duration) * 100}%` }} />
            <div className="absolute inset-y-0 border border-neutral-300/70 bg-neutral-100/10 pointer-events-none"
                 style={{
                   left: `${(viewport.da / duration) * 100}%`,
                   width: `${Math.max(0.6, ((viewport.a - viewport.da) / duration) * 100)}%`,
                 }} />
          </div>
        </div>
      )}
      <div ref={body} className="flex flex-1 min-h-0 overflow-y-auto">
        {/* La colonna dei nomi resta ferma: a 128x sotto passa un secondo di
            brano, e senza il nome la corsia e' una riga di grigio. */}
        <div className="shrink-0 w-[68px] border-r border-neutral-900 text-[9.5px] text-neutral-400 select-none">
          <div style={{ height: H_RULER }} className="border-b border-neutral-900 px-1.5 leading-[20px]">
            tempo <span className="text-amber-500/70">◆</span>
          </div>
          <div style={{ height: H_ACTS }} className="border-b border-neutral-900 px-1.5 leading-4">atti</div>
          <div style={{ height: lanes.suono }} className="border-b border-neutral-900 px-1.5 pt-0.5 leading-tight">
            suono<br /><span className="text-neutral-400">onda · battute</span>
          </div>
          <div style={{ height: lanes.cuts }} className="border-b border-neutral-900 px-1.5 pt-0.5 leading-tight">
            tagli<br /><span className="text-neutral-400">alt. = durezza</span>
          </div>
          <div style={{ height: lanes.quadri }} className="px-1.5 pt-0.5 leading-tight">
            quadri<br /><span className="text-neutral-400">un piano</span>
          </div>
        </div>

        <div
          ref={scroller}
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
          onScroll={(e) => setScroll((e.currentTarget as HTMLElement).scrollLeft)}
          onWheel={(e) => {
            if (!e.altKey) return;
            e.preventDefault();
            const box = e.currentTarget.getBoundingClientRect();
            zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - box.left);
          }}
          onPointerLeave={() => setAbove(null)}>
          <div className="relative select-none" style={{ width: width }}
               onPointerMove={(e) => setAbove(position(e))}>

            {/* righello e marcatori */}
            <div style={{ height: H_RULER }}
                 className="relative border-b border-neutral-900 cursor-text" onPointerDown={search}>
              {markers.map((m) => (
                <button key={m.t}
                        title={`${mmss(m.t)} — ${m.note}   (clic per andarci · ⇧clic per togliere)`}
                        onClick={(e) => { e.stopPropagation(); if (e.shiftKey) removeMarker(m.t); else vaiA(m.t, true); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="absolute top-[2px] z-30 w-[8px] h-[8px] bg-amber-400 rotate-45 -ml-[4px] hover:bg-amber-200"
                        style={{ left: x(m.t) }} />
              ))}
              {ticks.map((s) => (
                <div key={s} className="absolute top-0 bottom-0 border-l border-neutral-800/70 pl-1
                                        text-[9px] text-neutral-400 tabular-nums leading-5 pointer-events-none"
                     style={{ left: x(s) }}>
                  {mmss(s)}
                </div>
              ))}
            </div>

            {/* atti */}
            <div style={{ height: H_ACTS }} className="relative border-b border-neutral-900">
              {acts.map((a, i) => (
                <button key={i} onClick={() => vaiA(a.t0, true)}
                        title={`atto ${a.name} · batt ${a.da}–${a.a}`}
                        className="absolute inset-y-0 border-r border-black/70 bg-neutral-900/80
                                   text-[9px] text-neutral-400 hover:text-neutral-100 overflow-hidden
                                   text-left leading-4"
                        style={{ left: x(a.t0), width: Math.max(2, x(a.t1 - a.t0)) }}>
                  {/* Da vicino un atto e' largo quanto dieci schermi: il nome
                      scritto al suo inizio e' fuori vista quasi sempre, e la
                      corsia sembra vuota. Il nome scorre con la finestra e si
                      ferma al bordo dell'atto. */}
                  <span className="inline-block px-1 whitespace-nowrap"
                        style={{
                          transform: `translateX(${Math.max(
                            0,
                            Math.min(scroll - x(a.t0), x(a.t1 - a.t0) - 46),
                          )}px)`,
                        }}>
                    {a.name}
                  </span>
                </button>
              ))}
            </div>

            {/* suono */}
            <div style={{ height: lanes.suono }}
                 className="relative border-b border-neutral-900 cursor-text" onPointerDown={search}>
              <canvas ref={onde} className="absolute inset-y-0 left-0 pointer-events-none" />
              {pps > 12 && wave?.beats.map((b, i) => (
                <div key={i} className="absolute inset-y-0 w-px bg-neutral-700/40 pointer-events-none" style={{ left: x(b) }} />
              ))}
              {wave?.bars.map((b, i) => (
                <div key={`m${i}`} className="absolute inset-y-0 w-px bg-neutral-500/50 pointer-events-none" style={{ left: x(b) }} />
              ))}
              {!wave?.ready && (
                <div className="absolute inset-0 grid place-items-center text-[10px] text-neutral-400">
                  calcolo la forma d'onda…
                </div>
              )}
            </div>

            {/* tagli */}
            <div style={{ height: lanes.cuts }}
                 className="relative border-b border-neutral-900 bg-black/40"
                 onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                 onDrop={(e) => {
                   e.preventDefault();
                   const shot = e.dataTransfer.getData("text/darkroom-piano");
                   const i = which(e.clientX, e.currentTarget.getBoundingClientRect());
                   if (shot && i !== null) onPose(i, shot);
                 }}>
              {cuts.map((c, i) => {
                const sposto = trascino?.kind === "move" && trascino.da === i;
                const bersaglio = trascino?.kind === "move" && trascino.a === i && trascino.da !== i;
                const wide = trascino?.kind === "stretch" && trascino.i === i
                  ? Math.max(1, x(c.dur * (trascino.bars / Math.max(0.5, barsOf(i)))))
                  : Math.max(1, x(c.dur));
                return (
                  <div key={i}
                       onPointerDown={startDrag(i)}
                       title={`${c.shot} · ${mmss(c.t)} · ${c.dur.toFixed(2)}s · ${c.velocita.toFixed(2)}x
trascina per scambiarlo · tira il bordo destro per la durata`}
                       className={`absolute bottom-0 border-r border-black/60 cursor-grab active:cursor-grabbing
                                   ${sposto ? "opacity-40" : "hover:brightness-150"}
                                   ${bersaglio ? "outline outline-2 -outline-offset-2 outline-sky-400 z-20" : ""}
                                   ${picked === i && !bersaglio ? "outline outline-1 -outline-offset-1 outline-orange-400 z-10" : ""}
                                   ${selection.has(i) && picked !== i && !bersaglio ? "outline outline-1 -outline-offset-1 outline-orange-300/70 z-10" : ""}`}
                       style={{
                         left: x(c.t), width: wide,
                         height: `${18 + c.soundIntensity * 82}%`,
                         background: c.rovescio ? "#8a5a3a" : "#3f6076",
                       }}>
                    {/* La maniglia della durata. Larga sei pixel: piu' stretta
                        e non si prende, piu' larga e si rubano i clic al blocco. */}
                    <div onPointerDown={startResize(i)}
                         title="quante battute dura"
                         className="absolute inset-y-0 right-0 w-[6px] cursor-col-resize
                                    hover:bg-sky-300/70 active:bg-sky-300" />
                  </div>
                );
              })}
              {cuts.map((c, i) => c.shotIntensity === null ? null : (
                <div key={`p${i}`} className="absolute h-[2px] bg-[#c9a227]/80 pointer-events-none"
                     style={{ left: x(c.t), width: Math.max(1, x(c.dur)), bottom: `${18 + c.shotIntensity * 82}%` }} />
              ))}
              {pps > 34 && cuts.map((c, i) => (
                <div key={`n${i}`} className="absolute top-0 px-1 pointer-events-none truncate leading-[13px]"
                     style={{ left: x(c.t), width: Math.max(1, x(c.dur)) }}>
                  {/* Il blocco arriva fin quassu' quando il suono e' duro: senza
                      un fondo, il nome sparisce proprio sui tagli che contano. */}
                  <span className="text-[9px] text-neutral-100 bg-black/65 rounded-sm px-1">{c.shot}</span>
                </div>
              ))}
              {/* La durata dichiarata non si puo' mostrare spostando i blocchi
                  dopo — sarebbe un montaggio che non esiste — quindi si dice. */}
              {cuts.map((c, i) => (forcedDuration.has(c.bar) ? (
                <div key={`dd${i}`} title={`durata dichiarata: ${forcedDuration.get(c.bar)} battute`}
                     className="absolute bottom-0 text-[8.5px] text-sky-200 bg-sky-900/80 px-1 rounded-sm
                                pointer-events-none leading-tight"
                     style={{ left: x(c.t) + 1 }}>
                  →{forcedDuration.get(c.bar)}
                </div>
              ) : null))}
              {/* Una battuta forzata a mano non e' piu' derivata: si vede da
                  qui, senza dover aprire il taglio per scoprirlo. */}
              {cuts.filter((c) => inchiodate.has(c.bar)).map((c, i) => (
                <div key={`f${i}`} title="battuta inchiodata a mano"
                     className="absolute top-0 h-[3px] bg-sky-400 pointer-events-none"
                     style={{ left: x(c.t), width: Math.max(2, x(c.dur)) }} />
              ))}
            </div>

            {/* quadri */}
            <div style={{ height: lanes.quadri }} className="relative">
              {cuts.map((c, i) => {
                const src = poster.get(c.shot);
                return (
                  <button key={i}
                          onClick={(e) => open(i, { estendi: e.shiftKey, add: e.metaKey || e.ctrlKey })}
                          title={`${c.shot} · ${mmss(c.t)}`}
                          className={`absolute inset-y-0 border-r border-black/70 bg-cover bg-center ${
                            picked === i ? "outline outline-1 -outline-offset-1 outline-orange-400 z-10"
                            : selection.has(i) ? "outline outline-1 -outline-offset-1 outline-orange-300/70 z-10"
                            : "opacity-80 hover:opacity-100"}`}
                          style={{
                            left: x(c.t), width: Math.max(1, x(c.dur)),
                            backgroundImage: src ? `url(${pq(src)})` : undefined,
                            backgroundColor: src ? undefined : "#111",
                          }} />
                );
              })}
            </div>

            {/* il tratto scelto */}
            {inOut && (
              <>
                <div className="absolute top-0 bottom-0 bg-black/55 pointer-events-none" style={{ left: 0, width: x(inOut[0]) }} />
                <div className="absolute top-0 bottom-0 bg-black/55 pointer-events-none"
                     style={{ left: x(inOut[1]), width: Math.max(0, width - x(inOut[1])) }} />
                <div className="absolute top-0 bottom-0 border-x border-amber-500/70 pointer-events-none"
                     style={{ left: x(inOut[0]), width: Math.max(1, x(inOut[1] - inOut[0])) }} />
              </>
            )}

            {/* Dove va a finire il gesto.
                Un blocco che si allunga si ferma sulla mezza battuta piu'
                vicina: se il punto d'arrivo non si vede, si tira alla cieca e
                si scopre dov'e' andato solo lasciando. */}
            {trascino?.kind === "stretch" && cuts[trascino.i] && (
              <div className="absolute top-0 bottom-0 w-px bg-sky-300 pointer-events-none z-30"
                   style={{
                     left: x(cuts[trascino.i]!.t)
                       + x(cuts[trascino.i]!.dur * (trascino.bars / Math.max(0.5, barsOf(trascino.i)))),
                   }}>
                <div className="absolute top-0 left-1 text-[9px] text-sky-200 bg-sky-950/90 px-1 rounded-sm leading-4
                                whitespace-nowrap">
                  {trascino.bars} {trascino.bars === 1 ? "battuta" : "battute"}
                </div>
              </div>
            )}
            {trascino?.kind === "move" && trascino.a !== null && cuts[trascino.a] && (
              <div className="absolute top-0 bottom-0 w-px bg-sky-300 pointer-events-none z-30"
                   style={{ left: x(cuts[trascino.a]!.t) }} />
            )}

            {/* dove passa il dito, prima di premere */}
            {above !== null && (
              <div className="absolute top-0 bottom-0 w-px bg-neutral-500/40 pointer-events-none z-10"
                   style={{ left: x(above) }} />
            )}

            {/* dove sei */}
            <div className="absolute top-0 bottom-0 w-px bg-orange-400 pointer-events-none z-20" style={{ left: x(t) }}>
              <div className="absolute -top-[2px] -left-[3.5px] w-[8px] h-[8px] bg-orange-400 rotate-45" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
