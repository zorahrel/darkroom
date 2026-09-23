/**
 * Luce da studio uniforme e pelle ritoccata: un solo cambio rispetto a
 * `prompt_pulito.ts`, i blocchi LUCE e PELLE.
 *
 * L'UTENTE, 24/09, su v165: «molto meglio ma ancora la luce non sembra
 * uniforme e curata da studio, e diciamo che rimuove imperfezioni».
 *
 * Il prompt di v165 descriveva un FARETTO DURO («sorgente piccola e intensa,
 * cala in fretta, guance chiaramente piu' scure, ombra netta») e chiedeva
 * «niente ritocco». Ha ottenuto esattamente quello: faretto marcato, pelle non
 * ritoccata. Qui la luce diventa un beauty dish grande con riempimento dal
 * basso (uniforme, riflessi morbidi, ombre leggere) e la pelle ritoccata da
 * servizio di moda, con la grana ancora vera. Tutto il resto e' identico.
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

LA LUCE, copiata dal ritratto di studio allegato: una luce da studio CURATA, da ritratto beauty. La sorgente principale e' GRANDE e morbida, un beauty dish con diffusore, davanti a me e un po' piu' in alto dei miei occhi; sotto il viso un pannello bianco di riempimento apre le ombre. Il risultato e' una luce UNIFORME su tutto il viso.
- Fronte, guance, zigomi, naso e mento sono illuminati in modo omogeneo: nessuna zona buia, nessuna macchia di luce, nessun lato piu' scuro dell'altro.
- Fronte, dorso del naso e parte alta degli zigomi hanno un riflesso luminoso morbido, appena piu' chiari del resto.
- Sotto il naso e sotto il mento c'e' solo un'ombra leggera e sfumata.
- Il colore di quella luce e' FREDDO: le zone illuminate virano all'azzurro-ciano, circa un terzo della pelle visibilmente azzurrata. L'incarnato caldo resta solo nelle ombre leggere.
- Il viso e' la cosa piu' chiara dell'immagine, appena sovraesposto, come un ritratto di moda.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni. Niente brufoli, macchie, rossori, occhiaie, cicatrici, pori dilatati, peli sparsi. Resta pero' una pelle vera: grana fine e pori sottili ancora visibili da vicino, non plastica e non liscia come un'illustrazione. Ha la luminosita' curata della pelle del ritratto di studio, con i riflessi morbidi del beauty dish.

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
        recipe: "luce-beauty",
        materia: MATERIA,
        cambiato: "luce: da faretto duro a beauty dish uniforme + riempimento; pelle: ritoccata senza imperfezioni. Resto del prompt identico a prompt-pulito (v165)",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "uniformita' L sul viso vicina alla reference · macchie < v165 · ciano non peggiore di v165",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[beauty] job ${job.id}  giro ${g}`);
  }
});
