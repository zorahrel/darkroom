import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { rootDir } from "./project.ts";
import { RENDER_DIR, RENDER_SSH, VIDEO_AUDIO } from "./config.ts";

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
  inEdit: number;
  kept: boolean;
  /** Why it was dropped, when it was dropped by hand. */
  perche: string | null;
  /** Il verdetto di chi guarda, in tutt'e due i versi. `null` = mai passata
   *  sotto gli occhi, che è diverso da "tenuta" anche se sta nel montaggio. */
  giudizio: "tenuta" | "scartata" | null;
  judgedAt: number | null;
  /** Problems flagged from the editor. Not a verdict: a note for the next round. */
  problemi: string[];
  /** Perché questa ripresa merita di essere guardata per prima. Non è un
   *  verdetto: vedi `sospetto()`. `null` = niente di anomalo nei numeri. */
  suspect: string | null;
  /** Which generation it comes from: two halves of one take share this. */
  origine: string;
  /** The act it plays in, from `atti.json`. Null when it is not in the edit. */
  act: string | null;
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
  soundIntensity: number;
  /** The shot's own measured hardness: the other half of the pairing. Seeing
   *  the two side by side is what tells "ugly shot" from "wrong place". */
  shotIntensity: number | null;
  velocita: number;
  rovescio: boolean;
  act: string | null;
  origine: string;
};

/** `perche` e' la riga di storia che l'atto racconta — «lei cammina», «i piedi
 *  lasciano il fondo». La scrive `pianifica.py` in atti.json: senza, in Scelta
 *  si legge "atto cammino" e basta, che a chi giudica una ripresa non dice
 *  niente. Puo' mancare sui progetti generati prima del 27/08/2026. */
export type Act = { da: number; a: number; nome: string; t0: number; t1: number; perche?: string };

