/**
 * Incarnato caldo e un filo sovraesposto: togliere le istruzioni che lo
 * spegnevano.
 *
 * L'UTENTE, 13/09, su v128: "l'incarnato e' troppo pallido", "dovrebbe essere
 * un po' sovraesposto", "non e' figo come altre foto uscite finora".
 *
 * MISURATO sul viso, e gli da' ragione su tutti e tre:
 *
 *                     v128    la SUA pelle vera    reference
 *     L                34,5          46,3              41,7
 *     croma            12,5          21,1              12,2
 *     alte luci >85%    0,7%          3,5%             13,7%
 *
 * v128 e' il render PIU' SCURO e PIU' PALLIDO dell'intero progetto, e ha il
 * viso praticamente senza alte luci. La reference, che e' la foto "figa" da
 * cui siamo partiti, ha il 13,7% del viso sopra L 85: e' proprio quella
 * sovraesposizione a farla sembrare una foto di moda.
 *
 * LA CAUSA E' NEL PROMPT, E L'HO SCRITTA IO. Quando l'utente disse "la pelle
 * sembra grassa" ho aggiunto tre blocchi che, messi insieme, ordinano
 * esattamente il difetto di oggi:
 *
 *   "Quasi desaturata, come una pelle sotto un softbox bianco grande"
 *   "Chiara ma NON bruciata, e soprattutto OPACA: [...] non voglio nessun
 *    riflesso speculare su fronte, naso e zigomi"
 *   "La pelle e' OPACA e ASCIUTTA, come dopo un foglio matificante"
 *
 * Sono la stessa forma di errore delle "spalle cadenti" di settembre: una
 * frase nata per togliere un difetto che, restando nel prompt, ne ordina un
 * altro. E in piu' inseguiva il numero LETTERALE della reference (croma 12,2)
 * su una persona la cui pelle vera sta a 21,1.
 *
 * COSA CAMBIA QUI. Solo quei tre blocchi, uno alla volta, sostituiti con il
 * loro opposto misurato — caldo quanto la SUA pelle, un filo sovraesposto,
 * riflessi morbidi dove la luce batte. Restano intatti: pori e grana (il
 * confine fra "luminosa" e "plastica"), identita', occhiali, fondo, 35mm, e
 * la riga sul ciano che il 13/09 ha portato il colore da 2,0% a 24,0%.
 *
 * BERSAGLI, presi dalla PERSONA e non dal modello:
 *     L viso   -> 45     (sua 46,3)
 *     croma    -> 20     (sua 21,1)
 *     alte luci-> 4-14%  (sua 3,5%, reference 13,7%)
 *     ciano    -> >=20%  non deve perdersi per strada
 *
 * USO
 *     bun run scripts/pelle_calda_esposta.ts [--giri 2]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = arg("--progetto") ?? "profilo";
const PHOTO = "1";
const BASE = Number(arg("--base") ?? 128);
const rounds = Math.max(1, Number(arg("--giri") ?? 2));

/** I tre blocchi da ribaltare, con il loro opposto. */
const SOSTITUZIONI: Array<[string, string]> = [
  [
    "Quasi desaturata, come una pelle sotto un softbox bianco grande.",
    "Incarnato CALDO e pieno, il suo: olivastro mediterraneo, saturo come " +
      "nelle foto vere che ti allego. Non e' una pelle chiara del nord e non " +
      "va lavata.",
  ],
  [
    "Chiara ma NON bruciata, e soprattutto OPACA: desaturata non vuol dire " +
      "lucida, non voglio nessun riflesso speculare su fronte, naso e zigomi.",
    "Un filo SOVRAESPOSTA, come nelle foto di moda: il viso e' il punto piu' " +
      "luminoso dell'inquadratura e sfiora il bianco su fronte e zigomi, " +
      "senza bruciare i dettagli. Dove la luce batte la pelle BRILLA di un " +
      "riflesso morbido e ampio — non un puntino unto, una lucentezza sana.",
  ],
  [
    "La pelle e' OPACA e ASCIUTTA, come dopo un foglio matificante: nessun " +
      "riflesso lucido su fronte, naso, zigomi e mento, niente pelle grassa, " +
      "niente sudore, niente aloni brillanti.",
    "La pelle e' CURATA e LUMINOSA: sulla fronte, sugli zigomi e sul dorso " +
      "del naso c'e' una lucentezza morbida e diffusa, come una pelle idratata " +
      "sotto una luce grande. Non unta e non sudata — larga e uniforme, non a " +
      "chiazze.",
  ],
];

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

  let testo = base.prompt_used;
  for (const [vecchio, nuovo] of SOSTITUZIONI) {
    if (!testo.includes(vecchio)) {
      // Un'ancora che non c'e' piu' ferma tutto: se una sostituzione non
      // aggancia, il tiro parte con meta' ricetta e la cella misura un'altra
      // cosa. E' gia' successo il 09/09 (quattro job da buttare).
      throw new Error(`ancora non trovata nel prompt di v${BASE}: "${vecchio.slice(0, 60)}…"`);
    }
    testo = testo.replace(vecchio, nuovo);
  }

  const D = dirsFor(PID).DATA_DIR;
  const refs = [
    join(D, "refs", "id1-luce-ciano.png"),
    join(D, "refs", "id2-luce-ciano.png"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of refs) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    const lineage = JSON.stringify({
      recipe: "pelle-calda-esposta",
      base: `v${BASE}`,
      passo: "tolte le tre istruzioni che spegnevano l'incarnato",
      refs: refs.map((r) => r.split("/").pop()),
      misura:
        "L viso -> 45 (sua 46,3 · v128 34,5) · croma -> 20 (sua 21,1 · v128 12,5) · " +
        "alte luci >85% fra 4 e 14% (v128 0,7%) · ciano >=20% · " +
        "controprova a occhio: calda e luminosa, non unta e non di plastica",
    });
    const job = enqueueJob(
      PHOTO,
      testo,
      null,
      "chatgpt",
      null,
      "edit",
      join(D, "RAW", "1.PNG"),
      JSON.stringify(refs),
      lineage,
      "cdp",
    );
    console.log(`[pelle] job ${job.id}  giro ${g}`);
  }
});
