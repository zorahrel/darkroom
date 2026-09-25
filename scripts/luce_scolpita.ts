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

LA LUCE sul mio viso e' una luce da studio BIANCA appena calda (circa 5000 K), piu' dura e definita: un beauty dish senza diffusore messo in ALTO e davanti a me, spostato verso la sinistra dell'immagine di circa 35 gradi, che scende sul viso da circa 30 gradi. Scolpisce il volto: la fronte e il lato del viso verso la luce sono luminosi, con riflessi lucidi e netti su fronte, dorso del naso, zigomi e labbro inferiore; sotto gli zigomi, sotto il naso e lungo il lato opposto del viso le ombre sono profonde e con un bordo netto. Guance e mento, nelle parti illuminate, hanno il colore pesca caldo della mia pelle. Il contrasto fra lato illuminato e lato in ombra e' forte, come in un ritratto editoriale.

IL BLU del fondo RIENTRA nelle ombre: il lato del viso in ombra, il collo e le ombre sotto il mento prendono un riflesso blu-teal scuro, il rimbalzo del fondale, mentre le parti colpite dalla luce bianca restano calde. Dietro di me il blu disegna solo un bordo sottile e morbido lungo spalle e braccia, integrato nel fondo, senza stacco da ritaglio.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni. Niente brufoli, macchie, rossori, occhiaie, cicatrici, pori dilatati, peli sparsi. Resta pero' una pelle vera: grana fine e pori sottili ancora visibili da vicino, non plastica e non liscia come un'illustrazione. Ha la luminosita' curata di un ritratto beauty.

IL FONDO e' un fondale seamless con un gradiente VERTICALE uniforme da sinistra a destra: navy quasi nero in alto, blu profondo all'altezza della testa, teal-ciano pieno ma non elettrico nella parte bassa. Nessun alone circolare dietro la testa. La mia figura e' illuminata dentro questo ambiente e ci appartiene: i ricci e le spalle si fondono nel fondo con bordi naturali.

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
    { nome: "scolpita-ombre-blu", prompt: PROMPT },
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
        cambiato: "come v204 (key bianca calda alta), ma key piu' dura e laterale con ombre profonde e highlight lucidi; il blu del fondo rientra nelle ombre; fondo a gradiente verticale senza alone (correzioni del giudice visivo su v204/v205)",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "uniformita' zone > 0,8 (v198 0,91) E ciano sulla fronte > 50% (ref 90, v198 0)",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[asse] job ${job.id}  ${v.nome}  verde:${(v.prompt.match(/verde/gi) || []).length}`);
  }
});
