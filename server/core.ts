/**
 * Il ponte verso il motore nativo.
 *
 * Il motore è un processo che resta vivo e parla per righe JSON. Resta vivo perché
 * l'alternativa — un processo per foto — è precisamente il difetto che stiamo
 * togliendo: `sips` costava 1859 ms per foto su ARW da 47 MB, e la maggior parte era
 * avvio di processo.
 *
 * I processi sono più d'uno perché il motore serve una richiesta per volta: con uno
 * solo, caricare una griglia da duecento foto sarebbe una fila indiana. Con la fila
 * la griglia impiega secondi; ripartita sui core, decimi.
 */

import { spawn, type Subprocess } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cpus } from "node:os";

const RADICE = new URL("..", import.meta.url).pathname;

/** Quanti processi tenere. Metà dei core: l'altra metà serve a chi sta usando il Mac. */
const QUANTI = Math.max(1, Math.min(6, Math.floor(cpus().length / 2)));

/** Oltre questo tempo una richiesta è considerata persa e il processo va riavviato. */
const ATTESA_MS = 60_000;

export type RispostaMotore = Record<string, unknown> & {
  errore?: string;
  codice?: string;
  file?: string;
};

export class MotoreNonDisponibile extends Error {
  constructor(motivo: string) {
    super(
      `motore nativo non disponibile: ${motivo}\n` +
        `Compilalo con:  bun run core:build`,
    );
    this.name = "MotoreNonDisponibile";
  }
}

