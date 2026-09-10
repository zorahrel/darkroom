/**
 * Il girato: si sceglie cosa tenere, non si monta.
 *
 * È la stessa domanda del culling, posta al video. Da una giornata di riprese escono
 * trecento clip e in montaggio ne entrano trenta: il lavoro di sfoltire viene prima,
 * e farlo dentro un programma di montaggio significa aprire un progetto, importare
 * tutto e navigare una timeline per rispondere a una domanda che è «questa la tengo?».
 *
 * Distinto da `server/video.ts`, che è un'altra cosa e vale la pena dirlo: quello
 * cura il video *generato* dall'AI, questo il girato di una macchina da presa.
 *
 * Il confine è netto e non si sposta: **qui non si monta**. Si tiene, si scarta, si
 * segna dove attacca e dove stacca, si riordina. Il materiale sfoltito esce verso il
 * programma con cui si monta davvero, e le clip non vengono mai toccate.
 */

import { spawn } from "bun";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * I contenitori che si provano ad aprire.
 *
 * L'estensione dice cosa un file *dovrebbe* essere, non cosa è: BRAW e R3D hanno
 * l'estensione di un video e senza l'SDK del produttore non si aprono. Per questo
 * l'elenco serve a decidere cosa *provare*, e l'esito lo dà il tentativo.
 */
export const ESTENSIONI = new Set([
  ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm",
  ".mts", ".m2ts", ".mxf", ".braw", ".r3d",
]);

export const FILE_SCELTE = "Darkroom_Girato.json";

export type Clip = {
  /** Il nome del file: è l'identità della clip, e non cambia. */
  nome: string;
  percorso: string;
  byte: number;
  /** Durata in secondi. `null` quando il contenitore non si apre. */
  durata: number | null;
  larghezza: number | null;
  altezza: number | null;
  fotogrammiAlSecondo: number | null;
  /** Falso quando la clip non ha traccia audio: serve a spiegare un silenzio. */
  conAudio: boolean;
  /** Perché non si è potuta leggere, quando non si è potuta leggere. */
  illeggibile: string | null;
  /** Vero quando è il video di una Live Photo, non girato vero. */
  livePhoto: boolean;
};

export type Scelta = {
  nome: string;
  /** `false` = scartata. Le scartate restano nell'elenco: scartare non è cancellare. */
  tenuta: boolean;
  /** Secondo in cui attacca. `null` = dall'inizio. */
  attacco: number | null;
  /** Secondo in cui stacca. `null` = fino alla fine. */
  stacco: number | null;
  /** Posizione nella fila. Le clip tenute si riordinano; le scartate no. */
  posizione: number;
  nota: string | null;
};

export type Scelte = {
  versione: 1;
  aggiornato: number;
  clip: Scelta[];
};

async function guscio(cmd: string[]): Promise<{ uscita: string; codice: number }> {
  const p = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  const uscita = await new Response(p.stdout).text();
  return { uscita, codice: await p.exited };
}

/**
 * Riconosce il video di una Live Photo: una fotografia con lo stesso nome accanto.
 *
 * Non è girato, e in una cartella di scatti ce ne sono a centinaia: mescolarli alle
 * riprese vere vuol dire far scorrere trecento clip da tre secondi per trovarne dieci.
 */
function eLivePhoto(nomeFile: string, nellaCartella: Set<string>): boolean {
  const base = nomeFile.slice(0, -extname(nomeFile).length).toLowerCase();
  for (const altro of nellaCartella) {
    if (altro === nomeFile.toLowerCase()) continue;
    const e = extname(altro);
    if (![".jpg", ".jpeg", ".heic", ".png", ".dng"].includes(e)) continue;
    if (altro.slice(0, -e.length) === base) return true;
  }
  return false;
}

