/**
 * Il prompt riscritto da zero, coerente, con la luce della reference detta
 * come un faretto. Nessuna foto alterata: la partenza e' `1.PNG` intatta.
 *
 * L'UTENTE, 24/09, su v163/v164: «gia' meglio ma ancora non e' la stessa luce».
 *
 * PERCHE' NON UN'ALTRA TOPPA. Il prompt di v163 era 7.492 caratteri
 * stratificati da 160 versioni di `.replace()`, e si contraddiceva da solo:
 *
 *   - l'ultimo allegato era descritto in TRE modi: «il FONDALE, non una
 *     persona» (da copiare cosi' com'e'), «un'altra persona da cui prendere
 *     solo il colore della pelle, NON lo sfondo», «luce, fondo e colore»;
 *   - parlava di un «secondo scatto che sono IO» che non esiste piu';
 *   - diceva che le mie foto «sono state riprese sotto quella stessa luce»,
 *     falso per `1.PNG`;
 *   - e VIETAVA TRE VOLTE il faretto: «OPACA… nessun riflesso speculare su
 *     fronte, naso e zigomi», «OPACA e ASCIUTTA come dopo un foglio
 *     matificante», «luce morbida e senza punti speculari». Il faretto della
 *     reference E' quei riflessi (area lucida 26,7%, alte luci L 91).
 *
 * Le frasi sull'opacita' erano nate da «la pelle sembra grassa»; dopo, l'utente
 * ha chiesto «la pelle curata e lucida tipo della modella». Il prompt ha tenuto
 * entrambe. Qui resta la seconda, detta come effetto della luce e non della
 * pelle.
 *
 * COSA RESTA UGUALE a v163: partenza `1.PNG` intatta, allegati (bocca,
 * occhiali, reference), identita', bocca, occhiali, capelli, corpo, rasato,
 * inquadratura stretta, vestito, fondo. Cambia solo il modo di dirli, piu' il
 * blocco luce/pelle.
 *
 * MISURA (reference): fronte-guance 62 · alte luci L 91 · ciano 36% · a* luci
 * -8,4 / ombre +10,7. v163: 1,5 · 75 · 9% · +6,2 / +7,0.
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
3. il ritratto di studio di UN'ALTRA PERSONA. Da questa immagine prendi SOLO tre cose: la luce, il fondo e il colore. Il viso, i capelli, la posa, gli occhiali e l'eta' di quella persona non sono miei e non vanno presi.

CHI SONO. Sono un ragazzo MAGRO e ossuto, corporatura esile. Viso stretto e lungo, zigomi sottili, mascella normale, mento non squadrato. Collo sottile, piu' stretto della testa, pomo d'Adamo sporgente. Spalle strette e cadenti. Non allargarmi, non irrobustirmi, non simmetrizzarmi il viso, non ringiovanirmi. I miei capelli sono CASTANI SCURI e ricci. Sono RASATO di fresco: guance, mento e mascella lisci, con la lievissima ombra dei peli appena tagliati. Ignora la posa e le mani della foto: niente mano vicino al viso.

LA MIA BOCCA e' esattamente quella del ritaglio allegato: labbra chiuse e rilassate, niente sorriso, niente denti. E' una bocca stretta.

GLI OCCHIALI DA SOLE sono esattamente quelli dell'immagine su fondo grigio: stessa forma, proporzioni, spessore della montatura e curvatura.

LA LUCE, copiata dal ritratto di studio allegato. E' UN FARETTO: una sola sorgente piccola e intensa, davanti a me e piu' in alto dei miei occhi, puntata dritta sulla faccia. Non e' una luce morbida e diffusa: cala in fretta dal centro del viso verso i bordi.
- La FRONTE, il DORSO DEL NASO e la parte alta degli ZIGOMI sono le zone piu' chiare di tutta l'immagine: nel punto piu' alto quasi bianche, con un riflesso lucido.
- Le guance sotto gli zigomi, le tempie e la mascella sono chiaramente piu' scure.
- Sotto il naso, sotto il labbro inferiore e sotto il mento cade un'ombra netta, rivolta verso il basso.
- Il colore di quella luce e' FREDDO: le zone illuminate virano all'azzurro-ciano, circa un terzo della pelle visibilmente azzurrata. L'incarnato caldo resta solo nelle ombre.
- Il viso e' la cosa piu' chiara dell'immagine, appena sovraesposto sulle parti illuminate, come un ritratto di moda.

LA PELLE e' curata e luminosa come quella del ritratto di studio: il faretto ci lascia sopra riflessi lucidi su fronte, naso e zigomi, ed e' la luce a farli, non una pelle grassa. Pori visibili, grana fine e uniforme come uno scatto a ISO basso con una reflex. Una fotografia vera: niente ritocco, niente pelle di plastica.

IL FONDO e' quello del ritratto di studio: un fondale liscio e continuo, senza oggetti. In alto e' blu notte profondo e resta scuro; all'altezza della mia testa e' nettamente piu' scuro del mio viso illuminato. Dalle spalle in giu' schiarisce in un blu di cielo dopo il tramonto, in cui il blu domina sempre sul verde, e da li' al bordo basso resta uguale. La transizione e' continua. Da quel chiarore in basso arriva un riflesso freddo sul bordo delle spalle.

INQUADRATURA: mezzo busto stretto con un 50mm: la testa occupa circa due quinti dell'altezza, si vedono le spalle e l'inizio del petto.

VESTITO: maglia nera a maniche lunghe ADERENTE, girocollo, tessuto fine che segue il corpo, come quella del ritratto di studio. Si vede che sotto sono magro.

Quadrata 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "luce-bg-studio-blu.png"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);
  // Controllo sulle frasi che si contraddicevano: non devono tornare.
  for (const vietata of ["OPACA", "matificante", "senza punti speculari", "NON e' una persona", "secondo scatto"]) {
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
        recipe: "prompt-pulito",
        materia: MATERIA,
        cambiato: "prompt riscritto da zero: tolte le 3 frasi che vietavano i riflessi, un solo ruolo per la reference, luce detta come faretto",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "fronte-guance >> 1,5 · alte luci > 75 · ciano > 9% · a* luci < 0 · artefatti <= 200",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[pulito] job ${job.id}  giro ${g}`);
  }
});
