/**
 * Il prompt ordinava la testa SCURA, ed e' per questo che il viso e' buio.
 *
 * LA RIGA, parola per parola, nel prompt di v141/v142:
 *
 *     "La testa stacca scura contro la parte accesa del fondo."
 *
 * E due righe sopra, nello stesso blocco, c'e' gia' la relazione giusta:
 *
 *     "ALL'ALTEZZA DELLA MIA TESTA il fondale e' NETTAMENTE PIU' SCURO del
 *      mio viso"
 *
 * Sono in contraddizione: o il viso e' piu' chiaro del fondo, o la testa
 * stacca scura contro il fondo acceso. Non possono valere insieme, e il
 * modello ha seguito la seconda — il viso di v141 sta a L 18,7 e quello di
 * v142 a 16,7, contro i 40,3 della reference: i due render piu' scuri di tutto
 * il progetto.
 *
 * DA DOVE VIENE QUELLA RIGA, perche' non era un capriccio. L'ho scritta l'8/09
 * per risolvere lo stacco soggetto/fondo, quando il difetto era l'opposto: il
 * fondale acceso era luminoso quanto il viso e il ritratto sembrava un
 * collage. Allora "la testa stacca scura" descriveva davvero il rimedio. Poi
 * il fondo e' stato sistemato dalla riga sopra, che dice la stessa cosa in
 * modo relativo e corretto, e questa e' rimasta li' a ordinare buio senza che
 * nessuno la rileggesse. E' il quarto difetto di fila che l'utente vede a
 * occhio e che sta scritto nel prompt come istruzione esplicita.
 *
 * COSA CAMBIA, una riga sola: la contraddizione sparisce e resta la relazione,
 * detta dalla parte del viso invece che da quella del fondo.
 *
 * PERCHE' PUO' SISTEMARE ANCHE IL CIANO, che e' l'altro cancello mancato
 * (7,3% contro un bersaglio di 12%). La croma si misura sui pixel del viso, e
 * in un viso a L 16,7 i pixel sono quasi neri: il colore li' e' compresso per
 * costruzione, non perche' la luce colorata non ci sia. Esporre il viso non e'
 * una seconda variabile, e' la condizione perche' la prima si possa misurare.
 * Se dopo questo giro il ciano resta sotto 12 con L sopra 30, allora e' un
 * problema vero e si affronta separatamente.
 *
 * CANCELLI, gli stessi tre di prima, insieme:
 *     L viso  >= 30   (v142: 16,7)
 *     %ciano  >= 12   (v142: 7,3)
 *     alto-basso > 0  (v142: +6,9 — non si perde cio' che e' appena arrivato)
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
/** v142: luce alta + reference come campione di colore. */
const BASE = 142;
const MATERIA = "io-luce-alta.jpeg";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

const VECCHIA = "La testa stacca scura contro la parte accesa del fondo.";
const NUOVA =
  "Il MIO VISO e' la cosa piu' CHIARA di tutta l'inquadratura: e' ben esposto, " +
  "luminoso, per niente in ombra. Stacca dal fondo perche' e' ILLUMINATO, " +
  "mentre il fondale alla sua altezza resta scuro — non perche' la testa sia scura.";

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
  if (!base.prompt_used.includes(VECCHIA)) throw new Error(`v${BASE} non contiene la riga da togliere`);

  const prompt = base.prompt_used.replace(VECCHIA, NUOVA);
  if (prompt.includes("stacca scura")) throw new Error("la riga e' ancora li'");

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
        recipe: "testa-chiara",
        base: `v${BASE}`,
        materia: MATERIA,
        cambiato: "tolta 'la testa stacca scura', che contraddiceva 'il fondale e' piu' scuro del viso'",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "L viso >= 30 · %ciano >= 12 · alto-basso > 0",
        giro: g,
      }),
      "cdp",
    );
    console.log(`[chiara] job ${job.id}  giro ${g}`);
  }
});
