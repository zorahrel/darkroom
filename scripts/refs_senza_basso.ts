/**
 * Togliere dagli allegati le due foto illuminate dal basso.
 *
 * DA DOVE VIENE, in numeri. La direzione della luce si muove da quando la
 * materia dell'edit e' una sua foto gia' illuminata dall'alto, e si muove in
 * modo monotono ogni volta che tolgo una fonte di luce bassa dall'ingresso:
 *
 *     reference                                      +19,8
 *     io-luce-alta.jpeg  (la materia)                +15,3
 *     v128  materia vecchia + prompt sporco          -12,6
 *     v138  materia NUOVA   + prompt sporco           -6,2
 *     v139  materia NUOVA   + prompt PULITO           -2,7   <- migliore finora
 *
 * Restano 18 punti fra la materia (+15,3) e quello che esce (-2,7), e c'e' un
 * solo ingresso che ancora li spiega: DUE DEI QUATTRO ALLEGATI sono sue foto
 * illuminate dal basso — `1.PNG` a -3,8 e il selfie a -11,8. Il 14/09 un giro
 * in `generate`, SENZA nessuna foto sorgente, e' uscito comunque dal basso: la
 * sola cosa che aveva in ingresso erano quelle due. Quindi non e' l'edit a
 * ereditare la luce, sono gli allegati a portarla, e finche' restano li' la
 * tirano giu' anche con la materia e il prompt giusti.
 *
 * COSA CAMBIA, una cosa sola: quei due allegati non si mandano piu'. Restano
 * il ritaglio della bocca e gli occhiali, che sono dettagli e non facce
 * illuminate. Materia e prompt sono quelli di v139, parola per parola — e
 * stavolta lo dico avendolo verificato, non per convenzione: il prompt e'
 * quello gia' ripulito, senza "mascella da sotto" ne' "appena a sinistra".
 *
 * PERCHE' NON E' UNA PERDITA DI IDENTITA' ANNUNCIATA, ed e' la domanda giusta
 * da farsi prima di togliere le foto che tengono il viso. La materia NON e' un
 * fondo o un render: e' una sua foto vera, frontale, viso intero, con la bocca
 * scoperta che misura 0,237 contro lo 0,236 della sua bocca reale. L'identita'
 * continua ad arrivare da una sua fotografia — semplicemente da quella, invece
 * che da altre due in cui la luce e' sbagliata. Il rischio esiste comunque
 * (meno angoli del viso in ingresso) ed e' per questo che si misura:
 *
 *     mouth_check   la bocca non deve allargarsi oltre 0,26 (la sua: 0,236)
 *     occhio        deve restare riconoscibile: se non e' lui, si butta
 *
 * L'ho gia' visto fallire in questa forma: il 13/09 allegare foto identita'
 * TRATTATE da me ha prodotto "non sono io". Ma li' il difetto erano le foto
 * fabbricate; qui non fabbrico niente, tolgo soltanto.
 *
 * CANCELLO: alto-basso > 0. Invariato, e non negoziabile al ribasso: sotto
 * zero vuol dire mento piu' chiaro della fronte, cioe' il difetto che l'utente
 * vede e chiama "non e' frontale". -2,7 e' piu' vicino di -12,6 e resta un no.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
/** v139: materia alta + prompt ripulito. Il prompt si prende da li'. */
const BASE = 139;
const MATERIA = "io-luce-alta.jpeg";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);

  /** Solo dettagli, nessuna faccia illuminata dal basso. */
  const refs = [join(D, "refs", "bocca-reale.png"), join(D, "refs", "occhiali-gascan-ritagliato.jpg")];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

  // Il prompt di v139 deve essere quello ripulito: se non lo e', mi sono
  // sbagliato di base e il giro non parte.
  for (const vietata of ["mascella da sotto", "appena a sinistra"]) {
    if (base.prompt_used.toLowerCase().includes(vietata)) {
      throw new Error(`v${BASE} ha ancora "${vietata}": base sbagliata`);
    }
  }

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      base.prompt_used,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: "refs-senza-basso",
        base: `v${BASE}`,
        materia: MATERIA,
        cambiato: "tolti 1.PNG (-3,8) e il selfie (-11,8): gli unici ingressi ancora illuminati dal basso",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "key_direction alto-basso > 0 · mouth_check <= 0,26 · e deve restare lui",
        giro: g,
      }),
      "cdp",
    );
    console.log(`[senza-basso] job ${job.id}  giro ${g}`);
  }
});
