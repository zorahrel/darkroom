/**
 * Lo SFONDO da immagine di riferimento, non da descrizione.
 *
 * Perche': i fondi urbani (parcheggio, sottopasso, garage) erano scritti a
 * parole, e la citta' non e' quello che si vuole. La stessa lezione degli
 * occhiali — e prima ancora quella della focale sul collo — dice che una forma
 * o un luogo si ottengono ALLEGANDO l'immagine, non descrivendola: il testo
 * sposta l'atmosfera, non la cosa.
 *
 * Una cella per ogni fondo in data/refs. Tutto il resto e' costante: stessa
 * identita', stessa inquadratura 35mm, e gli occhiali sempre presi dalla loro
 * foto (la ricetta "solo ref" della cella C). L'unica variabile e' QUALE fondo
 * viene allegato — cosi' la scelta si fa guardando, non immaginando.
 *
 * Uso: bun run scripts/background_from_reference.ts [--fondi a.jpg,b.jpg] [--giri N]
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** La versione da cui si copia tutto il resto: identita', posa, inquadratura. */
const BASE = 63;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** Il blocco che descrive il LUOGO a parole: e' cio' che si sostituisce. */
const LUOGO = /LUOGO:.*?(?=OCCHIALI DA SOLE)/s;
/** Il blocco che descrive la forma degli occhiali a parole. */
const OCCHIALI = /OCCHIALI DA SOLE \(lenti nere opache\):[^.]*\.\s*/;

const SFONDO_DA_REF =
  "SFONDO: esattamente quello dell'immagine di riferimento allegata (quella senza persone). " +
  "Copiane il colore, il gradiente, la texture e la direzione della luce, e mettimi davanti a quello. " +
  "Non e' un posto in cui sono: e' il fondo dietro di me. Niente strade, niente citta', niente esterni notturni. ";

const OCCHIALI_DA_REF =
  "OCCHIALI DA SOLE: indosso ESATTAMENTE gli occhiali dell'immagine allegata su fondo grigio. " +
  "Copiane forma, proporzioni, spessore della montatura e curvatura: sono i miei, non un modello simile. ";

const RUOLI =
  "\n\nDue delle immagini allegate NON sono io e non sono luoghi in cui mi trovo: " +
  "una e' la foto dei miei occhiali da sole su fondo neutro, l'altra e' il fondo che voglio dietro di me. " +
  "Da quelle due non prendere nessun volto e nessuna posa: dalla prima solo gli occhiali, dalla seconda solo lo sfondo.";

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata: senza la scena di partenza non c'e' niente da variare`);
  for (const [nome, re] of [["LUOGO", LUOGO], ["OCCHIALI", OCCHIALI]] as const) {
    if (!re.test(base.prompt_used))
      throw new Error(`il blocco ${nome} non e' nel prompt di v${BASE}: la leva non e' dove credo, mi fermo`);
  }

  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const OCCHIALI_REF = join(refDir, "occhiali-gascan-ritagliato.jpg");
  if (!existsSync(OCCHIALI_REF)) throw new Error(`reference occhiali mancante: ${OCCHIALI_REF}`);

  // I fondi: quelli chiesti, o tutti i file che si chiamano `fondo-*`.
  const chiesti = arg("--fondi")?.split(",").map((s) => s.trim()).filter(Boolean);
  const disponibili = readdirSync(refDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const fondi = chiesti ?? disponibili.filter((f) => f.startsWith("fondo-"));
  const mancanti = fondi.filter((f) => !disponibili.includes(f));
  if (mancanti.length) throw new Error(`fondi inesistenti: ${mancanti.join(", ")}`);
  if (!fondi.length) throw new Error("nessun fondo da provare");

  const prompt =
    base.prompt_used.replace(LUOGO, SFONDO_DA_REF).replace(OCCHIALI, OCCHIALI_DA_REF) + RUOLI;

  const sorgenti = db()
    .query<{ original_path: string }, []>("SELECT original_path FROM photos ORDER BY id")
    .all()
    .map((r) => r.original_path.split("/").pop());

  for (let g = 1; g <= rounds; g++) {
    for (const fondo of fondi) {
      const refs = [OCCHIALI_REF, join(refDir, fondo)];
      const lineage = JSON.stringify({
        recipe: `fondo-ref-${fondo.replace(/\.[a-z]+$/i, "")}`,
        refset: "3 sorgenti + occhiali (ref) + fondo (ref)",
        preamble: "sfondo e occhiali presi dalle immagini invece che descritti: la citta' non piace e le parole non producono un luogo",
        sources: sorgenti,
        refs: refs.map((r) => r.split("/").pop()),
        backend: "cdp",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", null, JSON.stringify(refs), lineage, "cdp");
      console.log(`[fondo] job ${job.id}  ${fondo}  giro ${g}`);
    }
  }
});
