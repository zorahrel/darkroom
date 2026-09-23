/**
 * La stessa ricetta di v145, con la foto sorgente a risoluzione piena.
 *
 * PERCHE'. L'utente su v146: «vedo tutta la faccia rotta, tipo artefatto di
 * chatgpt». Misurato sul viso, confrontato con la sua foto vera:
 *
 *                       dettaglio   rumore colore   reticolo
 *   foto vera                8,41            0,85        206
 *   v128                     4,96            1,26        393
 *   v141                     2,60            0,73        769   <- peggiore
 *   v146 (v141 + 3 Codex)    4,23            1,55        551
 *
 * Il difetto nasce in v141, prima di Codex, e ha una causa sola: la sorgente
 * `io-luce-alta.jpeg` era la miniatura di iCloud (880x892, 126 kB), con il viso
 * di 191x264 pixel. Il modello ha dovuto inventarsi ~5 volte il dettaglio.
 * L'originale esportato da Foto il 23/09 e' 4182x4238 (18 MB): stessa foto
 * (differenza 0,75/255), stessa luce dall'alto (+15,2).
 *
 * UNA VARIABILE SOLA: cambia la materia, prompt e allegati sono quelli di
 * v145. Se la faccia torna pulita, era la risoluzione.
 *
 * MOTORE: `openbrowser` — ChatGPT web dentro OpenBrowser, con gli allegati.
 * Codex li ignora, ed e' per questo che v146 era uscita da passate in catena.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const BASE = 145;
const MATERIA = "io-luce-alta-originale.png";

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
        recipe: "materia-originale",
        base: `v${BASE}`,
        materia: MATERIA,
        cambiato: "sorgente a risoluzione piena (4182px) invece della miniatura iCloud (880px)",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "reticolo < 400 · alto-basso > 0 · L viso >= 30",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[originale] job ${job.id}  giro ${g}`);
  }
});
