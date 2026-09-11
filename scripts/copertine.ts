/**
 * Le copertine degli strumenti.
 *
 *   bun run scripts/copertine.ts            # genera quelle che mancano
 *   bun run scripts/copertine.ts --rifai id # rifa' una sola
 *
 * Le immagini nascono da Higgsfield, con cui Darkroom parla gia' per la rifinitura
 * delle fotografie: due crediti l'una, e nessuna sessione di browser da tenere viva
 * (la strada per ChatGPT c'era, e si e' rotta a meta' serie quando il login e'
 * scaduto). Poi vengono rifinite qui:
 * ridotte, e con il nero portato a trasparente perche' si posino sul colore del
 * pannello invece di ritagliarci sopra un quadrato.
 *
 * STILE: si cambia in un posto solo, `STILE` qui sotto, ed e' la ragione per cui
 * ventidue immagini fatte in ventidue momenti diversi sembrano la stessa famiglia.
 * Le regole che contano davvero, e che non vanno allentate una per volta:
 *
 *   - fondo NERO PURO, niente pavimento, niente ombre proiettate: e' cio' che rende
 *     possibile toglierlo dopo. Un fondo grigio o sfumato non si puo' scontornare.
 *   - due sole luci, ciano fredda da sinistra e ambra calda da destra. Nessun altro
 *     colore: e' l'unica cosa che tiene insieme la serie, e un arcobaleno la rompe.
 *   - vetro spesso satinato e alluminio scuro. Sempre quei due materiali.
 *   - oggetto piccolo e centrato, molto nero attorno: nella scheda si vede un terzo
 *     dell'immagine, e cio' che tocca il bordo viene tagliato.
 *   - mai testo, lettere, numeri, loghi o cornici.
 *
 * SOGGETTI: uno per strumento, e deve dire cosa fa lo strumento **senza disegnarne
 * l'icona ovvia** — il prisma per il colore e la lente per la qualita' sono le due
 * immagini che chiunque metterebbe, e messe accanto alle altre venti si vedono. Si
 * cerca il gesto: cosa succede alle fotografie quando questo strumento lavora.
 *
 * Uno strumento nuovo: aggiungi una riga a SOGGETTI e rilancia. Chi c'e' gia' non
 * viene rifatto, cosi' la serie non cambia sotto i piedi.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { generaDaTesto } from "../server/higgsfield.ts";

const STILE =
  "Illustrazione tridimensionale REALISTICA e concreta: si riconoscono oggetti veri — schermi, " +
  "fotografie stampate, cartelle, manopole, pellicola. " +
  "SEMPLICISSIMA: AL MASSIMO TRE ELEMENTI in tutta l'immagine, grandi e ben distanziati. Niente " +
  "sfondi affollati, niente pile di oggetti, niente cavi: l'immagine va letta in mezzo secondo " +
  "dentro un riquadro piccolo. " +
  "DISPOSIZIONE SU UNA RIGA, da sinistra a destra: a SINISTRA cio' che entra, a DESTRA cio' che " +
  "esce. L'insieme e' LARGO E BASSO, mai impilato in verticale, e riempie l'inquadratura in " +
  "orizzontale. " +
  "NESSUNA PAROLA. Niente lettere, niente numeri, niente etichette, niente didascalie sotto gli " +
  "oggetti, niente scritte sugli schermi, niente loghi, niente simboli, niente spunte e niente " +
  "croci. Se per capirla servisse una parola scritta, l'immagine e' sbagliata: la differenza fra " +
  "due oggetti si deve VEDERE nell'oggetto, non leggere accanto. " +
  "Tutto AMPIAMENTE DENTRO L'INQUADRATURA, con molto nero attorno: nessun oggetto deve toccare o " +
  "oltrepassare i bordi. " +
  "Le fotografie mostrate sono immagini vere e riconoscibili: paesaggio, ritratto, architettura. " +
  "SFONDO NERO PURO uniforme, senza pavimento e senza ombre proiettate. " +
  "DUE SOLI COLORI DI LUCE: una ciano fredda da sinistra e una ambra calda da destra. Nessun " +
  "verde, nessun rosso, nessun blu acceso, nessuna spia colorata: fuori da ciano e ambra ci sono " +
  "solo i colori naturali dentro le fotografie. " +
  "Composizione ORIZZONTALE, elegante, moderna, nitida.";

/**
 * Il soggetto delle fotografie, uno per strumento.
 *
 * Non e' decorazione: in un riquadro piccolo la prima cosa che si guarda e' la
 * FOTOGRAFIA, non la disposizione degli oggetti attorno. Con ventuno copertine
 * costruite diversamente ma tutte con dentro la stessa strada al tramonto, la serie
 * torna a sembrare tutta uguale -- e' successo, ed e' la ragione per cui questa
 * lista esiste.
 *
 * Chiederlo al modello «vari i soggetti» non basta: in una richiesta sola varia, ma
 * riordina anche i riquadri, e una copertina finita sullo strumento sbagliato e'
 * peggio di una ripetuta (misurato: la seconda riga e' tornata ruotata di uno, e
 * «cerca i difetti» aveva preso l'immagine della galleria). Assegnandoli qui, la
 * varieta' e' garantita e ogni immagine nasce gia' al suo posto.
 */
