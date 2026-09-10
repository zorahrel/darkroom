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
  "Infografica tridimensionale, non un'illustrazione decorativa: la composizione racconta una " +
  "TRASFORMAZIONE da sinistra a destra — la cosa che entra, il passaggio, la cosa che esce — e si " +
  "capisce senza didascalia. SFONDO NERO PURO uniforme, senza pavimento e senza ombre proiettate. " +
  "Materiali: vetro spesso leggermente satinato e alluminio spazzolato scuro. Una sola luce di taglio " +
  "ciano fredda da sinistra e una ambra calda da destra, niente altri colori se non dove il soggetto " +
  "richiede espressamente un confronto di colore. Nessuna lettera, nessun numero, nessun logo: il testo, " +
  "quando serve, e' righe astratte incise nel vetro, che si leggono come scrittura senza esserlo. " +
  "Composizione ORIZZONTALE, oggetti piccoli e molto nero attorno. Minimalismo estremo, elegante, " +
  "moderno, coerente con un'interfaccia scura.";

/**
 * Il soggetto deve far capire COSA FA lo strumento, non evocarlo.
 *
 * La prima serie era bella e muta: un ventaglio di cilindri di vetro non dice che
 * quello strumento sviluppa il colore, e due strumenti vicini — generare e rifare —
 * si somigliavano perche' entrambi erano «una lastra che si illumina». Qui ognuno
 * mostra il proprio passaggio: cosa entra da sinistra, cosa esce a destra. E' anche
 * il motivo per cui restano riconoscibili in fila: sono ventidue frasi diverse, non
 * ventidue variazioni della stessa.
 */
const SOGGETTI: Record<string, string> = {
  generate: "A sinistra tre righe astratte incise nel vetro, come una frase; al centro un passaggio di luce; a destra una lastra fotografica che si e' accesa con un'immagine dentro. Dal testo nasce l'immagine",
  retouch: "A sinistra una pila di lastre opache e spente; al centro un passaggio di luce che le attraversa tutte; a destra la stessa pila, ogni lastra ora nitida e illuminata. Un intero set rifatto in un colpo. SOLO ciano e ambra, nessun altro colore",
  prompt: "Una fila di manopole di alluminio in basso; sopra ognuna una piccola lastra che cambia di conseguenza, dalla piu' scura alla piu' luminosa. I controlli e il loro effetto, visibili insieme. SOLO ciano e ambra, nessun altro colore",
  color: "Una sola lastra fotografica tagliata a meta' da una linea netta verticale: la meta' sinistra grigia e piatta, la meta' destra con lo stesso soggetto ma colore pieno e contrasto. Il prima e il dopo nella stessa immagine",
  export: "Una lastra di vetro finita che scivola fuori da una fessura di alluminio verso destra, uscendo dal contenitore. Il lavoro che esce dal progetto",
  pipeline: "Quattro lastre in fila da sinistra a destra, collegate da un filo di luce: la prima spenta e grezza, ognuna piu' definita, l'ultima finita. La catena intera in un colpo solo",
  quality: "Una lastra fotografica sotto una cornice di misura di alluminio con tacche incise; una zona della lastra e' cerchiata e illuminata, come un difetto trovato. Misurare cosa e' venuto male",
  defects: "Una griglia di piccole lastre di vetro; tre portano un segno diverso — una crepa, una sfocatura, una zona bruciata — e sono staccate dalle altre. Il catalogo di cio' che puo' andare storto",
  gallery: "Una griglia ordinata di lastre di vetro sospese; una si stacca e viene avanti, ingrandita e accesa. Sfogliare e scegliere",
  sources: "A sinistra una cartella di alluminio aperta; da essa un flusso di piccole lastre passa in un vassoio a destra, dove sono allineate. Le fotografie che entrano nel progetto",
  posts: "Tre lastre verticali affiancate come schede, con un arco di luce che indica lo scorrimento laterale da una all'altra. Un carosello",
  references: "A sinistra una lastra campione appesa a un gancio; una linea di luce la collega a destra a una seconda lastra, che ne ha preso il colore. Uno stile che si trasferisce",
  tree: "Una lastra sola in basso, da cui parte un ramo di vetro che si divide in tre lastre diverse in alto. Le versioni nate dalla stessa foto",
  orphans: "Una griglia ordinata di lastre collegate da fili di luce; una sta fuori, il suo filo spezzato e spento. Una foto che non appartiene a nessuno",
  storyboard: "Quattro riquadri di vetro in fila su una guida di alluminio, ognuno con dentro una scena diversa, letti da sinistra a destra. Una storia divisa in quadri",
  edit: "In basso una forma d'onda scolpita in alluminio; sopra, clip di vetro tagliate esattamente in corrispondenza dei picchi, da lame di luce verticali. Tagliare sul ritmo",
  picks: "Cinque clip di vetro in fila: tre in avanti e accese, due spinte indietro e spente. Scegliere cosa tenere",
  shots: "A sinistra righe astratte incise nel vetro; a destra una clip di vetro in movimento, con scie di luce che ne mostrano il moto. Dal testo nasce la ripresa",
  gate: "Una barra di vetro orizzontale con una tacca incisa che segna una soglia; sotto la tacca due clip passano illuminate, sopra una resta ferma e spenta. Una barra da superare",
  projects: "Tre contenitori di alluminio affiancati, ognuno con lastre dentro; quello centrale e' aperto e illuminato. I lavori, uno accanto all'altro",
  queue: "Cinque gettoni di vetro su un binario di alluminio che scorre verso destra; il primo sta entrando in una fessura illuminata, gli altri aspettano. Una coda che avanza",
  status: "Un anello di vetro con dentro una corona di luce che pulsa, e accanto una piccola spia accesa. Il motore acceso e il suo stato",
};

/** «Qualita' massima, testo e diagrammi»: e' la descrizione del modello, ed e'
 *  esattamente cio' che serve a un'infografica che deve spiegare uno strumento. */
const MODELLO = "nano_banana_pro";
const DESTINAZIONE = "client/public/copertine";
const GREZZE = ".copertine-grezze";
/** Nella scheda se ne vede un terzo: oltre questo lato non si guadagna niente. */
const LATO = 256;

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
  const lato = LATO - 24;
  await esegui([
    "magick", grezza, "-crop", riquadro, "+repage", "-colorspace", "sRGB",
    "-resize", `${lato}x${lato}`,
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
    // Un respiro uguale per tutte, cosi' nella scheda hanno tutte la stessa aria.
    "-background", "none", "-gravity", "center", "-extent", `${LATO}x${LATO}`,
    "-define", "png:compression-level=9",
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
  const uscita = `${DESTINAZIONE}/${id}.png`;
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