/** Dove sta il binario. Si guarda l'ambiente prima del percorso di compilazione. */
export function percorsoBinario(): string | null {
  const daAmbiente = process.env.DARKROOM_CORE;
  if (daAmbiente && existsSync(daAmbiente)) return daAmbiente;
  for (const p of [
    join(RADICE, "core/target/release/darkroom-core"),
    join(RADICE, "core/target/debug/darkroom-core"),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function motoreDisponibile(): boolean {
  return percorsoBinario() !== null;
}

type Sospesa = {
  risolvi: (v: RispostaMotore) => void;
  rifiuta: (e: Error) => void;
  scadenza: ReturnType<typeof setTimeout>;
};

/** Un processo del motore, con la sua fila di richieste in attesa di risposta. */
class Processo {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private sospese: Sospesa[] = [];
  private resto = "";
  /** Quante richieste ha in volo: serve a distribuire il lavoro. */
  carico = 0;

  constructor(private readonly binario: string) {}

  private avvia() {
    const proc = spawn({
      cmd: [this.binario, "servizio"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.proc = proc as Subprocess<"pipe", "pipe", "pipe">;
    this.leggi(proc.stdout as ReadableStream<Uint8Array>);
    // Se il processo muore, chi stava aspettando deve saperlo: un `await` che non
    // torna mai è peggio di un errore.
    proc.exited.then(() => {
      const morte = new Error("il motore nativo è terminato");
      for (const s of this.sospese.splice(0)) {
        clearTimeout(s.scadenza);
        s.rifiuta(morte);
      }
      this.carico = 0;
      this.proc = null;
    });
  }

  private async leggi(flusso: ReadableStream<Uint8Array>) {
    const lettore = flusso.getReader();
    const decodificatore = new TextDecoder();
    for (;;) {
      const { done, value } = await lettore.read();
      if (done) break;
      this.resto += decodificatore.decode(value, { stream: true });
      let taglio: number;
      while ((taglio = this.resto.indexOf("\n")) >= 0) {
        const riga = this.resto.slice(0, taglio).trim();
        this.resto = this.resto.slice(taglio + 1);
        if (!riga) continue;
        // Le risposte tornano nell'ordine delle richieste: il motore serve una riga
        // per volta. È il motivo per cui basta una fila e non servono identificatori.
        const s = this.sospese.shift();
        if (!s) continue;
        this.carico--;
        clearTimeout(s.scadenza);
        try {
          s.risolvi(JSON.parse(riga) as RispostaMotore);
        } catch (e) {
          s.rifiuta(new Error(`risposta illeggibile dal motore: ${riga.slice(0, 200)}`));
        }
      }
    }
  }

  richiedi(richiesta: Record<string, unknown>): Promise<RispostaMotore> {
    if (!this.proc) this.avvia();
    const proc = this.proc!;
    return new Promise<RispostaMotore>((risolvi, rifiuta) => {
      const scadenza = setTimeout(() => {
        const i = this.sospese.findIndex((s) => s.scadenza === scadenza);
        if (i >= 0) this.sospese.splice(i, 1);
        this.carico--;
        // Un processo che non risponde non torna più affidabile aspettando: si butta.
        proc.kill();
        rifiuta(new Error(`il motore non ha risposto entro ${ATTESA_MS} ms`));
      }, ATTESA_MS);
      this.sospese.push({ risolvi, rifiuta, scadenza });
      this.carico++;
      const w = proc.stdin as unknown as { write: (s: string) => void; flush?: () => void };
      w.write(JSON.stringify(richiesta) + "\n");
      w.flush?.();
    });
  }

  chiudi() {
    this.proc?.kill();
    this.proc = null;
  }
}

let pool: Processo[] | null = null;

function processi(): Processo[] {
  if (pool) return pool;
  const binario = percorsoBinario();
  if (!binario) throw new MotoreNonDisponibile("binario non compilato");
  pool = Array.from({ length: QUANTI }, () => new Processo(binario));
  return pool;
}

/** Manda una richiesta al processo che ha meno lavoro in volo. */
export async function chiedi(richiesta: Record<string, unknown>): Promise<RispostaMotore> {
  const p = processi();
  let scelto = p[0]!;
  for (const q of p) if (q.carico < scelto.carico) scelto = q;
  return scelto.richiedi(richiesta);
}

/** Chiude il pool. Serve ai test, che non devono lasciare processi in giro. */
export function fermaMotore() {
  for (const p of pool ?? []) p.chiudi();
  pool = null;
}

export type EsitoAnteprima = {
  uscita: string;
  larghezza: number;
  altezza: number;
  /** Falso quando è servita la decodifica piena del RAW. */
  daIncorporata: boolean;
  /** Vero quando si è ottenuto meno di quello che si è chiesto. */
  troncata: boolean;
  ms: number;
};

/**
 * Un'anteprima al lato lungo richiesto, scritta come JPEG.
 *
 * `consentiDecodifica` apre alla decodifica piena del RAW quando l'anteprima
 * incorporata è più piccola del richiesto. Costa da mezzo secondo a un secondo e
 * mezzo per foto, quindi non è il comportamento predefinito: la griglia non la vuole,
 * il visore sì.
 */
export async function anteprima(
  file: string,
  lato: number,
  uscita: string,
  opzioni: { consentiDecodifica?: boolean; qualita?: number } = {},
): Promise<EsitoAnteprima> {
  const r = await chiedi({
    cmd: "anteprima",
    file,
    lato,
    uscita,
    qualita: opzioni.qualita ?? 82,
    consenti_decodifica: opzioni.consentiDecodifica ?? false,
  });
  if (r.errore) throw new ErroreMotore(String(r.errore), String(r.codice ?? ""), file);
  return {
    uscita: String(r.uscita),
    larghezza: Number(r.larghezza),
    altezza: Number(r.altezza),
    daIncorporata: Boolean(r.da_incorporata),
    troncata: Boolean(r.troncata),
    ms: Number(r.ms),
  };
}

/** Un errore che viene dal motore, col suo codice: chi chiama deve poter distinguere. */
export class ErroreMotore extends Error {
  constructor(
    messaggio: string,
    readonly codice: string,
    readonly file: string,
  ) {
    super(messaggio);
    this.name = "ErroreMotore";
  }
}

/** Un formato che il motore non sa aprire, non un file rotto. */
export function formatoNonSupportato(e: unknown): boolean {
  return e instanceof ErroreMotore && e.codice === "non_tiff";
}

export type Diagnosi = {
  file: string;
  byteFile: number;
  latoLungoIncorporata: number;
  latoLungoScatto: number | null;
  orientamento: number;
  anteprimeTrovate: number;
  livelliServiti: string[];
  decodificaPienaDisponibile: boolean;
};

/**
 * Cosa si può sapere di un file senza decodificarlo.
 *
 * Il numero che conta è `latoLungoIncorporata`: decide quali livelli costano
 * millisecondi e quali secondi, e cambia da fotocamera a fotocamera. Va letto prima
 * di fissare qualunque soglia, non dopo.
 */
export async function diagnosi(file: string): Promise<Diagnosi> {
  const r = await chiedi({ cmd: "diagnosi", file });
  if (r.errore) throw new ErroreMotore(String(r.errore), String(r.codice ?? ""), file);
  return {
    file: String(r.file),
    byteFile: Number(r.byte_file),
    latoLungoIncorporata: Number(r.lato_lungo_incorporata),
    latoLungoScatto: r.lato_lungo_scatto == null ? null : Number(r.lato_lungo_scatto),
    orientamento: Number(r.orientamento),
    anteprimeTrovate: Number(r.anteprime_trovate),
    livelliServiti: (r.livelli_serviti as string[]) ?? [],
    decodificaPienaDisponibile: Boolean(r.decodifica_piena_disponibile),
  };
}

export type Firma = {
  struttura: bigint;
  colore: number[];
  nitidezza: number;
};

/** La firma percettiva, per riconoscere le raffiche. */
export async function firma(file: string): Promise<Firma> {
  const r = await chiedi({ cmd: "firma", file });
  if (r.errore) throw new ErroreMotore(String(r.errore), String(r.codice ?? ""), file);
  return {
    struttura: BigInt(String(r.struttura)),
    colore: (r.colore as number[]) ?? [],
    nitidezza: Number(r.nitidezza),
  };
}

/** I formati che il motore sa aprire. Li dichiara lui: due liste divergono. */
export async function formati(): Promise<{ raw: string[]; altri: string[] }> {
  const r = await chiedi({ cmd: "formati" });
  return { raw: (r.raw as string[]) ?? [], altri: (r.altri as string[]) ?? [] };
}
