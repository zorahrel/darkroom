/**
 * Rifinitura del Kaumat partendo dalla C19, l'immagine della cronologia ChatGPT
 * piu' vicina a cio' che Attilio vuole. Un delta per passata, come ha funzionato
 * su testa e collo: si tiene fermo per iscritto cio' che e' gia' giusto e si
 * muove una cosa sola.
 *
 * Motore: ChatGPT web dentro OpenBrowser (721e68f). La quota Codex e' esaurita
 * fino al 26/09, e comunque Codex ignora gli allegati: qui la foto di partenza
 * e la reference arrivano davvero al modello.
 *
 *   --delta corpo   il tronco e' a botte, da rinoceronte: va reso atletico e
 *                   deve seguire la curva della spina dorsale.
 *   --delta collo   sale all'indietro e poi va in avanti, alla Loch Ness.
 *   --delta dita    dita divise da geco, non unite da una membrana.
 *   --delta pelle   piume e scaglie come nella reference del filmato.
 *   --delta piatte  la fila sulla nuca a dentini diventa di placche piatte.
 *   --delta testa   testa da geco grande e larga, occhio enorme.
 *   --delta muso    solo l'inclinazione: il muso pende verso terra.
 *   --delta allunga il collo che si e' accorciato torna lungo.
 *
 * Usage: bun run scripts/kaumat_c19.ts --delta corpo [--da vN]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerOpenBrowser } from "../server/worker.ts";

const PID = "kaumat";
const PHOTO = "kaumat-c19";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const C19 = `${R}/chatgpt-C19.png`;
const VIDEO = `${R}/video-reference-dettagli.png`;
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DELTA = arg("--delta") ?? "corpo";
/** Sorgente: un numero di versione di kaumat-c19 (v2) o, di default, la C19. */
const DA = arg("--da");

/** Tutto cio' che Attilio ha chiesto (jcode + questo topic) e che una passata
 *  non deve far regredire mentre ne corregge un altro pezzo. */
const TIENI = `
Keep everything else in the photograph exactly as it is: the crested-gecko head
with its wide blunt jaw and large amber eye, draconic and alien, the orange-rust
face, the teal and powder-blue hide with its iridescent glow, the cream fringe
rows along the sides of the neck and flank, the thick tail with its burnt orange
stripe, the animal standing on all four legs on the forest floor, the dark
primeval forest, the blurred leaves and branches in the foreground that make it
look filmed from far away through the undergrowth, the light, the colour grade,
the camera angle and the vertical 9:16 framing. It must stay a real photograph:
real lens, true skin texture, natural grain, never CGI, never a 3D render.
`.trim();

