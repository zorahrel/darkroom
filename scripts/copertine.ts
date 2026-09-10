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
  "Illustrazione tridimensionale REALISTICA e concreta, non astratta: si riconoscono oggetti veri — " +
  "schermi, fotografie stampate, cartelle, manopole, linee del tempo — e si capisce a colpo d'occhio " +
  "cosa entra e cosa esce. La composizione racconta una TRASFORMAZIONE da sinistra a destra. " +
  "Le fotografie mostrate sono immagini vere e riconoscibili: paesaggio, ritratto, architettura. " +
  "Il testo, quando serve, e' breve e LEGGIBILE, in inglese. " +
  "SFONDO NERO PURO uniforme, senza pavimento e senza ombre proiettate. Illuminazione con una luce " +
  "ciano fredda da sinistra e una ambra calda da destra; nessun altro colore se non quello delle " +
  "fotografie mostrate. Composizione ORIZZONTALE, molto nero attorno. Elegante, moderno, nitido, " +
  "coerente con l'interfaccia scura di un programma di fotografia.";

/**
 * Il soggetto deve far RICONOSCERE lo strumento, non evocarlo.
 *
 * La prima serie era bella e muta; la seconda raccontava un passaggio ma con sculture
 * di vetro, e per capirlo bisognava gia' sapere cosa faceva lo strumento. Qui gli
 * oggetti sono quelli veri del mestiere — un campo di testo, una fotografia, una
 * cartella, una linea del tempo — perche' l'associazione deve essere immediata: se
 * uno strumento parte da una frase scritta, nell'immagine si vede una frase scritta.
 */
const SOGGETTI: Record<string, string> = {
  generate: "A sinistra un campo di testo scuro con dentro scritto \"a quiet street at sunset\" e il cursore che lampeggia; una freccia di luce; a destra la fotografia vera che ne e' nata, incorniciata e illuminata. Dal testo nasce la fotografia, senza nessuno scatto di partenza",
  retouch: "A sinistra una griglia di sei fotografie piatte e slavate; una freccia di luce che le attraversa tutte insieme; a destra la stessa griglia di sei, ognuna ora sviluppata e con contrasto. Un set intero rifatto in un colpo",
  prompt: "Un pannello di controllo scuro con manopole e cursori etichettati; sopra il pannello la stessa fotografia ripetuta tre volte, che cambia mano a mano che i cursori si spostano. I controlli e il loro effetto, visibili insieme",
  color: "Una sola fotografia di paesaggio tagliata da una linea verticale netta: la meta' sinistra piatta e desaturata come uscita dalla macchina, la meta' destra sviluppata, con colore e contrasto. Il prima e il dopo nella stessa immagine",
  export: "Una cartella di sistema aperta a sinistra; tre fotografie finite scivolano fuori verso destra e si posano ordinate fuori dalla cartella. Le preferite che escono dal progetto",
  pipeline: "Una sola fotografia che attraversa quattro stazioni allineate da sinistra a destra: grezza, sviluppata, rifinita, esportata. La catena intera in un colpo solo",
  quality: "Una fotografia sotto una lente d'ingrandimento che cerchia una zona sfocata; accanto una piccola lista con tre voci, due spuntate e una segnata in rosso. Misurare cosa e' venuto male",
  defects: "Quattro fotografie affiancate, ognuna con un difetto diverso e riconoscibile: una mossa, una con le luci bruciate, una rumorosa, una fuori fuoco. Il catalogo di cio' che puo' andare storto",
  gallery: "Un provino a contatto di molte fotografie su una griglia scura; una si stacca, viene avanti ingrandita e illuminata. Sfogliare e scegliere",
  sources: "A sinistra una cartella del computer piena di fotografie; una freccia di luce; a destra la finestra di un programma dove le stesse fotografie sono ordinate in griglia. Le foto che entrano nel progetto",
  posts: "Uno schermo verticale di telefono che mostra un carosello di tre fotografie, con il gesto di scorrimento laterale indicato da un arco di luce. Post e caroselli",
  references: "A sinistra una fotografia di riferimento con un colore forte; una freccia di luce; a destra una fotografia diversa che ha assunto lo stesso colore. Uno stile che si trasferisce",
  tree: "Una fotografia in basso da cui partono tre rami di luce verso tre versioni della stessa foto, ognuna sviluppata diversamente. Le versioni nate dallo stesso scatto",
  orphans: "Una griglia ordinata di fotografie collegate da linee di luce; una sta fuori dalla griglia, la sua linea spezzata e spenta. Una foto che non appartiene a nessun progetto",
  storyboard: "Quattro riquadri di storyboard in fila su una striscia, ognuno con una scena diversa disegnata dentro, letti da sinistra a destra. Una storia divisa in quadri",
  edit: "Una linea del tempo di montaggio video: in basso la forma d'onda dell'audio, sopra le clip tagliate esattamente sui picchi, con le linee di taglio evidenziate. Tagliare sul ritmo",
  picks: "Cinque fotogrammi di riprese video in fila: tre con una spunta verde e in primo piano, due con una croce e spinte indietro, spente. Scegliere quali riprese tenere",
  shots: "A sinistra un campo di testo con dentro una breve descrizione scritta; una freccia di luce; a destra un fotogramma di video in movimento, con scia di movimento. Dal testo nasce la ripresa",
  gate: "Una barra orizzontale con una soglia segnata; sotto la soglia due clip passano illuminate, sopra una resta bloccata e spenta. Una barra di qualita' da superare",
  projects: "Tre schede di progetto affiancate su uno sfondo scuro, ognuna con la sua anteprima fotografica e il suo nome; quella centrale in evidenza. I lavori, uno accanto all'altro",
  queue: "Un elenco di lavori in coda su uno schermo scuro: il primo con la barra di avanzamento a meta', gli altri in attesa. Una coda che avanza",
  status: "Un piccolo cruscotto scuro con un indicatore circolare acceso in verde e due righe di stato accanto. Il motore acceso e il suo stato",
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
    // Vincolata solo in larghezza, e senza tela quadrata attorno: una composizione
    // larga deve poter riempire la fascia da bordo a bordo, invece di stare in
    // mezzo a una cornice trasparente che la rimpicciolisce.
    "-resize", `${LATO}x>`,
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
