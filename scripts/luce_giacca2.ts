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

LA LUCE e' uno schema a TRE luci, da ritratto editoriale fashion anni '90/inizio 2000, palette blu notte-ciano con pelle chiara e leggermente fredda. Ho la testa girata di tre quarti verso la DESTRA dell'immagine.

LUCE 1 - key light principale: grande softbox rettangolare da circa 100-120 cm con doppia diffusione, posizionato 35 gradi a DESTRA della camera e 35-45 gradi sopra il livello degli occhi, inclinato verso il basso sul viso, distanza circa 1,2-1,5 m. Temperatura circa 5200-5600 K con una leggerissima componente ciano-verde. Luce morbida ma direzionale, contrasto deciso. Illumina soprattutto fronte, parte alta degli zigomi, ponte e punta del naso, labbro superiore, mento, clavicole e parte superiore delle spalle. Le alte luci sulla pelle appaiono avorio freddo con riflessi verde-acqua/ciano molto pallidi. La fronte presenta una grande zona luminosa morbida, quasi perlacea. Gli occhiali proiettano un'ombra profonda e grafica sulla zona occhi e sulla parte superiore delle guance. La guancia sul lato SINISTRO dell'immagine resta in ombra.

LUCE 2 - fill cromatico: sorgente ampia e molto morbida, circa 80-100 cm, posizionata bassa a SINISTRA della camera, 20-30 gradi lateralmente rispetto al viso e leggermente sotto il livello del mento, distanza circa 1,5-2 m. Colore blu-ciano saturo, circa 8500-10000 K visivi, intensita' circa 2 stop sotto la key. Riempie delicatamente le ombre di mandibola, collo, parte inferiore del viso e spalle. Le ombre mantengono densita' profonda con una tinta blu petrolio, indaco e leggermente violacea; le transizioni fra luce e ombra rimangono vellutate.

LUCE 3 - luce per il fondo e leggero ritorno sul soggetto: sorgente con parabola ampia o piccolo softbox collocata dietro di me, molto bassa, circa all'altezza della vita, puntata verso il fondale e leggermente verso l'alto. Colore ciano/turchese intenso. Produce un fondale luminoso turchese nella parte bassa che sfuma progressivamente verso blu elettrico, blu reale e infine blu notte molto profondo nella parte superiore. Una piccola quantita' di questa luce rimbalza sui bordi inferiori delle spalle, sul collo e sui capelli creando sottili riflessi ciano.

Esposizione del volto leggermente cinematografica: fronte e zigomi luminosi intorno al 70-80% della gamma, mezzitoni della pelle intorno al 50-60%, ombre del volto dense intorno al 15-25%, lenti degli occhiali e abbigliamento vicini al nero profondo. Contrasto medio-alto, neri ricchi, alte luci morbide e cremose. Pelle con base beige-avorio fredda, alte luci verde-ciano pallido, mezzitoni neutro-rosati, ombre blu-prugna.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni. Niente brufoli, macchie, rossori, occhiaie, cicatrici, pori dilatati, peli sparsi. Resta pero' una pelle vera: grana fine e pori sottili ancora visibili da vicino, non plastica e non liscia come un'illustrazione. Ha la luminosita' curata di un ritratto beauty.

IL FONDO e' un fondale seamless blu con gradiente verticale: ciano luminoso e saturo nella meta' inferiore, blu intenso dietro testa e spalle, navy quasi nero nella parte alta. Mi stacco dal fondo attraverso il forte contrasto cromatico fra pelle chiara e blu saturo, una differenza di luminanza di circa 1-1,5 stop all'altezza del volto e un sottilissimo bordo freddo ciano lungo capelli, collo e spalle.

INQUADRATURA: mezzo busto stretto con un 50mm: la testa occupa circa due quinti dell'altezza, si vedono le spalle e l'inizio del petto.

VESTITO: indosso la felpa della terza immagine allegata, identica: felpa tutta nera a mezza zip, collo alto a lupetto, zip nera opaca tono su tono chiusa fino a poco sotto il collo, polsini a costine. Mi sta slim, segue le spalle strette: si vede che sotto sono magro.

COLOR GRADE, come la post-produzione di un editoriale di moda: tutta l'immagine ha una dominante fredda ciano-turchese. Le alte luci della pelle (fronte, dorso del naso, zigomi) virano verso un ciano ghiaccio chiarissimo, quasi bianco; i mezzitoni della pelle restano rosati e vivi; le ombre scendono verso il blu petrolio. Neri profondi con la stessa dominante blu. Contrasto alto, pelle luminosa e curata.

Quadrata 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "giacca-armonia-nera-v2.png"),
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
    { nome: "giacca-grade", prompt: PROMPT.replace(/ciano-verde/g, "ciano").replace(/verde-acqua\/ciano/g, "ciano").replace(/verde-ciano/g, "ciano") },
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
