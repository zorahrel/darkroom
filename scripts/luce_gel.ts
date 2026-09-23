/**
 * La luce della reference detta SOLO nel prompt, senza allegarla.
 *
 * L'UTENTE, 24/09, su v167: «non ti accorgi da solo che non e' la stessa luce?
 * No, non nella reference: da prompt penso dovresti riuscire».
 *
 * COSA MANCAVA, misurato sui pixel del viso (/tmp/ciano_dove.py):
 *
 *                 ciano centro  ciano bordi  alte luci p98  a* luci  a* ombre
 *   reference         52,7%        28,2%          97,4        -9,8     +10,5
 *   v167               1,5%         9,6%          80,1       +14,2     +10,7
 *
 * Il ciano della reference sta soprattutto AL CENTRO del viso: e' la luce
 * principale a essere ciano (una gelatina), non solo un contorno. Le alte luci
 * arrivano quasi al bianco. Il prompt di v167 chiedeva «un terzo della pelle
 * azzurrata» con un beauty dish e un pannello BIANCO: ha dato una luce calda.
 * Qui la luce principale ha la gelatina ciano esplicita, piu' una luce di
 * contorno ciano da dietro, e la reference non e' piu' allegata. Resto uguale.
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
- LUCE PRINCIPALE: un beauty dish grande e morbido, davanti a me e un po' piu' in alto dei miei occhi, con davanti una GELATINA CIANO (teal/cyan gel). La luce che mi batte in faccia NON e' bianca: e' azzurro-ciano. Fronte, dorso del naso, zigomi e mento sono visibilmente CIANO: circa META' della pelle illuminata del viso e' azzurro-ciana, non un velo leggero.
- E' una luce forte: le alte luci su fronte, dorso del naso e zigomi arrivano QUASI AL BIANCO, appena bruciate, con un riflesso lucido. Il viso e' la cosa piu' chiara dell'immagine, un filo sovraesposto.
- Il mio incarnato caldo, rosato, si vede SOLO nelle ombre: sotto gli zigomi, ai lati del naso, sotto il mento. E' questo contrasto — alte luci ciano, ombre calde — che fa la foto.
- LUCE DI CONTORNO: da dietro, una seconda luce ciano disegna un bordo freddo sui capelli, sulle orecchie e sul contorno della mascella.
- Le ombre sono morbide e leggere: sotto il naso e sotto il mento solo un'ombra sfumata. La luce copre il viso in modo uniforme, senza zone buie.

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
        recipe: "luce-gel-solo-prompt",
        materia: MATERIA,
        cambiato: "reference NON allegata: la luce e'\ descritta solo nel prompt, come beauty dish con gelatina ciano + contorno ciano; alte luci quasi bianche, ombre calde",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "ciano al centro del viso ~50% (ref 52,7) · alte luci p98 ~97 · a* luci < 0 · a* ombre ~ +10",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[gel] job ${job.id}  giro ${g}`);
  }
});
