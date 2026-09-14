/**
 * La reference allegata COL RUOLO di campione di direzione della luce.
 *
 * PERCHE' QUESTA E NON UN'ALTRA FRASE. Quindici tiri hanno provato a dire la
 * direzione a parole, e il prompt di v133 la dice in modo esplicito —
 * «FRONTALE rispetto al mio viso e centrata su di esso», «la fronte e' piu'
 * chiara del mento». Misurato: alto-basso -8,2 (v133) e -7,2 (v134), contro
 * +19,8 della reference. Dirla non funziona, e non e' questione di come.
 *
 * Cio' che INVECE ha funzionato, tre volte, e' sempre la stessa forma:
 * un'immagine che porta il fatto PIU' una riga di prompt che le da' il ruolo.
 *
 *   occhiali  descritti a parole per 17 versioni -> forma sbagliata;
 *             allegati + «sono esattamente quelli» -> giusti.
 *   fondo     «un cielo» a parole -> fondo spento (40,69,93);
 *             immagine di cielo allegata + ruolo -> colore giusto.
 *   ciano      allegati tinti e prompt muto -> 2,7% di viso ciano;
 *             stessi allegati + «quella e' la luce della scena» -> 24,0%.
 *
 * E ogni volta che una delle due meta' mancava, il risultato era nullo: non
 * basta l'immagine, non basta la parola.
 *
 * LA META' CHE NON HO MAI DATO PER LA DIREZIONE E' L'IMMAGINE. La reference
 * e' stata allegata una volta sola (v94) con il ruolo di «fondale con una
 * persona davanti» — cioe' come campione di FONDO, mai come campione di come
 * la luce cade su un viso. Le foto di luce che il modello ha visto finora
 * sono solo le mie, e sono illuminate dal basso (-3,8 e -11,8): copia quelle
 * perche' sono le uniche che ha.
 *
 * QUI: la reference entra come quinto allegato con un ruolo scritto — non e'
 * il mio viso, non e' il mio fondo, e' SOLO l'esempio di dove sta la lampada.
 * Il rischio noto e' che ne prenda il viso: la misura della bocca
 * (mouth_check.py) e il giudizio dell'utente dicono se e' successo.
 *
 * NON ritocco le sue foto: quella strada era aperta (relight_identity.py,
 * misurato: porta alto-basso a +19,7) e l'utente l'ha chiusa — «non devi
 * editare tu a mano». Lo script resta nel repo come misura, non in uso.
 *
 * BARRA, sulla base v133 (colore e laterale gia' a posto):
 *   alto-basso        -8,2  ->  > 0        (reference +19,8)
 *   sx-dx              1,0  ->  resta |x| < 4
 *   bocca/viso       0,285  ->  non peggiora (sue foto 0,236-0,256)
 *   ciano             2,2%  ->  non crolla
 * Se alto-basso non passa sopra zero, la strada dell'immagine+ruolo e'
 * falsificata anche per la direzione, e resta solo lo scatto.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";
import { enqueueJob } from "../server/jobs.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = arg("--progetto") ?? "profilo";
const PHOTO = "1";
const BASE = Number(arg("--base") ?? 133);
const rounds = Math.max(1, Number(arg("--giri") ?? 2));

/** Il ruolo del quinto allegato, detto in modo che non possa leggerlo come viso. */
const RUOLO_CAMPIONE =
  "\n\nL'ULTIMA IMMAGINE ALLEGATA NON SONO IO e non e' il mio sfondo: e' la " +
  "foto di un'altra persona, e serve a UNA COSA SOLA, guarda dove cade la " +
  "luce sul suo viso. Su di lei la fronte e' la zona piu' chiara di tutta la " +
  "faccia, gli zigomi la seguono, la mascella e il mento sono in ombra: la " +
  "lampada sta IN ALTO e DAVANTI a lei. Voglio esattamente quella caduta di " +
  "luce sul MIO viso — la stessa parte chiara in alto, la stessa ombra sotto " +
  "la mascella. Del suo viso non prendere niente: ne' i tratti, ne' la pelle, " +
  "ne' i capelli, ne' l'espressione, ne' i vestiti, ne' il suo sfondo. Il " +
  "viso resta il mio, identico alle altre foto allegate; cambia solo da dove " +
  "arriva la luce.";

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id=? AND version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} non ha prompt salvato`);

  const testo = base.prompt_used + RUOLO_CAMPIONE;

  const D = dirsFor(PID).DATA_DIR;
  const refs = [
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    // il campione di direzione, per ULTIMO: il prompt lo chiama cosi'
    join(D, "refs", "luce-bg-studio-blu.png"),
  ];
  for (const p of refs) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    const lineage = JSON.stringify({
      recipe: "luce-campione",
      base: `v${BASE}`,
      passo: "reference come 5° allegato col ruolo di campione di direzione della luce",
      refs: refs.map((r) => r.split("/").pop()),
      misura: "alto-basso -> >0 (ref +19,8 · v133 -8,2) · sx-dx |x|<4 · bocca non peggiora · ciano non crolla",
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
    console.log(`[campione] job ${job.id}  giro ${g}`);
  }
});
