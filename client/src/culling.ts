/**
 * La logica del giudizio, fuori dal componente perché sia provabile.
 *
 * Sembra banale e non lo è: qui è già passato un difetto che si vede solo usando
 * lo strumento come si usa davvero, cioè a raffica di tasti.
 */

export type GiudizioParziale = { stelle?: number | null; colore?: string | null };
export type Giudizio = { stelle: number | null; colore: string | null };

/**
 * Fonde una modifica parziale col giudizio che lo scatto ha adesso.
 *
 * L'API vuole il giudizio **intero**: manda solo le stelle e l'etichetta viene
 * cancellata. Quindi ogni tasto deve partire dal valore corrente — e da quello vero,
 * non da quello che il componente aveva in mano quando il gestore di tastiera è stato
 * creato.
 *
 * Il difetto pagato: premendo `3` e subito `8` — stelle e poi etichetta, che è come
 * si lavora — partivano due richieste costruite entrambe sul valore di *prima*, e la
 * seconda ad arrivare cancellava il lavoro della prima. Restavano tre stelle e
 * nessuna etichetta.
 */
export function unisciGiudizio(
  attuale: Giudizio | undefined | null,
  patch: GiudizioParziale,
): Giudizio {
  return {
    stelle: "stelle" in patch ? (patch.stelle ?? null) : (attuale?.stelle ?? null),
    colore: "colore" in patch ? (patch.colore ?? null) : (attuale?.colore ?? null),
  };
}

/**
 * Cosa fa un tasto. Separata dal gestore di eventi perché la mappa dei tasti è la
 * cosa che si guarda per capire come si usa lo strumento, e non deve stare dentro
 * uno `switch` lungo trenta righe.
 *
 * `null` significa «questo tasto non giudica niente»: la distinzione conta, perché il
 * filtro della ripetizione automatica si applica **solo** ai tasti che giudicano. Al
 * contrario — filtro prima, domanda dopo — le frecce verrebbero mangiate e non si
 * scorrerebbe più tenendo premuto.
 */
export const TASTI_COLORE: Record<string, string> = {
  "6": "rosso",
  "7": "giallo",
  "8": "verde",
  "9": "blu",
  "0": "viola",
};

export function tastoGiudica(key: string): boolean {
  return /^[0-9]$/.test(key) || key === "\\" || key.toLowerCase() === "x";
}

export function patchDaTasto(key: string, attuale: Giudizio): GiudizioParziale | null {
  // Due gesti diversi, e la differenza e' tutta nel modello dei dati:
  // `\` riporta lo scatto a «non ancora guardato», `x` lo segna «guardato e
  // scartato». Il rendiconto li conta separati, e chi riprende domani deve sapere
  // se una foto e' stata saltata o rifiutata.
  if (key === "\\") return { stelle: null, colore: null };
  if (key.toLowerCase() === "x") return { stelle: 0, colore: null };
  if (key >= "1" && key <= "5") return { stelle: Number(key) };
  const colore = TASTI_COLORE[key];
  if (colore) {
    // Ripremere lo stesso colore lo toglie: assegnare e disfare con lo stesso dito.
    return { colore: attuale.colore === colore ? null : colore };
  }
  return null;
}
