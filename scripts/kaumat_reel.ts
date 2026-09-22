/**
 * Shot sequence for the Kaumat reel: vertical 9:16 frames of the same creature,
 * generated one by one with the master reference sheet attached.
 *
 * Perche' uno script e non la coda: la route /api/generate-new non accetta
 * riferimenti, e il runner di sistema pesca i pending di TUTTI i progetti.
 * Qui si lavora solo kaumat, in sequenza, e ci si ferma da soli.
 *
 * I due difetti che le tre scene di stanotte hanno mostrato, e che ogni prompt
 * qui prova a chiudere:
 *   - SCALA: dire "3-4 metri" non serve, il modello disegna un geco da terrario.
 *     Serve un oggetto noto NEL frame ("il tronco caduto gli arriva al gomito").
 *   - TOPLINE PIATTA: la gobba da airone e' finita dritta tre volte su tre. Si
 *     chiede solo dove e' il soggetto dello shot, non in tutti.
 *
 * Usage: bun run scripts/kaumat_reel.ts [--only 1,3] [--pace 20]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const REF = "/Users/zorahrel/Darkroom/projects/kaumat/master/kaumat-master.png";
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PACE = Number(arg("--pace") ?? 20);
const ONLY = (arg("--only") ?? "").split(",").filter(Boolean);

/** Comune a ogni shot: lo stile del documentario e le cose che non devono
 *  comparire. Ripetuto in ogni richiesta perche' ogni generazione e' una
 *  conversazione nuova: il modello non ricorda lo shot precedente. */
const LOOK = `
LIGHT & STYLE: BBC natural-history documentary frame, Prehistoric Planet grade.
Deep shadows, one hard directional shaft of afternoon sun through the canopy, no
fill light. Photographic, not illustrated. Real lens, true texture, film grain.

Vertical 9:16, 1080x1920.

Negative: cartoon, videogame render, concept art, CGI look, 3D render, text,
watermark, people, hands, fur, claws, separated toes, fringe along the centre of
the spine, small pet-sized animal, terrarium, captive, studio background, grey
backdrop, turnaround layout, two animals, bright flat daylight, visible sky.
`.trim();

/** La scala e' un problema di CONFRONTO, non di numeri: ogni shot porta il suo
 *  oggetto noto dentro l'inquadratura. */