const DELTAS: Record<string, { refs: string[]; text: string }> = {
  corpo: {
    refs: [],
    text: `
Change ONE thing: THE BUILD OF THE BODY. Right now the torso is a heavy barrel,
squat like a rhinoceros, on short pillar legs. Make it ATHLETIC:
- The body FOLLOWS THE CURVE OF THE SPINE: the spine is one continuous flowing S
  from the head to the tail tip, and the body hangs from it. The back arches up
  in a long high curve over the middle, the belly is drawn up tight under it,
  the flanks narrow towards the hips. The silhouette is a flowing curve, never a
  barrel or a box.
- Lean and powerful like a big cat or a monitor lizard at the scale of a horse:
  defined muscles under the hide at shoulder, forearm, thigh and ribs, a narrow
  waist, a deep chest.
- Longer legs, jointed like a gecko's, elbows and knees clearly bent, lifting the
  body off the ground with spring in them.
Still a huge animal, but fast and predatory, not a heavy grazer.
Do not: barrel body, fat, squat, stocky, rhinoceros build, hanging belly,
pillar legs, flat straight back.`,
  },
  collo: {
    refs: [],
    text: `
Change ONE thing: THE NECK. It must be a Loch Ness curve: from the shoulders the
neck RISES UP AND BACKWARDS, leaning back over the body, then ARCHES FORWARD at
the top and comes DOWN AND FORWARD, so the big gecko head is carried high and
hangs forward well ahead of the shoulders, muzzle pointing down towards the
ground. The neck is long, muscular and athletic, continuing the S curve of the
spine. The body keeps its lean athletic build.
Do not: low neck, head at ground level, neck running straight forward, short
neck, thin stalk neck, heavy barrel body.`,
  },
  dita: {
    refs: [],
    text: `
Change ONE thing: THE HANDS AND FEET. Every foot has FIVE LONG SEPARATE DIGITS,
clearly divided from each other all the way down to the base with visible gaps
between them, splayed out like a real gecko's toes, each ending in a broad round
adhesive pad. The toes are NOT joined by a membrane and NOT fused into a paddle.
No claws, no points. Let the feet catch enough light that every toe can be
counted on the front feet.
Do not: webbing between the toes, fused toes, paddle, mitten, hoof, claws,
pointed toes, toes lost in shadow.`,
  },
  piatte: {
    refs: [],
    text: `
Change ONE thing: THE ROW OF SCALES ALONG THE TOP OF THE NECK AND BACK. Right
now it stands up as a line of small pointed teeth. Lay it down FLAT: broad,
rounded, overlapping cream plates lying against the skin like the rest of the
feather-scales, following the curve of the neck. Every raised detail on this
animal is flat and rounded and covers the surface.
Do not: points, spikes, thorns, teeth-like scales, a serrated crest, a saw-edge.`,
  },
  testa: {
    refs: [`${R}/kaumat-master.png`],
    text: `
The second image is the character sheet of this animal: take ONLY its head from
it.
Change ONE thing: THE HEAD, which is too small and too narrow, like a snake's.
Make it a crested gecko's head at the scale of this animal: BIG, a clearly
larger share of the body, WIDE and FLAT, a broad wedge widest at the jaw hinge
narrowing to a SHORT BLUNT ROUNDED snout, the wide jaw line curving up into a
fixed gentle smile. The EYE is ENORMOUS, round and lidless, glossy black with a
burning amber ring and a vertical slit pupil, set high at the corner of the
skull. The face stays draconic and alien, serious, never cute. The neck, its
curve and everything below it stay exactly as they are.
Do not: small head, narrow head, snake head, long pointed snout, small eye,
eyelids, cute face, a beak.`,
  },
  muso: {
    refs: [],
    text: `
Change ONE thing: THE TILT OF THE HEAD. Right now the head is held level, looking
straight ahead. At the top of the neck it must HOOK DOWNWARD: the head bends
over like the crook of a walking stick, the blunt snout pointing DOWN and
forward towards the forest floor, as if the animal is peering at the ground in
front of it. Keep the head exactly as it is in shape and size: the wide flat
gecko head, the enormous amber eye with its slit pupil, the smiling jaw. Only
its angle changes, and the top of the neck curves a little further forward to
carry it.
Do not: level head, head looking straight ahead, muzzle pointing up, smaller
head, narrower head, different eye.`,
  },
  allunga: {
    refs: [],
    text: `
Change ONE thing: THE LENGTH OF THE NECK, which has become too short, so the head
sits almost on the shoulders. Make the neck much LONGER: it rises from the
shoulders UP AND BACKWARDS in a tall curve, arches over at the top and comes
DOWN AND FORWARD, carrying the head well out ahead of the chest and higher than
the back. Keep the head exactly as it is, its size, its shape, its enormous eye
and its downward tilt with the snout pointing at the ground. The neck stays
thick and muscular, covered in the same flat cream feather-scales.
Do not: short neck, head on the shoulders, thin stalk neck, level head, snout
pointing up, smaller head, different eye.`,
  },
  pelle: {
    refs: [VIDEO],
    text: `
The second image is a frame from a film, attached ONLY for the texture of its
skin: do not copy that creature, its beak or its shape.
Change ONE thing: THE SKIN. Give the animal the feathers and scales of the
reference: along the neck, the throat and over the shoulders, rows of broad FLAT
overlapping cream-white feather-scales, like soft fingernails or flat bird
feathers laid in rows, lying down against the body and covering it; a spray of
small chalk-white scale flecks over the shoulders, flank and hips; everywhere
else fine overlapping scales with an iridescent teal sheen.
Do not: spikes, thorns, raised points, fur, fluffy feathers, a beak, a bird head,
a new body shape.`,
  },
};

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const delta = DELTAS[DELTA];
  if (!delta) {
    console.error(`[c19] delta sconosciuto: ${DELTA} (${Object.keys(DELTAS).join(" | ")})`);
    process.exit(1);
  }
  const src = DA ? join(d.GEN_DIR, PHOTO, `v${DA.replace(/^v/, "").padStart(2, "0")}.png`) : C19;
  if (!existsSync(src)) {
    console.error(`[c19] manca la sorgente: ${src}`);
    process.exit(1);
  }
  const prompt = `The first image is a photograph of an animal.\n\n${delta.text.trim()}\n\n${TIENI}`;
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, ?, '.png', 'generated', ?, ?)`,
    [PHOTO, C19, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });

  const names = delta.refs.map((r) => r.split("/").pop()!);
  const cfg = JSON.stringify({ recipe: `c19-${DELTA}`, refs: names, sources: [src.split("/").pop()] });
  const job = enqueueJob(
    PHOTO, prompt, cfg, "chatgpt", null, "edit", src,
    JSON.stringify(delta.refs), null, "openbrowser", names.length ? JSON.stringify(names) : null,
  );
  db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
  const n = nextVersionNumber(PHOTO);
  const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
  const t0 = Date.now();
  const res = await runWorkerOpenBrowser({ image: src, prompt, output: out, refs: delta.refs });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.status !== "ok" || !existsSync(out)) {
    const why = res.status === "ok" ? "file di uscita assente" : res.error;
    db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), why ?? "?", job.id]);
    console.error(`[c19] ${DELTA} FALLITO in ${secs}s: ${why}`);
    process.exit(1);
  }
  const lineage = JSON.stringify({ recipe: `c19-${DELTA}`, refs: names, sources: [src.split("/").pop()], backend: "openbrowser" });
  const ins = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
    [PHOTO, n, out, prompt, cfg, lineage, Date.now()],
  );
  scriviIngressiVariante(Number(ins.lastInsertRowid), [src], delta.refs);
  db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
  console.log(`[c19] ${DELTA} v${n} ok in ${secs}s → ${out}`);
});
