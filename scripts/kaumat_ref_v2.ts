/**
 * Reference sheet v2 del Kaumat: la v1 aveva i piedi a paletta palmata e un
 * corpo troppo "lucertola di plastica". Qui cambiano tre cose, e solo quelle:
 *
 *   - DITA: lunghe, separate, da geco vero, con le lamelle sotto i polpastrelli.
 *     Nella v1 erano scritte palmate NEL prompt, quindi non era un errore del
 *     modello: era il disegno a essere sbagliato.
 *   - CORPO: la S deve esserci gia' nella reference, non solo nelle scene. Se la
 *     turnaround e' rigida, ogni scena che la copia riparte da rigida.
 *   - ALIENO: la v1 leggeva come un geco colorato. Serve materia che in natura
 *     non esiste (cheratina translucida, vene luminescenti, papille sensoriali),
 *     restando dentro la fotografia naturalistica.
 *
 * Usage: bun run scripts/kaumat_ref_v2.ts [--n 2]
 */
import { mkdirSync } from "node:fs";
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
const N = Number(arg("--n") ?? 2);

const PROMPT = `
Creature reference sheet, studio turnaround of ONE single animal, on a neutral
grey background.

Subject: "Kaumat", a massive unknown quadruped animal, 3 to 4 metres long, the
mass of a bull. Colossal head one third of body length, extremely wide and flat,
far wider than tall, a broad triangular wedge widest at the jaw hinge narrowing
to a short blunt rounded snout, exactly a crested gecko's head. Huge wide jaw
line curving up into a fixed gentle smile running back to the ear opening, no
lips. Two enormous round lidless eyes, each nearly as wide as the snout, set far
apart at the outer corners of the skull, glossy black with a thin burning amber
ring and a vertical slit pupil.

HANDS AND FEET, the most important thing in this sheet: exactly a gecko's, at the
scale of a bear. FIVE LONG SEPARATE SPLAYED DIGITS on each foot, clearly divided
all the way down to the base, each one a distinct finger with two visible
knuckles, fanned out wide like a starfish and gripping the ground. Broad round
adhesive pads at the tip of every digit, and underneath each pad the fine
parallel ridges of gecko lamellae, clearly drawn. Thin translucent skin webbing
only between the bases of the digits, never a paddle, never a mitten, never a
continuous sheet, never a hoof. One foot is shown in a separate detail view from
below, digits splayed, so the lamellae under every pad can be counted.

POSE, the second most important thing: the body carries a deep S-curve even
standing still. In the side view the neck drops forward and down in a long curve,
the back arches up into a tall rounded dome over the middle of the spine, the
hips sit low, and the thick tail sweeps out and down and curls up at the tip. The
topline goes down, up, down, up: nowhere is it a straight horizontal line.

ALIEN MATERIAL, what must not look like an ordinary lizard: the amber-orange
keratin casque over the skull is semi-translucent like wet resin, light passing
through its thin rim, coral pink at the base, with a faint internal crystalline
structure visible under the surface. The powder-blue and pale mint hide is
covered in fine granular velvet scales, and between them run thin branching veins
of pale cyan bioluminescence, dim, like the glow under a deep-sea skin, strongest
in the loose folds of the throat and at the hip. Rows of small soft sensory
papillae, translucent and bead-like, ring the eye sockets and the jaw line.
Iridescent emerald-teal at the throat and shoulders, chalk-white flecks on the
hips, deep indigo tail banded with a burnt orange-red stripe. Heavy slabs of
shoulder and haunch muscle, tendons and veins under a taut hide.

Two cream-white rows of small soft fleshy triangular fringe scales run along the
two OUTER SIDE EDGES of the back, one row down each flank edge, starting above
each eye and fading at the hip. The centre line of the spine is completely bare.

Forelimbs jointed like a gecko's, elbow crooked out and back, front legs shorter
than the hind. Tail as thick as the torso at the hips, tapering to a coiled tip.

LAYOUT: full body turnaround of THE SAME ANIMAL shown four times in a row, left
to right: side profile, three-quarter, front, and from above. Plus one detail
view of the underside of a front foot. Even lighting, plain grey backdrop.

STYLE: photographic creature design for a natural-history film, real animal
anatomy, true skin texture, photoreal. Not illustrated.

Negative: webbed paddle feet, mitten feet, fused toes, hidden toes, hoof, flipper,
claws, straight flat back, level topline, rigid pose, cartoon, videogame render,
concept art, text, watermark, people, fur, two different animals.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const photoId = "kaumat-master-v2";
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [photoId, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, photoId);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "reference-sheet-v2" });
    const job = enqueueJob(photoId, PROMPT, cfg, "chatgpt", null, "generate", null, null, null, "codex-http", null);
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(photoId);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 15000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [], prompt: PROMPT, output: out });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status === "ok") {
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [photoId, n, out, PROMPT, cfg, JSON.stringify({ recipe: "reference-sheet-v2", backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [], []);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), photoId]);
      console.log(`[ref-v2] variante ${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[ref-v2] variante ${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
