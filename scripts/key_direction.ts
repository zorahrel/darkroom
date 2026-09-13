/**
 * DA DOVE viene la luce. E' la differenza che si vede a occhio, e l'avevo persa.
 *
 * COME CI SONO ARRIVATO, che conta quanto il risultato. Per tre giri ho
 * inseguito numeri sul COLORE della luce (croma 27->13, a* +18->+5) e sulla
 * corporatura, misurando ogni volta una variabile sola. Messe le due immagini
 * fianco a fianco e guardate — non misurate — la risposta e' stata che sono
 * "chiaramente diverse", e per motivi di cui nessuno dei miei numeri parlava:
 * posa, e soprattutto DIREZIONE della luce. Limare la temperatura mentre la
 * chiave arriva dalla parte sbagliata e' rifinire la cosa sbagliata.
 *
 * LA MISURA CHE MANCAVA. Sul riquadro del viso, differenza di luminanza media
 * fra meta' alta e meta' bassa, e fra meta' sinistra e destra:
 *
 *                       alto-basso   sx-dx
 *   la tua reference       +19,8      -4,1     chiave ALTA, da destra
 *   v113 consegnata         -8,5      +2,9     chiave dal BASSO, da sinistra
 *
 * Ventotto punti di differenza sull'asse verticale, e il segno e' opposto: la
 * fronte della reference e' molto piu' chiara del mento (softbox in alto), da
 * noi succede il contrario. Per confronto, la differenza di temperatura che ho
 * inseguito per un giro intero valeva 25 punti di a*, e si vedeva meno.
 *
 * LE CELLE
 *   alta       la chiave viene dall'ALTO: fronte e zigomi i punti piu' chiari,
 *              ombra sotto il naso e sotto la mascella
 *   alta-lato  come sopra, piu' lo spostamento a destra (l'altro segno che
 *              distingue la reference)
 *
 * Verifica: `scripts/key_direction.py`, che stampa le due differenze e
 * confronta con i valori della reference.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { enqueueJob } from "../server/jobs.ts";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const PID = "profilo";
const PHOTO = "1";
const BASE = 113;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** Ancora: il blocco che descrive la luce senza mai dire DA DOVE arriva. */
const ANCORA = "LA LUCE E IL FONDO: ritratto in STUDIO, e la luce e il fondo sono ESATTAMENTE quelli dell'ultima immagine allegata.";

const DALL_ALTO =
  "DA DOVE VIENE LA LUCE, ed e' la cosa piu' importante di tutto il ritratto: " +
  "un softbox grande sta IN ALTO, sopra la mia testa e davanti a me, " +
  "inclinato verso il basso. Quindi la mia FRONTE e i miei ZIGOMI sono i punti " +
  "PIU' CHIARI del viso, mentre sotto il naso, sotto il labbro e sotto la " +
  "mascella c'e' OMBRA, e il collo e' nettamente piu' scuro del viso. NON " +
  "illuminarmi dal basso e NON darmi una luce frontale piatta: la meta' alta " +
  "della mia faccia deve essere visibilmente piu' chiara della meta' bassa. " +
  "LA LUCE E IL FONDO: ritratto in STUDIO, e il fondo e' esattamente quello " +
  "dell'ultima immagine allegata.";

const DA_DESTRA =
  " Il softbox e' anche spostato di lato, alla MIA sinistra (la destra di chi " +
  "guarda la foto): quel lato del viso e' piu' illuminato, l'altro resta in " +
  "una mezza ombra morbida, e c'e' una piccola ombra del naso che cade " +
  "dall'altra parte. Non e' una luce simmetrica.";

type Cella = { nome: string; passo: string; applica: (p: string) => string };
const TUTTE: Cella[] = [
  { nome: "alta", passo: "chiave dall'alto: fronte chiara, mento in ombra", applica: (p) => p.replace(ANCORA, DALL_ALTO) },
  {
    nome: "alta-lato",
    passo: "chiave dall'alto e di lato, come la reference",
    applica: (p) => p.replace(ANCORA, DALL_ALTO + DA_DESTRA),
  },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;
if (!CELLE.length) throw new Error(`nessuna cella: ${chieste?.join(",")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);
  if (!base.prompt_used.includes(ANCORA)) throw new Error(`ancora assente in v${BASE}`);

  const D = dirsFor(PID).DATA_DIR;
  const PRIMA = join(D, "RAW", "1.PNG");
  const refs = [
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "fondo-cielo-luce-studio.png"),
  ];
  for (const p of [PRIMA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: nessuna sostituzione`);
      const lineage = JSON.stringify({
        recipe: `key-dir-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        misura: "key_direction.py — bersaglio: alto-basso +19,8 · sx-dx -4,1",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp");
      console.log(`[direzione] job ${job.id}  ${cella.nome.padEnd(10)} ${cella.passo}  giro ${g}`);
    }
  }
});
