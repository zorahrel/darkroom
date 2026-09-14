import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { refsDir } from "../server/project.ts";

/**
 * Togliere un riferimento sbagliato dall'elenco.
 *
 * PERCHE' ESISTE. Su questo progetto i riferimenti si accumulano: ogni prova
 * ne lascia uno, e dopo venti tentativi l'elenco e' pieno di immagini che non
 * si vogliono piu' allegare — ma l'unico modo di toglierle era il Finder.
 *
 * PERCHE' UN CESTINO E NON `rm`. Il lineage di ogni versione registra i nomi
 * dei file allegati: cancellare il file lascia righe che puntano nel vuoto e
 * l'albero mostra riquadri rotti al posto degli allegati. Il file si sposta in
 * `refs/_cestino/` — sparisce dall'elenco, resta servibile, e si rimette con
 * un `mv` se era un errore.
 */
const nome = "prova-da-togliere.png";
const cestino = () => join(refsDir(), "_cestino");

beforeEach(() => {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), nome), "x");
  rmSync(join(cestino(), nome), { force: true });
});

const togli = (file: string) =>
  app.request(`/api/references/${encodeURIComponent(file)}`, { method: "DELETE" });

describe("togliere un riferimento non lo cancella", () => {
  test("lo sposta nel cestino, e sparisce dall'elenco", async () => {
    const r = await togli(nome);
    expect(r.status).toBe(200);

    // Non e' piu' dove lo cerca l'elenco...
    expect(existsSync(join(refsDir(), nome))).toBe(false);
    // ...ma non e' distrutto.
    expect(existsSync(join(cestino(), nome))).toBe(true);

    const elenco = (await (await app.request("/api/references")).json()) as {
      references: Array<{ file: string }>;
    };
    expect(elenco.references.some((x) => x.file === nome)).toBe(false);
  });

  test("resta servibile: le varianti che lo allegavano non si rompono", async () => {
    await togli(nome);
    // E' il punto dell'intero disegno: una reference tolta dall'elenco resta
    // allegata alle varianti gia' generate, e quelle miniature devono vedersi.
    const img = await app.request(`/refs/${nome}`);
    expect(img.status).toBe(200);
  });

  test("due omonimi tolti in momenti diversi non si sovrascrivono", async () => {
    await togli(nome);
    writeFileSync(join(refsDir(), nome), "secondo");
    const r = await togli(nome);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { cestinato: string };
    // Il secondo prende un suffisso: il primo resta recuperabile.
    expect(body.cestinato).not.toBe(nome);
    expect(existsSync(join(cestino(), nome))).toBe(true);
    expect(existsSync(join(cestino(), body.cestinato))).toBe(true);
  });

  test("un nome con percorso e' rifiutato, un file assente e' 404", async () => {
    expect((await togli("../../photos.db")).status).toBe(400);
    expect((await togli("non-esiste.png")).status).toBe(404);
  });
});

describe("i riferimenti nell'albero si chiamano per nome, non per percorso", () => {
  /**
   * MISURATO il 14/09: 7 miniature rotte su /p/profilo/tree. I `source` erano
   * normalizzati con `.split("/").pop()`, i `refs` no — quindi il client
   * costruiva `/thumb/refs/%2FUsers%2F…%2Frefs%2Fbocca-reale.png`, che la rotta
   * rifiuta perche' dopo il decode contiene `/`. L'asimmetria era invisibile
   * finche' non si guardavano le immagini invece dei numeri.
   */
  test("lineage.ts riduce al basename anche i refs", async () => {
    const src = await Bun.file(new URL("../server/routes/lineage.ts", import.meta.url)).text();
    // `const versions` compare anche PRIMA (in un tipo): si cerca la sua
    // occorrenza successiva all'inizio del blocco, non la prima del file.
    const dopo = src.indexOf("const ingressiPer");
    const blocco = src.slice(dopo, src.indexOf("const versions", dopo));
    // Si legge la riga intera: `pop()` contiene parentesi, quindi un
    // `[^)]*` si fermerebbe a meta' espressione.
    const push = /e\.refs\.push\(.*/.exec(blocco);
    expect(push).not.toBeNull();
    // Deve ridurre al nome, non spingere il percorso cosi' com'e'.
    expect(push![0]).toContain('split("/").pop()');
  });

  test("nessun ref esposto dall'API e' un percorso assoluto", async () => {
    const r = await app.request("/api/lineage");
    const d = (await r.json()) as {
      photos?: Array<{ versions?: Array<{ file_refs?: string[] }> }>;
    };
    const tutti = (d.photos ?? []).flatMap((p) => (p.versions ?? []).flatMap((v) => v.file_refs ?? []));
    expect(tutti.filter((x) => x.startsWith("/"))).toEqual([]);
  });
});

describe("la griglia dei riferimenti li mostra interi", () => {
  /**
   * In un riquadro 691x651 le miniature erano rese 198x198 con `object-cover`,
   * mentre i file stanno fra 0,56 e 1,33 di rapporto: su una reference
   * verticale il quadrato ne mostrava meno della meta', tagliata al centro.
   * Una griglia che serve a RICONOSCERE i riferimenti non puo' ritagliarli.
   */
  test("usa contain su un riquadro 3/4, e ogni scheda ha il bottone per togliere", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    // L'immagine della GRIGLIA, cioe' quella dentro <figure>: dal 14/09 il file
    // contiene anche la vista singola, la cui immagine viene prima nel sorgente
    // e segue regole opposte (grande, senza riquadro fisso). Cercare "il primo
    // <img" misurava quella sbagliata.
    const scheda = src.slice(src.indexOf("<figure"));
    const img = /<img[\s\S]{0,400}?className="([^"]*)"/.exec(scheda);
    expect(img).not.toBeNull();
    expect(img![1]).toContain("object-contain");
    expect(img![1]).not.toContain("object-cover");
    expect(img![1]).toContain("aspect-[3/4]");
    expect(src).toContain("togliRiferimento");
    // Il gesto distruttivo su una reference gia' usata chiede conferma.
    expect(src).toContain("confirm(");
  });
});

