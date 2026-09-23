/**
 * Rifinitura del Kaumat partendo dalla C19, l'immagine della cronologia ChatGPT
 * piu' vicina a cio' che Attilio vuole. Un delta per passata, come ha funzionato
 * su testa e collo: si tiene fermo per iscritto cio' che e' gia' giusto e si
 * muove una cosa sola.
 *
 *   --delta corpo   il tronco e' a botte, da rinoceronte: va reso atletico e
 *                   deve seguire la curva della spina dorsale.
 *   --delta pelle   piume e scaglie come nella reference del filmato.
 *
 * Usage: bun run scripts/kaumat_c19.ts --delta corpo [--da <file|vN>]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const PHOTO = "kaumat-c19";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const C19 = `${R}/chatgpt/202609212220_6ab1ad7f_2.png`;
const VIDEO = `${R}/video-reference-dettagli.png`;
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DELTA = arg("--delta") ?? "corpo";
/** Sorgente: un numero di versione di kaumat-c19 (v2) o, di default, la C19. */
const DA = arg("--da");

/** Cio' che e' gia' giusto nella C19 e non si tocca: e' la ragione per cui si
 *  parte da li'. */
const TIENI = `
Keep exactly as they are: the gecko head with its wide blunt jaw, the large
amber eye, the orange-rust face and casque, the teal and powder-blue hide with
its iridescent glow at the shoulder, the cream fringe rows along the sides of the
neck and flank, the thick tail with its burnt orange stripe, the four legs on the
ground, the dark forest, the blurred foreground leaves and branches, the light,
the camera angle and the framing.
`.trim();

const DELTAS: Record<string, { prompt: string; refs: string[] }> = {
  corpo: {
    refs: [],
    prompt: `
The image is a photograph of an animal. ${TIENI}

Change ONE thing: THE BUILD OF THE BODY. Right now the torso is a heavy barrel,
thick and squat like a rhinoceros, on pillar legs. It must become ATHLETIC:

- The body FOLLOWS THE CURVE OF THE SPINE. The spine is one continuous S-shaped
  line from the back of the head to the tip of the tail, and the whole body hangs
  from it and follows it: the back arches up in a long high curve over the
  middle, the belly draws up tight underneath it, the flanks narrow towards the
  hips. The silhouette is a long flowing curve, never a box or a barrel.
- LEAN AND POWERFUL, like a big cat or a monitor lizard built at the scale of a
  horse: defined muscle groups visible under the hide at the shoulder, the
  forearm, the thigh and along the ribs, a narrow waist, a deep chest, tendons
  showing at the joints.
- LONGER LEGS, jointed and articulated like a gecko's, elbows and knees clearly
  bent, carrying the body up off the ground with spring in them, never short
  straight pillars.

It keeps its size, it is still a huge animal, but it reads as fast and
predatory, not as a heavy grazer.

It stays the same photograph: same forest, same light, real animal on a real
lens, natural grain.

Negative: barrel body, fat, squat, stocky, rhinoceros build, hippo build, round
belly hanging low, pillar legs, short straight legs, box-shaped torso, flat
straight back, new head, new colours, new framing, different background,
different light, cartoon, 3D render, text, watermark.
`.trim(),
  },
  pelle: {
    refs: [VIDEO],
    prompt: `
The first image is a photograph of an animal. The second is a frame from a film,
attached ONLY for its skin: do not copy that creature, its beak or its shape.

Keep the animal's body, pose and build exactly as they are, and ${TIENI.charAt(0).toLowerCase() + TIENI.slice(1)}

Change ONE thing: THE SURFACE OF THE SKIN, which must carry the feathers and
scales of the reference.

- Along the neck, the throat and over the shoulders, rows of broad, FLAT,
  overlapping cream-white FEATHER-SCALES, like soft fingernails or the flat
  feathers of a bird laid in rows, lying down against the body and COVERING the
  surface, exactly as on the creature in the second image. They are flat and
  soft, never spikes, never thorns, never raised points.
- A spray of small chalk-white scale flecks scattered over the shoulders, the
  flank and the hip, as in the reference.
- Everywhere else a fine granular skin of small overlapping scales, with the
  iridescent teal and powder-blue sheen the animal already has.

It stays the same photograph: same animal, same pose, same forest, same light,
real lens, natural grain.

Negative: spikes, thorns, pointed scales, raised crest of spines, fur, hair,
fluffy feathers, a beak, a bird head, new pose, new body shape, new framing,
different background, different light, cartoon, 3D render, text, watermark.
`.trim(),
  },
};

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const delta = DELTAS[DELTA];
  if (!delta) {
    console.error(`[c19] delta sconosciuto: ${DELTA} (corpo | pelle)`);
    process.exit(1);
  }
  const src = DA ? join(d.GEN_DIR, PHOTO, `v${String(DA.replace(/^v/, "")).padStart(2, "0")}.png`) : C19;
  if (!existsSync(src)) {
    console.error(`[c19] manca la sorgente: ${src}`);
    process.exit(1);
  }
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
    PHOTO, delta.prompt, cfg, "chatgpt", null, "edit", src,
    JSON.stringify(delta.refs), null, "codex-http", names.length ? JSON.stringify(names) : null,
  );
  db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
  const n = nextVersionNumber(PHOTO);
  const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
  const t0 = Date.now();
  const res = await runWorkerCodexHttp({ images: [src], prompt: delta.prompt, output: out, refs: delta.refs });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.status !== "ok") {
    db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
    console.error(`[c19] ${DELTA} FALLITO in ${secs}s: ${res.error}`);
    process.exit(1);
  }
  const ins = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
    [PHOTO, n, out, delta.prompt, cfg, JSON.stringify({ recipe: `c19-${DELTA}`, refs: names, sources: [src.split("/").pop()], backend: "codex-http" }), Date.now()],
  );
  scriviIngressiVariante(Number(ins.lastInsertRowid), [src], delta.refs);
  db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
  console.log(`[c19] ${DELTA} v${n} ok in ${secs}s → ${out}`);
});