const FOTOGRAFIE: Record<string, string> = {
  generate: "una strada di citta' al tramonto",
  prompt: "montagne innevate",
  color: "un ritratto in primo piano",
  export: "architettura moderna di vetro",
  pipeline: "un molo sul mare",
  quality: "una strada di citta' di notte con le luci",
  defects: "un bosco di alberi alti",
  gallery: "un deserto con rocce rosse",
  sources: "una spiaggia con le dune",
  posts: "fiori di campo in primo piano",
  references: "un interno di stanza con una finestra",
  tree: "un campo di grano",
  orphans: "un ponte sospeso",
  storyboard: "un orso in un fiume",
  edit: "una folla a un concerto",
  picks: "una nave in porto",
  shots: "un'auto in corsa di notte",
  gate: "un vicolo stretto illuminato",
  projects: "pioggia su una finestra",
  queue: "un lago all'alba",
  status: "un girasole",
};

const SOGGETTI: Record<string, string> = {
  generate: "A sinistra due cose che entrano: in alto un campo di testo scuro con dentro scritto \"a quiet street at sunset\" (l'unica scritta ammessa in tutta la serie, perche' e' il soggetto stesso), in basso una cartella aperta con dentro tre fotografie. A destra, piu' grande, quello che esce: una sola fotografia incorniciata di una strada al tramonto",
  prompt: "A sinistra tre cursori su un pannello scuro. A destra la stessa fotografia due volte, una sopra l'altra: quella in alto piatta e slavata, quella in basso contrastata e viva",
  color: "Una sola fotografia di paesaggio, grande, divisa a meta' da una linea verticale netta: la meta' sinistra piatta e desaturata, la meta' destra sviluppata con colore e contrasto pieni",
  export: "A sinistra tre fotografie stampate in fila che entrano. A destra una cartella aperta che le riceve",
  pipeline: "La stessa fotografia tre volte, in fila da sinistra a destra: grigia e piatta, poi sviluppata, poi finita e incorniciata. Nessuna etichetta sotto: la differenza si vede nelle tre immagini",
  quality: "A sinistra una fotografia grande. A destra una lente d'ingrandimento che ne ingrandisce un angolo, e dentro la lente si vede che quel punto e' mosso e sfocato",
  defects: "Tre fotografie affiancate in fila, tutte e tre visibilmente rovinate in modo diverso: la prima mossa e strisciata, la seconda bruciata di bianco, la terza fuori fuoco. Nessuna scritta sotto: il difetto si vede nella fotografia stessa",
  gallery: "A sinistra una griglia ordinata di nove fotografie piccole. A destra una sola di quelle, staccata e venuta avanti, grande e nitida",
  sources: "A sinistra una cartella di computer chiusa. A destra le fotografie che ne escono, disposte in una griglia ordinata",
  posts: "A sinistra tre fotografie stampate in pila. A destra uno schermo di telefono verticale che ne mostra una a tutto schermo",
  references: "A sinistra una fotografia con un colore molto forte. Al centro una freccia semplice di metallo scuro. A destra una fotografia diversa che ha preso lo stesso colore",
  tree: "In basso a sinistra una fotografia. In alto a destra tre versioni della stessa fotografia, collegate a quella di partenza da tre rami sottili",
  orphans: "A sinistra una griglia ordinata di fotografie. A destra una sola fotografia caduta fuori dalla griglia, storta e staccata dalle altre",
  storyboard: "A sinistra una sola fotografia. A destra quattro riquadri disegnati a matita, in fila su una striscia, che raccontano la stessa scena",
  edit: "Su fondo completamente nero: in basso una lunga forma d'onda audio luminosa, e sopra tre spezzoni di video allineati che finiscono esattamente dove la forma d'onda ha i picchi. Nessun pannello, nessun foglio e nessuna superficie chiara dietro: solo il nero",
  picks: "Tre fotogrammi video affiancati in fila, tutti e tre ben visibili e della stessa misura: i primi due in piena luce e in avanti, il terzo piu' spento e girato di lato, scartato ma ancora chiaramente riconoscibile. Nessun segno di spunta e nessuna croce: la scelta si vede dalla luce",
  shots: "A sinistra un campo di testo scuro. Al centro una freccia semplice di metallo scuro. A destra un fotogramma video con una scia di movimento",
  gate: "Una barra orizzontale di metallo con una tacca in mezzo. Sotto la tacca uno spezzone di video luminoso che passa; sopra, uno spezzone spento e fermo",
  projects: "A sinistra una cartella. A destra tre schede affiancate, ognuna con la propria anteprima fotografica diversa",
  queue: "A sinistra tre fotografie in pila che entrano. A destra uno schermo scuro con tre righe orizzontali, la prima riempita a meta'",
  status: "A sinistra tre fotografie. A destra un solo quadrante circolare di metallo scuro con la lancetta a meta', illuminato in ambra",
};
const MODELLO = "nano_banana_pro";
const DESTINAZIONE = "client/public/copertine";
const GREZZE = ".copertine-grezze";
/**
 * La larghezza dell'immagine finita.
 *
 * Era 256, e la scheda la disegnava a 459: veniva INGRANDITA, ed e' esattamente
 * cio' che si vede come «sgranata». Qui c'e' il doppio della larghezza della
 * fascia, che e' quello che serve su uno schermo a densita' doppia.
 */