const readJson = <T,>(p: string, fallback: T): T => {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** La fonderia: dove si monta, si codifica e si misura. Gli stessi due valori
 *  che stanno in `master.sh` — il Mac e' l'autore, non il nodo di calcolo. */
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
/**
 * `null` non è un terzo capriccio: è lo stato in cui nasce ogni ripresa, e
 * senza di lui l'annulla mente.
 *
 * L'annulla della pagina ripristinava `kept`, che è un booleano — e una scena
 * mai giudicata ha `kept` vero, perché nessuno l'ha scartata. Disfare uno
 * scarto la scriveva quindi fra i TENUTI: premevi «annulla» su una scena che
 * non avevi mai visto e le davi un sì. Un annulla che lascia il verdetto
 * opposto è peggio del verdetto sbagliato, perché sembra di essere tornati
 * indietro. Misurato su `g_corr` il 04/09.
 */
export function setPick(shot: string, kept: boolean | null, perche?: string) {
  const s = picks() as Picks & { tenuti?: Record<string, number> };
  s.tenuti ??= {};
  if (kept === null) {
    delete s.scartati[shot];
    delete s.tenuti[shot];
  } else if (kept) {
    delete s.scartati[shot];
    s.tenuti[shot] = Date.now();
  } else {
    s.scartati[shot] = perche?.trim() || "scartato a mano";
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
 * La durezza decisa a mano, che vince su quella misurata.
 *
 * La misura mette in fila le riprese per movimento, contrasto e luce, e
 * sbaglia quando la forza di un'immagine non sta li' dentro: una figura ferma
 * che riempie il quadro picchia piu' di un'onda lontana che si agita. Finora
 * l'unico rimedio era scartare la ripresa — cioe' buttarla invece di
 * rimetterla al posto giusto.
 *
 * `null` toglie la forzatura e restituisce la parola alla misura.
 */
export function setManualIntensity(shot: string, value: number | null) {
  const s = picks() as Picks & { durezze?: Record<string, number> };
  s.durezze ??= {};
  if (value === null) delete s.durezze[shot];
  else s.durezze[shot] = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** La riga che dice cosa si vede, scritta a mano. Vince sul ritaglio del
 *  prompt, che e' solo un ritaglio. Stringa vuota = torna quello automatico. */
export function setDescription(shot: string, text: string) {
  const s = picks() as Picks & { descrizioni?: Record<string, string> };
  s.descrizioni ??= {};
  const t = text.trim();
  if (!t) delete s.descrizioni[shot];
  else s.descrizioni[shot] = t.slice(0, 240);
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s;
}

/** Toglie ogni verdetto da una ripresa: torna in coda come se non fosse mai
 *  passata sotto gli occhi. */
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
 * I marcatori: un appunto attaccato a un istante.
 *
 * Guardando il montaggio si nota una cosa in un secondo e la si perde nel
 * successivo — "qui il taglio arriva tardi", "questa gia' vista". Segnarla
 * altrove vuol dire perdere il punto esatto; segnarla qui vuol dire ritrovarla
 * al secondo giusto. Vivono in `scelte.json` come tutto il resto che l'occhio
 * decide, e il Python li ignora perche' non sono una scelta di montaggio.
 */
export function setMarker(t: number, nota: string | null) {
  const s = picks() as any;
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
export function overrides(): {
  pin: { bar: number; shot: string }[];
  durata: { bar: number; bars: number }[];
  discardedByHand: { shot: string; reason: string }[];
} {
  const s = picks();
  const daUI = (m: string) => /a mano|dalla timeline|prova del contratto|^$/i.test(m);
  return {
    pin: Object.entries(s.pin ?? {}).map(([b, p]) => ({ bar: Number(b), shot: String(p) }))
      .sort((a, b) => a.bar - b.bar),
    durata: Object.entries(s.durata ?? {}).map(([b, v]) => ({ bar: Number(b), bars: Number(v) }))
      .sort((a, b) => a.bar - b.bar),
    discardedByHand: Object.entries(s.scartati ?? {})
      .filter(([, m]) => daUI(String(m)))
      .map(([shot, reason]) => ({ shot, reason: String(reason) })),
  };
}

export function markers(): { t: number; nota: string }[] {
  const m = (picks() as any).marcatori ?? {};
  return Object.entries(m)
    .map(([k, v]) => ({ t: Number(k), nota: String(v) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Scambiare due tagli: ognuno prende il posto dell'altro.
 *
 * È il gesto che sulla timeline si fa trascinando un blocco sopra un altro, e
 * per come è fatto questo montaggio è anche l'unico movimento che ha senso: i
 * tagli non stanno dove capita, stanno su battute misurate, e ogni battuta ne
 * regge esattamente uno. Muovere un blocco "un po' più in là" non vorrebbe dire
 * niente — prendere il posto di un altro sì.
 *
 * Scritto in una volta sola, così un annulla rimette entrambi o nessuno.
 */
export function swap(barA: number, shotA: string, barB: number, shotB: string) {
  const s = picks();
  s.pin![String(barA)] = shotB;
  s.pin![String(barB)] = shotA;
  writeFileSync(at("scelte.json"), JSON.stringify(s, null, 1));
  return s.pin!;
}

/** Toglie l'inchiodatura da più battute in un colpo: è l'annulla di uno scambio. */
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
export function held(): { bar: number; garanzia: string }[] {
  return readJson<any>(at("plan.json"), {}).sospese ?? [];
}

const actOf = (bar: number, as: Act[]) =>
  as.find((a) => bar >= a.da && bar < a.a)?.nome ?? null;

/**
 * Il provino di una ripresa: dodici istanti in una striscia sola.
 *
 * Serve a rispondere a una domanda che nessuna misura di questo progetto ha
 * saputo rispondere — *dove* una ripresa si sminchia. Ci hanno provato in
 * quattro modi: bilancio tonale, area di dettaglio, salto della sagoma, e
 * (oggi) la non-liscezza della traiettoria e il disaccordo fra soggetto e
 * sfondo. Nessuno separa una figura che si disfa da un'onda che esplode,
 * perche' i difetti veri sono semantici: «scende in mezzo alle scale», «il
 * gabbiano non e' coerente fra un fotogramma e l'altro». Un modello per
 * immagini singole quei quadri li descrive come perfettamente normali.
 *
 * Quindi non si automatizza il giudizio: si rende istantaneo. Su una striscia
 * l'occhio trova il punto in cui la figura cambia identita' in un secondo,
 * mentre scorrere una clip di due secondi e mezzo avanti e indietro ne costa
 * dieci. E ogni casella porta il video al suo istante, cosi' il sospetto si
 * verifica senza cercare.
 */
export function take(shot: string, take: string, quanti = 12): string | null {
  const clip = at("prev", `${shot}__${take}.mp4`);
  if (!existsSync(clip)) return null;
  const fuori = at("provini");
  if (!existsSync(fuori)) mkdirSync(fuori, { recursive: true });
  const dest = join(fuori, `${shot}__${take}_${quanti}.jpg`);
  // Si rifa' solo se la clip e' cambiata dopo: un provino e' un derivato, e
  // rigenerarlo a ogni apertura vuol dire un ffmpeg per ogni scorrimento.
  if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(clip).mtimeMs) return dest;

  const r = Bun.spawnSync([
    "ffmpeg", "-v", "error", "-y", "-i", clip,
    // `thumbnail=n` prende UN quadro ogni n scegliendo il piu' rappresentativo:
    // su una clip di 61 quadri servono dodici istanti distribuiti, non i primi
    // dodici. `-frames:v 1` chiude dopo il primo mosaico.
    "-vf", `select='not(mod(n\,${Math.max(1, Math.floor(61 / quanti))}))',scale=180:-1,tile=${quanti}x1`,
    "-frames:v", "1", "-q:v", "4", dest,
  ]);
  if (r.exitCode !== 0 || !existsSync(dest)) return null;
  return dest;
}

/**
 * Perché questa ripresa va guardata per prima.
 *
 * **Non è una selezione automatica**, e non per prudenza: perché è stata
 * provata e non funziona. Metà degli scarti a mano di questo progetto ha una
 * motivazione che *sembra* misurabile — «ferma», «quasi tutto nero», «piatta e
 * grigia», «resta due fili bianchi sul nero» — e sono quindici riprese su 256.
 * La regola che ne prende di più (`moto < 2.5` oppure `contrasto < 38`) ne
 * becca dieci e ne sbaglia **quarantotto** delle 241 tenute: come cancello è
 * inservibile, perché fra le tenute ci sono riprese volutamente immobili che
 * arrivano a `moto` 0.22.
 *
 * Lo stesso numero però è ottimo come **ordine di lettura**: guardando per
 * prime le ventisei che escono, le dieci morte si trovano in un minuto e non
 * si è buttato via niente. Un filtro, non un verdetto — e con scritto accanto
 * cosa ha fatto scattare il sospetto, così si può dargli torto in un colpo
 * d'occhio.
 *
 * (L'altra metà degli scarti — «scende in mezzo alle scale», «il gabbiano non
 * è coerente fra un fotogramma e l'altro» — non è misurabile per niente:
 * cinque tentativi e un VLM per fotogramma, tutti falliti. Sta in
 * `SELEZIONE.md` del progetto, coi numeri.)
 */
/** Le toppe bianche piatte che il generatore incolla nel nero, misurate da
 *  `artefatti.py` e lasciate in `artefatti.json`. Non si misurano qui perche'
 *  costano un ffmpeg per clip: farlo alla richiesta vorrebbe dire far aspettare
 *  chi apre la griglia. Il file e' assente finche' nessuno ha scansionato, e in
 *  quel caso questa riga semplicemente non compare. */
function artifacts(): Record<string, { sporchi: number; visti: number; dev: number }> {
  return readJson(at("artefatti.json"), {});
}

function suspect(
  m: Record<string, number | undefined>,
  art?: { sporchi: number; visti: number },
): string | null {
  const moto = m.moto, contrasto = m.contrasto, nero = m.nero, luce = m.luce;
  const reasons: string[] = [];
  // Per primo, perche' e' l'unico che dice "e' rotta" invece di "e' fiacca".
  if (art && art.sporchi > 0)
    reasons.push(`macchie bianche in ${art.sporchi} fotogrammi su ${art.visti}`);
  if (typeof moto === "number" && moto < 2.5) reasons.push(`si muove poco (${moto.toFixed(1)})`);
  if (typeof contrasto === "number" && contrasto < 38) reasons.push(`poco contrasto (${Math.round(contrasto)})`);
  if (typeof nero === "number" && nero > 0.9) reasons.push(`quasi tutta nera (${Math.round(nero * 100)}%)`);
  if (typeof luce === "number" && luce < 0.015) reasons.push("buia");
  return reasons.length ? reasons.join(" · ") : null;
}

/**
 * Una riga che dice cosa si vede, ricavata dal prompt.
 *
 * I prompt di un progetto sono quasi tutti uguali: pellicola, notte, alto
 * contrasto, la stessa donna nello stesso cappotto. Cambia una frase sola —
 * l'inquadratura — ed e' l'unica che serve a capire una ripresa in mezzo
 * secondo. Quindi non si riassume: si tolgono le frasi che hanno TUTTE, e
 * resta quella che ha solo questa.
 *
 * La soglia e' un quarto del progetto: una frase che compare in una ripresa su
 * quattro descrive lo stile, non la scena.
 */
function descrizioni(prompts: Record<string, any>): Record<string, string> {
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
    // Se sono tutte in comune la ripresa non ha niente di suo da dire, e
    // scrivere il boilerplate sarebbe peggio che non scrivere niente.
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
  const descr = descrizioni(prompts);
  const manualIntensity = ((sc as any).durezze ?? {}) as Record<string, number>;
  const manual = ((sc as any).descrizioni ?? {}) as Record<string, string>;
  const discarded = sc.scartati;
  const kept = ((sc as any).tenuti ?? {}) as Record<string, number>;
  const problems = sc.problemi ?? {};
  const shotsOutside = sc.riprese ?? {};

  const inEdit: Record<string, number> = {};
  const firstTime: Record<string, number> = {};
  const actOfShot: Record<string, string> = {};
  /** OGNI volta che la ripresa entra, non solo la prima. Un totale di secondi
   *  non dice se sono un blocco unico o tre lampi sparsi nel brano, e sono due
   *  cose diverse da giudicare: una ripresa mediocre che passa tre volte pesa
   *  piu' di una bella che passa una volta sola. */
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
   * I piani generati sulla GPU tengono i fotogrammi la' — passa il cavo solo
   * l'anteprima. Elencare i piani leggendo `src/` qui li renderebbe invisibili
   * proprio nel momento in cui c'e' da giudicarli. Quindi l'elenco e' l'unione:
   * ciò che ha i fotogrammi qui, piu' ciò che ha almeno un'anteprima. Il conto
   * dei fotogrammi delle remote sta in `raccolte.json`, scritto a fine job.
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
      const qui = existsSync(join(srcDir, id));
      const files = qui ? readdirSync(join(srcDir, id)) : [];
      // Le riprese erano inchiodate ad a|b|c. I piani generati da testo hanno
      // solo la "a", ma il vincolo era comunque sbagliato nel verso opposto:
      // si ricavano da cio' che c'e' su disco.
      const lettere = qui
        ? [...new Set(files.map((f) => /^([a-z])_\d+\.png$/.exec(f)?.[1]).filter(Boolean) as string[])]
        : (fromPreview.get(id) ?? []);
      const takes: Take[] = lettere.sort()
        .map((tk) => ({
          take: tk,
          frames: qui
            ? files.filter((f) => f.startsWith(`${tk}_`)).length
            : (collected[`${id}__${tk}`]?.frames ?? 0),
          clip: `/api/video/clip/${id}/${tk}`,
          poster: `/api/video/poster/${id}/${tk}`,
          kept: !(shotsOutside[id] ?? []).includes(tk),
        }));
      const m = dz.piani?.[id] ?? {};
      // La chiave in artefatti.json e' "<piano>__<ripresa>": basta che UNA
      // ripresa sia sporca perche' il piano meriti un'occhiata.
      const art = (["a", "b", "c"]
        .map((tk) => arte[`${id}__${tk}`])
        .filter(Boolean) as { sporchi: number; visti: number; dev: number }[])
        .sort((x, y) => y.sporchi - x.sporchi)[0];
      const sos = suspect(m, art);
      return {
        id,
        prompt: prompts[id]?.prompt ?? prompts[`${id}_b`]?.prompt ?? "",
        // Quella scritta a mano vince: e' un giudizio, l'altra e' un ritaglio.
        descrizione: manual[id] ?? descr[id] ?? descr[`${id}_b`] ?? null,
        descrizioneAMano: manual[id] !== undefined,
        takes,
        durezza: manualIntensity[id] ?? m.durezza ?? null,
        measuredIntensity: m.durezza ?? null,
        manualIntensity: manualIntensity[id] ?? null,
        moto: m.moto ?? null,
        dettaglio: m.dettaglio ?? null,
        inEdit: Math.round((inEdit[id] ?? 0) * 10) / 10,
        kept: !(id in discarded),
        perche: discarded[id] ?? null,
        giudizio: (discarded[id] !== undefined ? "scartata" : kept[id] !== undefined ? "tenuta" : null) as Shot["giudizio"],
        judgedAt: kept[id] ?? null,
        problemi: problems[id] ?? [],
        suspect: sos,
        origine: origine(id),
        act: actOfShot[id] ?? null,
        minuto: firstTime[id] ?? null,
        apparizioni: apparizioni[id] ?? [],
        // Scartato a mano vs escluso dal pianificatore sono due cose diverse:
        // la prima si annulla da qui, la seconda ha una ragione scritta.
        escluso: id in discarded ? null : (esclusi.esclusi?.[id] ?? null),
      };
    })
    .sort((a, b) => (b.durezza ?? -1) - (a.durezza ?? -1));
}

/** The edit as a timeline: one entry per cut, already in seconds. */
export function cuts(): {
  cuts: Cut[];
  durata: number;
  bpm: number | null;
  atti: Act[];
  sospese: { bar: number; garanzia: string }[];
} {
  const plan = readJson<any>(at("plan.json"), { segments: [] });
  const bm = readJson<any>(at("beatmap.json"), {});
  const dz = readJson<any>(at("durezza.json"), { piani: {} });
  const as = acts();
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
      soundIntensity: s.durezza ?? 0,
      shotIntensity: dz.piani?.[s.shot]?.durezza ?? null,
      velocita: s.velocita ?? 1,
      rovescio: !!s.rovescio,
      act: actOf(s.bars[0], as),
      origine: origine(s.shot),
    };
  });
  const last = cuts.at(-1);
  return {
    cuts,
    durata: last ? last.t + last.dur : 0,
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
export type Wave = { picchi: number[]; beats: number[]; bars: number[]; durata: number; pronta: boolean };

let waveRunning = false;

export function wave(): Wave {
  const bm = readJson<any>(at("beatmap.json"), {});
  const beats: number[] = bm.beats ?? [];
  const duration = bm.duration_s ?? 0;
  // I confini di battuta: un beat ogni quattro. E' la griglia su cui il piano
  // ragiona (`bars`), quindi e' quella che va disegnata piu' marcata.
  const bars = beats.filter((_, i) => i % 4 === 0);

  const f = at("onda.json");
  if (existsSync(f)) {
    const d = readJson<any>(f, {});
    if (Array.isArray(d.picchi) && d.picchi.length) {
      return { picchi: d.picchi, beats, bars, durata: duration, pronta: true };
    }
  }
  if (!waveRunning) { waveRunning = true; void computeWave().finally(() => { waveRunning = false; }); }
  return { picchi: [], beats, bars, durata: duration, pronta: false };
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
    preview: pick("ANTEPRIMA.mp4"),
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

export type GateRow = { n: string; text: string; ok: boolean | null };
export type Gate = {
  rows: GateRow[];
  outcome: "verde" | "rosso" | "sconosciuto";
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
let gateCache: { key: string; gate: Gate } | null = null;
let gateRunning: string | null = null;

/** Il risultato se c'e', altrimenti lo mette in cantiere e torna subito. */
export function gate(force = false): Gate {
  const check = at("check.py");
  const master = at("LUNGOMARE.mp4");
  if (!existsSync(check)) {
    return { rows: [], outcome: "sconosciuto", fallite: [], quando: null, calcolo: false };
  }
  const key = existsSync(master) ? String(statSync(master).mtimeMs) : "senza-video";
  if (!force && gateCache?.key === key) return gateCache.gate;
  if (gateRunning === key) {
    return { ...(gateCache?.gate ?? { rows: [], outcome: "sconosciuto", fallite: [], quando: null }), calcolo: true };
  }
  gateRunning = key;
  void measure(key).finally(() => { gateRunning = null; });
  return { ...(gateCache?.gate ?? { rows: [], outcome: "sconosciuto", fallite: [], quando: null }), calcolo: true };
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
async function measure(key: string): Promise<Gate> {
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
  const rows: GateRow[] = [];
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
    const text = m[2] ?? "";
    if (n === "2") { if (/SI RIPETE/.test(text)) ripetuti++; continue; }
    if (n === "3") {
      // Dump dei livelli, un piano per riga in una riga sola: in terminale
      // serve, in pagina e' un muro di numeri. Si tiene il conto.
      const quanti = (text.match(/=\d/g) ?? []).length;
      rows.push({ n, text: `livelli normalizzati su ${quanti} piani`, ok: true });
      continue;
    }
    rows.push({ n, text, ok: null });
  }
  rows.splice(1, 0, {
    n: "2",
    text: ripetuti
      ? `${ripetuti} piani ripassano il proprio girato oltre 2.5 volte`
      : "nessun piano ripassa il proprio girato oltre 2.5 volte",
    ok: ripetuti === 0,
  });

  const outcome: Gate["outcome"] = /VERDE/.test(out) ? "verde" : fallite.length ? "rosso" : "sconosciuto";
  // Una riga e' rossa se il suo testo compare fra i motivi del fallimento.
  for (const r2 of rows) {
    if (r2.ok !== null) continue;
    const keys = (r2.text.match(/[a-zà-ù]{5,}/gi) ?? []).slice(0, 3);
    r2.ok = !fallite.some((f) => keys.some((k) => f.toLowerCase().includes(k.toLowerCase())));
  }
  const b: Gate = { rows, outcome, fallite, quando: Date.now(), calcolo: false };
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

/** Lancia `master.sh`. Uno per progetto alla volta: due giri in parallelo si
 *  contendono `_work/` e il secondo cancella i quadri del primo. */
export function startRebuild(): { ok: boolean; errore?: string } {
  if (rebuild.active) return { ok: false, errore: "una ricostruzione e' gia' in corso" };
  const sh = at("master.sh");
  if (!existsSync(sh)) return { ok: false, errore: "master.sh non trovato nel progetto" };
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
    gateCache = null;            // il video e' cambiato: la barra va rifatta
  });
  return { ok: true };
}
