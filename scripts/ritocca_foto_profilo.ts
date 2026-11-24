/**
 * Foto profilo: si torna su v611 (la foto scelta da Attilio) e si corregge SOLO il viso,
 * con le sue foto vere evidenziate come riferimento. Niente character sheet in mezzo:
 * deciso da Attilio il 24/11 («tanto le reference le abbiamo prese»).
 * Ogni job allega 3 foto vere, a rotazione, scelte fra le evidenziate che non sono
 * selfie da vicino e non hanno occhiali (le altre schiacciavano il viso o appesantivano gli occhi).
 *
 *   bun run scripts/ritocca_foto_profilo.ts [--da 611] [--giri 8] [--stampa]
 *   bun run scripts/ritocca_foto_profilo.ts --luce --da 694   (cambia SOLO la luce, una variante per schema)
 *
 * --luce: Attilio il 25/11 («già così son fighi, solo la luce più figa, in ombra con contrasto»):
 * nessuna foto allegata, perché qui il viso non si tocca e un riferimento lo farebbe derivare.
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

// Schemi di luce low-key, uno per job: cambia solo da dove arriva la luce e quanta ombra lascia.
const LUCI = [
  "split light: one hard light from the camera-left side at 90 degrees lights exactly half of the face, the other half falls into deep shadow",
  "low-key Rembrandt light: one small hard source high at 45 degrees, a small triangle of light on the shadow cheek, everything else falls off into near-black",
  "hard overhead spotlight from straight above: bright top of the curls, nose and cheekbones, deep shadows under the sunglasses, nose and chin, background almost black",
  "backlit: strong cyan rim light from behind outlining the curls, ears and jawline, the front of the face in soft shadow with only a faint fill, very high contrast",
  "single hard light from below-left at a low angle like a phone torch in a dark room, dramatic shadows going upward, background swallowed by black",
  "night street flash: direct hard on-camera flash, crisp specular highlights on skin and lenses, short hard shadow behind the head, background dark and contrasty",
];
const PROMPT_LUCE = (luce: string) => [
  "Image 1 is my profile photo: keep it. Change ONLY the lighting, to a moody, low-key, high-contrast look like modern streetwear and rap editorials.",
  `New light: ${luce}.`,
  "Deep rich shadows and true blacks, strong contrast, but the face stays readable and correctly exposed where the light hits. Shadows keep a hint of detail, no crushed mud, no grey haze.",
  "Keep EVERYTHING else identical: the face and its proportions (do NOT reshape, slim, beautify or de-age it), skin tone and texture, the mole, the sunglasses, the curls, the small gold hoop earring on the same ear, the black t-shirt, pose, head angle, framing, lens and perspective. The background is the same place, only lit darker. Same size and square format.",
  "The result must look like an untouched photograph shot that way, not a filter: no vignette added, no glow, no smoothing, no CGI look, no text.",
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
  if (process.argv.includes("--luce")) {
    for (const [i, luce] of LUCI.entries()) {
      const job = enqueueJob(
        FOTO, PROMPT_LUCE(luce), null, "chatgpt", null, "edit", src, null,
        JSON.stringify({ recipe: "profilo-luce-low-key", sources: [`1/v${da}.png`], schema: i + 1, cambiato: `solo la luce: ${luce.split(":")[0]}` }),
        "openbrowser", null,
      );
      console.log(`job ${job.id}  luce ${i + 1}: ${luce.split(":")[0]}`);
    }
    return;
  }
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
