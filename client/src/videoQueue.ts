/**
 * Chi resta nell'elenco dopo un verdetto.
 *
 * La pagina della scelta tiene la posizione con un indice dentro una coda
 * filtrata. Finche' il filtro e' "tutte" l'indice e' innocuo, ma i filtri veri
 * sono quelli che la scena appena giudicata NON soddisfa piu': con "da
 * giudicare" la riga esce dalla coda nell'istante del verdetto, e quella dopo
 * scala da sola in posizione `i`.
 *
 * Avanzare li' dentro scavalca una scena, e la scavalca senza dirlo: su 145
 * riprese ne restavano viste 72, le altre segnate "mai viste" senza che niente
 * spiegasse perche'. Il conteggio in cima alla pagina lo mostrava e sembrava
 * lentezza dell'operatore.
 *
 * Sta qui, fuori dal componente, perche' e' una regola — non un dettaglio di
 * resa — e perche' un difetto invisibile a occhio va tenuto fermo da un test.
 */
export type PickFilter =
  | "da giudicare"
  | "sospette"
  | "tenute"
  | "scartate"
  | "annotate"
  | "in montaggio"
  | "tutte";

/** true se la scena, dopo questo verdetto, sparisce dall'elenco filtrato. */
export function leavesQueue(filter: PickFilter, kept: boolean): boolean {
  // Tutt'e due chiedono un verdetto che non c'e' ancora: darlo la fa uscire,
  // qualunque esso sia.
  if (filter === "da giudicare" || filter === "sospette") return true;
  if (filter === "tenute") return !kept;
  if (filter === "scartate") return kept;
  // "annotate", "in montaggio" e "tutte" non guardano il verdetto: la riga
  // resta dov'e' e l'indice deve avanzare come sempre.
  return false;
}