/** Legge durata, dimensioni e presenza di audio senza decodificare un fotogramma. */
export async function leggiClip(percorso: string, livePhoto = false): Promise<Clip> {
  const base: Clip = {
    nome: basename(percorso),
    percorso,
    byte: existsSync(percorso) ? statSync(percorso).size : 0,
    durata: null,
    larghezza: null,
    altezza: null,
    fotogrammiAlSecondo: null,
    conAudio: false,
    illeggibile: null,
    livePhoto,
  };

  const { uscita, codice } = await guscio([
    "ffprobe", "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    percorso,
  ]);
  if (codice !== 0 || !uscita.trim()) {
    // Un contenitore che non si apre non è un guasto del programma: è una clip che
    // richiede l'SDK del produttore, e va detto invece di nasconderla.
    return { ...base, illeggibile: "il contenitore non si apre con ffprobe" };
  }
  try {
    const j = JSON.parse(uscita) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }[];
    };
    const video = j.streams?.find((s) => s.codec_type === "video");
    const durata = Number(j.format?.duration);
    let fps: number | null = null;
    if (video?.avg_frame_rate) {
      const [n, d] = video.avg_frame_rate.split("/").map(Number);
      if (n && d) fps = Math.round((n / d) * 100) / 100;
    }
    return {
      ...base,
      durata: Number.isFinite(durata) ? durata : null,
      larghezza: video?.width ?? null,
      altezza: video?.height ?? null,
      fotogrammiAlSecondo: fps,
      conAudio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
      illeggibile: video ? null : "nessuna traccia video",
    };
  } catch (e) {
    return { ...base, illeggibile: e instanceof Error ? e.message : String(e) };
  }
}

/** Le clip di una cartella, in ordine di nome. Non scende nelle sottocartelle. */
export async function elenca(cartella: string): Promise<Clip[]> {
  if (!existsSync(cartella)) return [];
  const tutti = readdirSync(cartella, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !n.startsWith("."));
  const minuscoli = new Set(tutti.map((n) => n.toLowerCase()));

  const candidate = tutti
    .filter((n) => ESTENSIONI.has(extname(n).toLowerCase()))
    .sort();

  // In parallelo: ffprobe legge solo l'intestazione, e su trecento clip la
  // differenza fra in fila e insieme è fra mezzo minuto e due secondi.
  return await Promise.all(
    candidate.map((n) => leggiClip(join(cartella, n), eLivePhoto(n, minuscoli))),
  );
}

export function percorsoScelte(cartella: string): string {
  return join(cartella, FILE_SCELTE);
}

export function leggiScelte(cartella: string): Scelte {
  const p = percorsoScelte(cartella);
  if (!existsSync(p)) return { versione: 1, aggiornato: 0, clip: [] };
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as Scelte;
    if (j?.versione !== 1 || !Array.isArray(j.clip)) throw new Error("formato ignoto");
    return j;
  } catch {
    // Un file di scelte illeggibile non deve impedire di lavorare: si riparte da
    // vuoto invece di bloccare la cartella. Il file resta dov'è, non si sovrascrive
    // finché qualcuno non salva davvero.
    return { versione: 1, aggiornato: 0, clip: [] };
  }
}

/**
 * Scrive le scelte accanto alle clip.
 *
 * Il file nasce solo se c'è qualcosa da dire: una cartella in cui si tiene tutto
 * intero e non si riordina niente non deve guadagnare un file. E se le scelte
 * tornano a essere nessuna, il file sparisce invece di restare a mentire.
 */
export function scriviScelte(cartella: string, scelte: Scelta[]): { scritto: boolean; percorso: string } {
  const p = percorsoScelte(cartella);
  if (!cEQualcosaDaDire(scelte)) {
    if (existsSync(p)) require("node:fs").unlinkSync(p);
    return { scritto: false, percorso: p };
  }
  const dati: Scelte = { versione: 1, aggiornato: Date.now(), clip: scelte };
  // Si scrive accanto e si rinomina: chi legge trova il vecchio o il nuovo, mai
  // un file a metà.
  const temporaneo = p + ".parziale";
  writeFileSync(temporaneo, JSON.stringify(dati, null, 2) + "\n");
  renameSync(temporaneo, p);
  return { scritto: true, percorso: p };
}

/**
 * Vero quando le scelte dicono qualcosa che l'ordine naturale non direbbe già.
 *
 * L'ordine si confronta con quello **alfabetico dei nomi**, non con l'indice
 * dell'array: `riordina` rinumera le posizioni da zero, quindi dopo uno spostamento
 * `posizione` coincide sempre con l'indice — e un riordino sarebbe risultato
 * invisibile, cioè un file che non nasce e una fila che al riapri torna com'era.
 */
export function cEQualcosaDaDire(scelte: Scelta[]): boolean {
  if (scelte.some((s) => !s.tenuta || s.attacco !== null || s.stacco !== null || s.nota !== null)) {
    return true;
  }
  const perPosizione = [...scelte].sort((a, b) => a.posizione - b.posizione).map((s) => s.nome);
  const alfabetico = [...scelte].map((s) => s.nome).sort();
  return perPosizione.some((n, i) => n !== alfabetico[i]);
}

