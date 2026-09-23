/**
 * Faccia piu' grande nel fotogramma, perche' la grana abbia pixel in cui stare.
 *
 * L'UTENTE, 23/09, su v150: «e' rotta, non te ne accorgi da solo?». Misura
 * (face_artifacts, grana = std high-pass mascella / guance): foto vera 1,39 ·
 * v146 0,31 · v150 0,34 · v151/v152 (prompt «grana delle guance») 0,33.
 * Il prompt non muove la grana. La faccia occupa 362 px su 1254: ChatGPT la
 * rigenera in quello spazio e non ci sta la pelle vera. Nella foto vera sono
 * 1529 px.
 *
 * UNA VARIABILE: materia = v150 ritagliata stretta (faccia ~507 px su 1254),
 * stesso prompt del secondo giro. Barra: grana >= 1,0 · reticolo < 596 (v146).
 */
import { join } from "node:path";
import { initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROMPT =
  "Rifai questa foto come uno scatto reale ad alta definizione, cambiando solo la resa " +
  "della pelle: la pelle di tutto il viso, mascella e mento compresi, ha la grana di una " +
  "fotografia vera ravvicinata, pori visibili, micro-texture, la lievissima ombra dei peli " +
  "rasati stamattina sotto la pelle di mascella e labbro. Niente pelle dipinta, sfocata o " +
  "levigata, niente artefatti. TUTTO IL RESTO RESTA IDENTICO: stessa persona, stessi " +
  "lineamenti, stessa forma della mascella, stessi occhiali, stessi capelli, stessa " +
  "espressione, stessa inquadratura stretta, stessa luce che arriva da davanti e dall'alto, " +
  "stessi colori, stesso fondo. Non ringiovanirmi, non idealizzarmi.";

await withProject("profilo", async () => {
  initSchema();
  const materia = join(dirsFor("profilo").DATA_DIR, "RAW", "v150-stretta.png");
  const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;
  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob("1", PROMPT, null, "chatgpt", null, "edit", materia, null,
      JSON.stringify({ recipe: "inquadratura-stretta", base: "v150", cambiato: "faccia 362 -> ~507 px", misura: "grana >= 1,0 · reticolo < 596", giro: g }),
      "openbrowser");
    console.log(`[stretta] job ${job.id}  giro ${g}`);
  }
});
