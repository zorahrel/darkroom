/**
 * Tutto in UNA passata, partendo dalla foto vera. Niente catene.
 *
 * L'UTENTE, 23/09, su v154: «lo vedo ancora rotto da alcune parti, tipo con
 * una noise. Non e' evitabile? Alcune non ce l'avevamo».
 *
 * MISURA. Rumore sulle zone piatte (std dell'high-pass, L*, 1024 px), per
 * numero di passate sopra la foto vera:
 *
 *     v148  ricetta intera, foto vera      1 passata    0,29
 *     v141  ricetta intera, foto vera      1            0,37
 *     v146  v141 + 3 correzioni Codex      4            0,59
 *     v150  + via la barba                 5            0,55
 *     v154  + ritaglio ingrandito          6            0,77
 *
 * Ogni generazione ridisegna l'immagine che riceve, e ridisegnare un'immagine
 * gia' generata aggiunge grana sopra grana. Il ritaglio di v154 era per di
 * piu' INGRANDITO (x1,4): ChatGPT ha ricevuto una faccia morbida e ci ha
 * inventato sopra la texture. Il rumore e' evitabile: si evita non facendo
 * catene.
 *
 * COSA CAMBIA RISPETTO A v145 (che era gia' una passata sola):
 *   1. materia: la foto vera a piena risoluzione, RITAGLIATA stretta e
 *      RIMPICCIOLITA (scala 0,65): faccia ~500 px nell'uscita, come la versione
 *      stretta, ma nitida invece che ingrandita;
 *   2. barba: «barba irregolare» -> rasato di fresco (l'utente preferiva le
 *      versioni senza);
 *   3. esposizione e ciano: le due istruzioni che su v146 sono servite in tre
 *      passate Codex, qui dentro la stessa.
 *
 * Barra: rumore zone piatte <= 0,45 · fronte-guance > 0 · L viso >= 35 ·
 * ciano >= 15%.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const BASE = 145;
const MATERIA = "io-luce-alta-stretta-luce.png";

/**
 * SECONDO GIRO (v155/v156). Rumore risolto: 0,38 e 0,41, contro 0,77 di v154.
 * Luce dall'alto la piu' forte mai avuta (fronte-guance +37). Ma due cose
 * ordinate male:
 *   - esposizione: L viso 25,9 e 30,8. In una passata sola l'istruzione
 *     «alza di uno stop e mezzo» non passa: il viso copia l'esposizione della
 *     foto di partenza (L viso 27,0). Quindi la foto di partenza e' schiarita
 *     PRIMA, come si sviluppa un RAW: curva esponenziale sul lineare (c=2,0),
 *     medi raddoppiati e alte luci piegate. L viso 27,0 -> 38,5, bruciato 0%.
 *     E' una regolazione globale sulla foto vera, non un ritocco sul risultato;
 *   - inquadratura: la faccia esce a 298 e 335 px perche' il prompt di v145
 *     ordina «mezzo busto da LONTANO... la testa occupa meno di meta' altezza...
 *     Niente primo piano». E' la stessa ragione della faccia impastata di v150.
 */
const INQ_VECCHIA =
  "INQUADRATURA: mezzo busto da LONTANO con un 35mm, come una persona vista a due metri: " +
  "la testa occupa meno di meta' altezza, c'e' aria intorno. Niente primo piano.";
const INQ_NUOVA =
  "INQUADRATURA: mezzo busto stretto con un 50mm, come nella foto principale: la testa " +
  "occupa circa due quinti dell'altezza dell'immagine, si vedono le spalle e l'inizio del petto.";

const BARBA_VECCHIA = "pori visibili, barba irregolare, pelle non uniforme.";
const BARBA_NUOVA =
  "pori visibili, rasato di fresco con la lievissima ombra dei peli appena tagliati, " +
  "pelle non uniforme.";

const LUCE_E_COLORE =
  "\n\nESPOSIZIONE E COLORE, dentro questo stesso scatto. La foto principale e' piu' scura " +
  "di come la voglio: alza l'esposizione di circa uno stop e mezzo, il viso deve risultare " +
  "luminoso, appena un filo sovraesposto come un ritratto di moda, mai in penombra. La " +
  "lampada e' un softbox con gel AZZURRO-CIANO puntato da davanti e dall'alto: fronte, " +
  "zigomi, dorso del naso e mento virano visibilmente al ciano, circa un quarto della pelle " +
  "decisamente azzurrata; l'incarnato caldo resta solo nelle zone in ombra. La pelle e' " +
  "pulita e nitida come uno scatto a ISO basso con una reflex, con la grana fine e uniforme " +
  "di una fotografia vera.";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

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

  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);
  if (!base.prompt_used.includes(BARBA_VECCHIA)) throw new Error("frase della barba non trovata in v145");
  if (!base.prompt_used.includes(INQ_VECCHIA)) throw new Error("frase dell'inquadratura non trovata in v145");
  const prompt =
    base.prompt_used.replace(BARBA_VECCHIA, BARBA_NUOVA).replace(INQ_VECCHIA, INQ_NUOVA) + LUCE_E_COLORE;

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      prompt,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: "unica-passata-2",
        base: `v${BASE}`,
        materia: MATERIA,
        cambiato: "foto di partenza schiarita di 1 stop (L viso 38,5) + inquadratura stretta nel prompt",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "rumore piatto <= 0,45 · fronte-guance > 0 · L viso >= 35 · ciano >= 15%",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[unica] job ${job.id}  giro ${g}`);
  }
});
