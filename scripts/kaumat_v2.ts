/**
 * Il Kaumat come e' stato chiesto davvero, sulla reference vera.
 *
 * Fin qui la reference era il turnaround generato in Darkroom, che era gia' una
 * interpretazione. La reference vera e' la creatura di un video, e da quella
 * sessione jcode arrivano tutte le richieste che si erano perse per strada. Qui
 * ci sono tutte, una per riga, cosi' si vede subito quale manca:
 *
 *   - poggiato a TERRA, su QUATTRO zampe (non su due, non su un albero);
 *   - fattezze di geco ma NON la sua postura ne' le sue proporzioni;
 *   - muso LARGO come la mascella di un geco, ma DRACONICO e alieno;
 *   - mani PALMATE, senza punte;
 *   - molto definito muscolarmente, braccia articolate come un geco;
 *   - grande e pesante;
 *   - dettagli in rilievo PIATTI che COPRONO la superficie, mai appuntiti;
 *   - corpo bilanciato orizzontalmente, tutto a curva, a S;
 *   - piante davanti, come ripreso da lontano;
 *   - natura intorno non banale;
 *   - verticale.
 *
 * Usage: bun run scripts/kaumat_v2.ts [--n 1]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const PID = "kaumat";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const REFS = [`${R}/video-reference-posa.png`, `${R}/video-reference-dettagli.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);

const PROMPT = `
The two attached images are frames of the SAME creature, from a film. They are
the reference for everything: build, materials, colours, surface, and above all
the line of the neck. Study them and make a new photograph of that same animal.

THE NECK, the thing that defines it: it is a Loch Ness curve. From the shoulders
the neck rises UP AND BACKWARDS, leaning back over the body, then arches forward
at the top and comes DOWN AND FORWARD, so the head ends up hanging forward and
low, well ahead of the shoulders, muzzle pointing down. Seen in profile the neck
is a tall backward-leaning question mark. The neck is long and thick and heavily
muscled along its whole length, never a thin stalk.

SURFACE, the detail that keeps getting lost: the neck and the shoulders are
armoured in large, FLAT, overlapping cream-white plates, like broad soft
fingernails laid side by side, COVERING the surface in continuous rows, never
spikes, never points, never a crest of thorns. Scattered chalk-white flecks and
small white markings spray across the shoulders, the flank and the hip. Every
raised detail on this animal is FLAT AND BROAD and lies against the body.

HEAD: a glossy amber-orange keratin casque lies over the skull, flat, fanned and
finely ribbed like a scallop shell, its rim translucent, exactly the shape and
colour in the reference. The jaw is WIDE, as wide as a gecko's, and the face is
draconic and alien, never cute, never a lizard's narrow snout. A large round eye
with a vertical slit pupil.

BODY: teal and pale mint hide going to powder blue, iridescent, with a fine
granular skin texture. Heavily muscled, massive, HEAVY: the size of a bull, four
metres. It stands ON ALL FOUR LEGS ON THE GROUND, never on two, never on a tree.
The forelimbs are articulated like a gecko's, elbows crooked out and back. The
hands and feet are WEBBED PADDLES, the five digits clearly visible as divided
rays inside the webbing, with rounded tips and no claws and no points.

The whole body is balanced HORIZONTALLY and reads as one long S curve: the neck
rising and hooking forward at one end, the back arching, the long thick tail
sweeping out behind and lying along the ground, dark indigo with a burnt
orange-red stripe down its side, as in the reference.

FRAMING: vertical 9:16, 1080x1920. Shot from far away with a long lens, through
the forest: big out-of-focus leaves, fern fronds and a dark branch crowd the
foreground and the edges, the animal glimpsed through the gap between them, so it
reads as stolen footage of a real animal that does not know it is being watched.

SETTING: the floor of a dark primeval forest, wet leaf litter, moss, buttressed
trunks and tree ferns, nothing ordinary or garden-like about it. A moss-covered
fallen trunk a metre thick lies behind it and the arch of its back rises above
the trunk; tree ferns that would tower over a person reach only its shoulder.

LIGHT: near darkness, one hard blade of afternoon sun raking across the arched
neck and lighting the edges of the plates. No fill light.

STYLE: BBC natural-history documentary frame, Prehistoric Planet grade.
Photographic, real lens, true texture, film grain. Not illustrated.

Negative: spikes, thorns, pointed scales, raised crest of spines, a ridge down
the middle of the back, standing on two legs, bipedal, climbing a tree, perched
on a branch, cute face, narrow lizard snout, small head, thin neck, straight
neck, neck leaning forward from the base, short neck, claws, separated clawed
toes, hidden toes, smooth featureless paddle, slender build, light build,
small pet-sized animal, garden plants, tidy vegetation, bright daylight, visible
sky, clear unobstructed view, cartoon, videogame render, concept art, 3D render,
text, watermark, people, fur.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  const photoId = "kaumat-v2";
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [photoId, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, photoId);
  mkdirSync(dir, { recursive: true });

  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "kaumat-da-video", refs: REFS.map((r) => r.split("/").pop()) });
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
        [photoId, n, out, PROMPT, cfg, JSON.stringify({ recipe: "kaumat-da-video", refs: REFS.map((r) => r.split("/").pop()), backend: "codex-http" }), Date.now()],
      );
      scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
      db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
      db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), photoId]);
      console.log(`[v2] v${n} ok in ${secs}s → ${out}`);
    } else {
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), res.error ?? "?", job.id]);
      console.error(`[v2] v${n} FALLITA in ${secs}s: ${res.error}`);
    }
  }
});
