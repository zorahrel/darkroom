/**
 * Rifinitura degli shot del reel PARTENDO DALLA FINAL, non da zero.
 *
 * Perche' in edit e non una nuova generazione: la composizione, la luce e la
 * scala delle sette final sono gia' quelle giuste, e rigenerandole si perdono.
 * Qui l'immagine finale e' la sorgente, la reference v2 dice com'e' fatto
 * l'animale, e il prompt chiede di cambiare SOLO l'anatomia.
 *
 * Tre correzioni, tutte nate guardando le final:
 *   - dita fuse a paletta → dita lunghe e separate da geco, con le lamelle;
 *   - schiena piatta → la S profonda del collo e la cupola del dorso;
 *   - pelle da lucertola colorata → materia aliena (cheratina translucida,
 *     vene bioluminescenti, papille sensoriali).
 *
 * Usage: bun run scripts/kaumat_rifinitura.ts [--only 01_radura,04_occhio] [--pace 15]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const REF = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs/kaumat-master-v2.png";
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PACE = Number(arg("--pace") ?? 15);
const ONLY = (arg("--only") ?? "").split(",").filter(Boolean);

/** Cosa NON si tocca, detto per primo: e' la ragione per cui si parte dalla
 *  final invece di rigenerare. */
const TIENI = `
The first image is a finished photograph. Keep its composition, its framing, its
camera angle, its lighting direction, its background, its colour grade and its
scale relationships EXACTLY as they are. Do not reframe, do not zoom, do not move
the animal, do not change the time of day. The output must look like the same
photograph, same shot, same second.
`.trim();

/** Le tre correzioni. Si dicono come differenze rispetto a cio' che c'e' nella
 *  foto, non come descrizione dell'animale: e' l'unico modo perche' il modello
 *  capisca cosa deve CAMBIARE. */
const CAMBIA = `
The second image is the character reference for this animal. Redraw the animal in
the photograph so that its anatomy and its materials match that reference, and
change nothing else in the frame.

1. FEET, the most visible error to fix: in the photograph the toes are fused into
a smooth paddle or a mitten. They must become a gecko's: FIVE LONG SEPARATE
SPLAYED DIGITS on every foot, divided all the way down to the base, each with a
broad round adhesive pad at the tip and the fine parallel lamellae ridges under
each pad, exactly as in the reference. Thin skin webbing only between the bases
of the digits. Wherever a foot is visible, the individual toes must be countable.

2. BODY LINE: deepen the S. The neck drops forward and down in a long curve, the
back arches up into a tall rounded dome over the middle of the spine, the hips sit
low, the thick tail sweeps out and down and curls up at the tip. The highest
point of the animal is the middle of its back, never its shoulders and never its
head. No straight horizontal topline anywhere.

3. ALIEN MATERIAL: it must not read as an ordinary colourful lizard. The keratin
casque over the skull is semi-translucent like wet resin, light passing through
its thin rim, with a faint crystalline structure under the surface. Thin branching
veins of dim pale-cyan bioluminescence run between the granular velvet scales,
strongest in the loose throat folds and at the hip. Small translucent bead-like
sensory papillae ring the eye sockets and the jaw line. The crest of fine spines
along the back as in the reference.

Keep it photographic: a real animal on a real lens in that same forest, true skin
texture, natural grain. Never an illustration, never a 3D render, never CGI.

Negative: paddle feet, mitten feet, fused toes, hidden toes, webbed flipper,
straight flat back, level topline, new framing, different background, different
light, cartoon, concept art, text, watermark.
`.trim();

type Shot = { key: string; photoId: string; file: string };
const SHOTS: Shot[] = [
  { key: "01_radura", photoId: "reel_01_radura", file: "01_radura.png" },
  { key: "02_tronco", photoId: "reel_02_tronco", file: "02_tronco.png" },
  { key: "03_gobba", photoId: "reel_03_gobba", file: "03_gobba.png" },
  { key: "04_occhio", photoId: "reel_04_occhio", file: "04_occhio.png" },
  { key: "05_piede", photoId: "reel_05_piede", file: "05_piede.png" },
  { key: "06_sguardo", photoId: "reel_06_sguardo", file: "06_sguardo.png" },
  { key: "07_coda", photoId: "reel_07_coda", file: "07_coda.png" },
];
const FINAL = "/Users/zorahrel/Darkroom/projects/kaumat/data/final/reel";

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  if (!existsSync(REF)) {
    console.error(`[rif] reference assente: ${REF}`);
    process.exit(1);
  }
  const todo = ONLY.length ? SHOTS.filter((s) => ONLY.includes(s.key)) : SHOTS;
  console.log(`[rif] ${todo.length} shot da rifinire sulla final`);

  let ok = 0, ko = 0, streak = 0;
  for (const shot of todo) {
    if (streak >= 3) {
      console.error("[rif] 3 fallimenti di fila: mi fermo");
      process.exit(1);
    }
    const src = join(FINAL, shot.file);
    if (!existsSync(src)) {
      console.error(`[rif] final assente: ${src}`);
      ko++; streak++;
      continue;
    }
    const prompt = `${TIENI}\n\n${CAMBIA}`;
    const cfg = JSON.stringify({ recipe: "rifinitura-anatomia", refs: ["kaumat-master-v2.png"], sources: [shot.file] });
    const job = enqueueJob(
      shot.photoId, prompt, cfg, "chatgpt", null, "edit", src,
      JSON.stringify([REF]), null, "codex-http", JSON.stringify(["kaumat-master-v2.png"]),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);

    const n = nextVersionNumber(shot.photoId);
    const dir = join(d.GEN_DIR, shot.photoId);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);

    if (ok + ko > 0 && PACE > 0) await new Promise((r) => setTimeout(r, PACE * 1000));
    const t0 = Date.now();
    const res = await runWorkerCodexHttp({ images: [src], prompt, output: out, refs: [REF] });
    const secs = Math.round((Date.now() - t0) / 1000);

    if (res.status === "ok") {
      const lineage = JSON.stringify({ recipe: "rifinitura-anatomia", refs: ["kaumat-master-v2.png"], sources: [shot.file], backend: "codex-http" });
      const ins = db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
        [shot.photoId, n, out, prompt, cfg, lineage, Date.now()],
      );
      const versionId = Number(ins.lastInsertRowid);
      scriviIngressiVariante(versionId, [src], [REF]);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), versionId, job.id]);
      ok++; streak = 0;
      console.log(`[rif] ${shot.key} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      ko++; streak++;
      console.error(`[rif] ${shot.key} FALLITO in ${secs}s: ${res.error}`);
    }
  }
  console.log(`[rif] fine: ${ok} ok, ${ko} falliti`);
  if (ko > 0) process.exit(1);
});