type Shot = { n: string; id: string; body: string };
const SHOTS: Shot[] = [
  {
    n: "1",
    id: "reel_01_radura",
    body: `
The animal in the reference image, photographed in the wild, seen from across a
clearing on the floor of a dark primeval forest.

SCALE: it is the size of a bull, 4 metres from snout to tail tip. Moss-covered
boulders the size of car engines are scattered around it and it steps over them
without breaking stride. Tree-fern crowns that would tower over a person brush
only its shoulder. Its back is level with the low branches.

FRAMING: wide shot, the animal small in the lower third of the tall frame, the
enormous buttressed trunks and canopy of the forest filling everything above it.
Volumetric shafts of light falling through the mist between the trunks.

CAMERA: 85mm, deep focus, hidden camera position behind a trunk.`,
  },
  {
    n: "2",
    id: "reel_02_tronco",
    body: `
The animal in the reference image, photographed in the wild, walking past a
fallen tree.

SCALE: a fallen trunk lies across the frame behind it, a metre thick, and the
trunk's top edge reaches only to the animal's elbow. Whole ferns disappear under
its flank as it passes. Everything in the frame says this animal weighs as much
as a bull.

VIEW: broadside, filling the width of the frame, walking left to right, wet hide
catching the light.

SETTING: wet leaf litter, moss, stones. On the ground, not climbing.

CAMERA: 135mm, shallow depth of field, slight handheld drift.`,
  },
  {
    n: "3",
    id: "reel_03_gobba",
    body: `
The animal in the reference image, photographed in the wild, in silhouette
against backlit forest mist.

POSTURE, the point of this shot: hunched like a stalking heron. Shoulders pulled
up HIGH, the neck dropping steeply down and forward in a deep curve, the huge
head hanging LOW near the leaf litter, BELOW the level of the elbows. The back
arches up into a tall rounded DOME over the middle of the spine, then slopes down
to low hips. The thick tail sweeps out and down behind with its tip curling up.
The outline goes down, up, down, up. There is no straight line anywhere in the
topline: the highest point of the animal is the middle of its back, not its head
and not its shoulders.

VIEW: strict side-on profile, fully broadside, the whole S-curve of the body dark
against the glowing mist behind it. Rim light only, along the arched back and the
fringe edges.

SCALE: it is the size of a bull, 4 metres from snout to tail tip. A moss-covered
fallen trunk a metre thick lies behind it and its arched back rises above the
trunk. Tree ferns whose crowns would tower over a person reach only its shoulder.
The leaf litter under its head is a carpet of small leaves, tiny against the
head.

CAMERA: 300mm telephoto, heavy compression.

Negative for this shot above all: straight back, flat topline, level spine, head
up, head at shoulder height, standing tall, three-quarter view, front view.`,
  },
  {
    n: "4",
    id: "reel_04_occhio",
    body: `
Extreme close-up of the head of the animal in the reference image, photographed
in the wild.

FRAMING: the eye fills the upper half of the tall vertical frame. Glossy black
sphere with a thin burning amber ring and a vertical slit pupil, the forest
reflected curved in it. The amber-orange keratin casque above, wet, coral pink at
its base, beaded with rainwater.

SCALE: each granular velvet scale reads the size of a fingernail. The raindrops
standing on the casque are the size of grapes. A single fern frond crosses the
foreground, small against the head.

CAMERA: 100mm macro, razor-thin depth of field, only the eye and the casque rim
sharp. Breath fogging faintly in the cold air.`,
  },
  {
    n: "5",
    id: "reel_05_piede",
    body: `
Close-up of one front foot of the animal in the reference image, photographed in
the wild, pressing into wet mud and leaf litter.

The foot is one broad rounded paddle, the five short fingers entirely buried in a
continuous sheet of soft webbing, no claws and no separate toes. Powder-blue hide
with chalk-white flecks, loose skin folds at the wrist.

SCALE: the paddle is wider than a dinner plate. Whole fallen leaves vanish
completely beneath it. The mud squeezes up between the webbing and water floods
into the print as the weight lands.

FRAMING: low angle from ground level, the foot large in the frame, the massive
foreleg and a sliver of the body rising out of focus above it.

CAMERA: 50mm close focus, ground-level rig.`,
  },
  {
    n: "6",
    id: "reel_06_sguardo",
    body: `
The animal in the reference image, photographed in the wild, lifting its head
towards the camera because it has just noticed it.

The huge wide flat head rises out of the undergrowth into the upper half of the
tall frame, both enormous lidless eyes on the lens, the fixed gentle jaw line
unreadable. The neck still curved, the body behind it out of focus and only
half-visible through the leaves. Caught mid-movement, one blade of sun across the
casque.

SCALE: the head alone is as wide as the fern crowns beside it and as long as a
man's arm.

FRAMING: foliage crowding the edges of the frame, the camera peering through a
gap. Foreground nearly black.

CAMERA: 200mm telephoto, shallow depth of field, a stolen frame, slight handheld
drift and motion blur at the jaw.`,
  },
  {
    n: "7",
    id: "reel_07_coda",
    body: `
The animal in the reference image, photographed in the wild, leaving: only the
rear of the body and the tail still in frame as it walks away into the dark.

The thick deep-indigo tail, as thick as the torso at the hips and banded with a
burnt orange-red stripe, sweeps across the frame with its tip curling up. The
hips and hind paddles are still lit by the last blade of sun; the head and
shoulders are already swallowed by the darkness between the trunks.

SCALE: ferns and saplings bend aside as the tail passes over them.

FRAMING: vertical frame, the tail cutting diagonally through it, the forest dark
and empty above.

CAMERA: 135mm, slow shutter, a touch of motion blur on the tail, heavy grain.`,
  },
];

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  if (!existsSync(REF)) {
    console.error(`[kaumat] reference assente: ${REF}`);
    process.exit(1);
  }
  const preambolo = (db().query("SELECT value FROM settings WHERE key='global_prompt'").get() as { value?: string } | null)?.value ?? "";

  const todo = ONLY.length ? SHOTS.filter((s) => ONLY.includes(s.n)) : SHOTS;
  console.log(`[kaumat] ${todo.length} shot da generare, reference ${REF.split("/").pop()}`);

  let ok = 0, ko = 0, streak = 0;
  for (const shot of todo) {
    // Quattro buchi di fila non sono sfortuna: e' la quota o il token, e
    // insistere brucia solo tempo.
    if (streak >= 3) {
      console.error("[kaumat] 3 fallimenti di fila: mi fermo, non e' un caso");
      process.exit(1);
    }
    const prompt = `${preambolo}\n\n${shot.body.trim()}\n\n${LOOK}`;
    const photoId = shot.id;
    db().run(
      `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, scene_label, sequence_index, created_at, updated_at)
       VALUES (?, '', '.png', 'generated', ?, ?, ?, ?)`,
      [photoId, `shot ${shot.n}`, Number(shot.n), Date.now(), Date.now()],
    );
    const cfg = JSON.stringify({ recipe: `reel-shot-${shot.n}`, refs: [REF.split("/").pop()] });
    const job = enqueueJob(
      photoId, prompt, cfg, "chatgpt", null, "generate", null,
      JSON.stringify([REF]), null, "codex-http", JSON.stringify([REF.split("/").pop()]),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);

    const n = nextVersionNumber(photoId);
    const dir = join(d.GEN_DIR, photoId);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);

    // Pausa fra un job e l'altro: senza, il rate limit taglia fuori il resto
    // della passata (misurato 25/08 su Japan, 9 job persi).
    if (ok + ko > 0 && PACE > 0) await new Promise((r) => setTimeout(r, PACE * 1000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [], prompt, output: out, refs: [REF] });
    const secs = Math.round((Date.now() - t0) / 1000);

    if (res.status === "ok") {
      const lineage = JSON.stringify({ recipe: `reel-shot-${shot.n}`, refs: [REF.split("/").pop()], backend: "codex-http" });
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [photoId, n, out, prompt, cfg, lineage, Date.now()],
      );
      const versionId = Number(ins.lastInsertRowid);
      scriviIngressiVariante(versionId, [], [REF]);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), versionId, job.id]);
      db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), photoId]);
      ok++; streak = 0;
      console.log(`[kaumat] shot ${shot.n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      ko++; streak++;
      console.error(`[kaumat] shot ${shot.n} FALLITO in ${secs}s: ${res.error}`);
    }
  }
  console.log(`[kaumat] fine: ${ok} ok, ${ko} falliti`);
  if (ko > 0) process.exit(1);
});
