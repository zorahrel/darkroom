/**
 * Un asse per passata sul Kaumat v2. Il primo asse e' quello gia' segnalato una
 * volta nella jcode e mai chiuso: l'animale sta su DUE zampe, deve stare su
 * QUATTRO. Tutto il resto della v02 e' a bersaglio e si tiene fermo per iscritto.
 *
 * Usage: bun run scripts/kaumat_v2_fix.ts [--da 2] [--n 1]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PHOTO = arg("--photo") ?? "kaumat-v2";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const RIF = `${R}/video-reference-dettagli.png`;
const DA = Number(arg("--da") ?? 2);
const N = Number(arg("--n") ?? 1);
const COLLO = process.argv.includes("--collo");

/** Secondo delta: la fisionomia e la massa sono giuste, la linea del collo no.
 *  Resta l'unico punto della lista ancora aperto, e si muove da solo. */
const PROMPT_COLLO = `
The first image is a photograph of the animal. The second is a reference frame
from a film, attached ONLY for the line of its neck: do not copy that creature,
do not give the animal its beak.

Keep everything in the photograph as it is: the gecko head with its huge lidless
amber eyes, the wide blunt smiling jaw, the orange casque, the flat cream plates
lying over the neck and shoulders, the white flecks, the webbed paddle hands, the
heavy muscled body on all four legs, the thick tail with its orange stripe, the
forest, the foreground leaves, the light and the framing.

Change ONE thing: THE NECK. Right now it runs low and forward, the flat crouch of
a gecko, which is exactly what this animal must not have. Rebuild it as a Loch
Ness curve: from the shoulders the neck RISES UP AND BACKWARDS, leaning back over
the body, then ARCHES FORWARD at the top and comes DOWN AND FORWARD, so the big
gecko head is carried high and hangs forward well ahead of the shoulders, muzzle
pointing down at the ground. In profile the neck is a tall backward-leaning
question mark. It stays long, thick and heavily muscled the whole way, and the
flat cream plates still cover it in rows.

All four feet stay planted on the ground and the body stays balanced
horizontally: the whole animal reads as one long S, neck rising and hooking
forward at one end, back arching, tail sweeping out behind.

It stays the same photograph: same forest, same light, real animal, natural
grain.

Negative: low neck, flat gecko crouch, neck running straight forward, head at
ground level, head below the shoulders, thin neck, short neck, beak, bird head,
bipedal, front legs off the ground, spikes, crest of spines, new framing,
different background, different light, cartoon, 3D render, text, watermark.
`.trim();

const PROMPT_QUADRUPEDE = `
The first image is a photograph of the animal. The second is a reference frame of
the same animal from a film.

Keep everything in the photograph exactly as it is: the forest, the foreground
leaves, the light, the camera angle, the framing, the colours, the long neck
rising and hooking forward, the orange fanned casque, the flat overlapping cream
plates on the neck and shoulders, the white flecks, the long tail with its orange
stripe.

Change ONE thing: the animal is standing up on TWO legs. Put it down ON ALL FOUR
LEGS, with both FOREFEET PLANTED ON THE GROUND, carrying its weight. The
forelimbs are shorter than the hind legs and articulated like a gecko's, elbows
crooked out and back, and they must be clearly visible, reaching down from the
chest to the forest floor. With the front down the body settles into a long
HORIZONTAL line: the back roughly level, the neck rising from the shoulders and
hooking forward over the ground ahead, the tail sweeping out behind along the
ground. The whole animal reads as one long S lying horizontally, not as an upright
biped.

The hands and feet are WEBBED PADDLES: the five digits show as divided rays
inside the webbing, rounded tips, no claws and no points.

It stays the same photograph: same forest, same light, real animal on a real
lens, natural grain.

Negative: bipedal, standing upright, rearing, front legs off the ground, front
legs tucked up, hidden forelimbs, vertical body, kangaroo stance, claws, pointed
toes, spikes, thorns, crest of spines, new framing, different background,
different light, cartoon, 3D render, text, watermark.
`.trim();

const PROMPT = COLLO ? PROMPT_COLLO : PROMPT_QUADRUPEDE;
const RICETTA = COLLO ? "collo-loch-ness" : "quadrupede";

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const src = join(d.GEN_DIR, PHOTO, `v${String(DA).padStart(2, "0")}.png`);
  if (!existsSync(src)) {
    console.error(`[fix2] manca la sorgente: ${src}`);
    process.exit(1);
  }
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: RICETTA, refs: [RIF.split("/").pop()], sources: [`v${DA}`] });
    const job = enqueueJob(
      PHOTO, PROMPT, cfg, "chatgpt", null, "edit", src,
      JSON.stringify([RIF]), null, "codex-http", JSON.stringify([RIF.split("/").pop()]),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(PHOTO);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 12000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [src], prompt: PROMPT, output: out, refs: [RIF] });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status === "ok") {
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [PHOTO, n, out, PROMPT, cfg, JSON.stringify({ recipe: RICETTA, refs: [RIF.split("/").pop()], sources: [`v${DA}`], backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [src], [RIF]);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      console.log(`[fix2] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[fix2] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
