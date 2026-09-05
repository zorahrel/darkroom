import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "./project.ts";
import { RENDER_DIR, RENDER_SSH, VIDEO_AUDIO, VIDEO_MASTER } from "./config.ts";

/**
 * Video projects. A video project is a folder produced by the beat-locked
 * assembler (`montaggio.py`): shots on disk, one or more takes each, a measured
 * hardness table, and an edit plan whose cuts sit on the song's measured beats.
 *
 * Darkroom does not own that pipeline and does not re-implement it. It reads
 * the same files the Python reads and writes back exactly one thing — which
 * shots are kept — because that is the only decision in the chain a machine
 * could not make. Two automatic metrics were tried for it (tonal balance, then
 * detail area) and both ranked shots the eye had already rejected. So the
 * keep/kill lives here, in front of a human, and `scelte.json` is the contract.
 */

export type Take = { take: string; frames: number; clip: string; poster: string; kept: boolean };

/**
 * Which generation a shot comes from: the name without its trailing digits.
 *
 * `z43_0` and `z43_1` are not two shots, they are two halves of the same take —
 * same seed, same framing. Counting names, the edit declared 122 different
 * shots; counting origins it had 48, and forty-nine times two pieces of the
 * same take went past less than eight seconds apart.
 *
 * ONE trailing digit is removed, and only if there is something that is not a
 * digit before it. Removing them all merged too much: `k00` and `k15` both
 * became `k`, that is sixteen different sea shots treated as pieces of one
 * take. Measured on the descriptors: the `k` family merged that way resembles
 * itself 0.705 and `x` 0.761 — they are not the same thing. With a single digit
 * the families sit between 0.75 and 0.99, which is the right range.
 *
 * The same function lives in `pianifica.py`. It is a definition, not a policy:
 * duplicating it costs one line and the tests say if the two diverge.
 */
export const origin = (shot: string) => {
  const m = /^(.*[^0-9])_?[0-9]$/.exec(shot);
  return m?.[1]?.replace(/_+$/, "") ?? shot;
};
export type Shot = {
  id: string;
  prompt: string;
  takes: Take[];
  /** Measured, from durezza.json: 0 = calmest shot of the set, 1 = hardest. */
  intensity: number | null;
  moto: number | null;
  dettaglio: number | null;
  /** Seconds of screen time the current plan gives it. */
  inEdit: number;
  kept: boolean;
  /** Why it was dropped, when it was dropped by hand. */
  why: string | null;
  /** The verdict of whoever is watching, in both directions. `null` = never
   *  passed under the eyes, which is different from "kept" even when it is in
   *  the edit. */
  verdict: "tenuta" | "scartata" | null;
  judgedAt: number | null;
  /** Problems flagged from the editor. Not a verdict: a note for the next round. */
  problems: string[];
  /** Why this shot deserves to be looked at first. It is not a verdict: see
   *  `suspicion()`. `null` = nothing anomalous in the numbers. */
  suspect: string | null;
  /** Which generation it comes from: two halves of one take share this. */
  origin: string;
  /** The act it plays in, from `atti.json`. Null when it is not in the edit. */
  act: string | null;
  /** Seconds into the film where it first appears, null when unused. */
  minute: number | null;
  /** Why it is out, when it was excluded by the planner rather than by hand. */
  excluded: string | null;
};

export type Cut = {
  t: number;
  dur: number;
  bar: number;
  shot: string;
  soundIntensity: number;
  /** The shot's own measured hardness: the other half of the pairing. Seeing
   *  the two side by side is what tells "ugly shot" from "wrong place". */
  shotIntensity: number | null;
  velocita: number;
  rovescio: boolean;
  act: string | null;
  origin: string;
};

/** `perche` is the line of story the act tells — "she walks", "the feet leave
 *  the ground". `pianifica.py` writes it into atti.json: without it, Pick shows
 *  "act cammino" and nothing else, which says nothing to somebody judging a
 *  shot. It can be missing on projects generated before 27/08/2026. */
export type Act = { da: number; a: number; nome: string; t0: number; t1: number; why?: string };

const readJson = <T,>(p: string, fallback: T): T => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** The foundry: where the edit is assembled, encoded and measured. The same
 *  two values that live in `master.sh` — the Mac is the author, not the compute
 *  node. */
const PC = RENDER_SSH;
const REMOTO = RENDER_DIR;

export const videoRoot = () => rootDir();
const at = (...p: string[]) => join(videoRoot(), ...p);

/** Beat position (bars, possibly fractional) -> seconds, on the MEASURED beats.
 *  Never multiply an average BPM: the track breathes, and after thirty bars a
 *  constant bar length is half a sixteenth out. Mirrors `griglia.py`. */
