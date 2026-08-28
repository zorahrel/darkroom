import { describe, expect, test } from "bun:test";
import { preparaAllegati, preambolo, ordina, type Allegato } from "../server/allegati.ts";

/**
 * Il guasto che questo modulo previene non solleva errori: l'API riceve tutte
 * le immagini in un array unico e non conosce ruoli, quindi se il prompt dice
 * "le prime due sono io" mentre le prime due sono diventate delle reference, la
 * richiesta parte, riesce, e restituisce una faccia che non e' la tua.
 *
 * Questi test guardano una cosa sola: che la frase e l'ordine dicano sempre
 * la stessa cosa.
 */
const io = (n: string): Allegato => ({ path: `/RAW/${n}`, ruolo: "identita" });
const stile = (n: string, prendi?: string): Allegato => ({ path: `/refs/${n}`, ruolo: "stile", prendi });
const oggetto = (n: string, prendi?: string): Allegato => ({ path: `/refs/${n}`, ruolo: "oggetto", prendi });

describe("l'ordine degli allegati e la frase che li descrive", () => {
  test("identita' prima, poi stile, poi oggetti", () => {
    const { ordinati } = preparaAllegati([oggetto("occhiali.jpg"), stile("luce.jpg"), io("me.png")]);
    expect(ordinati.map((a) => a.ruolo)).toEqual(["identita", "stile", "oggetto"]);
  });

  test("l'ordine dichiarato dentro un ruolo si conserva", () => {
    // Chi chiama puo' avere un motivo per mettere uno scatto prima di un altro.
    const { files } = preparaAllegati([io("a.png"), io("b.png"), io("c.png")]);
    expect(files).toEqual(["/RAW/a.png", "/RAW/b.png", "/RAW/c.png"]);
  });

  test("la frase nomina le posizioni VERE dopo il riordino", () => {
    // IL BUG: dichiarati in quest'ordine, gli occhiali sarebbero i primi
    // dell'array e un prompt scritto a mano direbbe "i primi due sono io".
    const p = preambolo(
      ordina([oggetto("occhiali.jpg"), io("a.png"), io("b.png")]),
      false,
    );
    expect(p).toContain("The first two attached images");
    expect(p.slice(0, p.indexOf("OBJECT"))).toContain("are of ME");
    // e l'oggetto e' il terzo, non il primo
    expect(p).toContain("The third attached image");
  });

  test("con la sorgente, la frase la nomina insieme alle foto d'identita'", () => {
    const p = preambolo(ordina([io("altra.png")]), true);
    expect(p).toContain("SOURCE photograph");
    expect(p).toContain("are of ME");
  });

  test("una sorgente sola, senza allegati d'identita'", () => {
    const p = preambolo(ordina([stile("luce.jpg")]), true);
    expect(p).toContain("The SOURCE photograph is of ME");
  });
});

describe("si parla solo di cio' che e' allegato", () => {
  test("senza reference di stile, non se ne parla", () => {
    // Dire "la foto di stile e' un'altra persona" quando quel file non c'e'
    // confonde e basta: e' un errore gia' fatto in passato.
    const p = preambolo(ordina([io("a.png"), io("b.png")]), true);
    expect(p).not.toContain("STYLING");
    expect(p).not.toContain("OBJECT");
  });

  test("senza foto d'identita' e senza sorgente, non si promette un volto", () => {
    const p = preambolo(ordina([stile("luce.jpg")]), false);
    expect(p).not.toContain("of ME");
    expect(p).toContain("STYLING");
  });

  test("un elenco vuoto non produce frasi", () => {
    expect(preambolo([], false)).toBe("");
  });
});

describe("ogni ruolo dice cosa prendere e cosa no", () => {
  test("dallo stile non si copia mai il volto", () => {
    const p = preambolo(ordina([io("a.png"), stile("luce.jpg")]), false);
    expect(p).toContain("never copy the face");
  });

  test("nemmeno dagli oggetti", () => {
    const p = preambolo(ordina([io("a.png"), oggetto("occhiali.jpg")]), false);
    expect(p).toContain("Never copy any face");
  });

  test("il dettaglio da prendere entra nella frase", () => {
    const p = preambolo(ordina([oggetto("g.jpg", "the exact shape of the sunglasses")]), false);
    expect(p).toContain("the exact shape of the sunglasses");
  });

  test("senza dettaglio, resta una formula sensata", () => {
    const p = preambolo(ordina([stile("luce.jpg")]), false);
    expect(p).toContain("lighting, tonality, framing and treatment");
  });
});

describe("i file inviati e le posizioni citate coincidono", () => {
  test("il caso reale di v37: 3 scatti, 1 stile, 2 occhiali", () => {
    const { files, preambolo: p } = preparaAllegati(
      [
        oggetto("gascan-nero.jpg", "the exact shape of the sunglasses"),
        oggetto("gascan-frontale.jpg"),
        io("56E417C5.JPG"),
        io("ChatGPT.png"),
        stile("fondo-blu.jpg", "the deep blue background and hard top light"),
      ],
      { conSorgente: true },
    );
    // L'ordine mandato all'API
    expect(files).toEqual([
      "/RAW/56E417C5.JPG",
      "/RAW/ChatGPT.png",
      "/refs/fondo-blu.jpg",
      "/refs/gascan-nero.jpg",
      "/refs/gascan-frontale.jpg",
    ]);
    // La frase deve descrivere ESATTAMENTE quell'ordine
    expect(p).toContain("the first two attached images");   // gli scatti
    expect(p).toContain("The third attached image");         // lo stile
    expect(p).toContain("The last two attached images");     // gli occhiali
    expect(p).toContain("the deep blue background and hard top light");
    expect(p).toContain("the exact shape of the sunglasses");
  });

  test("aggiungere una reference NON sposta cio' che la frase chiama identita'", () => {
    // E' il modo silenzioso di sbagliare: un file in piu' e il prompt mente.
    const prima = preparaAllegati([io("a.png"), io("b.png"), stile("x.jpg")], { conSorgente: true });
    const dopo = preparaAllegati(
      [io("a.png"), io("b.png"), stile("x.jpg"), oggetto("y.jpg")],
      { conSorgente: true },
    );
    expect(dopo.files.slice(0, 2)).toEqual(prima.files.slice(0, 2));
    // Minuscolo: dentro la frase la posizione segue "The SOURCE photograph and".
    expect(dopo.preambolo).toContain("the first two attached images");
  });

  test("il numero di file inviati e' quello dichiarato", () => {
    const a = [io("a.png"), stile("b.jpg"), oggetto("c.jpg")];
    expect(preparaAllegati(a).files).toHaveLength(a.length);
  });

  test("un solo allegato non si dice 'il primo di uno'", () => {
    expect(preambolo(ordina([stile("x.jpg")]), false)).toContain("The attached image");
  });
});