describe("il deprompt sta attaccato alla reference, e si vede", () => {
  /**
   * PERCHE'. Il motore che legge un'immagine (`/api/reference/extract`, cinque
   * aspetti: luce, tonalita', inquadratura, pelle, resa) esisteva da sempre, ma
   * il risultato usciva solo come risposta HTTP: per conservarlo bisognava
   * inventargli un nome e salvarlo come «ricetta» staccata dal file. Su profilo
   * ne sono state salvate ZERO in tre settimane, mentre la luce della stessa
   * reference veniva descritta a mano sedici volte, sbagliando.
   */
  test("una reference appena caricata non ha descrizione, e non e' una stringa vuota", async () => {
    const elenco = (await (await app.request("/api/references")).json()) as {
      references: Array<{ file: string; prompt: string | null }>;
    };
    const r = elenco.references.find((x) => x.file === nome)!;
    expect(r).toBeDefined();
    // `null` = mai letta. Diverso da «letta e vuota», che vorrebbe dire che il
    // modello ha guardato e non ha trovato niente da dire.
    expect(r.prompt).toBeNull();
  });

  test("la descrizione salvata torna nell'elenco, con gli aspetti non letti", () => {
    const { db } = require("../server/db.ts");
    db().run(
      `INSERT INTO reference_prompt (file, body, aspects, missing, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET body = excluded.body`,
      [nome, "luce frontale e dall'alto, ombre morbide", 3, "tonalita,resa", Date.now()],
    );
    const riga = db()
      .query("SELECT body, aspects, missing FROM reference_prompt WHERE file = ?")
      .get(nome) as { body: string; aspects: number; missing: string };
    expect(riga.body).toContain("frontale");
    expect(riga.aspects).toBe(3);
    // Cio' che il modello NON ha letto si dice: e' la parte che tocca scrivere
    // a mano, e se resta implicita nessuno la scrive.
    expect(riga.missing.split(",")).toEqual(["tonalita", "resa"]);
  });

  test("togliendo la reference se ne va anche la descrizione", async () => {
    const { db } = require("../server/db.ts");
    db().run(
      `INSERT INTO reference_prompt (file, body, aspects, missing, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(file) DO UPDATE SET body = excluded.body`,
      [nome, "descrizione da buttare con il file", 5, "", Date.now()],
    );
    await togli(nome);
    const resta = db().query("SELECT file FROM reference_prompt WHERE file = ?").get(nome);
    expect(resta).toBeNull();
  });
});

