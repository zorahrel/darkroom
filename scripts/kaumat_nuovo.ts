/**
 * Il Kaumat generato DA ZERO, con tutta la lista di Attilio in un prompt solo.
 *
 * Perche' non un'altra modifica: diciassette passate in catena sulla C19 hanno
 * portato ogni pezzo a bersaglio, ma l'immagine ne porta i segni (Attilio: «mi
 * sembra fake»). Qui la v17 entra solo come riferimento di ANATOMIA e il geco di
 * Attilio solo come riferimento di COLORE: la foto e' nuova, e la lista delle
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
/** Ordine = ruolo, e il prompt lo dichiara: prima l'anatomia, poi il colore. */
const REFS = [`${G}/kaumat-c19/v17.png`, `${R}/geco-attilio.png`, `${R}/guida-zanne-v14.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);

const PROMPT = `
Create a NEW photograph. Three images are attached and they play different roles:
- the FIRST is the ANATOMY reference: the creature's body plan, head, horns,
  limbs and pose come from it. Do not copy its colours, its lighting or the
  photograph itself: this is a new shot of the same animal.
- the SECOND is a photo of a real crested gecko, attached ONLY for its COLOURS.
  Do not copy its shape, its size or its surroundings.
- the THIRD is a HORN PLACEMENT guide: the two RED shapes drawn on it mark
  exactly where the horns grow and which way they point. Use it only for that;
  its horns will be ivory, not red, and nothing else of it is copied.

THE ANIMAL, "Kaumat": a massive unknown creature, four metres long, the weight of
a bull. It has the features of a crested gecko but NOT its posture or
proportions.

- HEAD: BIG and HEAVY, as large as a bull's head, clearly wider than the neck:
  a crested gecko's head at this scale, WIDE and FLAT, broad at the jaw hinge, a short blunt rounded snout, the wide jaw line curving up into a fixed
  gentle smile. An ENORMOUS round lidless eye, glossy dark with an amber ring and
  a vertical slit pupil. Draconic and alien, serious, never cute.
- HORNS: exactly where the RED shapes are in the third image. A left-and-right
  PAIR of smooth ivory dragon horns growing from the REAR CORNERS of the skull,
  well BEHIND the eye, where the head meets the neck; nothing on top of the
  snout, nothing above the eye. They sweep UP AND BACK, curving slightly
  backwards along the line of the neck, like a dragon's. Thick at the base,
  tapering to a point, as long as the head is tall.
- NECK: a Loch Ness curve. It rises from the shoulders UP AND BACKWARDS, arches
  over and comes FORWARD AND DOWN, so the head hangs low in front of the chest
  with the snout tilted DOWN towards the ground, never held level.
- BODY: MASSIVE and heavy, a big-cat build scaled up to a bull: thick slabs of
  muscle on the shoulders and thighs, athletic and powerful, never a barrel,
  never a rhinoceros, never a thin lizard. The
  whole body follows the curve of the spine in one flowing S: the back arches
  up into a high rounded hump in the middle, the belly is drawn up tight, the
  hips sit low.
- LIMBS: long, big and HEAVILY MUSCLED, as thick as tree trunks at the upper arm
  and thigh, bent and curved at every joint like a
  crouching predator, standing ON ALL FOUR LEGS ON THE GROUND.
- HANDS AND FEET: very large and long, FIVE LONG SEPARATE gecko toes on each, each
  ending in a broad round adhesive pad, splayed on the forest floor. No claws, no
  webbing between the toes, never fused into a paddle.
- TAIL: thick at the base, lifted off the ground and sweeping in its own S,
  curling at the tip.
- SURFACE: every raised detail is FLAT and lies against the body, covering it,
  with ROUNDED edges like overlapping roof shingles; no pointed tips, no jagged
  or serrated edges, no spikes, no thorns, no crest down the middle of the spine. A THICK RUFF of
  soft layered cream FEATHERS hanging from the throat and the front of the neck,
  clearly visible, small soft
  white feather tufts scattered over the nape and shoulders, fine granular
  scales everywhere else, and a row of soft cream fringe scales along each OUTER
  EDGE of the back, like the gecko's.

COLOURS, from the second image: the animal is mostly the gecko's CREAMY PALE
YELLOW and SOFT OCHRE-TAN. The back and the two fringe rows along its edges are
pale cream-yellow like the gecko's dorsal pinstripe, with a sprinkle of small
ORANGE-RED DOTS along the back exactly like the gecko's; the flanks, limbs and
tail are warm tan and ochre, paler on the underside. Only small accents of
anything else: a rust-orange blush on the face, a faint trace of teal
iridescence at the throat. It must clearly read as the colours of that gecko.

THE SHOT, and every part of it matters:
- It stands on the floor of a dark primeval forest: wet leaf litter, moss,
  buttressed trunks, tree ferns, hanging vines, nothing tidy or garden-like.
- FOREGROUND LEAVES: large out-of-focus leaves, fern fronds and a dark branch
  crowd the foreground and cover the top, bottom and side edges of the frame,
  partly crossing in front of the animal, which is glimpsed through a gap in
  the leaves. Foreground nearly black, only the animal sharp.
- Filmed from far away with a long telephoto lens, from behind cover: stolen
  wildlife footage of an animal that does not know it is being watched.
- Near darkness, one hard blade of afternoon sun raking across the arched back,
  the neck and the horns. No fill light.
- Scale: a moss-covered fallen trunk a metre thick lies behind it and its back
  rises above it; tree ferns that would tower over a person reach its shoulder.

STYLE: a BBC natural-history documentary frame, Prehistoric Planet grade. A real
photograph: real lens, true skin texture, natural film grain. Never CGI, never a
3D render, never an illustration.

Vertical 9:16, 1080x1920.

Negative: small head, head held level, thin skinny body, thin limbs, jagged
pointed scales, serrated back, teal or blue body, grey body, barrel body, rhinoceros, short legs,
small feet, webbed or fused toes, claws, spikes, thorns, crest down the spine,
narrow head, snake head, beak, goat horns, horns above the eye, horns on the
forehead, horns pointing forward, red horns, straight neck,
bipedal, climbing a tree, clean empty foreground, clear unobstructed view,
posed portrait, bright daylight, visible sky, small pet-sized animal, cartoon,
concept art, 3D render, text, watermark, people.
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
  names[0] = "kaumat-c19-v17.png";

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