const LATO = 960;

/** L'altezza: 3:2, la stessa forma della fascia in cima alla scheda.
 *
 *  Ogni copertina finisce su una tela di questa misura, con lo stesso margine. E'
 *  l'unica cosa che rende la serie davvero uniforme: prima si ritagliava fino al
 *  pixel acceso e basta, e le altezze andavano da 321 a 1199 -- quasi quattro volte.
 *  Nella fascia, che e' sempre la stessa, `storyboard` riempiva da bordo a bordo e
 *  `posts` diventava un francobollo in mezzo. Non era il modello: era questa
 *  rifinitura. */
const ALTEZZA = Math.round((LATO * 2) / 3);

/** Il margine trasparente, uguale per tutte. Il ritaglio stringe fino al pixel
 *  acceso, quindi senza questo un soggetto che nel render toccava il bordo si
 *  legge come tagliato dalla cornice della scheda. */
const MARGINE = Math.round(LATO * 0.035);

/** WebP e non PNG: a questa misura le stesse immagini pesavano dieci volte tanto,
 *  e finiscono anche dentro il pacchetto dell'applicazione. */
const ESTENSIONE = "webp";

/**
 * Il nero diventa trasparente.
 *
 * Non e' una soglia secca: una soglia lascia un alone nero attorno al vetro, che
 * sul pannello grigio si vede come una macchia. L'opacita' segue la luminosita', e
 * il colore viene riportato in su per non spegnere i bordi.
 */
async function esegui(argomenti: string[]): Promise<string> {
  const p = Bun.spawn({ cmd: argomenti, stdout: "pipe", stderr: "pipe" });
  const [uscita, errore, codice] = await Promise.all([
    new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited,
  ]);
  if (codice !== 0) throw new Error(errore.slice(0, 200));
  return uscita.trim();
}

/** Come si ricava l'opacita' dalla luminosita'. Serve due volte: una per trovare il
 *  riquadro del soggetto, una per ritagliarlo davvero. */
const MASCHERA = ["-colorspace", "Gray", "-auto-level", "-level", "6%,60%"];

/**
 * Il nero diventa trasparente, e il margine sparisce.
 *
 * Il soggetto e' piccolo dentro molto nero — serve a ChatGPT per non tagliarlo — ma
 * nella scheda quel margine sarebbe quasi tutto il riquadro e l'oggetto non si
 * riconoscerebbe. Il riquadro utile si misura sulla maschera e si ritaglia PRIMA di
 * mettere l'alfa: ridimensionando dopo, i colori vengono moltiplicati per la
 * trasparenza e l'intera serie si spegne.
 *
 * L'opacita' segue la luminosita' e non una soglia secca: una soglia lascia un alone
 * nero attorno al vetro, che sul pannello grigio si vede come una macchia.
 */
