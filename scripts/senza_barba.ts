/**
 * Via la barba da v146, e nient'altro.
 *
 * L'UTENTE, 23/09, su v146: «ci siamo molto meglio, ma avevamo fatto versioni
 * senza barba molto meglio».
 *
 * MISURA (face_artifacts.viso, mediana di L su guance e mascella, 256 px):
 *
 *                 guance   mascella   scarto
 *   foto vera       47,4       42,7      4,7
 *   v43             25,9       27,5     -1,6
 *   v45             23,5       37,9    -14,4
 *   v46             74,2       56,2     18,0   <- prima con «barba» nel prompt
 *   v146            71,8       12,3     59,5
 *
 * LA CAUSA E' SCRITTA: da v46 il prompt dice «barba corta» e «pori e barba
 * visibili», poi «barba irregolare». Fino a v45 la barba non era nominata, e
 * lo scarto e' vicino a quello della foto vera. Ogni passata successiva l'ha
 * resa piu' scura.
 *
 * UNA VARIABILE SOLA. Materia = v146, che ha luce, colore ed esposizione gia'
 * a bersaglio: la passata chiede solo la rasatura. Niente allegati, perche'
 * qualunque foto allegata porta la sua luce (lezione di v141).
 *
 * BARRA: scarto mascella/guance <= 15 · alto-basso > 0 · L viso >= 30.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const BASE = 146;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

/**
 * PRIMO GIRO (v149/v150): negativo sulla grana. Il prompt diceva «pelle liscia»
 * e «niente ombra blu della rasatura»: ChatGPT ha verniciato la mascella.
 * Grana (std dell'high-pass, 256 px) mascella/guance: foto vera 2,3 · v146 1,1 ·
 * v150 0,6. L'utente: «e' rotta, non te ne accorgi da solo?».
 * Secondo giro: rasata DI FRESCO, con la grana delle guance. Barra aggiunta:
 * mascella/guance >= 1,0.
 */
const PROMPT =
  "Modifica questa foto cambiando UNA sola cosa: la barba diventa rasata di fresco, " +
  "come dopo il rasoio stamattina. La pelle di mascella, mento e labbro superiore ha la " +
  "STESSA grana delle guance: pori visibili, micro-texture vera, la lievissima ombra dei " +
  "peli appena tagliati sotto la pelle, come in una foto reale ravvicinata. Non deve " +
  "sembrare dipinta, sfocata o levigata: e' pelle vera fotografata. TUTTO IL RESTO RESTA " +
  "IDENTICO: stessa persona, stessi lineamenti, stessa forma della mascella, stessi " +
  "occhiali, stessi capelli, stessa espressione, stessa inquadratura, stessa luce che " +
  "arriva da davanti e dall'alto, stessi colori, stesso fondo. Non ringiovanirmi, non " +
  "idealizzarmi.";

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "generations", PHOTO, `v${BASE}.png`);
  if (!existsSync(materia)) throw new Error(`manca: ${materia}`);

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      PROMPT,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      null,
      JSON.stringify({
        recipe: "senza-barba-grana",
        base: `v${BASE}`,
        cambiato: "passata di sola rasatura su v146; il prompt da v46 ordinava la barba",
        misura: "grana mascella/guance >= 1,0 · scarto <= 20 · luce fronte-guance > 0",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[senza-barba] job ${job.id}  giro ${g}`);
  }
});
