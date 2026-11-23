/**
 * Foto profilo: si torna su v611 (la foto scelta da Attilio) e si corregge SOLO il viso,
 * con le sue foto vere evidenziate come riferimento. Niente character sheet in mezzo:
 * deciso da Attilio il 24/11 («tanto le reference le abbiamo prese»).
 * Ogni job allega 3 foto vere, a rotazione, scelte fra le evidenziate che non sono
 * selfie da vicino e non hanno occhiali (le altre schiacciavano il viso o appesantivano gli occhi).
 *
 *   bun run scripts/ritocca_foto_profilo.ts [--da 611] [--giri 8] [--stampa]
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { initSchema, db } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const FOTO = "1";
const GRUPPI = [
  ["io-felpa-mano-1.png", "io-tre-quarti-2026-11-15.jpg", "io-libreria-48.jpg"],
  ["io-felpa-mano-1.png", "io-muro-dorato-7bc8b538.png", "io-libreria-23.jpg"],
  ["io-tre-quarti-2026-11-15.jpg", "io-libreria-37.jpg", "io-muro-dorato-d24c1465.png"],
  ["io-libreria-48.jpg", "io-felpa-mano-1.png", "io-libreria-5.jpg"],
];

const PROMPT = [
  "Image 1 is my profile photo: keep it. Images 2, 3 and 4 are REAL, unretouched photos of me, the same man.",
  "Edit image 1 changing ONLY the face of the man, so he is unmistakably the man of images 2-4.",
  "Copy from images 2-4 the facial proportions: face width relative to height, full cheeks, jaw and chin shape, nose length, bridge and tip, mouth width and lips, ears, eyebrows. Do NOT slim the face, do NOT sharpen the jaw or cheekbones, do NOT beautify or de-age: about 30 years old.",
  "Some of images 2-4 are phone photos at arm's length: ignore the wide-angle distortion (bigger nose and forehead), keep the real proportions as seen from two metres.",
  "SKIN: fair natural skin tone as in images 2-4, real pores, freshly and closely shaved, NO stubble grain, no beard dots; the dark mole on the cheek where it is in images 2-4, no extra moles.",
  "Keep EVERYTHING else of image 1 identical: framing, pose, head angle, lens and perspective, the sunglasses exactly as they are, my curls, the small gold hoop earring on the same ear, black t-shirt, background, light and colours. Same size and square format.",
  "From images 2-4 take ONLY the face. Ignore their background, light, clothes, glasses, hands, beard.",
  "The result must look like an untouched photograph, no smoothing, no CGI look.",
].join("\n");

function arg(n: string, d?: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }

withProject(PROGETTO, () => {
  initSchema();
  const da = Number(arg("da", "611"));
  const giri = Number(arg("giri", "8"));
  const src = db().query<{ image_path: string }, [string, number]>(
    "SELECT image_path FROM versions WHERE photo_id = ? AND version_number = ?").get(FOTO, da)?.image_path;
  if (!src || !existsSync(src)) throw new Error(`v${da} mancante`);
  const evid = new Set(db().query<{ file: string }, []>("SELECT file FROM reference_pick").all().map((r) => r.file));
  const refsDir = join(dirsFor(PROGETTO).DATA_DIR, "refs");
  if (process.argv.includes("--stampa")) { console.log(`da v${da}: ${src}\n${PROMPT}`); return; }
  for (let g = 0; g < giri; g++) {
    const gruppo = GRUPPI[g % GRUPPI.length];
    for (const f of gruppo) {
      if (!evid.has(f)) throw new Error(`${f} non è fra le evidenziate`);
      if (!existsSync(join(refsDir, f))) throw new Error(`${f} mancante`);
    }
    const job = enqueueJob(
      FOTO, PROMPT, null, "chatgpt", null, "edit", src, JSON.stringify(gruppo.map((f) => join(refsDir, f))),
      JSON.stringify({ recipe: "profilo-viso-da-v611", sources: [`1/v${da}.png`], refs: gruppo, giro: g + 1, cambiato: "solo il viso, verso le foto vere" }),
      "openbrowser", JSON.stringify(gruppo),
    );
    console.log(`job ${job.id}  refs ${gruppo.join(", ")}`);
  }
});
