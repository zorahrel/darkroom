/**
 * Secondo giro della luce da solo prompt, corretto sulle misure di v168/v169.
 *
 *                 ciano centro  ciano bordi  a* luci  b* luci  alte luci
 *   reference         52,7%        28,2%      -9,8     +4,4      97,4
 *   v168              12,5%        39,6%      -8,4    -11,4      86,5
 *
 * Il segno del colore delle alte luci ora e' giusto (freddo). Tre scarti:
 * il ciano e' finito sul CONTORNO invece che sul viso, e' BLU mentre la
 * reference e' verde-acqua (b* positivo), e le alte luci sono meno bianche.
 * Cambia solo il blocco LUCE. Reference sempre non allegata.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const MATERIA = "1.PNG";

const PROMPT = `Questa foto sono IO. Rifalla come un ritratto da studio, tenendo il mio viso esattamente com'e'.

GLI ALLEGATI, uno per uno:
1. il ritaglio ravvicinato della MIA bocca (naso, bocca e mento);
2. i MIEI occhiali da sole su fondo grigio;
3. la MIA felpa nera, vista da sola su un manichino invisibile.

CHI SONO. Sono un ragazzo MAGRO e ossuto, corporatura esile. Viso stretto e lungo, zigomi sottili, mascella normale, mento non squadrato. Collo sottile, piu' stretto della testa, pomo d'Adamo sporgente. Spalle strette e cadenti. Non allargarmi, non irrobustirmi, non simmetrizzarmi il viso, non ringiovanirmi. I miei capelli sono CASTANI SCURI e ricci. Sono RASATO di fresco: guance, mento e mascella lisci, con la lievissima ombra dei peli appena tagliati. Ignora la posa e le mani della foto: niente mano vicino al viso.

LA MIA BOCCA e' esattamente quella del ritaglio allegato: labbra chiuse e rilassate, niente sorriso, niente denti. E' una bocca stretta.

GLI OCCHIALI DA SOLE sono esattamente quelli dell'immagine su fondo grigio: stessa forma, proporzioni, spessore della montatura e curvatura.

LA POSA e' quasi FRONTALE ma non in posa: il viso e' rivolto verso la camera, girato solo di poco (circa 10-15 gradi) verso la destra dell'immagine, e la testa e' appena inclinata di lato, un filo storta, non dritta come in una foto tessera. Lo sguardo e' distratto: gli occhi guardano appena fuori asse, un po' oltre la camera e leggermente in basso, come se stessi pensando ad altro, non dentro l'obiettivo. Spalle rilassate e un po' asimmetriche, quasi di fronte alla camera, bocca chiusa e rilassata. Sono sovrappensiero, fermo, tranquillo.

LA LUCE sul mio viso e' una luce da studio BIANCA e morbida, appena calda (circa 5000 K): un grande beauty dish messo in ALTO e davanti a me, sopra la camera e appena spostato verso la sinistra dell'immagine, che scende sul viso da circa 30 gradi. Illumina tutto il volto in modo pieno e pulito: la fronte e' la zona piu' luminosa, quasi bianca al centro; naso e zigomi hanno un riflesso chiaro; guance e mento sono color pesca caldo, il colore naturale della mia pelle, ben illuminati. Sotto il naso c'e' un'ombra corta e morbida che scende verso il basso e un filo verso la destra dell'immagine; sotto la montatura degli occhiali un'ombra morbida bruno-ambrata. Il collo, sotto il mento, sta nella sua ombra ed e' un po' piu' scuro.

IL BLU viene tutto da DIETRO di me: il fondale azzurro illuminato rimbalza e disegna un sottile bordo di luce ciano-azzurra lungo il contorno esterno di capelli, spalle e braccia, piu' marcato sul lato destro dell'immagine, e un riflesso bianco-azzurro sulla sommita' dei capelli. E' una luce di contorno: sfiora i bordi della figura e resta dietro, mentre la parte frontale del viso ha il colore caldo e naturale della pelle sotto la luce bianca.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni. Niente brufoli, macchie, rossori, occhiaie, cicatrici, pori dilatati, peli sparsi. Resta pero' una pelle vera: grana fine e pori sottili ancora visibili da vicino, non plastica e non liscia come un'illustrazione. Ha la luminosita' curata di un ritratto beauty.

IL FONDO e' un fondale seamless blu con gradiente verticale: ciano luminoso e saturo nella meta' inferiore, blu intenso dietro testa e spalle, navy quasi nero nella parte alta. Mi stacco dal fondo attraverso il forte contrasto cromatico fra pelle chiara e blu saturo, una differenza di luminanza di circa 1-1,5 stop all'altezza del volto e un sottilissimo bordo freddo ciano lungo capelli, collo e spalle.

INQUADRATURA: mezzo busto stretto con un 50mm: la testa occupa circa due quinti dell'altezza, si vedono le spalle e l'inizio del petto.

VESTITO: indosso la felpa della terza immagine allegata, identica: nera a mezza zip, leggermente OVERSIZE e morbida, spalle scese, con il collo ALTO a imbuto che copre meta' del mio collo; zip nera opaca tono su tono chiusa in alto. Mi cade morbida addosso, e si capisce comunque che sotto sono magro.

Quadrata 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "giacca-armonia-nera-v4.png"),
    join(D, "refs", "luce-bg-studio-blu.png"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);
  // Controllo sulle frasi che si contraddicevano: non devono tornare.
  for (const vietata of ["ritratto di studio", "UN'ALTRA PERSONA", "OPACA", "matificante", "senza punti speculari", "NON e' una persona", "secondo scatto"]) {
    if (PROMPT.includes(vietata)) throw new Error(`il prompt contiene di nuovo: ${vietata}`);
  }

  // Due varianti per confronto, un tiro ciascuna: il testo di ChatGPT parola
  // per parola, e lo stesso con «verde» -> «ciano» (l'utente ha bocciato il
  // verde su v170). Cosi' si vede se quella parola sposta la tinta.
  const varianti = [
    { nome: "neutra-ref-contrasto", prompt: PROMPT + "\n\nL'ULTIMA immagine allegata ritrae un'ALTRA persona: non prenderne il volto, i capelli, gli abiti ne' la posa. Prendine SOLO la resa della luce: lo stesso contrasto sul viso, ombre profonde sul lato lontano, zigomi e fronte lucidi, e lo stesso fondo a gradiente verticale, blu notte in alto e ciano in basso, il cui freddo rientra nelle ombre del collo e del lato in ombra. La pelle nelle zone illuminate resta calda come adesso." },
  ];
  for (let g = 1; g <= giri; g++) {
    const v = varianti[(g - 1) % varianti.length]!;
    const job = enqueueJob(
      PHOTO,
      v.prompt,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: `luce-${v.nome}`,
        materia: MATERIA,
        cambiato: "come v204, piu' la reference allegata come campione di contrasto e fondo (mai del volto). Base: come v201 (posa, felpa v4), ma la luce e' quella che claude -p legge nella reference: key BIANCA calda alta-frontale, pelle pesca naturale, blu solo come rim da dietro. Da v168 inseguivo un turchese sul viso che nella reference non c'e'",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "uniformita' zone > 0,8 (v198 0,91) E ciano sulla fronte > 50% (ref 90, v198 0)",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[asse] job ${job.id}  ${v.nome}  verde:${(v.prompt.match(/verde/gi) || []).length}`);
  }
});
