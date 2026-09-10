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
  edit: "In basso una lunga forma d'onda audio. Sopra, tre spezzoni di video allineati che finiscono esattamente dove la forma d'onda ha i picchi",
  picks: "Tre fotogrammi video affiancati in fila: due accesi, luminosi e nitidi, il terzo spento, scuro e spinto indietro. Nessun segno di spunta e nessuna croce: la scelta si vede dalla luce",
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
        prompt: `${soggetto}. ${STILE}`,
        outputPath: grezza,
      });
      spesi += credits ?? 0;
      fatte++;
    } else {
      tenute++;
    }
    await scontorna(grezza, uscita);
    console.log(`${id}: ${(statSync(uscita).size / 1024).toFixed(0)} KB`);
  } catch (e) {
    rotte.push(id);
    console.log(`[!] ${id}: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
  }
}
console.log(`generate ${fatte} (${spesi} crediti), gia' c'erano ${tenute}, non riuscite ${rotte.length}${rotte.length ? ": " + rotte.join(", ") : ""}`);