async function scontorna(grezza: string, uscita: string) {
  const riquadro = await esegui(["magick", grezza, ...MASCHERA, "-format", "%@", "info:"]);
  await esegui([
    "magick", grezza, "-crop", riquadro, "+repage", "-colorspace", "sRGB",
    // Dentro il riquadro utile, non solo in larghezza: cosi' una composizione larga
    // riempie comunque la fascia da bordo a bordo, e una alta -- che il modello non
    // dovrebbe fare, ma fa -- resta grande quanto le altre invece di allargare la
    // propria tela. La forma finale la decide `-extent`, qui sotto, non il soggetto.
    "-resize", `${LATO - 2 * MARGINE}x${ALTEZZA - 2 * MARGINE}`,
    // Le parentesi sono argomenti veri di magick: una shell che le cita le
    // trasformerebbe in testo, ed e' per questo che qui non c'e' una shell.
    "(", "+clone", ...MASCHERA, ")",
    "-alpha", "off", "-compose", "CopyOpacity", "-composite",
    // I bordi perdono luce quando diventano semitrasparenti: si riportano su.
    "-channel", "RGB", "-evaluate", "multiply", "1.15", "+channel",
    // `-compose` e' rimasto su CopyOpacity: `-extent` lo userebbe per posare
    // l'immagine sulla tela nuova, e copierebbe l'opacita' del fondo dentro i
    // colori — l'intera serie usciva nera con l'alfa giusta, cioe' silhouette.
    "-compose", "over",
    // La tela: sempre 3:2, sempre la stessa, col soggetto in mezzo. E' qui che
    // ventuno immagini di ventuno forme diverse diventano una serie.
    "-background", "none", "-gravity", "center", "-extent", `${LATO}x${ALTEZZA}`,
    "-quality", "88", "-define", "webp:alpha-quality=95",
    uscita,
  ]);
}

/**
 * Tutte in una richiesta sola.
 *
 * Ventuno richieste separate danno ventuno immagini che non si sono mai viste fra
 * loro: il modello ripete la stessa composizione che gli riesce meglio, e la serie
 * esce uniforme ma indistinguibile — tre fotografie e un oggetto, ventuno volte.
 * In una richiesta sola, invece, le altre venti sono davanti a lui mentre disegna
 * la ventunesima, e differenziarle diventa il compito.
 *
 * Il foglio esce 3:2 a 4k e si taglia in 5x5: e' l'unica griglia in cui i riquadri
 * sono a loro volta 3:2 -- (5x3)/(5x2) = 3/2 -- cioe' esattamente la forma della
 * fascia nella scheda. Restano quattro caselle vuote, e vanno chieste nere.
 */
const RIGHE = 4, COLONNE = 6;

function promptDelFoglio(ids: string[]): string {
  const celle = ids.map((id, i) => `Riquadro ${i + 1}: ${SOGGETTI[id]}.`).join("\n");
  const vuote = RIGHE * COLONNE - ids.length;
  return (
    `Un foglio unico diviso in una griglia regolare di ESATTAMENTE ${COLONNE} colonne per ` +
    `${RIGHE} righe: ${RIGHE * COLONNE} riquadri della stessa identica misura, tutte e ${RIGHE} le ` +
    `righe presenti. Ogni riquadro e' un'illustrazione a se' stante, e si contano da sinistra a ` +
    `destra e dall'alto in basso. NON disegnare i numeri dei riquadri.\n\n` +
    `${celle}\n\n` +
    (vuote > 0
      ? `Gli ultimi ${vuote} riquadri della griglia esistono ma sono vuoti: nero pieno, niente ` +
        `dentro. La griglia resta di ${COLONNE} per ${RIGHE}.\n\n`
      : "") +
    `I ${ids.length} riquadri pieni devono essere RICONOSCIBILMENTE DIVERSI L'UNO DALL'ALTRO: ` +
    `oggetti diversi, disposizioni diverse, inquadrature diverse. Non ripetere la stessa ` +
    `composizione due volte.\n\n` +
    // Alla prova precedente aveva fatto ventuno composizioni diverse con dentro la
    // STESSA fotografia di una strada al tramonto: la serie sembrava di nuovo tutta
    // uguale, perche' cio' che si guarda in un riquadro piccolo e' l'immagine, non
    // la disposizione. Il soggetto delle fotografie va imposto, non sperato.
    `E OGNI RIQUADRO MOSTRA FOTOGRAFIE DI SOGGETTI DIVERSI: montagna, ritratto in primo piano, ` +
    `architettura moderna, mare, strada di citta' di notte, bosco, deserto, neve, fiori, ` +
    `interno, ponte, campo di grano, spiaggia, animale, folla, nave, aereo, vicolo, pioggia, ` +
    `tramonto sul lago. Mai la stessa scena o lo stesso soggetto in due riquadri: e' cio' che ` +
    `si guarda per primo, e ventuno volte la stessa fotografia rende la serie indistinguibile ` +
    `anche se le composizioni sono diverse.\n\n` +
    // Il fondo non e' un dettaglio estetico: da quello si ricava la trasparenza, e
    // alla prima prova il foglio aveva una sfumatura verde-bruna che rendeva ogni
    // copertina un rettangolo opaco appoggiato sulla scheda invece di posarcisi.
    `IL FONDO DI OGNI RIQUADRO E' NERO ASSOLUTO, lo stesso nero dello spazio fra un riquadro e ` +
    `l'altro: nessuna sfumatura, nessun alone, nessuna luce diffusa sul fondo, nessun colore ` +
    `di fondo. Solo gli oggetti sono illuminati.\n\n` +
    `Ogni riquadro segue queste regole: ${STILE}`
  );
}

