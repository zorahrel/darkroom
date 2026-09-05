import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { api, pq, type VideoShot, type VideoJob, type VideoAct, type VideoCut } from "../api";
import { Area, NumberField, Choose } from "./video/ui";
import { Shortcut, VerdictButton } from "../ui";
import { leavesQueue, type PickFilter } from "../videoQueue";

import type { OutletCtx } from "../App";

/** Width of the clip in Pick mode, in pixels. It is dragged, and it survives
 *  between sessions: someone judging at speed does not want to find the
 *  default size again every time they reopen it.
 *
 *  `null` does not mean "no size": it means AS MUCH AS FITS — the clip takes
 *  all the height available and stops where that ends. It is the starting
 *  value because a fixed size (it was 300px) leaves half a column empty on a
 *  big screen and overflows on a small one, i.e. it is always wrong somewhere.
 *  There is a number only once somebody has dragged. */
const KEY_WIDTH = "darkroom.scelta.larghezzaClip";

/**
 * Judging the shots, one at a time.
 *
 * The grid is for browsing, this is for deciding, and the two want different
 * layouts. In the grid two 9:16 verticals inside one tile are ~80px each: at
 * that size the defects that matter are invisible — the white hole on the back
 * of `g_scal1` got through twice before anybody opened that shot on its own.
 *
 * Judgement is the one thing in the chain no measurement can supply. Three were
 * tried (tonal balance, detail area, silhouette jump) and none separates a
 * figure that dissolves from one walking into a wave: the index of `d02`, which
 * visibly falls apart, sits in the middle of the pack.
 */

/** A shot is a TAKE, not a file: `z43_0` and `z43_1` are two halves of the
 *  same generation, and judging them apart is why the cut looked full of
 *  duplicates despite having 122 different names. */
