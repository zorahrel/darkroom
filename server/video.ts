import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * Da quale generazione viene una ripresa: il nome senza le cifre finali.
 *
 * `z43_0` e `z43_1` non sono due riprese, sono due meta' della stessa presa —
 * stesso seme, stessa inquadratura. Contando i nomi il montaggio dichiarava 122
 * riprese diverse; contando le origini ne aveva 48, e quarantanove volte due
 * pezzi della stessa presa passavano a meno di otto secondi l'uno dall'altro.
 *
 * Si toglie UNA sola cifra finale, e solo se prima c'e' qualcosa che cifra non
 * e'. Togliendole tutte si univa troppo: `k00` e `k15` diventavano entrambi
 * `k`, cioe' sedici riprese di mare diverse trattate come pezzi della stessa
 * presa. Misurato sui descrittori: la famiglia `k` cosi' unita si somiglia
 * 0.705 e la `x` 0.761 — non sono la stessa cosa. Con una cifra sola le
 * famiglie stanno fra 0.75 e 0.99, che e' il campo giusto.
 *
 * La stessa funzione vive in `pianifica.py`. E' una definizione, non una
 * politica: duplicarla costa una riga e i test dicono se le due divergono.
 */
export const origine = (shot: string) => {
  const m = /^(.*[^0-9])_?[0-9]$/.exec(shot);
  return m?.[1]?.replace(/_+$/, "") ?? shot;
};
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
  /** Il verdetto di chi guarda, in tutt'e due i versi. `null` = mai passata
   *  sotto gli occhi, che è diverso da "tenuta" anche se sta nel montaggio. */
  giudizio: "tenuta" | "scartata" | null;
  giudicataIl: number | null;
  /** Problems flagged from the editor. Not a verdict: a note for the next round. */
  problemi: string[];
  /** Which generation it comes from: two halves of one take share this. */
  origine: string;
  /** The act it plays in, from `atti.json`. Null when it is not in the edit. */
  atto: string | null;
  /** Seconds into the film where it first appears, null when unused. */
  minuto: number | null;
  /** Why it is out, when it was excluded by the planner rather than by hand. */
  escluso: string | null;
};

export type Cut = {
  t: number;
  dur: number;
  bar: number;
  shot: string;
  durezzaSuono: number;
  /** The shot's own measured hardness: the other half of the pairing. Seeing
   *  the two side by side is what tells "ugly shot" from "wrong place". */
  durezzaPiano: number | null;
  velocita: number;
  rovescio: boolean;
  atto: string | null;
  origine: string;
};

export type Atto = { da: number; a: number; nome: string; t0: number; t1: number };

const readJson = <T,>(p: string, fallback: T): T => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** La fonderia: dove si monta, si codifica e si misura. Gli stessi due valori
 *  che stanno in `master.sh` — il Mac e' l'autore, non il nodo di calcolo. */
const PC = "<utente>@$COMFY_HOST";
const REMOTO = "D:\\progetto";

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
  /** Forced choices from the editor, read back by `pianifica.py`. Few, and
   *  declared: everything else stays derived. */
  pin?: Record<string, string>;
  durata?: Record<string, number>;
};

