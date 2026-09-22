/**
 * Una posa sola, con lo schizzo allegato.
 *
 * Lo schizzo della silhouette e' la reference che mancava: la posa a parole non
 * e' mai arrivata a destinazione (tre tentativi con la schiena dritta, poi una
 * gobba con la testa a terra che comunque non era quella chiesta). Un disegno
 * della linea si copia e basta.
 *
 * Due errori miei che questo prompt chiude:
 *   - la cresta centrale sul dorso, che il prompt originale VIETAVA ("the centre
 *     line of the spine is completely bare"): l'avevo introdotta io nella
 *     reference v2 e si e' propagata a tutte le rifiniture;
 *   - il collo basso: nello schizzo il collo SALE e la testa sta in cima, col
 *     muso rivolto in giu'.
 *
 * Usage: bun run scripts/kaumat_posa.ts [--n 1]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const REFS = [
  // L'animale: la reference originale, non la v2 (che ha la cresta sbagliata).
  "/Users/zorahrel/Darkroom/projects/kaumat/data/refs/kaumat-master.png",
  // La linea del corpo, disegnata.
  "/Users/zorahrel/Darkroom/projects/kaumat/data/refs/posa-schizzo.jpg",
];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);
/** Lo schizzo come SORGENTE da riempire invece che come riferimento da
 *  guardare. Descritto a parole, l'outline non e' mai arrivato: passato come
 *  immagine di partenza vincola molto di piu'. */
const RICALCA = process.argv.includes("--ricalca");

const TESTA_RICALCO = `
The first image is a white line drawing on black: it is the OUTLINE OF AN ANIMAL
seen in strict side profile, and it is a construction guide, not something to
reproduce. Build the photograph on top of it: the animal's body must follow that
line exactly, landmark by landmark. The second image is the character reference:
the animal filling the outline is that animal, with its anatomy, colours and
surface detail. Nothing of the drawing itself survives in the output, no white
line, no black background: the result is a photograph taken in a forest.
`.trim();

const TESTA_RIFERIMENTO = `
Two images are attached. The FIRST is the character reference: copy this animal's
anatomy, colours, proportions and surface detail faithfully. The SECOND is a line
drawing of the body silhouette: copy that outline exactly, it is the pose.
`.trim();

const PROMPT = `
${RICALCA ? TESTA_RICALCO : TESTA_RIFERIMENTO}

THE HEAD AND NECK, the thing that goes wrong most often. Take the head straight
from the character reference and do not restyle it: it is COLOSSAL, a third of
the body length, extremely WIDE and FLAT, far wider than tall, a broad triangular
wedge widest at the jaw hinge narrowing to a SHORT BLUNT ROUNDED snout. It is a
crested gecko's head, never a dinosaur's, never a lizard's narrow pointed muzzle.
THE EYE IS ENORMOUS, a huge round lidless dome taking up a third of the whole
head, glossy black with a burning amber ring and a vertical slit pupil. The wide
jaw line curves up into a fixed gentle smile running back to the ear opening.

THE NECK IS VERY LONG, far longer than in the reference sheet: a long, thick,
muscular neck that carries that huge head high up and well forward of the
shoulders. Long like a swan's in length, but heavy and muscular in build, never
thin, never a slender sauropod stalk.

THE POSE, from the line drawing. The outline of the whole animal is a deep W,
with FIVE landmarks, left to right, and every one of them must be there:

1. THE HEAD IS HIGH, at the top of a raised neck, and THE MUZZLE HOOKS DOWNWARD:
   the snout points down and slightly forward, the whole head bent over at the
   top of the neck like the crook of a walking stick, like a heron about to
   strike at the ground far below. The head is never level, never tipped up.
2. THE NECK DIPS. From the hooked head the neck plunges down and back in a deep
   U, its lowest point well below the line of the back, then climbs again to the
   shoulders. This dip is what makes the shape a W and it is the landmark most
   often missed: without it the animal just has a long straight raised neck,
   which is wrong.
3. THE HUMP. The middle of the back rises into a tall rounded dome, the second
   high point of the outline, standing as high as the head or nearly so.
4. THE HIPS DROP low behind the hump.
5. THE TAIL RISES steeply from the low hips, standing up tall and curling over at
   its tip.

Down, up, down, up: no straight segment anywhere in the topline. The neck is
thick and muscular like a bison's, not a long slender sauropod neck.

BACK, and this is a rule, not a preference: the CENTRE LINE OF THE SPINE IS
COMPLETELY BARE. No crest, no ridge, no row of spines, no fringe down the middle
of the back. The two cream-white rows of small soft fleshy triangular fringe
scales run along the two OUTER SIDE EDGES of the back, one row down each flank
edge, starting above each eye and fading at the hip.

FEET, exactly as in the character reference: a broad webbed fan, and the FIVE
DIGITS ARE CLEARLY VISIBLE AND DIVIDED inside it, each one a distinct ray running
out to its own rounded tip, the rim of the foot scalloped between the toes. Like
a web-footed gecko: the toes can be counted at a glance. Never a smooth featureless
paddle, never a mitten with the toes hidden.

SCALE: the size of a bull, 4 metres from snout to tail tip. A moss-covered fallen
trunk a metre thick lies behind it and the arch of its back rises above the
trunk. Tree ferns that would tower over a person reach only its shoulder.

SETTING: the floor of a dark primeval forest, wet leaf litter, moss, stones.
Strict side-on profile, fully broadside to the camera, so the whole outline of
the body reads against the background.

LIGHT: near darkness, one hard blade of afternoon sun from camera left raking
across the arched back and the raised neck. No fill light.

CAMERA: 300mm telephoto, heavy compression, shallow depth of field.

STYLE: BBC natural-history documentary frame, Prehistoric Planet grade.
Photographic, not illustrated. Film grain.

Vertical 9:16, 1080x1920.

Negative: small head, narrow head, long pointed muzzle, dinosaur head, small eye,
short neck, thin neck, sauropod neck, crest down the spine, central ridge, row of
spines along the back, fringe along the centre of the back, head down at ground
level, head below the shoulders, muzzle level, muzzle pointing up, no dip between
head and back, straight back, flat topline, no hump, tail lying flat on the
ground, smooth paddle feet, hidden toes, fused toes, three-quarter view, front
view, small pet-sized animal, bright daylight, visible sky, cartoon, videogame
render, concept art, text, watermark, people, fur.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const photoId = "kaumat-posa";
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [photoId, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, photoId);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "posa-da-schizzo", refs: REFS.map((r) => r.split("/").pop()) });
    const job = enqueueJob(
      photoId, PROMPT, cfg, "chatgpt", null, "generate", null,
      JSON.stringify(REFS), null, "codex-http", JSON.stringify(REFS.map((r) => r.split("/").pop())),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(photoId);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 12000));
    const t0 = Date.now();
    const res = RICALCA
      ? await runWorkerCodexHttp({ images: [REFS[1]!], prompt: PROMPT, output: out, refs: [REFS[0]!] })
      : await runWorkerCodexHttp({ images: [], prompt: PROMPT, output: out, refs: REFS });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status === "ok") {
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [photoId, n, out, PROMPT, cfg, JSON.stringify({ recipe: "posa-da-schizzo", refs: REFS.map((r) => r.split("/").pop()), backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), photoId]);
      console.log(`[posa] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[posa] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
