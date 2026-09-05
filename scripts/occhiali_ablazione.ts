/**
 * Ablazione sugli OCCHIALI, scena costante (la v63: parcheggio notturno).
 *
 * Perche' esiste: dalla v54 in poi — cioe' su tutte e quattro le versioni
 * esportate — gli occhiali sono stati descritti SOLO a parole ("due rettangoli
 * neri affiancati, larghi il doppio dell'altezza…") e le foto dei Gascan in
 * data/refs non sono mai state allegate. L'ablazione precedente (v67-v70) ha
 * gia' mostrato che per la FORMA le parole non pagano: era la distanza della
 * camera a risolvere il collo, non le frasi sul collo.
 *
 * Tre celle, una leva sola: COME si specificano gli occhiali.
 *   A  controllo  — prompt v63 identico, nessun allegato.       (parole)
 *   B  ref+parole  — stesso prompt + la foto degli occhiali.     (parole+ref)
 *   C  solo ref    — le parole sulla forma tolte, resta la foto. (ref)
 *
 * La cella A serve anche se v63 esiste gia': senza un controllo tirato oggi,
 * una differenza fra B/C e v63 potrebbe essere solo varianza fra due tiri.
 *
 * Uso: bun run scripts/occhiali_ablazione.ts [--giri N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** La versione da cui si copia la scena. Costante per tutte le celle. */
const BASE = 63;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const giri = Math.max(1, Number(arg("--giri") ?? 1));

/** Il blocco che descrive la forma degli occhiali a parole: e' la leva. */
const PAROLE =
  /OCCHIALI DA SOLE \(lenti nere opache\):[^.]*\.\s*/;
/** Cosa lo sostituisce quando la forma arriva dall'immagine invece che dal testo. */
const RINVIO =
  "OCCHIALI DA SOLE: indosso ESATTAMENTE gli occhiali dell'immagine allegata su fondo grigio. Copiane forma, proporzioni, spessore della montatura e curvatura: sono i miei, non un modello simile. ";
/** Detto anche quando le parole restano: senza, l'allegato puo' essere letto
 *  come un'altra foto di me e la faccia viene mediata. */
const RUOLO =
  "\n\nUna delle immagini allegate NON sono io: e' la foto dei miei occhiali da sole su fondo neutro. Serve solo a copiare gli occhiali con esattezza. Non prendere da quella nessun volto, nessuna luce, nessuno sfondo.";

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata: senza la scena di partenza non e' un'ablazione`);
  if (!PAROLE.test(base.prompt_used))
    throw new Error("il blocco OCCHIALI non e' nel prompt di v63: la leva non e' dove credo, mi fermo");

  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const REF = join(refDir, "occhiali-gascan-ritagliato.jpg");
  if (!existsSync(REF)) throw new Error(`reference mancante: ${REF}`);

  const celle = [
    { key: "occhiali-A-controllo", prompt: base.prompt_used, refs: [] as string[] },
    { key: "occhiali-B-ref-piu-parole", prompt: base.prompt_used + RUOLO, refs: [REF] },
    { key: "occhiali-C-solo-ref", prompt: base.prompt_used.replace(PAROLE, RINVIO) + RUOLO, refs: [REF] },
  ];

  const sorgenti = db()
    .query<{ original_path: string }, []>("SELECT original_path FROM photos ORDER BY id")
    .all()
    .map((r) => r.original_path);

  for (let g = 1; g <= giri; g++) {
    for (const c of celle) {
      const lineage = JSON.stringify({
        recipe: c.key,
        refset: c.refs.length ? "3 sorgenti + occhiali (reference)" : "3 sorgenti, occhiali a parole",
        preamble: `ablazione occhiali su scena v${BASE}: la forma dal testo, dall'immagine, o da entrambi`,
        sources: sorgenti.map((s) => s.split("/").pop()),
        refs: c.refs.map((r) => r.split("/").pop()),
        backend: "cdp",
      });
      const job = enqueueJob(
        PHOTO,
        c.prompt,
        null,
        "chatgpt",
        null,
        "edit",
        null,
        c.refs.length ? JSON.stringify(c.refs) : null,
        lineage,
        "cdp",
      );
      console.log(`[occhiali] job ${job.id}  ${c.key}  giro ${g}  refs=${c.refs.length}`);
    }
  }
});