/** Le scelte di partenza per una cartella: tutto tenuto, intero, nell'ordine dei nomi. */
export function scelteIniziali(clip: Clip[]): Scelta[] {
  return clip.map((c, i) => ({
    nome: c.nome,
    tenuta: true,
    attacco: null,
    stacco: null,
    posizione: i,
    nota: null,
  }));
}

/**
 * Unisce le scelte salvate con le clip trovate adesso.
 *
 * Le due liste divergono: una clip può essere stata aggiunta alla cartella dopo, o
 * tolta. Una scelta senza la sua clip si scarta; una clip senza scelta entra tenuta e
 * in fondo — perché il caso normale è «ne ho copiate altre», e metterle in mezzo
 * cambierebbe un ordine che qualcuno ha stabilito.
 */
export function unisci(clip: Clip[], salvate: Scelta[]): Scelta[] {
  const perNome = new Map(salvate.map((s) => [s.nome, s]));
  const fuori: Scelta[] = [];
  let prossima = salvate.length ? Math.max(...salvate.map((s) => s.posizione)) + 1 : 0;
  for (const c of clip) {
    const s = perNome.get(c.nome);
    fuori.push(
      s ?? { nome: c.nome, tenuta: true, attacco: null, stacco: null, posizione: prossima++, nota: null },
    );
  }
  return fuori.sort((a, b) => a.posizione - b.posizione);
}

/**
 * Sposta una clip da una posizione all'altra della fila.
 *
 * Un solo sistema di riferimento, e non è pedanteria: mescolare l'indice nell'array
 * «con la clip» e quello nell'array «senza la clip» dentro la stessa formula fa
 * saltare l'elemento di un posto su un trascinamento da zero pixel. È un difetto
 * documentato, e questa funzione esiste per non ripagarlo.
 */
export function riordina(scelte: Scelta[], da: number, a: number): Scelta[] {
  const ordinate = [...scelte].sort((x, y) => x.posizione - y.posizione);
  if (da < 0 || da >= ordinate.length || a < 0 || a >= ordinate.length || da === a) {
    return ordinate.map((s, i) => ({ ...s, posizione: i }));
  }
  const [presa] = ordinate.splice(da, 1);
  ordinate.splice(a, 0, presa!);
  return ordinate.map((s, i) => ({ ...s, posizione: i }));
}

/** La durata del montato: la somma dei tratti tenuti. */
export function durataTenuta(clip: Clip[], scelte: Scelta[]): number {
  const perNome = new Map(clip.map((c) => [c.nome, c]));
  let somma = 0;
  for (const s of scelte) {
    if (!s.tenuta) continue;
    const c = perNome.get(s.nome);
    if (!c?.durata) continue;
    const da = s.attacco ?? 0;
    const a = s.stacco ?? c.durata;
    somma += Math.max(0, Math.min(a, c.durata) - Math.max(0, da));
  }
  return Math.round(somma * 100) / 100;
}

/**
 * Perché una fila non produce suono.
 *
 * `null` quando il suono c'è. Un silenzio senza spiegazione manda a cercare un guasto
 * dove non c'è: le clip di una macchina fotografica in modalità video spesso non hanno
 * traccia audio, e non è rotto niente.
 */
export function perchePerSilenzio(clip: Clip[], scelte: Scelta[]): string | null {
  const tenute = scelte.filter((s) => s.tenuta).map((s) => s.nome);
  if (tenute.length === 0) return "nella fila non c'è nessuna clip";
  const perNome = new Map(clip.map((c) => [c.nome, c]));
  const conAudio = tenute.filter((n) => perNome.get(n)?.conAudio);
  if (conAudio.length === 0) return "nessuna delle clip in fila ha una traccia audio";
  return null;
}

/** Un fotogramma della clip, come JPEG, per la griglia e per la striscia. */
export async function fotogramma(
  percorso: string,
  secondo: number,
  lato: number,
  uscita: string,
): Promise<boolean> {
  const p = spawn({
    cmd: [
      "ffmpeg", "-v", "error", "-y",
      // `-ss` prima di `-i` cerca senza decodificare tutto quello che viene prima:
      // su una clip lunga è la differenza fra millisecondi e secondi.
      "-ss", String(Math.max(0, secondo)),
      "-i", percorso,
      "-frames:v", "1",
      "-vf", `scale='min(${lato},iw)':-2`,
      "-q:v", "4",
      uscita,
    ],
    stdout: "ignore",
    stderr: "pipe",
  });
  return (await p.exited) === 0 && existsSync(uscita);
}
