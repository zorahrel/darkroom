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
const CHARACTER = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs/kaumat-master.png";
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DA = Number(arg("--da") ?? 3);
const N = Number(arg("--n") ?? 1);
const TESTA = process.argv.includes("--testa");
const COLLO = process.argv.includes("--collo");

/** Il delta della passata precedente: gli snodi della W erano troppo timidi. */
const PROMPT_W = `
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

/** Il delta di questa passata: la posa e' giusta, la fisionomia no. La testa e'
 *  venuta piccola e appuntita da dinosauro, mentre nella reference e' enorme,
 *  larga e piatta, con l'occhio che ne occupa un terzo. Si cambiano SOLO testa e
 *  collo: tutto il resto della v04 e' gia' a bersaglio, e ogni passata che
 *  rigenera l'intero animale perde un pezzo che c'era. */
const PROMPT_TESTA = `
The first image is a photograph of the animal. The second is the character
reference sheet for the same animal.

The pose in the photograph is correct and must not change: keep the line of the
body exactly as it is, the hooked-down muzzle, the deep dip of the neck, the high
hump of the back, the low hips, the raised curling tail. Keep the forest, the
light, the camera angle, the framing, the colours and the feet as they are. Keep
the centre line of the spine bare, with the cream fringe scales only along the
outer side edges.

Change only the HEAD and the NECK, which are wrong, and make them match the
reference sheet:

1. THE HEAD MUST BE FAR BIGGER. In the photograph it is small and narrow with a
   long pointed muzzle, a dinosaur's head. In the reference it is COLOSSAL: a
   third of the body length, extremely WIDE and FLAT, far wider than tall, a
   broad triangular wedge widest at the jaw hinge narrowing to a SHORT BLUNT
   ROUNDED snout. Rebuild it to that: wide, flat, heavy, blunt. A crested
   gecko's head at the scale of a bull's.
2. THE EYE MUST BE ENORMOUS: a huge round lidless dome taking up a third of the
   whole head, glossy black with a burning amber ring and a vertical slit pupil,
   set high and far out at the corner of the skull, as in the reference.
3. THE JAW LINE curves up into the fixed gentle smile running back to the ear
   opening, no lips, exactly as in the reference.
4. THE NECK MUST BE LONGER AND THICKER: a long, heavy, muscular neck carrying
   that huge head high and well forward of the shoulders. Long in reach, but
   powerful in build, never a thin stalk.

It stays the same photograph: same forest, same light, real animal, natural
grain.

Negative: small head, narrow head, long pointed muzzle, dinosaur head, small eye,
short neck, thin neck, sauropod neck, new pose, straightened back, lost hump,
lost neck dip, muzzle up, level muzzle, new framing, different background,
different light, crest down the spine, cartoon, 3D render, text, watermark.
`.trim();

/** Terzo delta. Testa e collo si contendono lo stesso spazio: chiedendo la testa
 *  enorme il collo e' rientrato nelle spalle, chiedendo il collo lungo la testa
 *  si era rimpicciolita. Si tiene ferma la testa appena ottenuta e si allunga
 *  solo il collo: un asse per passata, o il generatore ricade sul suo prior
 *  (testa grossa = geco accovacciato, collo lungo = dinosauro). */
const PROMPT_COLLO = `
The first image is a photograph of the animal. The second is its character
reference sheet.

The head in the photograph is correct: keep it exactly as it is, the same size,
the same wide flat blunt shape, the same enormous eye. Keep the forest, the
light, the camera angle, the framing, the colours, the feet, the hump of the
back, the low hips and the raised curling tail exactly as they are. Keep the
centre line of the spine bare, fringe scales only along the outer side edges.

Change ONE thing: THE NECK IS FAR TOO SHORT. Right now that huge head sits almost
straight on the shoulders. Lengthen the neck a great deal, so the head is carried
high and well FORWARD of the shoulders, with a long span of neck between them.
The neck stays thick and muscular along its whole length, never a thin stalk.

As the neck lengthens it must take the shape of the drawing it came from: it
RISES from the shoulders, then DIPS in a pronounced U, and the head at the end of
it HOOKS DOWNWARD, the blunt snout pointing down towards the ground like the
crook of a walking stick. Head high and hooked down, neck long and dipping: the
topline of the whole animal reads as a W.

It stays the same photograph: same forest, same light, real animal, natural
grain.

Negative: short neck, head on the shoulders, thin neck, sauropod neck, smaller
head, narrow head, pointed muzzle, small eye, muzzle level, muzzle pointing up,
straight neck, lost hump, flattened back, new framing, different background,
different light, crest down the spine, cartoon, 3D render, text, watermark.
`.trim();

const PROMPT = COLLO ? PROMPT_COLLO : TESTA ? PROMPT_TESTA : PROMPT_W;
const RIF = TESTA || COLLO ? CHARACTER : SCHIZZO;
const RICETTA = COLLO ? "collo-lungo" : TESTA ? "fisionomia-testa-collo" : "posa-w-marcata";

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
      console.log(`[fix] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[fix] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
