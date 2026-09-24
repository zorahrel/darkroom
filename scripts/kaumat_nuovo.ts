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
const REFS = [`${G}/kaumat-c19/v17.png`, `${R}/geco-attilio.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);

const PROMPT = `
Create a NEW photograph. Two images are attached and they play different roles:
- the FIRST is the ANATOMY reference: the creature's body plan, limbs and pose
  come from it. IGNORE its horns and its head shape, both are described below.
  Do not copy its colours, its lighting or the photograph itself: this is a new
  shot of the same animal.
- the SECOND is a photo of a real crested gecko, attached as the STARTING POINT
  for the colours, pushed further as described below. Do not copy its shape, its
  size or its surroundings.

THE ANIMAL, "Kaumat": a massive unknown creature, four metres long, the weight of
a bull. It has the features of a crested gecko but NOT its posture or
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
  mouth near the jaw hinge and curving UPWARD like a boar's tusks, past the
  cheeks, their tips rising above the level of the eyes behind them. Thick at
  the base, tapering to a point. NO horns on top of the skull, nothing on the
  forehead or on the snout.
- NECK: a Loch Ness curve. It rises from the shoulders UP AND BACKWARDS, arches
  over and comes FORWARD AND DOWN, so the head hangs low in front of the chest
  with the snout tilted DOWN towards the ground, never held level.
- BODY: MASSIVE and heavy, a big-cat build scaled up to a bull: thick slabs of
  muscle on the shoulders and thighs, athletic and powerful, never a barrel,
  never a rhinoceros, never a thin lizard. The whole body follows the curve of
  the spine in one flowing S: the back arches up into a high rounded hump in
  the middle, the belly is drawn up tight, the hips sit low.
- LIMBS: long, big and HEAVILY MUSCLED, as thick as tree trunks at the upper arm
  and thigh, bent and curved at every joint like a crouching predator, standing
  ON ALL FOUR LEGS ON THE GROUND.
- HANDS AND FEET: very large and long, FIVE LONG SEPARATE gecko toes on each,
  all POINTING FORWARD in the direction the animal faces, fanned forward like a
  gripping hand, never splayed sideways or backwards. Each toe ends in a broad
  round adhesive pad with a short curved CLAW at the tip, also pointing
  forward and digging into the forest floor. No webbing between the toes,
  never fused into a paddle.
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

COLOURS, ALIEN but born from that gecko: the base is the gecko's creamy pale
yellow and ochre-tan, with its sprinkle of small ORANGE-RED DOTS along the back.
On top of that, colours no Earth reptile has: the armour plates are deep
indigo, violet and oxblood, with an oil-slick IRIDESCENT sheen that shifts
teal-green to violet where the sun hits them; the lips, the eyelash crests and
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
- Near darkness, one hard blade of afternoon sun raking across the arched back,
  the neck and the face. No fill light.
- Scale: a moss-covered fallen trunk a metre thick lies behind it and its back
  rises above it; tree ferns that would tower over a person reach its shoulder.

STYLE: a BBC natural-history documentary frame, Prehistoric Planet grade. A real
photograph: real lens, true skin texture, natural film grain. Never CGI, never a
3D render, never an illustration.

Vertical 9:16, 1080x1920.

Negative: horns on top of the head, horns behind the eye, goat horns, antlers,
small head, narrow head, small eyes, head held level, thin skinny body, thin
limbs, jagged pointed scales, serrated back, plain single-colour body, dull
beige body, grey body, barrel body, rhinoceros, short legs, small feet, webbed
or fused toes, toes pointing sideways, short tail, stubby tail, rounded head
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
