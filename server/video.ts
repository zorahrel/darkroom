import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "./project.ts";

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
export type Shot = {
  id: string;
  prompt: string;
  takes: Take[];
  /** Measured, from durezza.json: 0 = calmest shot of the set, 1 = hardest. */
  durezza: number | null;
  moto: number | null;
  dettaglio: number | null;
  /** Seconds of screen time the current plan gives it. */
  inScena: number;
  kept: boolean;
  /** Why it was dropped, when it was dropped by hand. */
  perche: string | null;
  /** Problems flagged from the editor. Not a verdict: a note for the next round. */
  problemi: string[];
};

export type Cut = {
  t: number;
  dur: number;
  shot: string;
  durezzaSuono: number;
  velocita: number;
  rovescio: boolean;
  fermo: boolean;
};

const readJson = <T,>(p: string, fallback: T): T => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
};

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

type Scelte = {
  scartati: Record<string, string>;
  problemi?: Record<string, string[]>;
  /** Per-take rejections: two takes of the same shot are not worth the same,
   *  and dropping one should not cost you the whole shot. */
  riprese?: Record<string, string[]>;
};

export function scelte(): Scelte {
  const s = readJson<Scelte>(at("scelte.json"), { scartati: {} });
  if (!s.problemi) s.problemi = {};
  if (!s.riprese) s.riprese = {};
  return s;
}

/** A flagged problem is a note, not a rejection: it survives a regeneration and
 *  says what to look at. Two automatic metrics failed to separate ugly from
 *  good, so what the eye catches has to be written down somewhere the next
 *  round can read. */
export function segnalaProblema(shot: string, testo: string) {
  const s = scelte();
  const t = testo.trim();
  if (!t) return s;
  s.problemi![shot] = [...(s.problemi![shot] ?? []), t];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function togliProblema(shot: string, i: number) {
  const s = scelte();
  const l = s.problemi![shot] ?? [];
  s.problemi![shot] = l.filter((_, k) => k !== i);
  if (!s.problemi![shot].length) delete s.problemi![shot];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function setScelta(shot: string, kept: boolean, perche?: string) {
  const s = scelte();
  if (kept) delete s.scartati[shot];
  else s.scartati[shot] = perche?.trim() || "scartato a mano";
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function setRipresa(shot: string, take: string, kept: boolean) {
  const s = scelte();
  const l = new Set(s.riprese![shot] ?? []);
  if (kept) l.delete(take);
  else l.add(take);
  if (l.size) s.riprese![shot] = [...l].sort();
  else delete s.riprese![shot];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

export function shots(): Shot[] {
  const prompts = readJson<Record<string, any>>(at("prompts.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const t = beatClock(bm);
  const sc = scelte();
  const scartati = sc.scartati;
  const problemi = sc.problemi ?? {};
  const riprFuori = sc.riprese ?? {};

  const inScena: Record<string, number> = {};
  for (const seg of plan.segments ?? []) {
    const [b0, b1] = seg.bars;
    inScena[seg.shot] = (inScena[seg.shot] ?? 0) + (t(b1) - t(b0));
  }

  const srcDir = at("src");
  const names = existsSync(srcDir)
    ? readdirSync(srcDir).filter((n) => !n.startsWith("."))
    : [];

  return names
    .map((id) => {
      const files = readdirSync(join(srcDir, id));
      const takes: Take[] = ["a", "b", "c"]
        .filter((tk) => files.some((f) => f.startsWith(`${tk}_`)))
        .map((tk) => ({
          take: tk,
          frames: files.filter((f) => f.startsWith(`${tk}_`)).length,
          clip: `/api/video/clip/${id}/${tk}`,
          poster: `/api/video/poster/${id}/${tk}`,
          kept: !(riprFuori[id] ?? []).includes(tk),
        }));
      const m = dz.piani?.[id] ?? {};
      return {
        id,
        prompt: prompts[id]?.prompt ?? prompts[`${id}_b`]?.prompt ?? "",
        takes,
        durezza: m.durezza ?? null,
        moto: m.moto ?? null,
        dettaglio: m.dettaglio ?? null,
        inScena: Math.round((inScena[id] ?? 0) * 10) / 10,
        kept: !(id in scartati),
        perche: scartati[id] ?? null,
        problemi: problemi[id] ?? [],
      };
    })
    .sort((a, b) => (b.durezza ?? -1) - (a.durezza ?? -1));
}

/** The edit as a timeline: one entry per cut, already in seconds. */
export function cuts(): { cuts: Cut[]; durata: number; bpm: number | null } {
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const t = beatClock(bm);
  const cuts: Cut[] = (plan.segments ?? []).map((s: any) => {
    const t0 = t(s.bars[0]);
    return {
      t: Math.round(t0 * 1000) / 1000,
      dur: Math.round((t(s.bars[1]) - t0) * 1000) / 1000,
      shot: s.shot,
      durezzaSuono: s.durezza ?? 0,
      velocita: s.velocita ?? 1,
      rovescio: !!s.rovescio,
      fermo: Number(s.subdiv) <= 0,
    };
  });
  const ultimo = cuts.at(-1);
  return {
    cuts,
    durata: ultimo ? ultimo.t + ultimo.dur : 0,
    bpm: bm.tempo_bpm ?? null,
  };
}

/** Files the page plays. `reel` is the delivery encode, `anteprima` the light one. */
export function assets() {
  const pick = (...names: string[]) => names.find((n) => existsSync(at(n))) ?? null;
  return {
    anteprima: pick("ANTEPRIMA.mp4"),
    reel: pick("REEL.mp4"),
    master: pick("LUNGOMARE.mp4"),
  };
}

export function clipPath(shot: string, take: string) {
  if (/[^a-z0-9_-]/i.test(shot) || !/^[abc]$/.test(take)) return null;
  const p = at("prev", `${shot}__${take}.mp4`);
  return existsSync(p) ? p : null;
}
export function posterPath(shot: string, take: string) {
  if (/[^a-z0-9_-]/i.test(shot) || !/^[abc]$/.test(take)) return null;
  const p = at("prev", `${shot}__${take}.jpg`);
  return existsSync(p) ? p : null;
}
export function assetPath(name: string) {
  if (!/^[A-Z_]+\.mp4$/.test(name)) return null;
  const p = at(name);
  return existsSync(p) ? p : null;
}
