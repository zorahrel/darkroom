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
2. i MIEI occhiali da sole su fondo grigio.

CHI SONO. Sono un ragazzo MAGRO e ossuto, corporatura esile. Viso stretto e lungo, zigomi sottili, mascella normale, mento non squadrato. Collo sottile, piu' stretto della testa, pomo d'Adamo sporgente. Spalle strette e cadenti. Non allargarmi, non irrobustirmi, non simmetrizzarmi il viso, non ringiovanirmi. I miei capelli sono CASTANI SCURI e ricci. Sono RASATO di fresco: guance, mento e mascella lisci, con la lievissima ombra dei peli appena tagliati. Ignora la posa e le mani della foto: niente mano vicino al viso.

LA MIA BOCCA e' esattamente quella del ritaglio allegato: labbra chiuse e rilassate, niente sorriso, niente denti. E' una bocca stretta.

GLI OCCHIALI DA SOLE sono esattamente quelli dell'immagine su fondo grigio: stessa forma, proporzioni, spessore della montatura e curvatura.

LA LUCE e' una luce da studio COLORATA, da ritratto editoriale con gelatine (colored gel portrait lighting).
- LUCE PRINCIPALE: un beauty dish grande e morbido, davanti a me e un po' piu' in alto dei miei occhi, con davanti una GELATINA VERDE-ACQUA (teal gel): un ciano che tende al VERDE, non al blu. La luce che mi batte in faccia NON e' bianca e NON e' blu: e' verde-acqua.
- Quel colore sta sulla parte ILLUMINATA DEL VISO, al centro: fronte, dorso del naso, zigomi, guance e mento. PIU' DI META' della pelle del viso e' visibilmente verde-acqua. Non e' un bordo: e' la faccia stessa colorata dalla luce.
- E' una luce FORTE: le alte luci su fronte, dorso del naso e zigomi sono PRATICAMENTE BIANCHE, bruciate, con un riflesso lucido. Il viso e' la cosa piu' chiara dell'immagine, sovraesposto come in un ritratto di moda.
- Il mio incarnato caldo, rosato, si vede SOLO nelle ombre: sotto gli zigomi, ai lati del naso, sotto il mento. Alte luci verde-acqua, ombre calde: e' questo contrasto che fa la foto.
- Da dietro c'e' solo un filo sottile di luce fredda sul bordo dei capelli: e' un dettaglio, non la luce principale.
- Le ombre sono morbide: sotto il naso e sotto il mento solo un'ombra sfumata. Nessuna zona buia.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni. Niente brufoli, macchie, rossori, occhiaie, cicatrici, pori dilatati, peli sparsi. Resta pero' una pelle vera: grana fine e pori sottili ancora visibili da vicino, non plastica e non liscia come un'illustrazione. Ha la luminosita' curata di un ritratto beauty, con i riflessi lucidi del beauty dish.

IL FONDO e' un fondale da studio liscio e continuo, senza oggetti. In alto e' blu notte profondo e resta scuro; all'altezza della mia testa e' nettamente piu' scuro del mio viso illuminato. Dalle spalle in giu' schiarisce in un blu di cielo dopo il tramonto, in cui il blu domina sempre sul verde, e da li' al bordo basso resta uguale. La transizione e' continua. Da quel chiarore in basso arriva un riflesso freddo sul bordo delle spalle.

INQUADRATURA: mezzo busto stretto con un 50mm: la testa occupa circa due quinti dell'altezza, si vedono le spalle e l'inizio del petto.

VESTITO: maglia nera a maniche lunghe ADERENTE, girocollo, tessuto fine che segue il corpo. Si vede che sotto sono magro.

Quadrata 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);
  // Controllo sulle frasi che si contraddicevano: non devono tornare.
  for (const vietata of ["ritratto di studio", "UN'ALTRA PERSONA", "OPACA", "matificante", "senza punti speculari", "NON e' una persona", "secondo scatto"]) {
    if (PROMPT.includes(vietata)) throw new Error(`il prompt contiene di nuovo: ${vietata}`);
  }

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      PROMPT,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: "luce-gel-2",
        materia: MATERIA,
        cambiato: "da v168/v169: gelatina verde-acqua invece di ciano-blu; il colore copre il centro del viso (non il bordo); alte luci bruciate; contorno ridotto a un filo",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "ciano centro > 30% (ref 52,7, v168 12,5) · bordi < centro · b* luci > -3 (ref +4,4, v168 -11) · alte luci p98 > 92",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[gel2] job ${job.id}  giro ${g}`);
  }
});
