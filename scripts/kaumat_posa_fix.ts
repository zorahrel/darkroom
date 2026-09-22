/**
 * Porta a fondo la W sulla posa gia' buona, invece di rigenerarla.
 *
 * La v03 (ricalco dello schizzo) ha gia' testa alta, muso piegato in giu' e coda
 * che sale: quello che manca e' solo l'ampiezza dei tre snodi. Rigenerare da
 * zero rimetterebbe in gioco anche cio' che e' gia' giusto, e le ultime tre
 * passate hanno mostrato che ogni giro nuovo perde qualcosa che c'era.
 *
 * Usage: bun run scripts/kaumat_posa_fix.ts [--da 3] [--n 1]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const PHOTO = "kaumat-posa";
const SCHIZZO = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs/posa-schizzo.jpg";
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DA = Number(arg("--da") ?? 3);
const N = Number(arg("--n") ?? 1);

const PROMPT = `
The first image is a photograph of the animal. The second is the line drawing of
the pose it is meant to be holding.

Keep the animal, its anatomy, its colours, the forest, the light, the camera
angle and the framing exactly as they are in the photograph. Change ONE thing:
push the line of its body all the way to the drawing. Right now the curves are
too shallow. Exaggerate them:

1. THE MUZZLE HOOKS FURTHER DOWN. The snout points down towards the ground, the
   head bent right over at the top of the neck like the crook of a walking stick.
2. THE NECK DIPS DEEPER between the head and the shoulders, a pronounced U whose
   lowest point is clearly below the line of the back. This dip is the landmark
   that is missing and it is what makes the outline a W instead of an arc.
3. THE HUMP RISES HIGHER. The middle of the back swells into a tall rounded dome,
   the second high point of the animal, as high as the head.
4. THE HIPS DROP lower behind the hump and the TAIL RISES steeply, standing tall
   and curling over at the tip.

Two things that must not change while you do it: the CENTRE LINE OF THE SPINE
STAYS COMPLETELY BARE, no crest, no ridge, no spines down the middle of the back,
the two rows of cream fringe scales run only along the outer side edges of the
back; and every foot keeps FIVE LONG SEPARATE SPLAYED DIGITS with round adhesive
pads and lamellae underneath, never a paddle.

It stays a photograph: same forest, same light, real animal, natural grain. No
white line and no black background from the drawing appears in the output.

Negative: crest down the spine, central ridge, spines along the back, shallow
curves, straight neck, arc-shaped topline, level muzzle, muzzle up, flat back, no
hump, tail on the ground, paddle feet, fused toes, new framing, different
background, cartoon, 3D render, text, watermark.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const src = join(d.GEN_DIR, PHOTO, `v${String(DA).padStart(2, "0")}.png`);
  if (!existsSync(src)) {
    console.error(`[fix] manca la sorgente: ${src}`);
    process.exit(1);
  }
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "posa-w-marcata", refs: ["posa-schizzo.jpg"], sources: [`v${DA}`] });
    const job = enqueueJob(
      PHOTO, PROMPT, cfg, "chatgpt", null, "edit", src,
      JSON.stringify([SCHIZZO]), null, "codex-http", JSON.stringify(["posa-schizzo.jpg"]),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(PHOTO);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 12000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [src], prompt: PROMPT, output: out, refs: [SCHIZZO] });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status === "ok") {
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [PHOTO, n, out, PROMPT, cfg, JSON.stringify({ recipe: "posa-w-marcata", refs: ["posa-schizzo.jpg"], sources: [`v${DA}`], backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [src], [SCHIZZO]);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      console.log(`[fix] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[fix] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
