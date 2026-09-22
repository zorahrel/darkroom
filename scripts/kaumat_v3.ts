/**
 * Il Kaumat come chiesto: un geco, non la bestia del video.
 *
 * L'errore della passata precedente e' stato copiare la creatura del filmato.
 * Nella jcode la distinzione e' scritta due volte: «non deve essere come il
 * ciliatus, ma delle fattezze aliene tipo lui» e «deve essere piu' alienico TIPO
 * la reference». La reference serve per il GRADO DI ALIENITA' e per il modo in
 * cui i rilievi stanno sul corpo, non per il soggetto.
 *
 * Cosa viene da dove:
 *   - dal geco ciliatus: la faccia. Testa larga e piatta, occhi enormi senza
 *     palpebre, muso corto e tozzo, bocca che sale nel sorriso fisso.
 *   - dalla reference video: il grado di alienita', i rilievi PIATTI che coprono
 *     la superficie, la curva del collo alla Loch Ness, il corpo orizzontale a S.
 *   - da nessuno dei due: le proporzioni e la postura, che di geco non sono.
 *     Massa da toro, quattro zampe a terra, muscoli, mani palmate.
 *
 * Usage: bun run scripts/kaumat_v3.ts [--n 2]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
/** Prima la faccia (il geco), poi l'alienita' (il video): l'ordine conta, ed e'
 *  dichiarato dentro il prompt riga per riga. */
const REFS = [`${R}/kaumat-master.png`, `${R}/video-reference-dettagli.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 2);

const PROMPT = `
Two images are attached and they play DIFFERENT roles. Read this before anything
else.

The FIRST image is the CHARACTER: this is the animal. Its face, its head shape,
its eyes, its colours and its skin are the subject you are photographing.

The SECOND image is a MOOD REFERENCE ONLY: a creature from a film. Do NOT copy
this creature, do NOT give the animal its beak-like head, and do NOT reproduce
it. Take from it three things and nothing else: how ALIEN it feels, the way its
raised details are FLAT AND BROAD and lie flat covering the surface of the body,
and the line of its neck.

THE HEAD is a crested gecko's, from the first image: COLOSSAL, a third of the
body length, extremely WIDE and FLAT, far wider than tall, a broad triangular
wedge widest at the jaw hinge narrowing to a SHORT BLUNT ROUNDED snout. Two
ENORMOUS round lidless eyes, each nearly as wide as the snout, set far apart at
the outer corners of the skull, glossy black with a burning amber ring and a
vertical slit pupil. The wide jaw line curves up into a fixed gentle smile
running back to the ear opening, no lips. A flat amber-orange keratin casque lies
smooth over the top of the skull, coral pink at its base, translucent at the rim.
The face is DRACONIC and alien, heavy and serious, never a beak, never a bird's
head, never cute.

PROPORTIONS AND POSTURE ARE NOT A GECKO'S: this is a massive animal, four metres
long, the mass of a bull, heavily muscled, thick slabs of shoulder and haunch,
tendons and loose skin folds. It stands ON ALL FOUR LEGS ON THE GROUND, weight
on all four, never bipedal, never on a tree, never the flat splayed crouch of a
gecko on glass. The forelimbs are articulated like a gecko's, elbows crooked out
and back, but they are heavy load-bearing limbs. Hands and feet are WEBBED
PADDLES: the five digits visible as divided rays inside the webbing, rounded
tips, no claws and no points.

THE NECK is the Loch Ness curve taken from the second image: from the shoulders
it rises UP AND BACKWARDS, leaning back, then arches forward at the top and comes
DOWN AND FORWARD, so that huge gecko head hangs forward and low, well ahead of
the shoulders, muzzle pointing down. Long and thick and muscular the whole way,
never a thin stalk.

THE SURFACE, taken from the second image but on this animal's own colours: broad
FLAT cream-white plates lie against the neck and shoulders in continuous
overlapping rows, like wide soft fingernails, COVERING the surface. Every raised
detail is flat and lies down against the body. No spikes, no thorns, no points,
no crest of spines, and the centre line of the spine stays bare. Scattered
chalk-white flecks spray over the shoulders, flank and hips. The hide is powder
blue and pale mint going iridescent emerald-teal at the throat and shoulders,
fine granular velvet skin. The tail is as thick as the torso at the hips, deep
indigo with a burnt orange-red stripe, sweeping out behind along the ground and
curling at the tip.

THE WHOLE BODY IS BALANCED HORIZONTALLY and reads as one long S: neck rising and
hooking forward at one end, back arching, tail sweeping out behind.

FRAMING: vertical 9:16, 1080x1920. Shot from far away on a long lens, THROUGH
the forest: big out-of-focus leaves, fern fronds and a dark branch crowd the
foreground and the edges, the animal glimpsed in the gap between them, as if
filmed without it knowing. Foreground nearly black, only the animal sharp.

SETTING: the floor of a dark primeval forest, wet leaf litter, moss, buttressed
trunks, tree ferns, hanging vines, nothing tidy or garden-like. A moss-covered
fallen trunk a metre thick lies behind it and the arch of its back rises above
the trunk; tree ferns that would tower over a person reach only its shoulder.

LIGHT: near darkness, one hard blade of afternoon sun raking across the arched
neck and lighting the edges of the plates. No fill light.

STYLE: BBC natural-history documentary frame, Prehistoric Planet grade.
Photographic, real lens, true texture, film grain. Not illustrated.

Negative: beak, bird head, narrow head, pointed snout, small eyes, eyelids,
cute face, spikes, thorns, pointed scales, crest of spines, ridge down the middle
of the back, bipedal, standing upright, front legs off the ground, climbing,
perched on a branch, gecko crouch, flat splayed gecko posture, slender, light
build, small pet-sized animal, claws, separated clawed toes, hidden toes, garden
plants, tidy vegetation, bright daylight, visible sky, clear unobstructed view,
cartoon, videogame render, concept art, 3D render, text, watermark, people, fur.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const photoId = "kaumat-v3";
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [photoId, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, photoId);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "geco-alieno", refs: REFS.map((r) => r.split("/").pop()) });
    const job = enqueueJob(
      photoId, PROMPT, cfg, "chatgpt", null, "generate", null,
      JSON.stringify(REFS), null, "codex-http", JSON.stringify(REFS.map((r) => r.split("/").pop())),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(photoId);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 12000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [], prompt: PROMPT, output: out, refs: REFS });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status === "ok") {
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [photoId, n, out, PROMPT, cfg, JSON.stringify({ recipe: "geco-alieno", refs: REFS.map((r) => r.split("/").pop()), backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), photoId]);
      console.log(`[v3] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[v3] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
