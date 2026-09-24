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

LA POSA e' naturale e distratta, come uno scatto rubato fra un'inquadratura e l'altra: lo sguardo va fuori campo, verso la destra dell'immagine e un po' in basso, come se stessi pensando ad altro o qualcuno mi avesse appena parlato. Testa girata di tre quarti verso destra e appena inclinata, spalle rilassate e un po' asimmetriche, bocca chiusa e rilassata. Sono sovrappensiero, fermo, tranquillo.

LA LUCE sul mio viso e' UNA sola, CIANO-TURCHESE chiaro, il colore dell'acqua di una piscina illuminata di notte: un grande pannello morbido quasi frontale, appena piu' alto degli occhi, molto vicino e molto potente. E' l'unica luce che mi tocca il viso, e lo illumina in modo uniforme dalla fronte al mento. Il viso e' SOVRAESPOSTO di mezzo stop, luminoso, quasi abbagliato: fronte, naso, zigomi e mento sono un turchese pallidissimo che sfiora il bianco, le guance un turchese chiaro pieno, e solo sotto il mento e sul collo la luce cala in un blu morbido. La pelle resta pelle, con la sua grana e il suo volume sotto la luce colorata. Il viso e' di gran lunga la cosa piu' luminosa della foto; la felpa resta nera.

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
    { nome: "ciano-alta", prompt: PROMPT.replace(/ciano-verde/g, "ciano").replace(/verde-acqua\/ciano/g, "ciano").replace(/verde-ciano/g, "ciano") },
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
        recipe: `luce-tre-luci-${v.nome}`,
        materia: MATERIA,
        cambiato: "felpa v2 tutta nera (zip nera, logo tono su tono) e un paragrafo COLOR GRADE: il ciano detto come post-produzione invece che come colore delle luci",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "ciano centro > 30% (ref 52,7, v168 12,5) · bordi < centro · b* luci > -3 (ref +4,4, v168 -11) · alte luci p98 > 92",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[giacca] job ${job.id}  ${v.nome}  verde:${(v.prompt.match(/verde/gi) || []).length}`);
  }
});