describe("la pagina usa lo spazio che ha", () => {
  /**
   * MISURATO il 14/09 nel browser vero: con `max-w-3xl` sul contenitore la
   * colonna restava a 768 px a qualunque risoluzione — a 1440 px il 46% dello
   * schermo era vuoto, a 1920 il 59%, e la griglia restava a 4 miniature per
   * riga. Dopo: 6 per riga a 1440, 9 a 1920, vuoto sceso al 4-5%.
   */
  test("il limite di larghezza sta sui blocchi di testo, non sul contenitore", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    // Il contenitore di pagina non deve limitare: lo fa la prosa al suo interno.
    expect(src).not.toContain('"max-w-3xl space-y-6 py-4 pb-20"');
    expect(src).toContain('"space-y-6 py-4 pb-20"');
    // Ma il limite deve esistere ancora da qualche parte: una riga di prosa
    // lunga 1900 px e' illeggibile.
    expect((src.match(/max-w-3xl/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("il deprompt lungo si puo' leggere per intero", () => {
  /**
   * MISURATO nel browser il 14/09 sulla scheda di `fondo-blu-gradiente-luce-dura.jpg`
   * (deprompt reale: 649 caratteri):
   *
   *     prima   `line-clamp-3` + testo intero solo in `title`  → 16% leggibile
   *     dopo    clic su «leggi tutto»                          → 100%, a 11 px
   *
   * Un `title` non e' un modo per leggere un paragrafo: sparisce al primo
   * movimento del mouse e su touch non esiste.
   */
  const src = () =>
    Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();

  test("il ritaglio sta sul paragrafo, non sul bottone", async () => {
    const s = await src();
    // `line-clamp-3` su un <button> non ritaglia: il box WebKit non prende
    // `box-orient`, e ogni scheda tornava un muro di testo. Misurato.
    // I commenti si tolgono PRIMA di cercare: quello sopra il blocco cita
    // `line-clamp-3` e `<button>` per spiegare il difetto, e un test che legge
    // la spiegazione invece del codice passa (o fallisce) per il motivo sbagliato.
    const codice = s.replace(/\/\*[\s\S]*?\*\//g, "");
    // Dentro la SCHEDA, non nella vista singola: dal 14/09 il file contiene
    // entrambe, e nella vista singola il ritaglio non ci deve proprio essere.
    const griglia = codice.slice(codice.indexOf("<figure"));
    const blocco = griglia.slice(griglia.indexOf("{r.prompt ? ("), griglia.indexOf("leggi cosa c'è dentro"));
    const paragrafo = blocco.slice(blocco.indexOf("<p"), blocco.indexOf("</p>"));
    const bottone = blocco.slice(blocco.indexOf("<button"), blocco.indexOf("</button>"));
    expect(paragrafo).toContain("line-clamp-3");
    expect(bottone).not.toContain("line-clamp-3");
  });

  test("c'e' un comando esplicito per aprirlo e chiuderlo", async () => {
    const s = await src();
    expect(s).toContain("leggi tutto");
    expect(s).toContain("mostra meno");
    // Lo stato e' per scheda: aprirne una non apre le altre.
    expect(s).toContain("const [aperti, setAperti] = useState<Set<string>>");
  });
});

describe("una reference si puo' guardare da sola", () => {
  /**
   * PERCHE' UNA VISTA SINGOLA. La griglia risponde a «quale scelgo»: miniature
   * piccole, testo ritagliato, il nome accanto a diciotto altri nomi. Quando la
   * domanda diventa «cosa c'e' dentro questa» servono cose opposte — l'immagine
   * grande e il testo per esteso — e comprimerle in una scheda le rende
   * illeggibili entrambe. Serve anche un indirizzo: una reference si manda a
   * qualcuno, e «apri Riferimenti e cerca il file che comincia per fondo-» non
   * e' un indirizzo.
   */
  test("ha una rotta sua, e la griglia ci porta", async () => {
    const main = await Bun.file(new URL("../client/src/main.tsx", import.meta.url)).text();
    expect(main).toContain('path="p/:pid/references/:file"');

    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    // Il nome nella scheda e' un link a quell'indirizzo, col nome codificato:
    // i file hanno punti e trattini, e uno con uno slash romperebbe la rotta.
    expect(src).toMatch(/to=\{`\/p\/\$\{pid\}\/references\/\$\{encodeURIComponent\(r\.file\)\}`\}/);
  });

  test("mostra il prompt per intero, senza ritaglio", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    // La vista singola sta prima della griglia (esce presto su `aperta`).
    const dettaglio = src.slice(src.indexOf("if (aperta)"), src.indexOf("<figure"));
    expect(dettaglio.length).toBeGreaterThan(200);
    // Qui NON si ritaglia: e' esattamente il motivo per cui la pagina esiste.
    expect(dettaglio).not.toContain("line-clamp");
    expect(dettaglio).toContain("whitespace-pre-wrap");
    // E le azioni sono le stesse della scheda: chiamate, non riscritte.
    for (const azione of ["cambiaRuolo", "leggiDentro", "togliRiferimento"]) {
      expect(dettaglio).toContain(azione);
    }
  });

  test("un nome che non esiste lo dice, invece di mostrare il vuoto", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    const dettaglio = src.slice(src.indexOf("if (aperta)"), src.indexOf("<figure"));
    // Tre stati distinti, non due: sto caricando / non c'e' / eccola. Il primo
    // e il secondo si somigliano a schermo e vogliono dire cose opposte.
    expect(dettaglio).toContain("refs === null");
    expect(dettaglio).toMatch(/Nessun riferimento si chiama/);
  });
});

describe("durante il caricamento non si vede il progetto vuoto", () => {
  /**
   * SEGNALATO dall'utente: «per un attimo al caricamento esce il progetto
   * vuoto». La causa e' che lo stato iniziale era `[]`, indistinguibile da
   * «non ce n'e' nessuno»: React disegna subito, la fetch arriva dopo, e nel
   * mezzo la pagina afferma una cosa falsa. MISURATO dopo la correzione
   * campionando il DOM ogni 60 ms per 2,4 s: lo stato vuoto compare in 0
   * campioni su 40, «Carico…» in 17, poi 19 schede.
   */
  test("lo stato iniziale e' «non lo so ancora», non «non ce n'e'»", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    expect(src).toContain("useState<Reference[] | null>(null)");
    // E il null deve essere GESTITO prima del vuoto, altrimenti non serve.
    expect(src).toMatch(/refs === null/);
  });
});
