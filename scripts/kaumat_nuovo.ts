/**
 * Il Kaumat generato DA ZERO, con tutta la lista di Attilio in un prompt solo.
 *
 * Perche' non un'altra modifica: diciassette passate in catena sulla C19 hanno
 * portato ogni pezzo a bersaglio, ma l'immagine ne porta i segni (Attilio: «mi
 * sembra fake»). L'anatomia e' scritta nel prompt; riferimenti solo suoi e veri:
 * lo schizzo della posa e il suo geco, per la linea della nuca e qualche accento: la foto e' nuova, e la lista delle
 * richieste e' scritta tutta, voce per voce, cosi' non ne cade nessuna.
 *
 * Usage: bun run scripts/kaumat_nuovo.ts [--n 1]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerOpenBrowserGenerate } from "../server/worker.ts";

const PID = "kaumat";
const PHOTO = "kaumat-nuovo";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const G = "/Users/zorahrel/Darkroom/projects/kaumat/data/generations";
/** Solo foto VERE come riferimento (Attilio, 24/09): una versione generata
 *  riporta dentro i difetti e l'aria finta delle generazioni precedenti.
 *  L'anatomia sta tutta scritta nel prompt. */
const REFS = [`${R}/posa-schizzo.jpg`, `${R}/geco-attilio.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);

const PROMPT = `
Create a NEW photograph. Two images are attached and they play different roles:
- the FIRST is a hand-drawn line: the POSE, seen from the side, the animal
  facing LEFT. The hook on the left is the neck rising up and back then
  falling forward with the head hanging, snout down; the hump in the middle is
  the arched back; the line on the right is the long tail rising and curling.
  Follow that silhouette closely. It is only a line: nothing else of it.
- the SECOND is a photo of a real crested gecko seen from behind, attached ONLY
  as the model for the NAPE LINE and for a few pale accents. The animal must NOT
  look like this gecko: it is an alien creature, far more colourful.
Everything else is described in words.

THE ANIMAL, "Kaumat": a large unknown predator, four metres long, as tall as a horse,
lean and fast. It has the features of a crested gecko but NOT its posture or
proportions.

- HEAD: a crested gecko's face pushed to the EXTREME, as large as a bull's head.
  VERY WIDE, FLAT and triangular seen from above, twice as wide as the neck,
  broadest at the jaw hinge. A short blunt rounded snout and a HUGE wide
  lipline running all the way back past the eye, curving up into the gecko's
  fixed smile. ENORMOUS bulging round lidless eyes, each the size of a fist,
  glossy with a glowing amber-gold iris and a thin vertical slit pupil. Above
  each eye the crested gecko's "eyelash" crest, exaggerated: a soft flat fringe
  of scales lying back along the brow, never spikes. Tiny nostrils. Alien,
  draconic, unsettling, never cute.
- NAPE LINE, exactly like the gecko in the second image seen from behind: the
  back edge of the skull is a straight HORIZONTAL ridge running ACROSS the nape
  from side to side, from behind one eye to behind the other, lined with a row
  of small soft fringe scales, so the head ends in a squared-off, flat-topped
  crown clearly separate from the neck. From the two ends of that line the two
  fringe rows continue down along the outer edges of the back.
- TUSKS, not horns: a pair of long smooth ivory TUSKS growing out of the LOWER
  JAW, one on each side, emerging from under the lips at the back corners of the
  mouth near the jaw hinge. They sweep FORWARD along the sides of the face and
  curve up only at the end, like a boar's or a walrus's, their points aimed
  FORWARD, ahead of the snout, in the direction the animal is looking. Thick
  at the base, tapering to a point. NO horns on top of the skull, nothing on the
  forehead or on the snout.
- NECK: a Loch Ness curve. It rises from the shoulders UP AND BACKWARDS, arches
  over and comes FORWARD AND DOWN, so the head hangs low in front of the chest
  with the snout tilted DOWN towards the ground, never held level.
- BODY: LEAN and AGILE, built for speed: a cheetah's or a greyhound's body
  scaled up to four metres, deep narrow chest, tight waist, the belly drawn up
  high, every muscle long and defined under the skin, never bulky, never heavy,
  never a barrel, never a rhinoceros. The whole body follows the curve of the
  spine in one flowing S: the back arches up into a high rounded hump in the
  middle, the hips sit low.
- LIMBS: long, lean and muscular, lifting the body clear of the ground. It is
  STANDING STILL: ALL FOUR FEET PLANTED FLAT on the forest floor, none raised,
  none mid-step. The legs stand UNDER the body, front legs under the shoulders
  and hind legs under the hips, like a large mammal's, not sprawled out to the
  sides. The weight is BALANCED: the forward reach of the neck and head is
  counterweighted by the long tail behind, and the body sits naturally on its
  four legs.
- HANDS AND FEET: very large and long, FIVE LONG SEPARATE gecko toes on each,
  each ending in a broad round adhesive pad, splayed on the forest floor. No
  claws, no webbing between the toes, never fused into a paddle.
- TAIL: very LONG, longer than the head and body together, thick at the base
  and tapering to a thin tip, lifted off the ground and sweeping in its own
  long S behind the animal, curling at the tip.
- SURFACE: every raised detail is FLAT and lies against the body. Over the back,
  shoulders, flanks and thighs, large FLAT ARMOUR PLATES: smooth polished scutes
  the size of a hand or bigger, irregular and slightly domed, set like
  flagstones into the fine granular skin, each plate a different colour patch
  from the skin around it, so the body is covered in bold PLATES AND BLOTCHES.
  A THICK RUFF of soft layered cream FEATHERS hangs from the throat and the
  front of the neck, small soft white feather tufts on the nape and shoulders,
  and a row of soft fringe scales along each OUTER EDGE of the back, like the
  gecko's. No spikes, no thorns, no pointed or serrated scales, no crest down
  the middle of the spine.

COLOURS, ALIEN: this is NOT a beige gecko. Most of the body, the back, flanks,
shoulders, thighs and tail, is covered in the armour plates, deep indigo,
violet and oxblood, with an oil-slick IRIDESCENT sheen that shifts teal-green
to violet where the sun hits them; between the plates the skin is dark bronze.
The gecko's creamy pale yellow appears ONLY as accents: the dorsal stripe, the
two fringe rows along the back, the feather ruff and the belly, with a few
small orange-red dots along the stripe; the lips, the eyelash crests and
the tip of the tail flush hot orange-red; a line of faint turquoise
bioluminescent spots runs along each flank; the tusks are ivory. Rich,
saturated, strange, but a real animal's skin, never neon paint.

THE SHOT, and every part of it matters:
- It stands on the floor of a dark primeval forest: wet leaf litter, moss,
  buttressed trunks, tree ferns, hanging vines, nothing tidy or garden-like.
- FOREGROUND LEAVES: large out-of-focus leaves, fern fronds and a dark branch
  crowd the foreground and cover the top, bottom and side edges of the frame,
  partly crossing in front of the animal, which is glimpsed through a gap in
  the leaves. Foreground nearly black, only the animal sharp.
- Filmed from far away with a long telephoto lens, from behind cover: stolen
  wildlife footage of an animal that does not know it is being watched.
- The animal is IN the scene, not pasted on it: its feet sink into the wet
  leaf litter and push it aside, soft contact shadows pool under the feet and
  the belly, the same forest haze and dappled light fall on it as on the trees
  at the same distance, and its sharpness falls off with the same depth of
  field as the trunk it stands in front of.
- Near darkness, one hard blade of afternoon sun raking across the arched back,
  the neck and the face. No fill light.
- Scale: a moss-covered fallen trunk a metre thick lies behind it and its back
  rises above it; tree ferns that would tower over a person reach its shoulder.

STYLE: a BBC natural-history documentary frame, Prehistoric Planet grade. A real
photograph: real lens, true skin texture, natural film grain. Never CGI, never a
3D render, never an illustration.

Vertical 9:16, 1080x1920.

Negative: raised leg, leg lifted mid-step, walking, off-balance, leaning,
floating feet, missing ground shadow, cut-out composite, photomontage, bulky heavy body, belly close to the ground, short thick legs,
sprawling lizard legs, mostly beige or cream body, looks like an ordinary gecko, walking
towards the camera, front view, low neck, tusks pointing up or backwards, horns on top of the head, horns behind the eye, goat horns, antlers,
small head, narrow head, small eyes, head held level, jagged pointed scales, serrated back, plain single-colour body, dull
beige body, grey body, barrel body, rhinoceros, short legs, small feet, webbed
or fused toes, claws, short tail, stubby tail, rounded head
without a nape line, spikes, thorns, crest down the spine, snake head, beak,
straight neck, bipedal, climbing a tree, clean empty foreground, clear
unobstructed view, posed portrait, bright daylight, visible sky, small pet-sized
animal, neon, cartoon, concept art, 3D render, text, watermark, people.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  for (const r of REFS) if (!existsSync(r)) throw new Error(`manca il riferimento: ${r}`);
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [PHOTO, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });
  const names = REFS.map((r) => r.split("/").pop()!);

  let ko = 0;
  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "kaumat-da-zero", refs: names });
    const job = enqueueJob(
      PHOTO, PROMPT, cfg, "chatgpt", null, "generate", null,
      JSON.stringify(REFS), null, "openbrowser", JSON.stringify(REFS.map((r) => r.split("/").pop())),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(PHOTO);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 30000));
    const t0 = Date.now();
    const res = await runWorkerOpenBrowserGenerate({ prompt: PROMPT, output: out, refs: REFS });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status !== "ok" || !existsSync(out)) {
      const why = res.status === "ok" ? "file di uscita assente" : res.error;
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), why ?? "?", job.id]);
      console.error(`[nuovo] v${n} FALLITA in ${secs}s: ${why}`);
      ko++;
      continue;
    }
    const ins = db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
      [PHOTO, n, out, PROMPT, cfg, JSON.stringify({ recipe: "kaumat-da-zero", refs: names, backend: "openbrowser" }), Date.now()],
    );
    scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
    db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
    db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), PHOTO]);
    console.log(`[nuovo] v${n} ok in ${secs}s → ${out}`);
  }
  if (ko === N) process.exit(1);
});
