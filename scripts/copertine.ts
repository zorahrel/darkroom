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
  "fotografie stampate, cartelle, manopole, linee del tempo. " +
  "SEMPLICISSIMA: AL MASSIMO TRE ELEMENTI in tutta l'immagine, grandi e ben distanziati. Niente " +
  "sfondi affollati, niente pile di oggetti, niente cavi, niente etichette esplicative: l'immagine " +
  "va letta in mezzo secondo dentro un riquadro piccolo. " +
  "Tutto AMPIAMENTE DENTRO L'INQUADRATURA, con molto nero attorno: nessun oggetto deve toccare o " +
  "oltrepassare i bordi. " +
  "Le fotografie mostrate sono immagini vere e riconoscibili: paesaggio, ritratto, architettura. " +
  "Testo solo dove e' il soggetto stesso (una frase dentro un campo), breve e leggibile, in inglese. " +
  "SFONDO NERO PURO uniforme, senza pavimento e senza ombre proiettate. Una luce ciano fredda da " +
  "sinistra e una ambra calda da destra; nessun altro colore se non quello delle fotografie. " +
  "Composizione ORIZZONTALE, elegante, moderna, nitida.";

/**
 * Il soggetto deve far RICONOSCERE lo strumento in mezzo secondo.
 *
 * Le prime serie erano astratte e mute; la terza era concreta ma affollata — motori,
 * cavi, etichette, pile di stampe — e in un riquadro da 460 punti diventava una
 * texture. Qui ogni soggetto ha DUE O TRE cose in croce: quello che entra, la
 * freccia, quello che esce. Se serve una didascalia per capirlo, il soggetto e'
 * sbagliato, non l'immagine.
 */
const SOGGETTI: Record<string, string> = {
  generate: "Solo tre cose, due che entrano e una che esce: in alto a sinistra un campo di testo scuro con dentro scritto \"a quiet street at sunset\", in basso a sinistra una cartella aperta con dentro tre fotografie, e a destra, piu' grande, una sola fotografia incorniciata di una strada al tramonto verso cui puntano tutte e due",
  prompt: "Solo due cose: a sinistra tre cursori su un pannello scuro, a destra una sola fotografia che ne risente, piu' chiara",
  color: "Una cosa sola: una fotografia di paesaggio divisa a meta' da una linea verticale netta, la meta' sinistra piatta e desaturata, la meta' destra sviluppata con colore e contrasto",
  export: "Solo due cose: una cartella aperta a sinistra e tre fotografie che ne escono verso destra",
  pipeline: "Solo tre cose: la stessa fotografia in tre stadi allineati da sinistra a destra, grezza, sviluppata, finita",
  quality: "Solo due cose: una fotografia e una lente d'ingrandimento che cerchia un punto sfocato dentro di essa",
  defects: "Solo tre cose: tre fotografie affiancate, una mossa, una con le luci bruciate, una fuori fuoco",
  gallery: "Solo due cose: una griglia di nove fotografie e una che si stacca e viene avanti",
  sources: "Solo due cose: una cartella del computer a sinistra e una griglia ordinata di fotografie a destra",
  posts: "Una cosa sola: uno schermo verticale di telefono che mostra tre fotografie in carosello",
  references: "Solo tre cose: una fotografia a sinistra con un colore forte, una freccia, una fotografia diversa a destra che ha assunto lo stesso colore",
  tree: "Solo due cose: una fotografia in basso e tre versioni della stessa in alto, collegate da tre rami",
  orphans: "Solo due cose: una griglia ordinata di fotografie e una sola fotografia fuori dalla griglia, staccata",
  storyboard: "Una cosa sola: quattro riquadri di storyboard disegnati, in fila su una striscia",
  edit: "Solo due cose: una forma d'onda audio in basso e tre clip video sopra, tagliate sui picchi",
  picks: "Solo tre cose: tre fotogrammi video affiancati, due con una spunta e uno con una croce",
  shots: "Solo tre cose: a sinistra un campo di testo con una breve frase, al centro una freccia, a destra un fotogramma video con scia di movimento",
  gate: "Solo due cose: una barra orizzontale con una soglia segnata, e due clip video, una che passa sotto e una bloccata sopra",
  projects: "Una cosa sola: tre schede di progetto affiancate, ognuna con la sua anteprima fotografica",
  queue: "Una cosa sola: tre righe di lavori in coda su uno schermo scuro, la prima con la barra di avanzamento a meta'",
  status: "Solo due cose: un indicatore circolare acceso in verde e una riga di stato accanto",
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
    // Un margine trasparente attorno, dopo il ritaglio: il ritaglio stringe fino al
    // pixel acceso, quindi un soggetto che nel render toccava il bordo restava a filo
    // e nella scheda si leggeva come tagliato dalla cornice.
    "-bordercolor", "none", "-border", `${Math.round(LATO * 0.035)}`,
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
