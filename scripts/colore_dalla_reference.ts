/**
 * Rimettere il colore su v141, che e' la prima con la luce dalla parte giusta.
 *
 * DOVE SIAMO. Il 15/09 la direzione della luce e' passata sopra zero per la
 * prima volta in venticinque tiri, togliendo dagli allegati le due sue foto
 * illuminate dal basso:
 *
 *                                    alto-basso   %ciano    L viso
 *     reference                         +19,8      26,7%     40,3
 *     v128  (consegnata)                -12,6      24,0%     35,7
 *     v139  materia alta + prompt        -2,7       3,0%     31,2
 *     v141  + tolte le due foto basse    +8,3       1,9%     18,7   <- luce OK
 *
 * Cioe' ho scambiato il colore con la direzione: v128 ha il colore e la luce
 * sbagliata, v141 ha la luce e nessun colore, ed e' anche la piu' scura del
 * progetto. Non e' un caso, ed e' la stessa causa: il ciano di v128 arrivava da
 * due sue foto tinte di ciano da me e dichiarate nel prompt come "la luce della
 * scena". Quelle foto sono nel cestino — le ha tolte lui, e due volte mi ha
 * detto di non fabbricare allegati — quindi il ciano oggi lo chiedono solo le
 * parole, e da solo il prompt lo porta al 2-3%.
 *
 * COSA PROVO, e perche' proprio questo. Allego la REFERENCE come campione di
 * colore ed esposizione. Non e' fabbricata: e' l'immagine che lui stesso ha
 * indicato come bersaglio, ed e' l'unica cosa in giro che porta le tre
 * proprieta' che mi mancano tutte insieme e gia' d'accordo fra loro:
 *
 *     ciano sulla pelle   26,7%   (v141: 1,9%)
 *     viso esposto        L 40,3  (v141: 18,7 — la piu' scura del progetto)
 *     luce alta           +19,8   (v141: +8,3, quindi non la contraddice)
 *
 * L'ultima riga e' la ragione per cui vale la pena adesso e non prima. Il 14/09
 * avevo gia' allegato la reference, col ruolo di campione di DIREZIONE, e non
 * era servita: ma allora la materia era una sua foto illuminata dal basso, e
 * l'allegato remava contro l'ingresso. Ora materia e reference dicono la stessa
 * cosa sulla luce, e il ruolo che le do e' quello che la reference puo'
 * davvero insegnare — il colore e l'esposizione, non la geometria.
 *
 * LA FORMA DELLA RIGA, che qui e' tutto. Immagine + ruolo esplicito e' la sola
 * combinazione che ha funzionato tre volte su questo progetto (gli occhiali, il
 * fondo, il ciano di v128): l'immagine porta il fatto, la riga dice cosa
 * prenderne e cosa no. La parte "cosa no" e' la meta' che l'anno scorso mi ha
 * fatto ritrovare la faccia di un'altra persona nei render, quindi e' esplicita
 * e occupa piu' spazio del "cosa si'".
 *
 * CANCELLI, tutti e tre insieme — questo giro non vale se ne passa uno solo:
 *     %ciano  >= 12   (meta' strada verso 26,7; sotto, le parole non bastano)
 *     L viso  >= 30   (v141 e' a 18,7: cosi' scura non si consegna)
 *     alto-basso > 0  (non si torna indietro sulla cosa appena guadagnata)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
/** v141: materia alta + prompt pulito + niente foto illuminate dal basso. */
const BASE = 141;
const MATERIA = "io-luce-alta.jpeg";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

/** Il ruolo dell'ultimo allegato, in coda al prompt. */
const RUOLO =
  "\n\nL'ULTIMA IMMAGINE ALLEGATA e' il ritratto di UN'ALTRA PERSONA, e serve a UNA COSA SOLA: " +
  "il COLORE e la LUMINOSITA' della pelle. Guarda come la luce colorata cade sulla sua faccia — " +
  "i riflessi freddi, azzurro-ciano, su fronte, zigomi e dorso del naso, e il calore che resta " +
  "solo nelle zone in ombra — e come la sua faccia sia CHIARA, esposta, per niente buia. " +
  "La MIA faccia deve avere lo stesso colore di luce e la stessa luminosita': riflessi ciano " +
  "sulle parti illuminate, incarnato caldo nelle ombre, pelle chiara e ben esposta. " +
  "Di quella persona NON prendere assolutamente: il viso, i lineamenti, la pelle liscia, i " +
  "capelli, la posa, il corpo, i vestiti, lo sfondo, l'inquadratura. Il viso resta il MIO, " +
  "quello della foto principale. Prendi da lei soltanto il colore della luce e quanto e' chiara.";

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    // ultima: il campione di colore. L'ordine conta, il prompt dice "l'ultima".
    join(D, "refs", "luce-bg-studio-blu.png"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);
  for (const vietata of ["mascella da sotto", "appena a sinistra"]) {
    if (base.prompt_used.toLowerCase().includes(vietata)) {
      throw new Error(`v${BASE} ha ancora "${vietata}": base sbagliata`);
    }
  }

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      base.prompt_used + RUOLO,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: "colore-dalla-reference",
        base: `v${BASE}`,
        materia: MATERIA,
        cambiato: "reference allegata come campione di COLORE ed ESPOSIZIONE (non di direzione)",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "%ciano >= 12 · L viso >= 30 · alto-basso > 0 — tutti e tre",
        giro: g,
      }),
      "cdp",
    );
    console.log(`[colore] job ${job.id}  giro ${g}`);
  }
});