export function scelte(): Scelte {
  const s = readJson<Scelte>(at("scelte.json"), { scartati: {} });
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

/**
 * Il verdetto su una ripresa, tenuto in tutt'e due i versi.
 *
 * Prima "tieni" cancellava soltanto la riga da `scartati`, e tenere è lo stato
 * di partenza: premere il tasto su cento scene non lasciava nessuna traccia. La
 * coda "da giudicare" restava lunga uguale, e "quali ho già approvato?" era una
 * domanda senza risposta — l'unico giudizio registrato era quello negativo.
 *
 * Ora si scrive anche il sì, con quando. `pianifica.py` legge solo `scartati`,
 * quindi il piano non se ne accorge: è memoria di chi guarda, non una scelta di
 * montaggio.
 */
export function setScelta(shot: string, kept: boolean, perche?: string) {
  const s = scelte() as Scelte & { tenuti?: Record<string, number> };
  s.tenuti ??= {};
  if (kept) {
    delete s.scartati[shot];
    s.tenuti[shot] = Date.now();
  } else {
    s.scartati[shot] = perche?.trim() || "scartato a mano";
    delete s.tenuti[shot];
  }
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** Toglie ogni verdetto da una ripresa: torna in coda come se non fosse mai
 *  passata sotto gli occhi. */
export function annullaGiudizio(shot: string) {
  const s = scelte() as Scelte & { tenuti?: Record<string, number> };
  delete s.scartati[shot];
  if (s.tenuti) delete s.tenuti[shot];
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

/** Nail a shot to a bar. The planner reads it back and says, in the plan, which
 *  guarantee the pin suspended — a forced edit is allowed, a silent one is not. */
export function setPin(bar: number, shot: string | null) {
  const s = scelte();
  if (shot) s.pin![String(bar)] = shot;
  else delete s.pin![String(bar)];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/**
 * I marcatori: un appunto attaccato a un istante.
 *
 * Guardando il montaggio si nota una cosa in un secondo e la si perde nel
 * successivo — "qui il taglio arriva tardi", "questa gia' vista". Segnarla
 * altrove vuol dire perdere il punto esatto; segnarla qui vuol dire ritrovarla
 * al secondo giusto. Vivono in `scelte.json` come tutto il resto che l'occhio
 * decide, e il Python li ignora perche' non sono una scelta di montaggio.
 */
export function setMarcatore(t: number, nota: string | null) {
  const s = scelte() as any;
  s.marcatori ??= {};
  const k = t.toFixed(2);
  if (nota) s.marcatori[k] = nota; else delete s.marcatori[k];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s.marcatori as Record<string, string>;
}

/**
 * Tutto ciò che è stato forzato a mano.
 *
 * Il montaggio è derivato: quello che si vede è il risultato di misure. Le
 * forzature sono le uniche cose che non lo sono, e finché restavano scritte
 * solo dentro `scelte.json` erano invisibili — un clic di troppo su un provino
 * inchiodava una battuta e nessuno se ne accorgeva fino alla ricostruzione
 * dopo. Un cambiamento che non si vede è un cambiamento che non si può
 * disfare, quindi qui si elencano.
 */
export function forzature(): {
  pin: { battuta: number; piano: string }[];
  durata: { battuta: number; battute: number }[];
  scartatiAMano: { piano: string; motivo: string }[];
} {
  const s = scelte();
  const daUI = (m: string) => /a mano|dalla timeline|prova del contratto|^$/i.test(m);
  return {
    pin: Object.entries(s.pin ?? {}).map(([b, p]) => ({ battuta: Number(b), piano: String(p) }))
      .sort((a, b) => a.battuta - b.battuta),
    durata: Object.entries(s.durata ?? {}).map(([b, v]) => ({ battuta: Number(b), battute: Number(v) }))
      .sort((a, b) => a.battuta - b.battuta),
    scartatiAMano: Object.entries(s.scartati ?? {})
      .filter(([, m]) => daUI(String(m)))
      .map(([piano, motivo]) => ({ piano, motivo: String(motivo) })),
  };
}

export function marcatori(): { t: number; nota: string }[] {
  const m = (scelte() as any).marcatori ?? {};
  return Object.entries(m)
    .map(([k, v]) => ({ t: Number(k), nota: String(v) }))
    .sort((a, b) => a.t - b.t);
}

/** Force a block's length, in bars. */
export function setDurata(bar: number, bars: number | null) {
  const s = scelte();
  if (bars && bars > 0) s.durata![String(bar)] = bars;
  else delete s.durata![String(bar)];
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** The story, from `atti.json`. Empty when the planner does not write it: the
 *  page then draws no bands rather than inventing a division. */
export function atti(): Atto[] {
  return readJson<Atto[]>(at("atti.json"), []);
}

/** Guarantees a forced edit suspended, as recorded by the planner. */
export function sospese(): { battuta: number; garanzia: string }[] {
  return readJson<any>(at("plan.json"), {}).sospese ?? [];
}

const attoDi = (bar: number, as: Atto[]) =>
  as.find((a) => bar >= a.da && bar < a.a)?.nome ?? null;

export function shots(): Shot[] {
  const prompts = readJson<Record<string, any>>(at("prompts.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const t = beatClock(bm);
  const sc = scelte();
  const as = atti();
  const esclusi = readJson<any>(at("esclusi.json"), { esclusi: {}, dall_editor: {} });
  const scartati = sc.scartati;
  const tenuti = ((sc as any).tenuti ?? {}) as Record<string, number>;
  const problemi = sc.problemi ?? {};
  const riprFuori = sc.riprese ?? {};

  const inScena: Record<string, number> = {};
  const primaVolta: Record<string, number> = {};
  const attoDelPiano: Record<string, string> = {};
  for (const seg of plan.segments ?? []) {
    const [b0, b1] = seg.bars;
    inScena[seg.shot] = (inScena[seg.shot] ?? 0) + (t(b1) - t(b0));
    if (primaVolta[seg.shot] === undefined) primaVolta[seg.shot] = t(b0);
    const a = attoDi(b0, as);
    if (a && !attoDelPiano[seg.shot]) attoDelPiano[seg.shot] = a;
  }

  const srcDir = at("src");
  const locali = existsSync(srcDir)
    ? readdirSync(srcDir).filter((n) => !n.startsWith("."))
    : [];

  /**
   * I piani generati sulla GPU tengono i fotogrammi la' — passa il cavo solo
   * l'anteprima. Elencare i piani leggendo `src/` qui li renderebbe invisibili
   * proprio nel momento in cui c'e' da giudicarli. Quindi l'elenco e' l'unione:
   * ciò che ha i fotogrammi qui, piu' ciò che ha almeno un'anteprima. Il conto
   * dei fotogrammi delle remote sta in `raccolte.json`, scritto a fine job.
   */
  const raccolte = readJson<Record<string, { frames?: number }>>(at("raccolte.json"), {});
  const prevDir = at("prev");
  const daAnteprima = new Map<string, string[]>();
  if (existsSync(prevDir)) {
    for (const f of readdirSync(prevDir)) {
      const m = /^(.+)__([a-z])\.mp4$/.exec(f);
      if (m?.[1] && m[2]) daAnteprima.set(m[1], [...(daAnteprima.get(m[1]) ?? []), m[2]]);
    }
  }
  const names = [...new Set([...locali, ...daAnteprima.keys()])].sort();

  return names
    .map((id) => {
      const qui = existsSync(join(srcDir, id));
      const files = qui ? readdirSync(join(srcDir, id)) : [];
      // Le riprese erano inchiodate ad a|b|c. I piani generati da testo hanno
      // solo la "a", ma il vincolo era comunque sbagliato nel verso opposto:
      // si ricavano da cio' che c'e' su disco.
      const lettere = qui
        ? [...new Set(files.map((f) => /^([a-z])_\d+\.png$/.exec(f)?.[1]).filter(Boolean) as string[])]
        : (daAnteprima.get(id) ?? []);
      const takes: Take[] = lettere.sort()
        .map((tk) => ({
          take: tk,
          frames: qui
            ? files.filter((f) => f.startsWith(`${tk}_`)).length
            : (raccolte[`${id}__${tk}`]?.frames ?? 0),
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
        giudizio: (scartati[id] !== undefined ? "scartata" : tenuti[id] !== undefined ? "tenuta" : null) as Shot["giudizio"],
        giudicataIl: tenuti[id] ?? null,
        problemi: problemi[id] ?? [],
        origine: origine(id),
        atto: attoDelPiano[id] ?? null,
        minuto: primaVolta[id] ?? null,
        // Scartato a mano vs escluso dal pianificatore sono due cose diverse:
        // la prima si annulla da qui, la seconda ha una ragione scritta.
        escluso: id in scartati ? null : (esclusi.esclusi?.[id] ?? null),
      };
    })
    .sort((a, b) => (b.durezza ?? -1) - (a.durezza ?? -1));
}

/** The edit as a timeline: one entry per cut, already in seconds. */
export function cuts(): {
  cuts: Cut[];
  durata: number;
  bpm: number | null;
  atti: Atto[];
  sospese: { battuta: number; garanzia: string }[];
} {
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const as = atti();
  const t = beatClock(bm);
  // `fermo` controllava `subdiv <= 0`. Col movimento pieno subdiv vale ~51 su
  // ogni segmento: la condizione non e' mai vera e la legenda mostrava un
  // colore che nessun blocco poteva avere.
  const cuts: Cut[] = (plan.segments ?? []).map((s: any) => {
    const t0 = t(s.bars[0]);
    return {
      t: Math.round(t0 * 1000) / 1000,
      dur: Math.round((t(s.bars[1]) - t0) * 1000) / 1000,
      bar: s.bars[0],
      shot: s.shot,
      durezzaSuono: s.durezza ?? 0,
      durezzaPiano: dz.piani?.[s.shot]?.durezza ?? null,
      velocita: s.velocita ?? 1,
      rovescio: !!s.rovescio,
      atto: attoDi(s.bars[0], as),
      origine: origine(s.shot),
    };
  });
  const ultimo = cuts.at(-1);
  return {
    cuts,
    durata: ultimo ? ultimo.t + ultimo.dur : 0,
    bpm: bm.tempo_bpm ?? null,
    atti: as,
    sospese: plan.sospese ?? [],
  };
}

/** Files the page plays. `reel` is the delivery encode, `anteprima` the light one. */
/**
 * La forma d'onda del brano, i beat e i confini di battuta.
 *
 * Questo montaggio e' agganciato ai beat: ogni taglio cade su un beat misurato
 * e la scelta della ripresa segue la durezza del suono. Senza il suono in
 * pagina, la timeline mostra il risultato e nasconde la ragione — si vede *che*
 * il taglio e' li', non *perche'*. Con l'onda sotto, un taglio fuori posto si
 * vede prima di sentirlo.
 *
 * I picchi si calcolano una volta e restano in `onda.json`: decodificare due
 * minuti e mezzo di mp3 costa un secondo, ma non a ogni apertura di pagina.
 */
export type Onda = { picchi: number[]; beats: number[]; battute: number[]; durata: number; pronta: boolean };

let ondaInCorso = false;

export function onda(): Onda {
  const bm = readJson<any>(at("beatmap.json"), {});
  const beats: number[] = bm.beats ?? [];
  const durata = bm.duration_s ?? 0;
  // I confini di battuta: un beat ogni quattro. E' la griglia su cui il piano
  // ragiona (`bars`), quindi e' quella che va disegnata piu' marcata.
  const battute = beats.filter((_, i) => i % 4 === 0);

  const f = at("onda.json");
  if (existsSync(f)) {
    const d = readJson<any>(f, {});
    if (Array.isArray(d.picchi) && d.picchi.length) {
      return { picchi: d.picchi, beats, battute, durata, pronta: true };
    }
  }
  if (!ondaInCorso) { ondaInCorso = true; void calcolaOnda().finally(() => { ondaInCorso = false; }); }
  return { picchi: [], beats, battute, durata, pronta: false };
}

async function calcolaOnda(): Promise<void> {
  const audio = join(videoRoot(), "..", "progetto [112].mp3");
  if (!existsSync(audio)) return;
  // Mono, 8 kHz, interi con segno: per un profilo di ampiezza basta e avanza, e
  // sono 1,2 MB invece di 25.
  const proc = Bun.spawn(
    ["ffmpeg", "-v", "error", "-i", audio, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buf = new Int16Array((await new Response(proc.stdout).arrayBuffer()));
  await proc.exited;
  if (!buf.length) return;
  const N = 2400;                        // un picco ogni ~60 ms su due minuti e mezzo
  const per = Math.max(1, Math.floor(buf.length / N));
  const picchi: number[] = [];
  for (let i = 0; i < N; i++) {
    let max = 0;
    for (let k = i * per; k < Math.min((i + 1) * per, buf.length); k++) {
      const v = Math.abs(buf[k] ?? 0);
      if (v > max) max = v;
    }
    picchi.push(Math.round((max / 32768) * 1000) / 1000);
  }
  writeFileSync(at("onda.json"), JSON.stringify({ picchi }));
}

export function assets() {
  const pick = (...names: string[]) => names.find((n) => existsSync(at(n))) ?? null;
  return {
    anteprima: pick("ANTEPRIMA.mp4"),
    reel: pick("REEL.mp4"),
    master: pick("LUNGOMARE.mp4"),
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

export type RigaBarra = { n: string; testo: string; ok: boolean | null };
export type Barra = {
  righe: RigaBarra[];
  esito: "verde" | "rosso" | "sconosciuto";
  fallite: string[];
  quando: number | null;
  /** Vera mentre `check.py` sta girando: la pagina si disegna subito e la
   *  barra arriva dopo. Misurarla costa un minuto e mezzo di ffmpeg, e far
   *  aspettare la pagina per quello e' il modo sicuro di non guardarla piu'. */
  calcolo: boolean;
};

/**
 * La barra si ESEGUE, non si reimplementa.
 *
 * `check.py` e' l'unica misura. Riscriverne le condizioni qui in TypeScript
 * darebbe due implementazioni che concordano — e concordare non e' verificare.
 * Il precedente e' concreto: la condizione 5 ha misurato per due mesi la cosa
 * sbagliata (contava i fotogrammi identici e usciva 0%, ma solo perche' la
 * grana da sola superava la soglia su ogni fotogramma). Una seconda copia
 * avrebbe avuto lo stesso buco, e nessuno se ne sarebbe accorto.
 *
 * La condizione 2 stampa una riga per piano: e' un dettaglio da terminale, qui
 * si collassa in una riga sola col conto di quelli che non tengono.
 */
let barraCache: { chiave: string; barra: Barra } | null = null;
let barraInCorso: string | null = null;

/** Il risultato se c'e', altrimenti lo mette in cantiere e torna subito. */
export function barra(force = false): Barra {
  const check = at("check.py");
  const master = at("LUNGOMARE.mp4");
  if (!existsSync(check)) {
    return { righe: [], esito: "sconosciuto", fallite: [], quando: null, calcolo: false };
  }
  const chiave = existsSync(master) ? String(statSync(master).mtimeMs) : "senza-video";
  if (!force && barraCache?.chiave === chiave) return barraCache.barra;
  if (barraInCorso === chiave) {
    return { ...(barraCache?.barra ?? { righe: [], esito: "sconosciuto", fallite: [], quando: null }), calcolo: true };
  }
  barraInCorso = chiave;
  void misura(chiave).finally(() => { barraInCorso = null; });
  return { ...(barraCache?.barra ?? { righe: [], esito: "sconosciuto", fallite: [], quando: null }), calcolo: true };
}

/**
 * La barra si misura sul PC, in asincrono. Due difetti in una riga sola.
 *
 * Era `spawnSync`. Dentro un IIFE asincrono sembrava messa in cantiere, ma
 * `spawnSync` ferma l'unico thread di Bun finche' il processo non muore: per i
 * novanta secondi di `check.py` il server non rispondeva a nient'altro.
 * Misurato: `/api/video/shots` costa 45 ms da solo e oltre 60 secondi mentre la
 * barra "girava in sottofondo" — ed e' per questo che la pagina si apriva vuota.
 *
 * E gira sul PC perche' `check.py` legge 49.000 fotogrammi per contare i quadri
 * nuovi al secondo: e' lo stesso lavoro che `master.sh` fa gia' la', sullo
 * stesso file, con gli stessi numeri (confrontati riga per riga). Se il PC non
 * risponde la barra lo dice, invece di rifarsi in silenzio addosso al Mac.
 */
async function misura(chiave: string): Promise<Barra> {
  const proc = Bun.spawn(
    ["ssh", "-o", "ConnectTimeout=20", PC, `cd /d ${REMOTO} && python check.py LUNGOMARE.mp4`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [so, se] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const out = `${so}\n${se}`;
  const righe: RigaBarra[] = [];
  const fallite: string[] = [];
  let inRosso = false;
  let ripetuti = 0;

  for (const raw of out.split("\n")) {
    const l = raw.trimEnd();
    if (/^ROSSO:/.test(l)) { inRosso = true; continue; }
    if (inRosso && /^\s+-\s/.test(l)) { fallite.push(l.replace(/^\s+-\s/, "")); continue; }
    const m = /^(\d+b?)\.\s+(.*)$/.exec(l);
    if (!m) continue;
    const n = m[1] ?? "";
    const testo = m[2] ?? "";
    if (n === "2") { if (/SI RIPETE/.test(testo)) ripetuti++; continue; }
    if (n === "3") {
      // Dump dei livelli, un piano per riga in una riga sola: in terminale
      // serve, in pagina e' un muro di numeri. Si tiene il conto.
      const quanti = (testo.match(/=\d/g) ?? []).length;
      righe.push({ n, testo: `livelli normalizzati su ${quanti} piani`, ok: true });
      continue;
    }
    righe.push({ n, testo, ok: null });
  }
  righe.splice(1, 0, {
    n: "2",
    testo: ripetuti
      ? `${ripetuti} piani ripassano il proprio girato oltre 2.5 volte`
      : "nessun piano ripassa il proprio girato oltre 2.5 volte",
    ok: ripetuti === 0,
  });

  const esito: Barra["esito"] = /VERDE/.test(out) ? "verde" : fallite.length ? "rosso" : "sconosciuto";
  // Una riga e' rossa se il suo testo compare fra i motivi del fallimento.
  for (const r2 of righe) {
    if (r2.ok !== null) continue;
    const chiavi = (r2.testo.match(/[a-zà-ù]{5,}/gi) ?? []).slice(0, 3);
    r2.ok = !fallite.some((f) => chiavi.some((k) => f.toLowerCase().includes(k.toLowerCase())));
  }
  const b: Barra = { righe, esito, fallite, quando: Date.now(), calcolo: false };
  barraCache = { chiave, barra: b };
  return b;
}

export type Ricostruzione = {
  attiva: boolean;
  log: string;
  iniziata: number | null;
  finita: number | null;
  uscita: number | null;
};

let ricostruzione: Ricostruzione = { attiva: false, log: "", iniziata: null, finita: null, uscita: null };

export const statoRicostruzione = () => ricostruzione;

/** Lancia `master.sh`. Uno per progetto alla volta: due giri in parallelo si
 *  contendono `_work/` e il secondo cancella i quadri del primo. */
export function ricostruisci(): { ok: boolean; errore?: string } {
  if (ricostruzione.attiva) return { ok: false, errore: "una ricostruzione e' gia' in corso" };
  const sh = at("master.sh");
  if (!existsSync(sh)) return { ok: false, errore: "master.sh non trovato nel progetto" };
  ricostruzione = { attiva: true, log: "", iniziata: Date.now(), finita: null, uscita: null };
  const proc = Bun.spawn([sh], { cwd: videoRoot(), stdout: "pipe", stderr: "pipe" });

  const bevi = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const dec = new TextDecoder();
    for await (const chunk of stream as any) {
      ricostruzione.log = (ricostruzione.log + dec.decode(chunk)).slice(-60_000);
    }
  };
  void Promise.all([bevi(proc.stdout as any), bevi(proc.stderr as any)]);
  void proc.exited.then((code) => {
    ricostruzione.attiva = false;
    ricostruzione.finita = Date.now();
    ricostruzione.uscita = code;
    barraCache = null;            // il video e' cambiato: la barra va rifatta
  });
  return { ok: true };
}