function beatClock(bm: any): (bar: number) => number {
  const b: number[] = [...(bm.beats ?? [])];
  if (b.length < 2) return () => 0;
  const step = (b.at(-1) as number) - (b.at(-2) as number);
  while ((b.at(-1) as number) < (bm.duration_s ?? 0) + 8 * step) {
    b.push((b.at(-1) as number) + step);
  }
  const first = b[0] as number;
  const second = b[1] as number;
  const last = b.at(-1) as number;
  const phase: number = bm.downbeat_phase ?? 0;
  return (bar: number) => {
    const bp = phase + 4 * bar;
    const i = Math.floor(bp);
    if (i < 0) return first + bp * (second - first);
    if (i >= b.length - 1) return last + (bp - (b.length - 1)) * step;
    const a = b[i] as number;
    const c = b[i + 1] as number;
    return a + (bp - i) * (c - a);
  };
}

type Picks = {
  scartati: Record<string, string>;
  problemi?: Record<string, string[]>;
  /** Per-take rejections: two takes of the same shot are not worth the same,
   *  and dropping one should not cost you the whole shot. */
  riprese?: Record<string, string[]>;
  /** Forced choices from the editor, read back by `pianifica.py`. Few, and
   *  declared: everything else stays derived. */
  pin?: Record<string, string>;
  durata?: Record<string, number>;
};

export function picks(): Picks {
  const s = readJson<Picks>(at("scelte.json"), { scartati: {} });
  if (!s.problemi) s.problemi = {};
  if (!s.riprese) s.riprese = {};
  if (!s.pin) s.pin = {};
  if (!s.durata) s.durata = {};
  return s;
}

/** A flagged problem is a note, not a rejection: it survives a regeneration and
 *  says what to look at. Two automatic metrics failed to separate ugly from
 *  good, so what the eye catches has to be written down somewhere the next
 *  round can read. */
