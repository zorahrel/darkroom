/**
 * Character sheet del viso di Attilio, generato dall'AI.
 *
 * Riferimenti: SOLO le foto vere che Attilio ha evidenziato in Darkroom
 * (tabella reference_pick del progetto profilo). Nessuna versione generata:
 * le guide generate trasmettevano la pelle a reticolo (v647-v654).
 *
 * Il risultato e' una foto a se' del progetto (id "character-sheet"), cosi' si
 * guarda e si sceglie in Darkroom come ogni altra; la tavola scelta diventa poi
 * il riferimento d'identita' delle generazioni.
 *
 *   bun run scripts/character_sheet.ts [--giri N] [--stampa]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const FOTO = "character-sheet";

const PROMPT = `Photographic CHARACTER REFERENCE SHEET of one real man: the man in the five attached photos. All five photos show the same person; use them ONLY for his identity. It must look like real photographs taken in one studio session, not an illustration, not a 3D render.

LAYOUT: landscape 3:2, plain light-grey seamless studio background, no text, no labels, no numbers, no arrows, no borders drawn. TOP ROW, five head-and-shoulders shots at the same scale with the eyes on the same line: full front, three-quarter turned to his left, profile to his left, three-quarter turned to his right, profile to his right. BOTTOM ROW, four close-ups: (a) the eyes and eyebrows, (b) nose and mouth, (c) his left cheek and left ear with the gold hoop, showing moles 1, 2 and 3, (d) his right cheek with mole 4.

FACE SHAPE, the part every earlier attempt got wrong: his face is BROAD and FULL, wider than a model's, with round fleshy cheeks, a soft wide jaw and some fullness under the chin; a wide nose with a rounded fleshy tip; thick dark eyebrows set low and close to the eyes; heavy, slightly hooded eyelids. He is a normal man, not a model: do NOT slim the face, do NOT sharpen the jawline or the cheekbones, do NOT make him younger. Photos 4 and 5 are the closest views of his real face shape: follow them for width and fullness.

IDENTITY: copy from the photos the exact shape of his face, cheeks, jaw and chin, his nose, eyebrows, eyes, ears and curly hair, and the proportions: eye spacing, nose length and width, mouth width, distance from nose to mouth, chin height. Likeness comes before beauty: do not make him younger, thinner or more symmetrical than in the photos. Hair: voluminous dark curls on top, SHORT sides and nape, no mullet. Neutral relaxed expression, mouth closed.

MOLES, his four real ones and nothing else on the face. Moles 1, 2 and 3 and the earring are on his LEFT cheek and LEFT ear. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm, halfway between the nose and the ear at nostril height; it is his signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on his RIGHT cheek, a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All small and matte. No freckles on the nose, no moles on the lip or chin. CHIN smooth and rounded, no cleft, no dimple.

EARRING: small hoop in shiny YELLOW GOLD on his left ear, never silver.

SKIN: freshly shaved, no beard and no stubble dots along the jaw. Real unretouched photographic skin, as in a macro photo: visible pores (larger on the nose and cheeks), fine vellus hair, slightly redder tone around the nostrils and cheeks, a little shine only on the nose and forehead. NO crinkled-paper or mesh texture, no plastic or waxy skin, no beauty filter, no airbrushing.

CLOTHES: plain black crew-neck t-shirt. NO glasses of any kind: ignore the prescription glasses in the photos. Ignore the full beard of photo 5 and the necklace of photo 4: the face is clean-shaven, no jewellery except the earring. Ignore the phone, the hands, the rooms and the light of the photos.

LIGHT: even, soft, neutral daylight-white studio light from the front, the same on every shot, true skin colour, no coloured gels, no blown highlights, no hard shadows.`;

const REFS = [
  "io-felpa-mano-1.png",
  "io-occhiali-vista-632DC4E9.jpeg",
  "io-rasato-2023-06-23-p13.jpg",
  "io-selfie-rasato-orecchino.jpg",
  "io-selfie-barba-vicino.jpg",
];

const iG = process.argv.indexOf("--giri");
const giri = iG > 0 ? Math.max(1, Number(process.argv[iG + 1]) || 1) : 4;

await withProject(PROGETTO, async () => {
  initSchema();
  const refDir = join(dirsFor(PROGETTO).DATA_DIR, "refs");
  const refs = REFS.map((f) => join(refDir, f));
  for (const r of refs) if (!existsSync(r)) throw new Error(`riferimento mancante: ${r}`);

  // Le foto evidenziate sono la fonte: se la scelta in Darkroom cambia, lo script
  // non deve continuare a usare la vecchia in silenzio.
  const evidenziate = db().query<{ file: string }, []>("SELECT file FROM reference_pick ORDER BY file").all().map((r) => r.file);
  if (JSON.stringify(evidenziate) !== JSON.stringify([...REFS].sort())) {
    throw new Error(`le foto evidenziate sono cambiate: ${evidenziate.join(", ")}`);
  }

  if (process.argv.includes("--stampa")) {
    console.log(`refs: ${REFS.join(", ")}\n${PROMPT.length} car.\n${PROMPT}`);
    return;
  }

  const now = Date.now();
  db().prepare(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
  ).run(FOTO, now, now);

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      FOTO, PROMPT, null, "chatgpt", null, "generate", null, JSON.stringify(refs),
      JSON.stringify({ recipe: "character-sheet", refs: REFS, giro: g, cambiato: `giro ${g} di ${giri}` }),
      "openbrowser",
      JSON.stringify(REFS),
    );
    console.log(`[character-sheet] job ${job.id}  giro ${g}/${giri}`);
  }
});
