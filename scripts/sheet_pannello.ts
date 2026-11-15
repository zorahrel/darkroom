/**
 * Character sheet un pannello alla volta, per MODIFICA di una foto vera.
 *
 * Generare da zero con le foto come riferimento rende Attilio piu' magro e piu'
 * giovane: il modello ridisegna il viso. Qui l'immagine 1 e' una sua foto vera
 * evidenziata in Darkroom e il prompt chiede di cambiare solo inquadratura, sfondo,
 * luce e vestito, lasciando la geometria del viso com'e'. Ogni pannello e' una foto
 * del progetto (`sheet-<pannello>`), cosi' i tentativi stanno nel suo albero.
 *
 *   bun run scripts/sheet_pannello.ts --pannello frontale [--giri 3] [--stampa]
 *   bun run scripts/sheet_pannello.ts --ritocca <sheet.png> --foto <evidenziata> [--giri 3]
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { initSchema, db } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";

const VISO_INTATTO =
  "This is a REAL photo of me. Keep my face EXACTLY as it is in this photo: the same face width and fullness, " +
  "round cheeks, jaw and chin, the same nose shape and width, eyes, eyelids, eyebrows, lips, ears, skin texture, " +
  "moles and small gold hoop earring, same age. Do NOT slim the face, do NOT sharpen the jaw or cheekbones, " +
  "do NOT beautify, de-age or retouch, do NOT change the proportions. It must still be obviously me.";

const PANNELLI: Record<string, { da: string; base?: boolean; prompt: string }> = {
  // Face sheet completo: si modifica la griglia delle 5 foto evidenziate
  // (scripts/face_sheet_base.py), non si genera da zero.
  foglio: {
    da: "io-face-sheet-base.png",
    base: true,
    prompt: [
      "This is a grid of six panels. Five of them are REAL photos of me (the same man), the first one is empty.",
      "Turn this grid into ONE clean professional face reference sheet of me, photographic, same 3x2 grid, same panel positions, thin light grey gaps between panels, no text, no numbers, no labels.",
      "IDENTITY, the most important rule: in every panel keep my face EXACTLY as it is in the real photo in that panel: the same face width and fullness, round cheeks, jaw and chin, the same nose shape and width, eyes, heavy eyelids, low thick eyebrows, lips, ears, real skin texture with pores, the moles, same age (about 30). Do NOT slim the face, do NOT sharpen the jaw or cheekbones, do NOT beautify, de-age or retouch. Panel 1 must be the same man as the others.",
      "SAME FOR EVERY PANEL: no glasses; no hands, no phone, no necklace; clean-shaven with only a faint shadow, like the shaved photos (panels 3, 4, 5), never the full beard of panel 6; my own short dark-brown curls, the same volume in every panel; a small hoop earring on my left ear (it is on the same side in every panel, as in the photos); plain black crew-neck t-shirt; light grey seamless studio background; the same soft even studio light from the front in every panel; head and top of the shoulders, the same scale in every panel; neutral relaxed expression, mouth closed.",
      "VIEW OF EACH PANEL:",
      "1. Full side profile (90 degrees), facing the opposite way from panels 2 and 5. Use the face of the other panels.",
      "2. Three-quarter view (about 45 degrees), turned the same way as in this photo.",
      "3. Front view, head straight, eyes into the lens.",
      "4. Front close-up of the face from forehead to chin, filling the panel, to show skin, moles and earring.",
      "5. Full side profile (90 degrees), turned further the same way as in this photo.",
      "6. Three-quarter view (about 45 degrees), turned the opposite way from panel 2.",
      "Real photograph, real skin pores, no smoothing, no painterly, CGI or illustration look.",
    ].join("\n"),
  },
  frontale: {
    da: "io-felpa-mano-1.png",
    prompt: [
      VISO_INTATTO,
      "Change only these things:",
      "1. Remove my hand from my face and show my real mouth, chin and jaw, continuing the same face naturally, with the same short stubble as in the photo.",
      "2. Head straight, facing the camera, neutral relaxed expression, eyes looking into the lens.",
      "3. Plain light grey seamless studio background.",
      "4. Soft even studio light from the front, both cheeks equally lit, no harsh shadows.",
      "5. Plain black crew-neck t-shirt.",
      "6. Square framing: head and top of the shoulders, centered, the face filling about half the frame.",
      "Photographic, real skin pores, no smoothing, no painterly or CGI look.",
    ].join("\n"),
  },
};

function arg(nome: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

// Giro di ritocco dello sheet: l'immagine da modificare e' lo sheet scelto da Attilio
// (o l'ultimo buono), il riferimento e' UNA sola sua foto vera evidenziata. Un giro per
// foto: ogni giro avvicina il viso a quella foto senza toccare griglia, pose e luce.
const RITOCCO = (foto: string) => [
  "Image 1 is my face reference sheet: six photographic panels of me in a 3x2 grid. Image 2 is a REAL, unretouched photo of me.",
  "Edit image 1 so the man in EVERY panel has EXACTLY the facial proportions of image 2. Proportions matter more than anything else:",
  "- face width relative to face height; jaw width relative to cheekbone width; chin shape and length;",
  "- distance between the eyes, eye size, eyelid shape; eyebrow height and thickness;",
  "- nose length, bridge width and tip shape; mouth width and lip thickness; ear size and position.",
  "Copy these ratios from image 2, do not invent them: do NOT widen or narrow the jaw, do NOT make the face fuller or slimmer than image 2, do NOT beautify or de-age.",
  foto.includes("selfie")
    ? "Image 2 is a selfie at arm's length: ignore the wide-angle distortion (bigger nose and forehead from the lens), keep the real proportions as seen from two metres."
    : "",
  "Keep EVERYTHING else of image 1 identical: grid, panel positions, view and head angle of each panel, light grey background, soft even light, black t-shirt, curls, small YELLOW-GOLD hoop earring on the same ear, no glasses, the same stubble as image 1, the gaze and open eyes of image 1, no text.",
  "EYES: fully open and alert, upper eyelids light and NOT heavy, NOT droopy, NOT sleepy, no dark circles; dark brown irises.",
  "From image 2 take ONLY the face proportions and the moles. Ignore its background, light, clothes, glasses, hands.",
  "Real photograph, real skin pores, no smoothing, no CGI look.",
].filter(Boolean).join("\n");

// Correzione mirata della sola pelle: il viso dello sheet scelto resta com'e' (occhi,
// sguardo, forma), si tolgono barba e puntini e si rimettono i nei della foto vera.
const SOLO_PELLE = [
  "Image 1 is my face reference sheet: six photographic panels of me in a 3x2 grid. Image 2 is a REAL, unretouched photo of me, freshly shaved.",
  "Edit image 1 changing ONLY the skin, in every panel:",
  "1. Freshly and closely shaved like image 2: remove all stubble and beard dots on chin, jaw, cheeks, upper lip and neck. Keep real skin pores, no smoothing.",
  "2. My moles exactly as in image 2: the dark mole on the cheek, at the same place relative to the nose, mouth and ear, on the SAME side as the earring; it must be visible in every panel where that cheek is visible, and nowhere else. No extra moles.",
  "Keep EVERYTHING else of image 1 pixel-identical: the face shape and width, eyes, eyelids, gaze, eyebrows, nose, lips, ears, age, hair, earring, the grid, poses, background, light and black t-shirt.",
  "From image 2 take ONLY the shaved skin and the moles. Ignore its glasses, light, background and clothes.",
].join("\n");

withProject(PROGETTO, () => {
  initSchema();
  const ritocca = arg("ritocca");
  if (ritocca) {
    const foto = arg("foto");
    const evid = db().query<{ file: string }, []>("SELECT file FROM reference_pick").all().map((r) => r.file);
    if (!foto || !evid.includes(foto)) throw new Error(`--foto deve essere una foto evidenziata: ${evid.join(", ")}`);
    if (!existsSync(ritocca)) throw new Error(`sheet mancante: ${ritocca}`);
    const ref = join(dirsFor(PROGETTO).DATA_DIR, "refs", foto);
    if (!existsSync(ref)) throw new Error(`foto mancante: ${ref}`);
    const prompt = process.argv.includes("--solo-pelle") ? SOLO_PELLE : RITOCCO(foto);
    if (process.argv.includes("--stampa")) { console.log(`da: ${ritocca}\nref: ${foto}\n${prompt.length} car.\n${prompt}`); return; }
    const giri = Number(arg("giri", "3"));
    const id = "sheet-iter";
    const now = Date.now();
    db().prepare(
      `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
       VALUES (?, ?, '.png', 'generated', ?, ?)`,
    ).run(id, ritocca, now, now);
    for (let g = 1; g <= giri; g++) {
      const job = enqueueJob(
        id, prompt, null, "chatgpt", null, "edit", ritocca, JSON.stringify([ref]),
        JSON.stringify({ recipe: "sheet-ritocco", sources: [ritocca.split("/").slice(-2).join("/")], refs: [foto], giro: g, cambiato: `viso verso ${foto}` }),
        "openbrowser",
        JSON.stringify([foto]),
      );
      console.log(`[sheet-iter] job ${job.id}  ref ${foto}  giro ${g}/${giri}`);
    }
    return;
  }
  const nome = arg("pannello", "frontale")!;
  const p = PANNELLI[nome];
  if (!p) throw new Error(`pannello sconosciuto: ${nome} (noti: ${Object.keys(PANNELLI).join(", ")})`);
  const giri = Number(arg("giri", "3"));

  const evidenziate = db().query<{ file: string }, []>("SELECT file FROM reference_pick").all().map((r) => r.file);
  if (!p.base && !evidenziate.includes(p.da)) throw new Error(`${p.da} non e' fra le foto evidenziate: ${evidenziate.join(", ")}`);
  const input = join(dirsFor(PROGETTO).DATA_DIR, "refs", p.da);
  if (!existsSync(input)) throw new Error(`foto mancante: ${input}`);

  if (process.argv.includes("--stampa")) {
    console.log(`da: ${p.da}\n${p.prompt.length} car.\n${p.prompt}`);
    return;
  }

  const foto = `sheet-${nome}`;
  const now = Date.now();
  db().prepare(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, ?, '.png', 'generated', ?, ?)`,
  ).run(foto, input, now, now);

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      foto, p.prompt, null, "chatgpt", null, "edit", input, null,
      JSON.stringify({ recipe: `sheet-${nome}`, sources: [p.da], giro: g, cambiato: `pannello ${nome}, giro ${g} di ${giri}` }),
      "openbrowser",
      // La foto vera e' l'immagine da modificare, non un riferimento allegato:
      // dichiararla come riferimento fa fermare il worker (non la trova fra gli allegati).
      null,
    );
    console.log(`[sheet-${nome}] job ${job.id}  giro ${g}/${giri}`);
  }
});
