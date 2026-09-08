/**
 * I quattro livelli delle anteprime.
 *
 * Questo file non importa niente: lo leggono il backend, l'interfaccia e — come
 * testo, in una prova — anche il motore Rust. È l'unico punto in cui i quattro
 * numeri esistono, e deve restare tale: se il motore ne usasse altri, l'applicazione
 * desktop e la versione web servirebbero immagini diverse per la stessa fotografia, e
 * sarebbero due prodotti invece di uno.
 */

export const LIVELLI = [
  { nome: "proxy", lato: 256 },
  { nome: "griglia", lato: 512 },
  /**
   * 2048 e non i 3840 di un'applicazione nativa a schermo intero su un Retina:
   * un'immagine dentro una pagina, anche a tutta larghezza, non supera i ~2500 px
   * reali, e ogni pixel oltre l'anteprima incorporata si paga con una decodifica
   * piena del RAW — misurata a 868 ms su una Sony ARW, dove l'anteprima incorporata
   * si ferma comunque a 1616.
   */
  { nome: "visore", lato: 2048 },
  /** Per l'ingrandimento oltre 1:1, e per chi esporta. */
  { nome: "nativo", lato: 3840 },
] as const;

export type NomeLivello = (typeof LIVELLI)[number]["nome"];

/** Il livello che copre la larghezza richiesta. Si arrotonda sopra, mai sotto. */
export function livelloPer(lato: number): (typeof LIVELLI)[number] {
  for (const l of LIVELLI) if (lato <= l.lato) return l;
  return LIVELLI[LIVELLI.length - 1]!;
}