/**
 * Quanto e' VARIA ogni riga (o colonna) del foglio.
 *
 * Non la luminosita': il colore del corridoio fra un riquadro e l'altro non si puo'
 * prevedere. Misurato su due fogli fatti con lo stesso identico prompt: nel primo i
 * corridoi erano neri, nel secondo bianchi a 255. Qualunque soglia sulla luce ne
 * indovina uno e sbaglia l'altro — e sbagliare vuol dire ventuno ritagli storti,
 * senza nessun errore.
 *
 * Cio' che un corridoio e' sempre, invece, e' UNIFORME: nero pieno o bianco pieno,
 * tutti i pixel uguali. Dentro un riquadro c'e' un disegno, quindi i pixel variano.
 * Si misura quello, e il colore smette di contare.
 */
async function variazione(foglio: string, verso: "righe" | "colonne", punti: number): Promise<number[]> {
  const TRAVERSO = 64;
  const forma = verso === "righe" ? `${TRAVERSO}x${punti}!` : `${punti}x${TRAVERSO}!`;
  const testo = await esegui([
    "magick", foglio, "-colorspace", "gray", "-resize", forma, "-depth", "8", "txt:-",
  ]);
  const griglia: number[][] = Array.from({ length: punti }, () => []);
  for (const riga of testo.split("\n").slice(1)) {
    const m = riga.match(/^(\d+),(\d+):.*gray\((\d+)\)/);
    if (!m) continue;
    const [x, y, v] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dove = verso === "righe" ? y : x;
    griglia[dove]?.push(v);
  }
  return griglia.map((valori) => {
    if (!valori.length) return 0;
    const media = valori.reduce((a, b) => a + b, 0) / valori.length;
    return Math.sqrt(valori.reduce((a, b) => a + (b - media) ** 2, 0) / valori.length);
  });
}

/** Le fasce che contengono un disegno: quelle dove la variazione non e' piatta. */
function bandePiene(varianze: number[]): [number, number][] {
  const soglia = Math.max(...varianze) * 0.18;
  const minimo = varianze.length * 0.03;
  const bande: [number, number][] = [];
  let inizio: number | null = null;
  for (let i = 0; i < varianze.length; i++) {
    const dentro = varianze[i]! > soglia;
    if (dentro && inizio === null) inizio = i;
    if (!dentro && inizio !== null) {
      if (i - inizio > minimo) bande.push([inizio, i]);
      inizio = null;
    }
  }
  if (inizio !== null && varianze.length - inizio > minimo) bande.push([inizio, varianze.length]);
  return bande;
}

