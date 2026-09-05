/**
 * Ablation on the SUNGLASSES, constant scene (v63: night car park).
 *
 * Why it exists: from v54 on — i.e. on all four exported versions — the
 * sunglasses were described ONLY in words ("two black rectangles side by side,
 * twice as wide as tall…") and the photos of the Gascans in data/refs were
 * never attached. The previous ablation (v67-v70) has already shown that for
 * SHAPE words do not pay: it was the camera distance that solved the neck, not
 * the sentences about the neck.
 *
 * Three cells, one lever: HOW the sunglasses are specified.
 *   A  control    — identical v63 prompt, no attachment.        (words)
 *   B  ref+words  — same prompt + the photo of the sunglasses.  (words+ref)
 *   C  ref only   — the words about shape removed, photo stays. (ref)
 *
 * Cell A is needed even though v63 already exists: without a control shot
 * today, a difference between B/C and v63 could be mere variance between two
 * takes.
 *
 * Usage: bun run scripts/sunglasses_ablation.ts [--rounds N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** The version the scene is copied from. Constant for every cell. */
const BASE = 63;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** The block that describes the shape of the sunglasses in words: it is the lever. */
const WORDS =
  /OCCHIALI DA SOLE \(lenti nere opache\):[^.]*\.\s*/;
/** What replaces it when the shape comes from the image instead of the text. */
const RINVIO =
  "OCCHIALI DA SOLE: indosso ESATTAMENTE gli occhiali dell'immagine allegata su fondo grigio. Copiane forma, proporzioni, spessore della montatura e curvatura: sono i miei, non un modello simile. ";
/** Said even when the words stay: without it, the attachment can be read as
 *  another photo of me and the face gets averaged. */
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
  if (!WORDS.test(base.prompt_used))
    throw new Error("il blocco OCCHIALI non e' nel prompt di v63: la leva non e' dove credo, mi fermo");

  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const REF = join(refDir, "occhiali-gascan-ritagliato.jpg");
  if (!existsSync(REF)) throw new Error(`reference mancante: ${REF}`);

  const cells = [
    { key: "occhiali-A-controllo", prompt: base.prompt_used, refs: [] as string[] },
    { key: "occhiali-B-ref-piu-parole", prompt: base.prompt_used + RUOLO, refs: [REF] },
    { key: "occhiali-C-solo-ref", prompt: base.prompt_used.replace(WORDS, RINVIO) + RUOLO, refs: [REF] },
  ];

  const sources = db()
    .query<{ original_path: string }, []>("SELECT original_path FROM photos ORDER BY id")
    .all()
    .map((r) => r.original_path);

  for (let g = 1; g <= rounds; g++) {
    for (const c of cells) {
      const lineage = JSON.stringify({
        recipe: c.key,
        refset: c.refs.length ? "3 sorgenti + occhiali (reference)" : "3 sorgenti, occhiali a parole",
        preamble: `ablazione occhiali su scena v${BASE}: la forma dal testo, dall'immagine, o da entrambi`,
        sources: sources.map((s) => s.split("/").pop()),
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