export function flagProblem(shot: string, text: string) {
  const s = picks();
  const t = text.trim();
  if (!t) return s;
  s.problemi![shot] = [...(s.problemi![shot] ?? []), t];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function clearProblem(shot: string, i: number) {
  const s = picks();
  const l = s.problemi![shot] ?? [];
  s.problemi![shot] = l.filter((_, k) => k !== i);
  if (!s.problemi![shot].length) delete s.problemi![shot];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/**
 * The verdict on a shot, kept in both directions.
 *
 * "Keep" used to merely delete the row from `scartati`, and keeping is the
 * starting state: pressing the key on a hundred scenes left no trace at all.
 * The "to judge" queue stayed exactly as long, and "which ones have I already
 * approved?" was a question with no answer — the only judgement recorded was
 * the negative one.
 *
 * Now the yes is written too, with its when. `pianifica.py` reads only
 * `scartati`, so the plan does not notice: this is the memory of whoever
 * watches, not an editing choice.
 */
/**
 * `null` is not a third whim: it is the state every shot is born in, and
 * without it undo lies.
 *
 * The page's undo restored `kept`, which is a boolean — and a scene never
 * judged has `kept` true, because nobody discarded it. Undoing a discard
 * therefore wrote it among the KEPT ones: you pressed "undo" on a scene you had
 * never seen and gave it a yes. An undo that leaves the opposite verdict is
 * worse than the wrong verdict, because it feels like you went back. Measured
 * on `g_corr` on 04/09.
 */
export function setPick(shot: string, kept: boolean | null, why?: string) {
  const s = picks() as Picks & { tenuti?: Record<string, number> };
  s.tenuti ??= {};
  if (kept === null) {
    delete s.scartati[shot];
    delete s.tenuti[shot];
  } else if (kept) {
    delete s.scartati[shot];
    s.tenuti[shot] = Date.now();
  } else {
    s.scartati[shot] = why?.trim() || "scartato a mano";
    delete s.tenuti[shot];
  }
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  // The caller gets the English view, never the on-disk object: those key
  // names belong to the Python that shares the file, and letting them out of
  // this module is how one of them ended up spelled in Italian in the HTTP
  // layer.
  return { discarded: s.scartati };
}


/**
 * Hardness decided by hand, which wins over the measured one.
 *
 * The measurement lines the shots up by movement, contrast and light, and gets
 * it wrong when an image's force is not in there: a still figure filling the
 * frame hits harder than a distant wave thrashing about. Until now the only
 * remedy was discarding the shot — that is, throwing it away instead of putting
 * it back in the right place.
 *
 * `null` removes the override and gives the word back to the measurement.
 */
export function setManualIntensity(shot: string, value: number | null) {
  const s = picks() as Picks & { durezze?: Record<string, number> };
  s.durezze ??= {};
  if (value === null) delete s.durezze[shot];
  else s.durezze[shot] = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** The line saying what you see, written by hand. It wins over the prompt's
 *  excerpt, which is only an excerpt. Empty string = back to the automatic
 *  one. */
export function setDescription(shot: string, text: string) {
  const s = picks() as Picks & { descriptions?: Record<string, string> };
  s.descriptions ??= {};
  const t = text.trim();
  if (!t) delete s.descriptions[shot];
  else s.descriptions[shot] = t.slice(0, 240);
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** Removes every verdict from a shot: it goes back to the queue as if it had
 *  never passed under the eyes. */
export function clearVerdict(shot: string) {
  const s = picks() as Picks & { tenuti?: Record<string, number> };
  delete s.scartati[shot];
  if (s.tenuti) delete s.tenuti[shot];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function setShot(shot: string, take: string, kept: boolean) {
  const s = picks();
  const l = new Set(s.riprese![shot] ?? []);
  if (kept) l.delete(take);
  else l.add(take);
  if (l.size) s.riprese![shot] = [...l].sort();
  else delete s.riprese![shot];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** Nail a shot to a bar. The planner reads it back and says, in the plan, which
 *  guarantee the pin suspended — a forced edit is allowed, a silent one is not. */
export function setPin(bar: number, shot: string | null) {
  const s = picks();
  if (shot) s.pin![String(bar)] = shot;
  else delete s.pin![String(bar)];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/**
 * The markers: a note pinned to an instant.
 *
 * Watching the edit you notice something in one second and lose it in the next
 * — "the cut lands late here", "seen this one already". Noting it elsewhere
 * means losing the exact point; noting it here means finding it again at the
 * right second. They live in `scelte.json` like everything else the eye
 * decides, and the Python ignores them because they are not an editing choice.
 */
export function setMarker(t: number, note: string | null) {
  const s = picks() as any;
  s.marcatori ??= {};
  const k = t.toFixed(2);
  if (note) s.marcatori[k] = note; else delete s.marcatori[k];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s.marcatori as Record<string, string>;
}

/**
 * Everything that was forced by hand.
 *
 * The edit is derived: what you see is the result of measurements. The
 * overrides are the only things that are not, and as long as they stayed
 * written only inside `scelte.json` they were invisible — one click too many on
 * a contact strip nailed a bar down and nobody noticed until the rebuild
 * afterwards. A change you cannot see is a change you cannot undo, so here they
 * are listed.
 */
export function overrides(): {
  pin: { bar: number; shot: string }[];
  duration: { bar: number; bars: number }[];
  discardedByHand: { shot: string; reason: string }[];
} {
  const s = picks();
  const daUI = (m: string) => /a mano|dalla timeline|prova del contratto|^$/i.test(m);
  return {
    pin: Object.entries(s.pin ?? {}).map(([b, p]) => ({ bar: Number(b), shot: String(p) }))
      .sort((a, b) => a.bar - b.bar),
    duration: Object.entries(s.durata ?? {}).map(([b, v]) => ({ bar: Number(b), bars: Number(v) }))
      .sort((a, b) => a.bar - b.bar),
    discardedByHand: Object.entries(s.scartati ?? {})
      .filter(([, m]) => daUI(String(m)))
      .map(([shot, reason]) => ({ shot, reason: String(reason) })),
  };
}

export function markers(): { t: number; note: string }[] {
  const m = (picks() as any).marcatori ?? {};
  return Object.entries(m)
    .map(([k, v]) => ({ t: Number(k), note: String(v) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Swapping two cuts: each takes the other's place.
 *
 * It is the gesture you make on the timeline by dragging one block over
 * another, and given how this edit is built it is also the only movement that
 * makes sense: cuts do not sit wherever, they sit on measured bars, and each
 * bar holds exactly one. Moving a block "a bit further along" would not mean
 * anything — taking another's place does.
 *
 * Written in one go, so an undo puts back both or neither.
 */
export function swap(barA: number, shotA: string, barB: number, shotB: string) {
  const s = picks();
  s.pin![String(barA)] = shotB;
  s.pin![String(barB)] = shotA;
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s.pin!;
}

/** Removes the pin from several bars at once: it is the undo of a swap. */
export function unpin(bars: number[]) {
  const s = picks();
  for (const b of bars) delete s.pin![String(b)];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s.pin!;
}

/** Force a block's length, in bars. */
export function setDuration(bar: number, bars: number | null) {
  const s = picks();
  if (bars && bars > 0) s.durata![String(bar)] = bars;
  else delete s.durata![String(bar)];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** The story, from `atti.json`. Empty when the planner does not write it: the
 *  page then draws no bands rather than inventing a division. */
export function acts(): Act[] {
  return readJson<Act[]>(at("atti.json"), []);
}

/** Guarantees a forced edit suspended, as recorded by the planner. */
export function held(): { bar: number; guarantee: string }[] {
  return readJson<any>(at("plan.json"), {}).held ?? [];
}

const actOf = (bar: number, as: Act[]) =>
  as.find((a) => bar >= a.da && bar < a.a)?.nome ?? null;

/**
 * A shot's contact strip: twelve instants in a single band.
 *
 * It exists to answer a question no measurement in this project has managed to
 * answer — *where* a shot falls apart. Four ways were tried: tonal balance,
 * detail area, silhouette jump, and (today) trajectory non-smoothness and
 * disagreement between subject and background. None separates a figure coming
 * undone from a wave exploding, because the real defects are semantic: "she
 * goes down in the middle of the stairs", "the seagull is not consistent from
 * one frame to the next". A single-image model describes those frames as
 * perfectly normal.
 *
 * So the judgement is not automated: it is made instant. On a strip the eye
 * finds the point where the figure changes identity in one second, while
 * scrubbing a two-and-a-half-second clip back and forth costs ten. And every
 * cell takes the video to its instant, so a suspicion is checked without
 * searching.
 */
export function take(shot: string, take: string, howMany = 12): string | null {
  const clip = at("prev", `${shot}__${take}.mp4`);
  if (!existsSync(clip)) return null;
  const outside = at("provini");
  if (!existsSync(outside)) mkdirSync(outside, { recursive: true });
  const dest = join(outside, `${shot}__${take}_${howMany}.jpg`);
  // It is remade only if the clip changed afterwards: a contact strip is a
  // derivative, and regenerating it on every open means an ffmpeg per scroll.
  if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(clip).mtimeMs) return dest;

  const r = Bun.spawnSync([
    "ffmpeg", "-v", "error", "-y", "-i", clip,
    // `thumbnail=n` takes ONE frame every n, choosing the most representative:
    // over a 61-frame clip you want twelve instants spread out, not the first
    // twelve. `-frames:v 1` closes after the first mosaic.
    "-vf", `select='not(mod(n\,${Math.max(1, Math.floor(61 / howMany))}))',scale=180:-1,tile=${howMany}x1`,
    "-frames:v", "1", "-q:v", "4", dest,
  ]);
  if (r.exitCode !== 0 || !existsSync(dest)) return null;
  return dest;
}

/**
 * Why this shot should be looked at first.
 *
 * **It is not an automatic selection**, and not out of caution: because it was
 * tried and it does not work. Half the hand discards in this project have a
 * reason that *looks* measurable — "still", "almost all black", "flat and
 * grey", "leaves two white threads on the black" — and that is fifteen shots
 * out of 256. The rule that catches the most of them (`moto < 2.5` or
 * `contrasto < 38`) catches ten and gets **forty-eight** of the 241 kept ones
 * wrong: as a gate it is useless, because among the kept ones there are
 * deliberately motionless shots going down to `moto` 0.22.
 *
 * The same number is excellent as a **reading order**, though: by looking first
 * at the twenty-six it turns up, the ten dead ones are found in a minute and
 * nothing has been thrown away. A filter, not a verdict — and with what raised
 * the suspicion written beside it, so it can be overruled at a glance.
 *
 * (The other half of the discards — "she goes down in the middle of the
 * stairs", "the seagull is not consistent from one frame to the next" — is not
 * measurable at all: five attempts and a VLM per frame, all failed. It is in
 * the project's `SELEZIONE.md`, with the numbers.)
 */
/** The flat white patches the generator glues into the black, measured by
 *  `artefatti.py` and left in `artefatti.json`. They are not measured here
 *  because they cost an ffmpeg per clip: doing it on request would mean making
 *  whoever opens the grid wait. The file is absent until somebody has scanned,
 *  and in that case this line simply does not appear. */
function artifacts(): Record<string, { sporchi: number; visti: number; dev: number }> {
  return readJson(at("artefatti.json"), {});
}

function suspect(
  m: Record<string, number | undefined>,
  art?: { sporchi: number; visti: number },
): string | null {
  const moto = m.moto, contrasto = m.contrasto, nero = m.nero, luce = m.luce;
  const reasons: string[] = [];
  // First, because it is the only one that says "it is broken" instead of
  // "it is weak".
  if (art && art.sporchi > 0)
    reasons.push(`macchie bianche in ${art.sporchi} fotogrammi su ${art.visti}`);
  if (typeof moto === "number" && moto < 2.5) reasons.push(`si muove poco (${moto.toFixed(1)})`);
  if (typeof contrasto === "number" && contrasto < 38) reasons.push(`poco contrasto (${Math.round(contrasto)})`);
  if (typeof nero === "number" && nero > 0.9) reasons.push(`quasi tutta nera (${Math.round(nero * 100)}%)`);
  if (typeof luce === "number" && luce < 0.015) reasons.push("buia");
  return reasons.length ? reasons.join(" · ") : null;
}

/**
 * A line saying what you see, derived from the prompt.
 *
 * A project's prompts are nearly all the same: film stock, night, high
 * contrast, the same woman in the same coat. One sentence changes — the framing
 * — and it is the only one that lets you understand a shot in half a second. So
 * it is not summarised: the sentences they ALL have are removed, and what
 * remains is the one only this shot has.
 *
 * The threshold is a quarter of the project: a sentence appearing in one shot
 * out of four describes the style, not the scene.
 */
function descriptions(prompts: Record<string, any>): Record<string, string> {
  const frasi = (t: string) =>
    String(t ?? "")
      .split(/(?<=[.!?])\s+/)
      .map((f) => f.trim())
      .filter((f) => f.length > 12);

  const quante = new Map<string, number>();
  const perId = new Map<string, string[]>();
  for (const [id, v] of Object.entries(prompts)) {
    const fs = frasi(v?.prompt);
    if (!fs.length) continue;
    perId.set(id, fs);
    for (const f of new Set(fs)) quante.set(f, (quante.get(f) ?? 0) + 1);
  }
  const common = Math.max(2, Math.ceil(perId.size / 4));

  const out: Record<string, string> = {};
  for (const [id, fs] of perId) {
    const proprie = fs.filter((f) => (quante.get(f) ?? 0) < common);
    // If they are all shared the shot has nothing of its own to say, and
    // writing the boilerplate would be worse than writing nothing.
    if (!proprie.length) continue;
    let t = proprie.slice(0, 2).join(" ");
    if (t.length > 180) t = `${t.slice(0, 177)}…`;
    out[id] = t;
  }
  return out;
}

export function shots(): Shot[] {
  const prompts = readJson<Record<string, any>>(at("prompts.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const t = beatClock(bm);
  const sc = picks();
  const as = acts();
  const esclusi = readJson<any>(at("esclusi.json"), { esclusi: {}, dall_editor: {} });
  const arte = artifacts();
  const descr = descriptions(prompts);
  const manualIntensity = ((sc as any).durezze ?? {}) as Record<string, number>;
  const manual = ((sc as any).descriptions ?? {}) as Record<string, string>;
  const discarded = sc.scartati;
  const kept = ((sc as any).tenuti ?? {}) as Record<string, number>;
  const problems = sc.problemi ?? {};
  const shotsOutside = sc.riprese ?? {};

  const inEdit: Record<string, number> = {};
  const firstTime: Record<string, number> = {};
  const actOfShot: Record<string, string> = {};
  /** EVERY time the shot goes in, not just the first. A total in seconds does
   *  not say whether it is one block or three flashes scattered through the
   *  track, and those are two different things to judge: a mediocre shot that
   *  passes three times weighs more than a beautiful one passing once. */
  const apparizioni: Record<string, { t: number; dur: number; act: string | null }[]> = {};
  for (const seg of plan.segments ?? []) {
    const [b0, b1] = seg.bars;
    const dur = t(b1) - t(b0);
    inEdit[seg.shot] = (inEdit[seg.shot] ?? 0) + dur;
    if (firstTime[seg.shot] === undefined) firstTime[seg.shot] = t(b0);
    const a = actOf(b0, as);
    if (a && !actOfShot[seg.shot]) actOfShot[seg.shot] = a;
    (apparizioni[seg.shot] ??= []).push({
      t: Math.round(t(b0) * 10) / 10,
      dur: Math.round(dur * 10) / 10,
      act: a ?? null,
    });
  }

  const srcDir = at("src");
  const locali = existsSync(srcDir)
    ? readdirSync(srcDir).filter((n) => !n.startsWith("."))
    : [];

  /**
   * Shots generated on the GPU keep their frames over there — only the preview
   * crosses the cable. Listing shots by reading `src/` here would make them
   * invisible at exactly the moment they need judging. So the list is the
   * union: what has its frames here, plus what has at least one preview. The
   * frame count of the remote ones is in `raccolte.json`, written when the job
   * ends.
   */
  const collected = readJson<Record<string, { frames?: number }>>(at("raccolte.json"), {});
  const prevDir = at("prev");
  const fromPreview = new Map<string, string[]>();
  if (existsSync(prevDir)) {
    for (const f of readdirSync(prevDir)) {
      const m = /^(.+)__([a-z])\.mp4$/.exec(f);
      if (m?.[1] && m[2]) fromPreview.set(m[1], [...(fromPreview.get(m[1]) ?? []), m[2]]);
    }
  }
  const names = [...new Set([...locali, ...fromPreview.keys()])].sort();

  return names
    .map((id) => {
      const here = existsSync(join(srcDir, id));
      const files = here ? readdirSync(join(srcDir, id)) : [];
      // Shots were nailed to a|b|c. Shots generated from text have only the "a",
      // but the constraint was wrong in the opposite direction anyway: they are
      // derived from what is on disk.
      const lettere = here
        ? [...new Set(files.map((f) => /^([a-z])_\d+\.png$/.exec(f)?.[1]).filter(Boolean) as string[])]
        : (fromPreview.get(id) ?? []);
      const takes: Take[] = lettere.sort()
        .map((tk) => ({
          take: tk,
          frames: here
            ? files.filter((f) => f.startsWith(`${tk}_`)).length
            : (collected[`${id}__${tk}`]?.frames ?? 0),
          clip: `/api/video/clip/${id}/${tk}`,
          poster: `/api/video/poster/${id}/${tk}`,
          kept: !(shotsOutside[id] ?? []).includes(tk),
        }));
      const m = dz.piani?.[id] ?? {};
      // The key in artefatti.json is "<shot>__<take>": it takes only ONE take
      // being dirty for the shot to deserve a look.
      const art = (["a", "b", "c"]
        .map((tk) => arte[`${id}__${tk}`])
        .filter(Boolean) as { sporchi: number; visti: number; dev: number }[])
        .sort((x, y) => y.sporchi - x.sporchi)[0];
      const sos = suspect(m, art);
      return {
        id,
        prompt: prompts[id]?.prompt ?? prompts[`${id}_b`]?.prompt ?? "",
        // The hand-written one wins: it is a judgement, the other is an excerpt.
        description: manual[id] ?? descr[id] ?? descr[`${id}_b`] ?? null,
        descriptionByHand: manual[id] !== undefined,
        takes,
        intensity: manualIntensity[id] ?? m.durezza ?? null,
        measuredIntensity: m.durezza ?? null,
        manualIntensity: manualIntensity[id] ?? null,
        moto: m.moto ?? null,
        dettaglio: m.dettaglio ?? null,
        inEdit: Math.round((inEdit[id] ?? 0) * 10) / 10,
        kept: !(id in discarded),
        why: discarded[id] ?? null,
        verdict: (discarded[id] !== undefined ? "scartata" : kept[id] !== undefined ? "tenuta" : null) as Shot["verdict"],
        judgedAt: kept[id] ?? null,
        problems: problems[id] ?? [],
        suspect: sos,
        origin: origin(id),
        act: actOfShot[id] ?? null,
        minute: firstTime[id] ?? null,
        apparizioni: apparizioni[id] ?? [],
        // Discarded by hand and excluded by the planner are two different things:
        // the first is undone from here, the second has a written reason.
        excluded: id in discarded ? null : (esclusi.esclusi?.[id] ?? null),
      };
    })
    .sort((a, b) => (b.intensity ?? -1) - (a.intensity ?? -1));
}

/** The edit as a timeline: one entry per cut, already in seconds. */
export function cuts(): {
  cuts: Cut[];
  duration: number;
  bpm: number | null;
  acts: Act[];
  held: { bar: number; guarantee: string }[];
} {
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const as = acts();
  const t = beatClock(bm);
  // `fermo` checked `subdiv <= 0`. With full movement subdiv is around 51 on
  // every segment: the condition is never true and the legend showed a colour
  // no block could have.
  const cuts: Cut[] = (plan.segments ?? []).map((s: any) => {
    const t0 = t(s.bars[0]);
    return {
      t: Math.round(t0 * 1000) / 1000,
      dur: Math.round((t(s.bars[1]) - t0) * 1000) / 1000,
      bar: s.bars[0],
      shot: s.shot,
      soundIntensity: s.durezza ?? 0,
      shotIntensity: dz.piani?.[s.shot]?.intensity ?? null,
      velocita: s.velocita ?? 1,
      rovescio: !!s.rovescio,
      act: actOf(s.bars[0], as),
      origin: origin(s.shot),
    };
  });
  const last = cuts.at(-1);
  return {
    cuts,
    duration: last ? last.t + last.dur : 0,
    bpm: bm.tempo_bpm ?? null,
    acts: as,
    held: plan.sospese ?? [],
  };
}

/** Files the page plays. `reel` is the delivery encode, `anteprima` the light one. */
/**
 * The track's waveform, the beats and the bar boundaries.
 *
 * This edit is locked to the beats: every cut falls on a measured beat and the
 * choice of shot follows the hardness of the sound. Without the sound on the
 * page, the timeline shows the result and hides the reason — you see *that* the
 * cut is there, not *why*. With the wave underneath, a misplaced cut is seen
 * before it is heard.
 *
 * The peaks are computed once and stay in `onda.json`: decoding two and a half
 * minutes of mp3 costs a second, but not on every page open.
 */
export type Wave = { peaks: number[]; beats: number[]; bars: number[]; duration: number; ready: boolean };

let waveRunning = false;

export function wave(): Wave {
  const bm = readJson<any>(at("beatmap.json"), {});
  const beats: number[] = bm.beats ?? [];
  const duration = bm.duration_s ?? 0;
  // The bar boundaries: one beat in four. It is the grid the plan reasons on
  // (`bars`), so it is the one to draw more strongly.
  const bars = beats.filter((_, i) => i % 4 === 0);

  const f = at("onda.json");
  if (existsSync(f)) {
    const d = readJson<any>(f, {});
    if (Array.isArray(d.picchi) && d.picchi.length) {
      return { peaks: d.picchi, beats, bars, duration: duration, ready: true };
    }
  }
  if (!waveRunning) { waveRunning = true; void computeWave().finally(() => { waveRunning = false; }); }
  return { peaks: [], beats, bars, duration: duration, ready: false };
}

/**
 * The track the edit is cut to.
 *
 * This was one filename belonging to one project, so the waveform under the
 * timeline drew for its author and stayed blank, unexplained, for anybody
 * else. Order: what the operator set, then the first audio file sitting beside
 * the project folder — which is where a project's music actually lives.
 */
function audioTrack(): string | null {
  if (VIDEO_AUDIO) return existsSync(VIDEO_AUDIO) ? VIDEO_AUDIO : null;
  const beside = join(videoRoot(), "..");
  if (!existsSync(beside)) return null;
  const found = readdirSync(beside)
    .filter((f) => /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(f))
    .sort();
  return found.length ? join(beside, found[0]!) : null;
}

async function computeWave(): Promise<void> {
  const audio = audioTrack();
  if (!audio) return;
  // Mono, 8 kHz, signed integers: for an amplitude profile that is plenty, and
  // it is 1.2 MB instead of 25.
  const proc = Bun.spawn(
    ["ffmpeg", "-v", "error", "-i", audio, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buf = new Int16Array((await new Response(proc.stdout).arrayBuffer()));
  await proc.exited;
  if (!buf.length) return;
  const N = 2400;                        // one peak every ~60 ms over two and a half minutes
  const per = Math.max(1, Math.floor(buf.length / N));
  const peaks: number[] = [];
  for (let i = 0; i < N; i++) {
    let max = 0;
    for (let k = i * per; k < Math.min((i + 1) * per, buf.length); k++) {
      const v = Math.abs(buf[k] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(Math.round((max / 32768) * 1000) / 1000);
  }
  writeFileSync(at("onda.json"), JSON.stringify({ peaks }));
}

export function assets() {
  const pick = (...names: string[]) => names.find((n) => existsSync(at(n))) ?? null;
  return {
    preview: pick("ANTEPRIMA.mp4"),
    reel: pick("REEL.mp4"),
    master: pick(VIDEO_MASTER),
  };
}

export function clipPath(shot: string, take: string) {
  if (/[^a-z0-9_-]/i.test(shot) || !/^[a-z]$/.test(take)) return null;
  const p = at("prev", `${shot}__${take}.mp4`);
  return existsSync(p) ? p : null;
}
export function posterPath(shot: string, take: string) {
  if (/[^a-z0-9_-]/i.test(shot) || !/^[a-z]$/.test(take)) return null;
  const p = at("prev", `${shot}__${take}.jpg`);
  return existsSync(p) ? p : null;
}
export function assetPath(name: string) {
  if (!/^[A-Z_]+\.mp4$/.test(name)) return null;
  const p = at(name);
  return existsSync(p) ? p : null;
}

/* ------------------------------------------------------------------ */
/*  La barra, e la ricostruzione                                        */
/* ------------------------------------------------------------------ */

export type GateRow = { n: string; text: string; ok: boolean | null };
export type Gate = {
  rows: GateRow[];
  outcome: "verde" | "rosso" | "sconosciuto";
  failed: string[];
  quando: number | null;
  /** True while `check.py` is running: the page draws immediately and the bar
   *  arrives afterwards. Measuring it costs a minute and a half of ffmpeg, and
   *  making the page wait for that is the sure way never to look at it again. */
  computing: boolean;
};

/**
 * The bar is RUN, not reimplemented.
 *
 * `check.py` is the only measurement. Rewriting its conditions here in
 * TypeScript would give two implementations that agree — and agreeing is not
 * verifying. The precedent is concrete: condition 5 measured the wrong thing
 * for two months (it counted identical frames and came out at 0%, but only
 * because grain alone passed the threshold on every frame). A second copy would
 * have had the same hole, and nobody would have noticed.
 *
 * Condition 2 prints one line per shot: a terminal detail, collapsed here into
 * a single line with the count of the ones that do not hold.
 */
let gateCache: { key: string; gate: Gate } | null = null;
let gateRunning: string | null = null;

/** The result if it is there, otherwise it puts it in the works and returns
 *  at once. */
export function gate(force = false): Gate {
  const check = at("check.py");
  const master = at(VIDEO_MASTER);
  if (!existsSync(check)) {
    return { rows: [], outcome: "sconosciuto", failed: [], quando: null, computing: false };
  }
  const key = existsSync(master) ? String(statSync(master).mtimeMs) : "senza-video";
  if (!force && gateCache?.key === key) return gateCache.gate;
  if (gateRunning === key) {
    return { ...(gateCache?.gate ?? { rows: [], outcome: "sconosciuto", failed: [], quando: null }), computing: true };
  }
  gateRunning = key;
  void measure(key).finally(() => { gateRunning = null; });
  return { ...(gateCache?.gate ?? { rows: [], outcome: "sconosciuto", failed: [], quando: null }), computing: true };
}

/**
 * The bar is measured on the PC, asynchronously. Two defects in a single line.
 *
 * It was `spawnSync`. Inside an async IIFE it looked like it had been set going,
 * but `spawnSync` stops Bun's only thread until the process dies: for the
 * ninety seconds of `check.py` the server answered nothing else. Measured:
 * `/api/video/shots` costs 45 ms on its own and over 60 seconds while the bar
 * "ran in the background" — and that is why the page opened empty.
 *
 * And it runs on the PC because `check.py` reads 49,000 frames to count new
 * frames per second: it is the same work `master.sh` already does over there,
 * on the same file, with the same numbers (compared line by line). If the PC
 * does not answer, the bar says so instead of silently redoing it on the Mac.
 */
async function measure(key: string): Promise<Gate> {
  const proc = Bun.spawn(
    ["ssh", "-o", "ConnectTimeout=20", PC, `cd /d ${REMOTO} && python check.py ${VIDEO_MASTER}`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [so, se] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const out = `${so}\n${se}`;
  const rows: GateRow[] = [];
  const failed: string[] = [];
  let inRosso = false;
  let repeated = 0;

  for (const raw of out.split("\n")) {
    const l = raw.trimEnd();
    if (/^ROSSO:/.test(l)) { inRosso = true; continue; }
    if (inRosso && /^\s+-\s/.test(l)) { failed.push(l.replace(/^\s+-\s/, "")); continue; }
    const m = /^(\d+b?)\.\s+(.*)$/.exec(l);
    if (!m) continue;
    const n = m[1] ?? "";
    const text = m[2] ?? "";
    if (n === "2") { if (/SI RIPETE/.test(text)) repeated++; continue; }
    if (n === "3") {
      // A dump of the levels, one shot per row on a single line: useful in a
      // terminal, a wall of numbers on a page. The count is what is kept.
      const howMany = (text.match(/=\d/g) ?? []).length;
      rows.push({ n, text: `livelli normalizzati su ${howMany} piani`, ok: true });
      continue;
    }
    rows.push({ n, text, ok: null });
  }
  rows.splice(1, 0, {
    n: "2",
    text: repeated
      ? `${repeated} piani ripassano il proprio girato oltre 2.5 volte`
      : "nessun piano ripassa il proprio girato oltre 2.5 volte",
    ok: repeated === 0,
  });

  const outcome: Gate["outcome"] = /VERDE/.test(out) ? "verde" : failed.length ? "rosso" : "sconosciuto";
  // A row is red if its text appears among the reasons for the failure.
  for (const r2 of rows) {
    if (r2.ok !== null) continue;
    const keys = (r2.text.match(/[a-zà-ù]{5,}/gi) ?? []).slice(0, 3);
    r2.ok = !failed.some((f) => keys.some((k) => f.toLowerCase().includes(k.toLowerCase())));
  }
  const b: Gate = { rows, outcome, failed, quando: Date.now(), computing: false };
  gateCache = { key, gate: b };
  return b;
}

export type Rebuild = {
  active: boolean;
  log: string;
  iniziata: number | null;
  finita: number | null;
  output: number | null;
};

let rebuild: Rebuild = { active: false, log: "", iniziata: null, finita: null, output: null };

export const rebuildState = () => rebuild;

/** Launches `master.sh`. One per project at a time: two runs in parallel
 *  fight over `_work/` and the second deletes the first one's frames. */
export function startRebuild(): { ok: boolean; error?: string } {
  if (rebuild.active) return { ok: false, error: "una ricostruzione e' gia' in corso" };
  const sh = at("master.sh");
  if (!existsSync(sh)) return { ok: false, error: "master.sh non trovato nel progetto" };
  rebuild = { active: true, log: "", iniziata: Date.now(), finita: null, output: null };
  const proc = Bun.spawn([sh], { cwd: videoRoot(), stdout: "pipe", stderr: "pipe" });

  const bevi = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const dec = new TextDecoder();
    for await (const chunk of stream as any) {
      rebuild.log = (rebuild.log + dec.decode(chunk)).slice(-60_000);
    }
  };
  void Promise.all([bevi(proc.stdout as any), bevi(proc.stderr as any)]);
  void proc.exited.then((code) => {
    rebuild.active = false;
    rebuild.finita = Date.now();
    rebuild.output = code;
    gateCache = null;            // the video changed: the bar has to be redone
  });
  return { ok: true };
}
