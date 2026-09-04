/**
 * Gli allegati di una generazione, e la frase che li descrive al modello.
 *
 * L'API delle immagini non conosce ruoli: le foto viaggiano tutte insieme in
 * un solo array `image[]`, e chi guarda vede N immagini indistinguibili. La
 * differenza fra "questa sono io" e "questa e' lo stile da copiare" esiste
 * soltanto perche' il prompt la dichiara — per POSIZIONE.
 *
 * Finche' l'array e la frase si scrivono in due punti diversi, quella
 * corrispondenza e' una promessa che nessuno verifica: basta aggiungere una
 * reference in mezzo, o riordinare l'elenco, e il prompt continua a dire "le
 * prime due sono io" mentre le prime due sono diventate altro. Il modello
 * obbedisce alla frase, quindi prende l'identita' dall'immagine sbagliata e il
 * risultato e' una persona che non esiste — un guasto che non solleva errori e
 * si scopre solo guardando la faccia venuta male.
 *
 * Qui i due lati nascono dalla STESSA lista: si dichiara ogni file con il suo
 * ruolo, e da quella lista si ricavano sia l'ordine degli allegati sia le
 * parole che lo descrivono. Non possono piu' divergere.
 */

/** Che cosa e' un'immagine per il modello. */
export type Role =
  /** La persona: viso, ossatura, identita' da conservare. */
  | "identita"
  /** Luce, tonalita', inquadratura. Mai il volto. */
  | "stile"
  /** Un oggetto da riprodurre nella forma: occhiali, capo, accessorio. */
  | "oggetto";

export type Allegato = {
  /** Percorso del file da inviare. */
  path: string;
  role: Role;
  /** Che cosa prendere da questa immagine, con parole tue. Entra nel prompt:
   *  "the shape of the sunglasses", "the coloured gel lighting". */
  prendi?: string;
};

/** Come si dice una posizione in inglese, per il prompt. */
function posizione(indici: number[], total: number): string {
  if (total === 1) return "The attached image";
  if (indici.length === 1) {
    const ord = [
      "first", "second", "third", "fourth", "fifth",
      "sixth", "seventh", "eighth", "ninth", "tenth",
    ][indici[0]!];
    return ord ? `The ${ord} attached image` : `Attached image ${indici[0]! + 1}`;
  }
  if (indici.length === total) return "The attached images";
  // Un blocco contiguo si dice per esteso: "the first two", "the last three".
  const contiguo = indici.every((n, i) => i === 0 || n === indici[i - 1]! + 1);
  const quanti = ["", "one", "two", "three", "four", "five", "six"][indici.length] ?? String(indici.length);
  if (contiguo && indici[0] === 0) return `The first ${quanti} attached images`;
  if (contiguo && indici[indici.length - 1] === total - 1) return `The last ${quanti} attached images`;
  return `Attached images ${indici.map((n) => n + 1).join(", ")}`;
}

/**
 * Il preambolo che spiega al modello che cosa ha davanti.
 *
 * Ogni ruolo compare solo se ci sono immagini che lo portano: dire "la foto in
 * bianco e nero e' un'altra persona" quando quel file non e' allegato confonde
 * e basta, ed e' un errore gia' fatto in passato.
 */
export function preamble(allegati: Allegato[], withSource: boolean): string {
  const tot = allegati.length;
  const per = (r: Role) =>
    allegati.map((a, i) => ({ a, i })).filter((x) => x.a.role === r);

  const frasi: string[] = [];

  const ident = per("identita");
  if (ident.length > 0 || withSource) {
    const chi = withSource
      ? ident.length > 0
        ? `The SOURCE photograph and ${posizione(ident.map((x) => x.i), tot).toLowerCase()}`
        : "The SOURCE photograph"
      : posizione(ident.map((x) => x.i), tot);
    // Il verbo segue QUANTE immagini sono davvero nominate, non il fatto che
    // ci sia una sorgente: con la sola sorgente e nessun allegato d'identita'
    // usciva "The SOURCE photograph are of ME", e una frase sgrammaticata la
    // paga il modello, che la interpreta peggio.
    const quante = (withSource ? 1 : 0) + ident.length;
    frasi.push(
      `${chi} ${quante > 1 ? "are" : "is"} of ME, the same person: ` +
        `use them only to keep my face, bone structure and identity exactly as they show it. ` +
        `Ignore their pose, hands, framing, background and lighting.`,
    );
  }

  for (const { a, i } of per("stile")) {
    frasi.push(
      `${posizione([i], tot)} is a STYLING reference: never copy the face in it. ` +
        `Take from it ${a.prendi ?? "the lighting, tonality, framing and treatment"}.`,
    );
  }

  const ogg = per("oggetto");
  if (ogg.length > 0) {
    const cosa = ogg[0]!.a.prendi ?? "the object shown";
    frasi.push(
      `${posizione(ogg.map((x) => x.i), tot)} ${ogg.length > 1 ? "show" : "shows"} an OBJECT to reproduce: ` +
        `copy ${cosa} exactly as pictured. Never copy any face from them.`,
    );
  }

  return frasi.join(" ");
}

/**
 * L'ordine in cui gli allegati vanno inviati.
 *
 * Raggruppati per ruolo, cosi' il preambolo puo' parlare di blocchi contigui
 * ("le prime due") invece di elencare posizioni sparse — che il modello segue
 * peggio. L'ordine dentro ogni gruppo resta quello dichiarato da chi chiama.
 */
export function sort(allegati: Allegato[]): Allegato[] {
  const weight: Record<Role, number> = { identita: 0, stile: 1, oggetto: 2 };
  return [...allegati].sort((a, b) => weight[a.role] - weight[b.role]);
}

/**
 * Allegati e preambolo dalla stessa lista, garantiti coerenti.
 *
 * `conSorgente` dice se esiste anche un'immagine di partenza (quella su cui si
 * fa l'edit): non e' fra gli allegati ma il preambolo deve nominarla, perche'
 * per il modello e' comunque una delle immagini in ingresso.
 */
export function preparaAllegati(
  allegati: Allegato[],
  opzioni: { withSource?: boolean } = {},
): { files: string[]; preamble: string; sorted: Allegato[] } {
  const sorted = sort(allegati);
  return {
    files: sorted.map((a) => a.path),
    preamble: preamble(sorted, opzioni.withSource ?? false),
    sorted,
  };
}