/** Taglia il foglio nei singoli grezzi, seguendo la griglia che c'e' davvero. */
async function tagliaFoglio(foglio: string, ids: string[]) {
  const dim = await esegui(["magick", "identify", "-format", "%w %h", foglio]);
  const [L, A] = dim.trim().split(/\s+/).map(Number) as [number, number];
  const PUNTI = 240;

  const righe = bandePiene(await variazione(foglio, "righe", PUNTI));
  const colonne = bandePiene(await variazione(foglio, "colonne", PUNTI));
  console.log(`griglia misurata: ${colonne.length} colonne x ${righe.length} righe`);
  if (colonne.length * righe.length < ids.length) {
    throw new Error(
      `il foglio ha ${colonne.length}x${righe.length} riquadri e ne servono ${ids.length}: ` +
      `rifallo con --rigenera`,
    );
  }

  for (const [i, id] of ids.entries()) {
    const [c0, c1] = colonne[i % colonne.length]!;
    const [r0, r1] = righe[Math.floor(i / colonne.length)]!;
    await esegui([
      "magick", foglio,
      "-crop",
      `${Math.round(((c1 - c0) / PUNTI) * L)}x${Math.round(((r1 - r0) / PUNTI) * A)}` +
      `+${Math.round((c0 / PUNTI) * L)}+${Math.round((r0 / PUNTI) * A)}`,
      "+repage", `${GREZZE}/${id}.png`,
    ]);
  }
}

const foglio = process.argv.includes("--foglio");
if (foglio) {
  const ids = Object.keys(SOGGETTI);
  const grezzo = `${GREZZE}/_foglio.png`;
  mkdirSync(GREZZE, { recursive: true });
  mkdirSync(DESTINAZIONE, { recursive: true });
  if (!existsSync(grezzo) || process.argv.includes("--rigenera")) {
    const { credits } = await generaDaTesto({
      model: MODELLO,
      prompt: promptDelFoglio(ids),
      params: { resolution: "4k", aspect_ratio: "3:2" },
      outputPath: grezzo,
    });
    console.log(`foglio: ${credits ?? "?"} crediti, ${await esegui(["magick", "identify", "-format", "%wx%h", grezzo])}`);
  }
  await tagliaFoglio(grezzo, ids);
  for (const id of ids) {
    await scontorna(`${GREZZE}/${id}.png`, `${DESTINAZIONE}/${id}.${ESTENSIONE}`);
  }
  console.log(`tagliate ${ids.length} copertine dal foglio`);
  process.exit(0);
}

const rifai = process.argv.includes("--rifai") ? process.argv[process.argv.indexOf("--rifai") + 1] : null;
mkdirSync(GREZZE, { recursive: true });
mkdirSync(DESTINAZIONE, { recursive: true });

let fatte = 0, tenute = 0, spesi = 0;
const rotte: string[] = [];
for (const [id, soggetto] of Object.entries(SOGGETTI)) {
  if (rifai && id !== rifai) continue;
  const grezza = `${GREZZE}/${id}.png`;
  const uscita = `${DESTINAZIONE}/${id}.${ESTENSIONE}`;
  try {
    if (!existsSync(grezza) || rifai === id) {
      const { credits } = await generaDaTesto({
        model: MODELLO,
        prompt: `${soggetto}. TUTTE le fotografie mostrate in questa immagine raffigurano ${FOTOGRAFIE[id] ?? "un paesaggio"}, e nient'altro. ${STILE}`,
        params: { resolution: "2k", aspect_ratio: "3:2" },
        outputPath: grezza,
      });
      spesi += credits ?? 0;
      fatte++;
    } else {
      tenute++;
    }
    await scontorna(grezza, uscita);
    // Quanta parte della copertina resta opaca. La trasparenza si ricava dalla luce,
    // quindi un render col fondo chiaro non si scontorna: resta un rettangolo pieno
    // che nella scheda si vede come una toppa. E' successo, e a occhio in un foglio
    // da ventuno non si nota -- si nota qui, che la mediana sta sul 18%.
    const opaco = Number(
      await esegui(["magick", uscita, "-alpha", "extract", "-threshold", "50%", "-format", "%[fx:mean*100]", "info:"]),
    );
    const sospetto = opaco > 50 ? "  [!] fondo non scontornato: rifalla" : "";
    console.log(`${id}: ${(statSync(uscita).size / 1024).toFixed(0)} KB, opaca al ${opaco.toFixed(0)}%${sospetto}`);
  } catch (e) {
    rotte.push(id);
    console.log(`[!] ${id}: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
  }
}
console.log(`generate ${fatte} (${spesi} crediti), gia' c'erano ${tenute}, non riuscite ${rotte.length}${rotte.length ? ": " + rotte.join(", ") : ""}`);
