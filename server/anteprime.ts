/**
 * I livelli delle anteprime, e il budget che le tiene sotto controllo.
 *
 * Prima di questo file ogni chiamante chiedeva la larghezza che gli faceva comodo:
 * 120, 160, 300, 400, 480, 500, 720, 900, 1000, 1600, 2048. Quindici cartelle di
 * cache per le stesse fotografie, 199 MB, e nessuno che togliesse mai niente.
 *
 * Quattro livelli, quindi, e le richieste ci si arrotondano sopra. Non sono una scala
 * continua ma quattro usi distinti, ed e' il motivo per cui hanno budget separati: la
 * striscia consuma proxy mentre la griglia consuma celle, e con un budget comune
 * scorrere la griglia svuoterebbe la striscia. Un livello che si svuota da solo non e'
 * un precaricamento, e' una promessa.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./db.ts";
import { LIVELLI, livelloPer, type NomeLivello } from "./livelli.ts";

export { LIVELLI, livelloPer, type NomeLivello };


/**
 * Il budget complessivo della cache su disco, in byte.
 *
 * Su disco e non in memoria: qui le anteprime sopravvivono al riavvio, ed e' cio' che
 * rende istantanea la seconda apertura di una cartella. Due gigabyte perche' e' lo
 * stesso ordine di grandezza che il motore usa in memoria, e perche' 199 MB accumulati
 * senza accorgersene dicono che senza un tetto non ne esiste uno.
 */
export const BUDGET_TOTALE = Number(process.env.DARKROOM_CACHE_BYTE) || 2 * 1024 * 1024 * 1024;

/**
 * Quote per livello. Il visore prende la fetta piu' grande perche' e' quello che
 * costa di piu' a ricostruire; i proxy poco, perche' costano poco ma servono sempre.
 */
export const QUOTE: Record<NomeLivello, number> = {
  proxy: 0.2,
  griglia: 0.1,
  visore: 0.5,
  nativo: 0.2,
};


export function radiceCache(): string {
  return join(ROOT, "dashboard", ".cache", "thumbs");
}

export function cartellaLivello(livello: NomeLivello): string {
  return join(radiceCache(), livello);
}

/** Il percorso della voce di cache di un sorgente a un livello. */
export function percorsoCache(sorgente: string, livello: NomeLivello): string {
  // La chiave contiene dimensione e data del sorgente: un file sostituito non
  // eredita l'anteprima di quello di prima.
  const st = statSync(sorgente);
  const sicuro = sorgente.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(
    cartellaLivello(livello),
    `${st.size}_${Math.floor(st.mtimeMs)}_${sicuro}.jpg`,
  );
}

export type StatoLivello = {
  livello: NomeLivello;
  file: number;
  byte: number;
  budget: number;
};

export function statoCache(): StatoLivello[] {
  return LIVELLI.map((l) => {
    const dir = cartellaLivello(l.nome);
    let file = 0;
    let byte = 0;
    if (existsSync(dir)) {
      for (const n of readdirSync(dir)) {
        try {
          const st = statSync(join(dir, n));
          if (st.isFile()) {
            file++;
            byte += st.size;
          }
        } catch {
          // Un file sparito mentre lo si conta non e' un problema: e' cache.
        }
      }
    }
    return { livello: l.nome, file, byte, budget: Math.floor(BUDGET_TOTALE * QUOTE[l.nome]) };
  });
}

/**
 * Sfratta dal livello finche' non rientra nel budget, togliendo per primo il file
 * usato meno di recente.
 *
 * Si guarda `atime` e non `mtime`: la data di modifica dice quando l'anteprima e'
 * stata generata, quella di accesso quando e' stata vista l'ultima volta — ed e'
 * quest'ultima a dire se serve ancora.
 */
export function sfratta(
  livello: NomeLivello,
  budgetTotale: number = BUDGET_TOTALE,
): { tolti: number; byteLiberati: number } {
  const dir = cartellaLivello(livello);
  if (!existsSync(dir)) return { tolti: 0, byteLiberati: 0 };
  const budget = Math.floor(budgetTotale * QUOTE[livello]);

  const voci: { percorso: string; byte: number; usato: number }[] = [];
  let totale = 0;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      voci.push({ percorso: p, byte: st.size, usato: st.atimeMs || st.mtimeMs });
      totale += st.size;
    } catch {
      /* sparito nel frattempo */
    }
  }
  if (totale <= budget) return { tolti: 0, byteLiberati: 0 };

  voci.sort((a, b) => a.usato - b.usato);
  let tolti = 0;
  let byteLiberati = 0;
  for (const v of voci) {
    if (totale - byteLiberati <= budget) break;
    try {
      unlinkSync(v.percorso);
      tolti++;
      byteLiberati += v.byte;
    } catch {
      /* qualcun altro lo sta leggendo: si prova il prossimo */
    }
  }
  return { tolti, byteLiberati };
}

/**
 * Sfratta ogni livello. Chiamata di rado, non a ogni anteprima: contare
 * ottomila file per scriverne uno sarebbe piu' caro dell'anteprima stessa.
 */
export function sfrattaTutti(
  budgetTotale: number = BUDGET_TOTALE,
): Record<string, { tolti: number; byteLiberati: number }> {
  const fuori: Record<string, { tolti: number; byteLiberati: number }> = {};
  for (const l of LIVELLI) fuori[l.nome] = sfratta(l.nome, budgetTotale);
  return fuori;
}

export function assicuraCartelle(): void {
  for (const l of LIVELLI) mkdirSync(cartellaLivello(l.nome), { recursive: true });
}

/**
 * Le cartelle della cache di prima dei livelli: una per ogni larghezza che a qualcuno
 * era servita — 120, 160, 300, 400, 480, 500, 900, 1000, 1600, 2048. Nessuno le
 * leggera' piu', ma restano sul disco: erano 199 MB.
 *
 * Si riconoscono dal nome, che e' un numero. I quattro livelli hanno nomi di parole,
 * quindi la distinzione non e' fragile.
 */
export function cartelleVecchie(): string[] {
  const radice = radiceCache();
  if (!existsSync(radice)) return [];
  return readdirSync(radice)
    .filter((n) => /^\d+$/.test(n))
    .map((n) => join(radice, n));
}