type Scene = {
  origin: string;
  pieces: VideoShot[];
  act: string | null;
  minute: number | null;
  inEdit: number;
  kept: boolean;
  /** The verdict given, if any. `null` means never looked at — which is not
   *  the same as "kept": keeping is the starting state. */
  verdict: "tenuta" | "scartata" | null;
  judgedAt: number | null;
  annotated: boolean;
  /** Why to watch it first. Not a verdict: a reading order. */
  suspect: string | null;
  /** Every time it enters the cut. A total in seconds does not say whether it
   *  is one block or three scattered flashes, and those judge differently. */
  appearances: { t: number; dur: number; act: string | null }[];
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function group(shots: VideoShot[]): Scene[] {
  const per = new Map<string, VideoShot[]>();
  for (const s of shots) per.set(s.origin, [...(per.get(s.origin) ?? []), s]);
  return [...per.entries()]
    .map(([origin, pieces]) => {
      const inM = pieces.filter((p) => p.minute !== null);
      return {
        origin,
        pieces: pieces.sort((a, b) => a.id.localeCompare(b.id)),
        act: inM[0]?.act ?? null,
        minute: inM.length ? Math.min(...inM.map((p) => p.minute!)) : null,
        inEdit: pieces.reduce((n, p) => n + p.inEdit, 0),
        // A take is "kept" if at least one piece is.
        kept: pieces.some((p) => p.kept),
        // The take's verdict: one discarded piece is enough to make it so, and
        // it takes at least one explicit yes to count as approved.
        verdict: (pieces.some((p) => p.verdict === "scartata") ? "scartata"
                 : pieces.some((p) => p.verdict === "tenuta") ? "tenuta"
                 : null) as Scene["verdict"],
        judgedAt: pieces.reduce<number | null>(
          (m, p) => (p.judgedAt && (!m || p.judgedAt > m) ? p.judgedAt : m), null),
        annotated: pieces.some((p) => p.problems.length > 0),
        // The take's suspicion is that of the first piece that has one.
        suspect: pieces.find((p) => p.suspect)?.suspect ?? null,
        appearances: pieces.flatMap((p) => p.appearances ?? []).sort((x, y) => x.t - y.t),
      };
    })
    .sort((a, b) => (a.minute ?? 1e9) - (b.minute ?? 1e9) || a.origin.localeCompare(b.origin));
}

/** One definition only, next to the rule that says who leaves the list:
 *  two filter lists that drift apart are a jump cut that keeps coming back. */
type Filter = PickFilter;

/** Twelve instants in a strip. Each cell takes the video to its own. */
function Take({ shot, take, onVaiA }: {
  shot: string; take: string; onVaiA: (fraction: number) => void;
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
        {/* The cells sit ON TOP of the image instead of being cropped:
            one request to the server, and the target stays exact even if the
            strip changes its number of instants. */}
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
 * The hardness: how hard the image hits, lined up against all the others.
 *
 * The slider exists because the measurement is wrong in a specific way: it
 * looks at motion, contrast and light, and an image's force is not always in
 * there. A still figure filling the frame hits harder than a distant wave
 * thrashing about. Without the slider the only remedy was discarding the shot,
 * i.e. throwing it away instead of putting it back in the right place.
 */
function Intensity({ shot, value, measured, manual, motion, detail, onChange }: {
  shot: string;
  value: number | null; measured: number | null; manual: number | null;
  motion: number | null; detail: number | null;
  onChange: (v: number | null) => void;
}) {
  const [touch, setTouch] = useState<number | null>(null);

  /**
   * It saves ONCE, when the slider settles.
   *
   * Saving on every notch makes the writes overtake each other: twelve arrow
   * taps from 0.60 leave as twelve POSTs, and what survives on the server is
   * the last one to ARRIVE, not the last one sent. Measured: the slider said
   * 0.48, after a reload it was back to 0.53. With the wait one write leaves,
   * the right one, and there is no race to win.
   */
  const waited = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (v: number) => {
    if (waited.current) clearTimeout(waited.current);
    waited.current = setTimeout(() => { waited.current = null; onChange(v); }, 300);
  };
  useEffect(() => () => { if (waited.current) clearTimeout(waited.current); }, []);
  useEffect(() => {
    if (waited.current) { clearTimeout(waited.current); waited.current = null; }
    setTouch(null);
  }, [shot]);
  const shown = touch ?? value;

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
        onChange={(e) => { const v = Number(e.currentTarget.value); setTouch(v); save(v); }}
        className="dr-hue w-full mt-1"
      />
      <div className="flex justify-between text-[9.5px] text-neutral-400">
        <span>ferma</span><span>picchia</span>
      </div>
      <p className="mt-1 text-[10.5px] text-neutral-400 leading-snug">
        Decide <b>dove</b> cade nel brano, non se è bella: dura sui colpi, molle sui respiri.
        {(motion !== null || detail !== null) && (
          <span className="tabular-nums">
            {" "}Da movimento {motion?.toFixed(1) ?? "—"} · dettaglio{" "}
            {detail !== null ? `${Math.round(detail * 100)}%` : "—"}.
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * What you see, in one line.
 *
 * The automatic one is the prompt minus the sentences every shot carries: what
 * is left is the framing, the only part that tells this one apart from the
 * other three hundred. It can be rewritten, and then yours wins — because a
 * crop says what was ASKED FOR, and after watching the clip you know what came
 * OUT, which is not the same thing.
 */
function Description({ shot, text, manual, onSave }: {
  shot: string; text: string | null; manual: boolean; onSave: (t: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { setEdit(false); setDraft(""); }, [shot]);

  if (edit) {
    return (
      <div className="mt-1.5">
        <textarea
          autoFocus value={draft} onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEdit(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault(); onSave(draft); setEdit(false);
            }
          }}
          placeholder="cosa si vede, in una riga"
          className="w-full h-14 bg-neutral-900 border border-neutral-700 rounded-sm px-2 py-1
                     text-[12px] outline-none focus:border-neutral-500"
        />
        <div className="flex gap-2 text-[11px] mt-1">
          <button onClick={() => { onSave(draft); setEdit(false); }}
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
        onClick={() => { setDraft(manual ? (text ?? "") : ""); setEdit(true); }}
        title="scrivi cosa si vede"
        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm border border-neutral-800
                   text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
      >
        ✎
      </button>
    </div>
  );
}

/** Whether the shot sits well where it landed. It is the yardstick hardness
 *  lacks: 0.95 is a lot if the track breathes there, right if it hits there.
 *  Threshold 0.20, which is where the gap starts to be visible. */
/**
 * The clip's transport.
 *
 * It used to be `autoPlay muted loop` and nothing else: the clip span and you
 * could do nothing about it. But here you do not watch a clip, you EXAMINE it —
 * «it falls apart at the end of the loop», «the hand disappears halfway» — and
 * to say that you have to be able to stop it on the frame where it happens. A
 * judgement given on the fly over a running loop is an impression, not an
 * observation.
 *
 * The frame step comes from `frames / duration`, not from a 24 written here:
 * the file gives the duration and the server gives the frames, and a constant
 * would be mute on exactly the shots generated at a different length (2.5s
 * against 3.4s).
 */
function Transport({ video, frameCount }: {
  video: React.RefObject<HTMLVideoElement | null>;
  frameCount: number | null;
}) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);

  // The listeners re-attach on every clip change: `key` on the <video> makes
  // it be recreated, so an effect attached once would be talking to a node no
  // longer in the document.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const t = () => setTime(v.currentTime);
    const d = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const p = () => setPlaying(true);
    const f = () => setPlaying(false);
    v.addEventListener("timeupdate", t);
    v.addEventListener("durationchange", d);
    v.addEventListener("loadedmetadata", d);
    v.addEventListener("play", p);
    v.addEventListener("pause", f);
    d(); t(); setPlaying(!v.paused);
    return () => {
      v.removeEventListener("timeupdate", t);
      v.removeEventListener("durationchange", d);
      v.removeEventListener("loadedmetadata", d);
      v.removeEventListener("play", p);
      v.removeEventListener("pause", f);
    };
  });

  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, video]);
  useEffect(() => { if (video.current) video.current.loop = loop; }, [loop, video]);

  const step = frameCount && duration ? duration / frameCount : 1 / 24;
  const seekTo = (t: number) => {
    const v = video.current;
    if (!v || !duration) return;
    v.currentTime = Math.min(duration - 1e-3, Math.max(0, t));
    setTime(v.currentTime);
  };
  const nudge = (n: number) => { video.current?.pause(); seekTo((video.current?.currentTime ?? 0) + n * step); };
  const startStop = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  // The arrows judge, so the frame moves with `,` and `.` — the same keys as
  // every editing program — and `k` stops and starts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable)) return;
      if (e.key === ",") { e.preventDefault(); nudge(-1); }
      else if (e.key === ".") { e.preventDefault(); nudge(1); }
      else if (e.key === "k") { e.preventDefault(); startStop(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Clamped at the last frame: with the clip finished `time` is exactly the
  // duration, and the division gave "f82/81" — a frame that does not exist.
  const n = step > 0 && frameCount
    ? Math.min(frameCount, Math.floor(time / step) + 1)
    : step > 0 ? Math.floor(time / step) + 1 : 0;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-neutral-400">
      <button onClick={startStop} title="ferma o riparti (k)"
              className="w-6 h-6 shrink-0 grid place-items-center rounded-sm border border-neutral-800
                         hover:border-neutral-600 text-neutral-200 text-[11px]">
        {playing ? "❚❚" : "▶"}
      </button>
      <button onClick={() => nudge(-1)} title="un fotogramma indietro (,)"
              className="px-1 h-6 shrink-0 rounded-sm border border-neutral-800 hover:border-neutral-600">◀|</button>
      <button onClick={() => nudge(1)} title="un fotogramma avanti (.)"
              className="px-1 h-6 shrink-0 rounded-sm border border-neutral-800 hover:border-neutral-600">|▶</button>
      <input
        type="range" min={0} max={Math.max(duration, 0.001)} step={step} value={time}
        onChange={(e) => { video.current?.pause(); seekTo(Number(e.currentTarget.value)); }}
        className="dr-hue flex-1 min-w-0"
        aria-label="posizione nella clip"
      />
      <span className="shrink-0 tabular-nums text-neutral-300">
        {time.toFixed(2)}<span className="text-neutral-500">/{duration.toFixed(2)}s</span>
      </span>
      {frameCount ? (
        <span className="shrink-0 tabular-nums text-neutral-500">f{n}/{frameCount}</span>
      ) : null}
      <span className="shrink-0 flex gap-px">
        {[0.25, 0.5, 1].map((x) => (
          <button key={x} onClick={() => setSpeed(x)}
                  className={`px-1 h-6 rounded-sm border tabular-nums ${
                    speed === x ? "border-neutral-500 text-neutral-200" : "border-neutral-800 hover:border-neutral-600"}`}>
            {x}×
          </button>
        ))}
      </span>
      <button onClick={() => setLoop((c) => !c)} title="ripeti da capo"
              className={`px-1 h-6 shrink-0 rounded-sm border ${
                loop ? "border-neutral-500 text-neutral-200" : "border-neutral-800 hover:border-neutral-600"}`}>
        ↻
      </button>
    </div>
  );
}

function Match({ sound, shot }: { sound: number | null; shot: number | null }) {
  if (sound === null || shot === null) return null;
  const d = shot - sound;
  if (Math.abs(d) <= 0.2) {
    return <span className="text-[10.5px] text-emerald-400/80" title={`brano ${sound.toFixed(2)}`}>combacia</span>;
  }
  return (
    <span className={`text-[10.5px] ${d > 0 ? "text-amber-400/90" : "text-sky-400/80"}`}
          title={`brano ${sound.toFixed(2)} · ripresa ${shot.toFixed(2)}`}>
      {d > 0 ? "più dura del brano" : "più molle del brano"} ({d > 0 ? "+" : ""}{d.toFixed(2)})
    </span>
  );
}

/** The state as a choice between three, not as a sentence. You see where it
 *  is set and you move it from here: "forget the verdict" used to be a small
 *  button at the end of a line of text, and changing your mind meant hunting
 *  for it. */
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
  const [note, setNote] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [regen, setRegen] = useState(false);
  const [promptMod, setPromptMod] = useState("");
  const [par, setPar] = useState({ width: 640, height: 1152, length: 61, steps: 20 });
  const [jobs, setJobs] = useState<VideoJob[]>([]);

  /** Here too the height is measured: the clip must take the screen there is,
   *  and the page must not scroll while you judge at speed. */
  const shell = useRef<HTMLDivElement>(null);
  const [shellHeight, setShellHeight] = useState(700);
  useLayoutEffect(() => {
    // This page takes the full height too: the space the app shell puts above
    // the others is, here, height stolen from the clip.
    ctx?.setFlush?.(true);
    const measure = () => {
      const el = shell.current;
      if (!el) return;
      const parent = el.parentElement;
      const below = parent ? parseFloat(getComputedStyle(parent).paddingBottom) || 0 : 0;
      setShellHeight(Math.max(360, window.innerHeight - el.getBoundingClientRect().top - below));
    };
    measure();
    window.addEventListener("resize", measure);
    // The measurement must be redone when the container changes as well, not
    // just the window: navigating from Cut to Pick the padding changes under
    // your feet.
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
  const observer = useRef<ResizeObserver | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; w0: number } | null>(null);

  /** How wide the clip is, in pixels. Whoever is watching picks it, by
 *  dragging. */
  const [wantedWidth, setWantedWidth] = useState<number | null>(() => {
    const g = localStorage.getItem(KEY_WIDTH);
    const n = Number(g);
    return g !== null && Number.isFinite(n) && n >= 160 ? n : null;
  });
  useEffect(() => {
    try {
      if (wantedWidth === null) localStorage.removeItem(KEY_WIDTH);
      else localStorage.setItem(KEY_WIDTH, String(wantedWidth));
    } catch { /* nothing */ }
  }, [wantedWidth]);

  /** The frame's REAL ratio, read from the file when it starts.
   *  9:16 is not assumed: the previews sit between 0.550 and 0.556, and
   *  assuming it means deforming the figure by up to 2% exactly while it is
   *  being judged. */
  const [ratio, setRatio] = useState(9 / 16);

  /** The height is measured on the VIDEO AREA, not the panel: under the clip
   *  is the row of pieces, and measuring the whole panel would hand the clip a
   *  height it does not have — i.e. make it overflow on precisely the takes
   *  that come in two pieces. */
  const [areaHeight, setHArea] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);

  /**
   * The observer attaches with a ref callback, NOT with an effect.
   *
   * With `useLayoutEffect(..., [])` there was a real, silent defect: the video
   * area lives inside the `{!shot ? ... : ...}` branch, so on the first render
   * — when the shots have not arrived from the server yet — the ref is null,
   * the effect returns immediately and is never re-run. Result: `hArea` stayed
   * 0, the height limit vanished entirely (`hArea || Infinity`) and dragging
   * the clip grew it until it went off the bottom of the window. A ref callback
   * is instead called every time the node enters or leaves the DOM, which is
   * exactly the thing to follow.
   */
  const snapArea = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    area.current = el;
    if (!el) return;
    const measure = () => {
      setHArea(el.clientHeight);
      const row = panel.current;
      if (row) setPanelWidth(row.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (panel.current) ro.observe(panel.current);
    observer.current = ro;
  }, []);

  /** How much room is left to the right-hand panel, at minimum. Below this
   *  threshold the prompt and the strip become unreadable, and widening the
   *  clip until they are crushed is not a choice worth being able to make. */
  const MIN_RIGHT = 320;

  /**
   * The HEIGHT is fixed, not the width, and the width stays `auto`.
   *
   * It looks like a detail and it is the difference between "does not overflow"
   * and "overflows by 2%". Fixing the width makes the height come out of a
   * division by `ratio` — and `ratio` is a guess until the file has loaded its
   * metadata: it starts at 9/16 (0.5625) while the real previews sit at 0.550.
   * That 2% is enough for the clip to end up under the edge and be cut off,
   * which is exactly what could be seen.
   *
   * Fixing the height makes the constraint exact: `hArea` is measured, not
   * estimated, and the clip cannot be taller than the space it has. `ratio`
   * stays in use only to translate the WANTED width into a height: if it is a
   * little wrong the clip comes out slightly narrower or wider than asked —
   * which nobody notices — instead of overflowing, which is noticed at once.
   *
   * And the `auto` width is deduced by the frame from its real ratio: no
   * deformation and no bars, because there is no box with a shape we decided
   * for it to fill.
   */
  const clipHeight = Math.max(
    120,
    Math.min(
      ...[
        areaHeight || Infinity,                                    // no taller than the area
        wantedWidth === null ? Infinity : wantedWidth / ratio, // if it was asked for
        panelWidth ? (panelWidth - MIN_RIGHT) / ratio : Infinity, // lascia vivere la colonna destra
      ],
    ),
  );

  useEffect(() => {
    api.videoShots().then((r) => setShots(r.shots)).catch(() => {});
  }, []);

  const scenes = useMemo(() => group(shots), [shots]);
  /** The beats with their `why`. They come from the plan, not deduced from the
   *  shots: that is where the line of story lives. */
  const [fullActs, setFullActs] = useState<VideoAct[]>([]);
  /** The cuts serve one purpose here: saying how hard the TRACK is at the point
   *  the shot falls on. Without them a shot's hardness is a number with no
   *  yardstick — is 0.95 a lot or a little? It depends on what the track asks
   *  for there, and that is exactly the hook the cut is built on. */
  const [cuts, setCuts] = useState<VideoCut[]>([]);
  useEffect(() => {
    api.videoCuts().then((r) => { setFullActs(r.acts ?? []); setCuts(r.cuts ?? []); }).catch(() => {});
  }, []);
  /** The hardness of the sound at second `t`, from the cut that lands on it. */
  const soundAt = useCallback(
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
  const current = scene?.pieces[Math.min(piece, scene.pieces.length - 1)] ?? null;

  // Generations are watched only while one is alive: a single tab, and an
  // empty poll every three seconds for the whole session serves nobody.
  useEffect(() => {
    let alive = true;
    const pass = async () => {
      try {
        const r = await api.videoGenerations();
        if (!alive) return;
        setJobs(r.jobs);
        if (r.jobs.some((j) => j.status === "running" || j.status === "pending")) setTimeout(pass, 3000);
      } catch { /* the server may not be a video project */ }
    };
    void pass();
    return () => { alive = false; };
  }, [regen]);

  useEffect(() => { setPiece(0); }, [scene?.origin]);
  useEffect(() => { if (i >= queue.length) setI(Math.max(0, queue.length - 1)); }, [queue.length, i]);

  const advance = useCallback(() => setI((k) => Math.min(k + 1, Math.max(0, queue.length - 1))), [queue.length]);

  /**
   * The last verdict, with what it was before.
   *
   * You judge at speed with the arrows, so sooner or later you press the wrong
   * one — and the shot has already gone by. As long as the only trace was a
   * line in `scelte.json` on disk, "did I discard something by mistake?" was a question
   * you could only answer by opening the file. Now the last one stays written
   * on the page, with its undo, until another is made.
   */
  /**
   * It remembers the previous JUDGEMENT, not `kept`.
   *
   * `kept` is a boolean, and a never-judged shot has it true — nobody discarded
   * it. Restoring that, undoing a discard wrote it among the kept ones: you
   * pressed «undo» and instead of going back you gave a yes. The third state
   * (`null` = never judged) is the only one that can really undo.
   */
  const [last, setLast] = useState<
    { ids: string[]; name: string; kept: boolean; before: Map<string, VideoShot["verdict"]>; index: number } | null
  >(null);

  const judge = useCallback(
    async (kept: boolean, why?: string) => {
      if (!scene) return;
      const ids = scene.pieces.map((p) => p.id);
      const before = new Map(scene.pieces.map((p) => [p.id, p.verdict]));
      // Optimistic: the row stays as the user set it even if the network lags.
      setShots((prev) =>
        prev.map((s) =>
          ids.includes(s.id) ? { ...s, kept, verdict: kept ? "tenuta" : "scartata" } : s));
      setLast({ ids, name: scene.origin, kept, before, index: i });
      try {
        let u = shots;
        for (const id of ids) u = (await api.videoPick(id, kept, why)).shots;
        setShots(u);
      } catch { /* the row stays as the user set it */ }
      // Advancing AFTER judging skips a shot, and skips it silently: the judged
      // one has already left the list and the next has moved up into slot `i`
      // by itself. The rule lives in `videoQueue.ts`, with its test.
      if (!leavesQueue(filter, kept)) advance();
    },
    [scene, shots, advance, i, filter],
  );

  /** Puts every piece back as it was and returns to the shot, so it can be
 *  watched again. */
  const undoLast = useCallback(async () => {
    if (!last) return;
    const u = last;
    setLast(null);
    /** "kept" -> yes · "discarded" -> no · never judged -> no verdict. */
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
    } catch { /* nothing */ }
    setI(u.index); setPiece(0);
  }, [last, shots]);

  const annotate = useCallback(async () => {
    const t = text.trim();
    setNote(null); setText("");
    if (!t || !scene) return;
    try { setShots((await api.videoProblem(scene.pieces[0]!.id, t)).shots); } catch { /* nothing */ }
  }, [text, scene]);

  // Keyboard: the hands stay put and you judge at speed.
  //
  // WHERE text is being typed or a slider is being moved, though, the keys go
  // back to being keys. Without this guard the defect is not cosmetic: the
  // hardness slider would not move at all (the left arrow opened "discard" and
  // called preventDefault), and moving the caret inside the description with
  // the arrows DISCARDED the shot being described. Found by trying the slider
  // from the outside, not by reading the code.
  const onOneField = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (onOneField(e.target)) return;
      if (note !== null) {
        if (e.key === "Escape") { setNote(null); setText(""); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void annotate();
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); setNote("scarto"); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void judge(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setNote("nota"); }
      else if (e.key === "z") { e.preventDefault(); void undoLast(); }
      else if (e.key === " ") { e.preventDefault(); const v = video.current; if (v) { v.currentTime = 0; void v.play(); } }
      else if (e.key === "ArrowDown") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, annotate, judge, advance, undoLast]);

  useEffect(() => { if (note !== null) field.current?.focus(); }, [note]);

  const toJudge = scenes.filter((s) => s.verdict === null && !s.annotated).length;
  const suspect = scenes.filter((s) => !!s.suspect && s.verdict === null).length;
  const kept = scenes.filter((s) => s.verdict === "tenuta").length;
  const discarded = scenes.filter((s) => s.verdict === "scartata").length;

  return (
    <div ref={shell} className="flex flex-col text-neutral-200 overflow-hidden" style={{ height: shellHeight }}>
      {/* AUTO height, not a fixed 24px: on a tablet nothing fits inside
          24px and the bar falls apart. It wraps cleanly, and the filter group
          scrolls sideways instead of pushing the rest out. */}
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
        {(["da giudicare", "sospette", "tenute", "scartate", "annotate", "in montaggio", "all"] as const).map((k) => (
          <button
            key={k}
            onClick={() => { setFilter(k); setI(0); }}
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm border ${
              filter === k ? "border-neutral-500 text-neutral-200" : "border-neutral-900 text-neutral-400"
            }`}
          >
            {k === "all" ? "tutte" : k}{k === "da giudicare" ? ` ${toJudge}` : k === "sospette" ? ` ${suspect}` : ""}
          </button>
        ))}
        <Choose value={act} width={108} title="filtra per atto"
                items={[{ v: "", text: "ogni atto" }, ...acts.map((a) => ({ v: a, text: a }))]}
                onChange={(v) => { setAct(v); setI(0); }} />
        </div>
      </div>

      {/* The map of ALL the takes, one tick each, in the order they fall in
          the cut.
          The numbers at the top say HOW MANY are kept and how many discarded;
          this says WHICH, and those are two different questions. It is mostly
          for seeing the holes — a stretch of grey is a piece of track nobody
          has looked at yet, and with the "to judge" filter that stretch is
          invisible, because in there is only what is missing, never where it is
          missing. */}
      {scenes.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-1 py-1 border-b border-neutral-900">
          {/* `overflow-hidden` and ticks with no minimum width, and this is not
              a finishing touch: with `min-w-[2px]` 274 ticks ask for 820px,
              which a tablet does not have. The row overflowed its box and the
              legend's numbers ended up printed OVER the ticks (seen at 834px).
              With no floor the ticks squeeze and the map stays whole and in
              proportion at every width — which is what it exists for. */}
          <div className="flex-1 min-w-0 flex gap-px h-3.5 overflow-hidden">
            {scenes.map((s) => {
              const color =
                s.verdict === "tenuta" ? "bg-emerald-500/70 hover:bg-emerald-400"
                : s.verdict === "scartata" ? "bg-rose-500/60 hover:bg-rose-400"
                : s.suspect ? "bg-amber-500/50 hover:bg-amber-400"
                : "bg-neutral-700/70 hover:bg-neutral-500";
              const itsOwn = scene?.origin === s.origin;
              return (
                <button
                  key={s.origin}
                  title={`${s.origin} — ${s.verdict ?? "mai giudicata"}${
                    s.minute !== null ? ` · ${mmss(s.minute)}` : " · non in montaggio"}`}
                  onClick={() => {
                    // Jumping to a take the current filter hides cannot fail
                    // silently: the filter is widened and you go there. The
                    // opposite — a click that does nothing — is the fastest way
                    // to make people think the map is decorative.
                    const where = queue.findIndex((c) => c.origin === s.origin);
                    if (where >= 0) setI(where);
                    else { setFilter("all"); setAct(""); setI(scenes.indexOf(s)); }
                  }}
                  className={`flex-1 min-w-0 rounded-[1px] transition-colors ${color} ${
                    itsOwn ? "ring-1 ring-neutral-100 ring-inset" : ""}`}
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
        <div ref={panel} className="flex-1 min-h-0 flex flex-col md:flex-row gap-1 pt-2 pb-1">
          <div className="shrink-0 flex flex-col min-w-0">
            {/* The frame is NEVER inside a box with a shape we decided for it,
                and the two defects seen today explain why:

                - `aspect-[9/16]` deformed it. The previews are not all 9:16 —
                  measured, they sit between 360x648 (0.556) and 360x654
                  (0.550) — and what is judged here is precisely the shape of
                  the figure: a woman 2% thinner is exactly the error you
                  cannot afford;
                - `object-contain` inside a wide box added black bars, because
                  in a flex column `align-items` is `stretch` and the video was
                  widened to the whole column.

                So: no `object-fit`, explicit width, `auto` height. The resizer
                decides the width, but it is clamped to `height * ratio` — so
                the frame can neither deform nor overflow, and there is never
                any leftover to fill with black.

                The `max-h-full` on the video is NOT redundant with the clamp:
                it is the same thing said to the browser instead of to a
                calculation of mine. If my measurement arrives late — on the
                first frame, while the window resizes, or if the ratio has not
                been read yet — the clamp is wrong for an instant and the video
                overflows. `max-h-full` is not, and for a replaced element with
                a given width and `auto` height the browser recomputes the width
                TOO, so the ratio stays right. Two defences against the same
                overflow, and the one that does not depend on me has the last
                word. */}
            <div ref={snapArea} className="flex-1 min-h-0 grid place-items-center overflow-hidden">
              <video
                ref={video}
                key={current.id}
                src={pq(current.takes[0]?.clip ?? "")}
                poster={pq(current.takes[0]?.poster ?? "")}
                autoPlay muted loop playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
                }}
                onClick={(e) => { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); }}
                style={{ height: clipHeight, width: "auto" }}
                className="max-h-full max-w-full bg-black border border-neutral-800 rounded-sm cursor-pointer"
              />
            </div>
            <Transport video={video} frameCount={current.takes[0]?.frames ?? null} />
            {scene.pieces.length > 1 && (
              <div className="mt-2 flex gap-1.5">
                {scene.pieces.map((p, k) => (
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

          {/* The resizer. Not an indulgence: the same judging pass wants two
              different widths — wide to see whether the figure comes undone,
              narrow when you are reading the prompt or looking at the strip.
              Dragging costs less than shrinking the window. The size survives
              between sessions. */}
          <div
            role="separator"
            aria-orientation="vertical"
            title="trascina per stringere o allargare · doppio clic: quanto ci sta"
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              // Start from the VISIBLE width, not the wanted one: until
              // somebody has dragged, the wanted one is `null`, and the drag
              // has to continue from where the clip is now, not from a number.
              drag.current = { x0: e.clientX, w0: wantedWidth ?? clipHeight * ratio };
            }}
            onPointerMove={(e) => {
              const t = drag.current;
              if (!t) return;
              setWantedWidth(Math.max(160, Math.min(1200, t.w0 + (e.clientX - t.x0))));
            }}
            onPointerUp={(e) => {
              drag.current = null;
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
              <div className="text-[15px] text-neutral-200">{scene.origin}</div>
              {/* The state is a CHOICE between three, not a sentence to read: you
                  see where it is set now and you move it from here without
                  going back down to the keys. */}
              <State
                value={scene.verdict}
                onChange={async (v) => {
                  if (v === null) {
                    for (const pz of scene.pieces) setShots((await api.videoClearVerdict(pz.id)).shots);
                  } else if (v === "tenuta") await judge(true);
                  else setNote("scarto");
                }}
              />
              {scene.verdict && scene.judgedAt && (
                <span className="text-[10.5px] text-neutral-400">
                  {new Date(scene.judgedAt).toLocaleString("it-IT",
                    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {/* What you see, in one line. It is the first thing needed and it
                was not there: you had the name, the numbers and the whole
                prompt, i.e. everything except the answer to "what is this
                thing". */}
            <Description
              shot={current.id}
              text={current.description}
              manual={current.descriptionByHand}
              onSave={async (t) => setShots((await api.videoDescription(current.id, t)).shots)}
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
                {/* Between "keep" and "discard" is missing the third thing you
                    actually want to do when a shot is flagged: fix it. The
                    prompt panel already existed but sat closed at the bottom of
                    the column, so the road was: read the problem, scroll, open,
                    find the prompt. From here it is one key. */}
                <button
                  onClick={() => { setPromptMod(current.prompt ?? ""); setRegen(true); }}
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
              motion={current.motion}
              detail={current.detail}
              onChange={async (v) => setShots((await api.videoIntensity(current.id, v)).shots)}
            />

            {/* «on screen 6.6s at 1:10» hid the most useful thing: how many
                times it comes in. A mediocre shot that passes three times
                weighs more than a good one that passes once, and the total does
                not say so. */}
            <div className="mt-3">
              <div className="text-[11px] text-neutral-400">
                {scene.appearances.length === 0
                  ? "non è nel montaggio"
                  : scene.appearances.length === 1
                  ? "entra una volta"
                  : `entra ${scene.appearances.length} volte · ${scene.inEdit.toFixed(1)}s in tutto`}
              </div>
              {scene.appearances.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {scene.appearances.map((ap, k) => (
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
                      <Match sound={soundAt(ap.t)} shot={current.intensity} />
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
                        try { setShots((await api.videoProblem(current.id, undefined, k)).shots); } catch { /* nothing */ }
                      }}
                    >
                      togli
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* The prompt is where you fix what the note says. As long as they
                were in two different windows, the loop "this one deforms" ->
                new prompt -> generation was closed by hand. */}
            <details className="mt-3" open={regen} onToggle={(e) => {
              const open = (e.currentTarget as HTMLDetailsElement).open;
              setRegen(open);
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
                {/* These are not hidden constants: at 704x1280 with 81 frames the
                    3090 gets to 23.9 GB out of 24.5 and writes nothing for an
                    hour. Whoever launches has to be able to see the number that
                    decides. */}
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
                      await api.videoGenerate(current.id, promptMod, current.takes[0]?.take ?? "a", par);
                      setJobs((await api.videoGenerations()).jobs);
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
                  autoFocus value={text} onChange={setText}
                  onEsc={() => setNote(null)} onSubmit={() => void annotate()}
                  placeholder={note === "scarto" ? "perché la scarti?" : "cosa c'è da sistemare?"}
                  className="h-20 text-[12px]"
                />
                <div className="mt-1 flex gap-2 text-[11px]">
                  <button
                    className="px-2 py-0.5 rounded-sm border border-neutral-600 text-neutral-200
                               inline-flex items-center gap-1.5"
                    onClick={async () => {
                      const t = text;
                      if (note === "scarto") { setNote(null); setText(""); await judge(false, t); }
                      else await annotate();
                    }}
                  >
                    {note === "scarto" ? "discard" : "annota"}
                    <Shortcut>⌘↵</Shortcut>
                  </button>
                  <button className="px-2 py-0.5 rounded-sm border border-neutral-800 text-neutral-400
                                     inline-flex items-center gap-1.5"
                          onClick={() => { setNote(null); setText(""); }}>
                    lascia stare
                    <Shortcut>esc</Shortcut>
                  </button>
                </div>
              </div>
            ) : (
              /* The shortcut lives ON the button, not in a legend beside it:
                 a legend is read once and then becomes furniture, while the
                 button is looked at every time you hesitate. The button
                 teaches it, and whoever learns it stops using the button. */
              <div className="mt-4 flex gap-2 items-center flex-wrap">
                <VerdictButton onClick={() => setNote("scarto")} key="←"
                  className="border-rose-800 text-rose-300 hover:bg-rose-950/50">
                  ✕ scarta
                </VerdictButton>
                <VerdictButton onClick={() => void judge(true)} key="→"
                  className="border-emerald-800 text-emerald-300 hover:bg-emerald-950/50">
                  ♥ tieni
                </VerdictButton>
                <VerdictButton onClick={() => setNote("nota")} key="↑"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ✎ annota
                </VerdictButton>
                <VerdictButton onClick={() => advance()} key="↓"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ↷ salta
                </VerdictButton>
                <VerdictButton onClick={() => { const v = video.current; if (v) { v.currentTime = 0; void v.play(); } }}
                  key="spazio"
                  className="border-neutral-800 text-neutral-400 hover:border-neutral-600">
                  ↻ rivedi
                </VerdictButton>
              </div>
            )}

            {/* How much is left, and what is coming. A counter "12 / 176" only
                says the end is far off; the faces after it say whether it is
                worth pressing on or changing filter, and judging goes at speed
                for that reason. */}
            {/* The strip: twelve instants of the clip, as wide as the column.
                It answers a question no measurement in this project has managed
                to answer — WHERE a shot falls apart. Five ways were tried
                (tonal balance, detail area, silhouette jump, trajectory
                non-smoothness, disagreement between subject and background) and
                none separates a figure coming undone from a wave exploding: the
                real defects are semantic — «she goes down in the middle of the
                stairs», «the seagull is not consistent from one frame to the
                next» — and a single-image model describes those frames as
                perfectly normal.

                So the judgement is not automated, it is made instant: the point
                where the figure changes identity is seen in a second, and a
                click takes you there. At thirty pixels a cell nothing was
                visible, so it lives here and not in the clip's column. */}
            <Take
              shot={current.id}
              take={current.takes[0]?.take ?? "a"}
              onVaiA={(fraction) => {
                const v = video.current;
                if (!v || !Number.isFinite(v.duration)) return;
                v.pause();
                v.currentTime = fraction * v.duration;
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
                  const pr = sc.pieces[0];
                  return (
                    <button
                      key={sc.origin}
                      onClick={() => { setI(i + 1 + k); setPiece(0); }}
                      title={`${sc.origin}${sc.act ? ` · ${sc.act}` : ""}`}
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
