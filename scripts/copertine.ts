/**
 * Le copertine degli strumenti.
 *
 *   bun run scripts/copertine.ts            # genera quelle che mancano
 *   bun run scripts/copertine.ts --rifai id # rifa' una sola
 *
 * Le immagini nascono da ChatGPT attraverso la skill `chatgpt-image` (Chrome
 * collegato via CDP, nessuna chiamata all'API a pagamento), poi vengono rifinite qui:
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
import { $ } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";

const STILE =
  "Render 3D di prodotto su SFONDO NERO PURO uniforme, senza pavimento e senza ombre proiettate. " +
  "Materiali: vetro spesso leggermente satinato e alluminio spazzolato scuro. Una sola luce di taglio " +
  "ciano fredda da sinistra e una ambra calda da destra, niente altri colori, bagliore volumetrico " +
  "appena accennato. Nessun testo, nessuna lettera, nessun numero, nessun logo, nessuna cornice. " +
  "Oggetto centrato e piccolo, composizione quadrata con molto nero attorno. Minimalismo estremo, " +
  "elegante, moderno, coerente con un'interfaccia scura.";

/** Il soggetto dice cosa fa lo strumento senza disegnarne l'icona ovvia. */
const SOGGETTI: Record<string, string> = {
  generate: "Una lastra di vetro vuota da cui sta emergendo, dall'interno, una forma di luce non ancora definita",
  retouch: "Una pila di lastre di vetro identiche; una si stacca dalla pila e si accende",
  prompt: "Un banco di manopole cilindriche di alluminio viste di tre quarti, una sola accesa",
  color: "Tre cilindri di vetro colorato che si compenetrano e nella zona di sovrapposizione diventano neutri",
  export: "Una lastra di vetro che scivola fuori da una fessura di alluminio spazzolato",
  pipeline: "Una fila di anelli di vetro allineati in profondità che si accendono uno dopo l'altro",
  quality: "Una lente di vetro molto spesso appoggiata su una griglia incisa, che ne raddrizza la porzione sotto di sé",
  defects: "Una lastra di vetro con una sola crepa luminosa, sospesa e catalogata",
  gallery: "Una griglia di lastrine di vetro sospese a profondità leggermente diverse",
  sources: "Un cassetto di alluminio aperto, pieno di lastre di vetro in verticale",
  posts: "Tre lastre verticali affiancate che scorrono lateralmente, come schede",
  references: "Una lastrina campione appesa a un gancio di alluminio accanto a una scala di grigi",
  tree: "Un ramo di vetro che si biforca due volte, ogni punta accesa in modo diverso",
  orphans: "Una lastrina sola, un po' più lontana e fuori posto, accanto a una griglia ordinata",
  storyboard: "Una striscia rigida di riquadri di vetro in sequenza, come una pellicola solida",
  edit: "Una forma d'onda scolpita in alluminio, attraversata da lame di luce verticali",
  picks: "Due lastre affiancate: quella davanti accesa, quella dietro spenta e opaca",
  shots: "Un otturatore poligonale di alluminio a metà apertura, con luce che passa dallo spiraglio",
  gate: "Una barra di vetro orizzontale con una tacca incisa che segna una soglia",
  projects: "Tre contenitori di alluminio impilati, quello in cima aperto e illuminato dall'interno",
  queue: "Una fila di gettoni di vetro su un binario di alluminio, solo il primo acceso",
  status: "Un anello di vetro con dentro una corona di luce, come un indicatore",
};

const SKILL = `${process.env.HOME}/jarvis/skills-marketplace/skills/chatgpt-image/run.ts`;
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

let fatte = 0, tenute = 0;
const rotte: string[] = [];
for (const [id, soggetto] of Object.entries(SOGGETTI)) {
  if (rifai && id !== rifai) continue;
  const grezza = `${GREZZE}/${id}.png`;
  const uscita = `${DESTINAZIONE}/${id}.png`;
  try {
    if (!existsSync(grezza) || rifai === id) {
      await $`bun run ${SKILL} ${`${soggetto}. ${STILE}`} --out ${grezza}`.quiet();
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
console.log(`generate ${fatte}, gia' c'erano ${tenute}, non riuscite ${rotte.length}${rotte.length ? ": " + rotte.join(", ") : ""}`);
