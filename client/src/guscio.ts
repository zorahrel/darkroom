/**
 * Su quale superficie stiamo girando, e che differenza fa.
 *
 * Una sola interfaccia, due gusci: il browser e l'applicazione desktop. Quasi tutto è
 * identico — è il punto — ma due cose no, e vale la pena che siano dichiarate qui
 * invece di sparse in una decina di `if`.
 *
 * **Le anteprime.** Nel browser sono una richiesta HTTP al backend, che chiama il
 * motore e rimanda i byte. Nell'applicazione il motore è nello stesso processo e i
 * byte non attraversano nessuna porta: su una griglia da duemila scatti sono duemila
 * richieste che non partono.
 *
 * **Ciò che richiede il disco.** Aprire una cartella di lavoro è una cosa che un
 * browser non può fare. Offrirla e fallire è peggio che dichiararla.
 */

import { livelloPer } from "../../server/livelli";

type FinestraTauri = Window & {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } };
};

/** Vero quando l'interfaccia gira dentro l'applicazione desktop. */
export function nelGuscioDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as FinestraTauri;
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined;
}

export type Capacita = {
  /** Le anteprime arrivano dal motore nello stesso processo, senza rete. */
  anteprimeInProcesso: boolean;
  /** Si può indicare una cartella del disco da cui lavorare. */
  cartellaLocale: boolean;
};

export function capacita(): Capacita {
  const desktop = nelGuscioDesktop();
  return { anteprimeInProcesso: desktop, cartellaLocale: desktop };
}

/**
 * L'indirizzo dell'anteprima di un file, al livello che copre la larghezza chiesta.
 *
 * Nel guscio desktop è il protocollo servito dal motore in-process. Nel browser
 * `null`, e chi chiama ricade sull'endpoint HTTP: qui non si inventa un secondo
 * percorso di ripiego, si dice che questa strada non c'è.
 */
export function anteprimaInProcesso(percorsoFile: string | null | undefined, lato: number): string | null {
  if (!percorsoFile || !nelGuscioDesktop()) return null;
  return `anteprima://${livelloPer(lato).nome}/${encodeURIComponent(percorsoFile)}`;
}

/** Chiama un comando dell'applicazione. Nel browser non esiste, e lo dice. */
export async function comando<T>(nome: string, argomenti?: Record<string, unknown>): Promise<T> {
  const w = window as FinestraTauri;
  const invoke = w.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error(`"${nome}" esiste solo nell'applicazione desktop`);
  return (await invoke(nome, argomenti)) as T;
}
