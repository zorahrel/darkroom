/**
 * Variant generator for a darkroom project, with a reference attached.
 *
 * It deliberately does not use startRunner(): that runner picks up the pendings
 * of ALL projects, and right now Japan has some queued that were stopped on
 * purpose. Here only the requested project is worked, in sequence, and it stops
 * by itself after N consecutive failures instead of grinding through the quota
 * for nothing.
 *
 * Usage: bun run scripts/gen_variants.ts <projectId> [--variants a,b,c] [--limit N]
 */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";
import { runWorker } from "../server/worker.ts";

const pid = process.argv[2] ?? "profilo";
/** Chosen at runtime: it depends on which references were actually
 *  attached, not on how the folder is arranged. */
const PACE = Number(process.env.DARKROOM_PACE ?? 20);
let hasStyleRef = false;
let nRefs = 0;
let together = false;
/** The NAME of the preamble in use. It is needed in the tree: two passes with
 *  the same recipe but different instructions are two experiments, and with no
 *  name they end up under the same label precisely where the comparison
 *  matters. */
const ROLES_NAME = () =>
  together ? (hasStyleRef ? "insieme+stile" : "insieme") : !hasStyleRef ? "solo-id" : nRefs > 1 ? "id+stile" : "solo-stile";
const ROLES = () =>
  together
    ? ROLES_MULTI_SOURCE + (hasStyleRef ? "One further image is attached as a styling reference only: never copy that face, take from it lighting, tonality, framing and treatment. " : "")
    : !hasStyleRef
      ? ROLES_ID_ONLY
      : nRefs > 1
        ? ROLES_MIXED
        : ROLES_STYLE_ONLY;
const has = (k: string) => process.argv.includes(k);
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg("--limit") ?? 0);
/** --together: one job per recipe, with ALL the photos attached together. */
const TOGETHER = has("--together");
/** --no-refs: no attachments beyond the sources. Needed when the photos
 *  are enough on their own: a style image of ANOTHER person, attached to a
 *  portrait, is one more face the model can average in. */
const NO_REFS = has("--no-refs");
/** --channel cdp uses ChatGPT's web surface instead of the Codex endpoint.
 *  It is not a fallback: they are two distinct quota buckets, and when one is
 *  exhausted the other can be open (verified 25/08: codex 429, web fine).
 *  The web accepts a single "primary" source, so the others travel as
 *  attachments in the same request -- the preamble says they are all me. */
const CHANNEL = (arg("--channel") ?? "codex").toLowerCase();
const rounds = Number(arg("--rounds") ?? 1);
const only = arg("--variants")?.split(",").map((s) => s.trim()).filter(Boolean);

/** The recipes. All of them cite the attached reference: that is what holds
 *  the variants together, instead of nine photos each retouched its own way. */
/** Common preamble. The attached references do not have the same role: the
 *  colour ones are other photos of the same person (identity), the black and
 *  white one is of another subject and serves only as a model of light and
 *  framing. Without saying so, the model averages the faces and returns a
 *  person who does not exist. */
const ROLES_MIXED =
  "The attached images have two different roles. The COLOUR photos are other photographs of me: use them only to keep my face, bone structure and identity consistent — that is who the person in the result must be. The BLACK AND WHITE photo is a different person: never copy that face, take from it only the lighting, mood, framing and treatment. ";

/** When the references are ALL photos of the person, there is no role to
 *  distinguish: saying "the black and white one is another subject" when that
 *  file is not attached only confuses. The style, in that case, is already
 *  written out in full in the recipe. */
const ROLES_ID_ONLY =
  "The attached images are reference photographs of me that I like. Match them on BOTH counts: keep my face, bone structure and identity exactly as they show it, AND follow their visual language \u2014 the lighting, the tonality, the framing, the way the skin and hair are rendered. The result should look like it belongs in the same set as the attached references. "

/** A single reference, and it is one of STYLE: the face must stay the one in
 *  the source photo. Without saying so, the model takes the face from the
 *  reference too — and that is another person. */
const ROLES_STYLE_ONLY =
  "The attached image is a photograph of a DIFFERENT person, attached only as a styling reference. Never copy that face. Take from it the lighting, tonality, framing and treatment. The face, bone structure and identity must remain exactly those of the photo being edited. ";

/** Several shots as a single input (GEN-01). It has to be said that they are
 *  the same person: without that, the model can read them as different people
 *  and average the faces. */
const ROLES_MULTI_SOURCE =
  "The attached photographs are all of ME, the same person in different shots and lighting. Use all of them together as material: take my face and identity from them, and produce ONE new portrait. ";

const RECIPES: { key: string; body: string }[] = [
  {
    key: "bw-hard",
    body:
      "Produce a black and white editorial portrait of me: single hard directional key light from the side, deep contrast, clean white background, tight head-and-shoulders crop. Keep my face, bone structure and identity exactly as in the source photographs - do not change my features. Sharp skin texture, visible pores and stubble, no beauty smoothing, no makeup look.",
  },
  {
    key: "bw-soft",
    body:
      "Produce a black and white portrait of me with a soft large-source light from the front-left and a gentle falloff on the background. Monochrome, clean framing. Keep my face and identity exactly as in the source photographs. Natural skin texture, no retouching of features.",
  },
  {
    key: "square-profile",
    body:
      "Produce a square 1:1 profile picture of me: hard directional key light, clean uncluttered background, head centred with a little headroom, shoulders visible. Black and white. Keep my face, bone structure and identity exactly as in the source photographs. Natural skin texture, no beauty smoothing. Composition must read well when displayed small and circular-cropped.",
  },
  {
    key: "bw-grain",
    body:
      "Produce a black and white portrait of me with the texture of pushed 35mm film: visible grain, deep blacks, slightly lifted highlights, a touch of contrast. Tight framing, directional light. Keep my face and identity exactly as in the source photographs. No smoothing; grain must sit over skin texture rather than replace it.",
  },
  {
    key: "color-editorial",
    body:
      "Produce a colour editorial portrait of me: hard directional key light, clean neutral background, tight crop. Natural skin tones, muted desaturated palette. Keep my face and identity exactly as in the source photographs. Crisp detail, no smoothing.",
  },
];

withProject(pid, async () => {
  initSchema();
  const d = dirsFor(pid);
  const refDir = join(d.DATA_DIR, "refs");
  // Which references to attach is not always "all the ones in the folder": the
  // folder holds both photos of the person (identity) and style images, and
  // mixing them is not neutral. --refs chooses by name.
  const wanted = arg("--refs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const all = existsSync(refDir)
    ? readdirSync(refDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    : [];
  const missing = (wanted ?? []).filter((w) => !all.includes(w));
  if (missing.length) { console.error(`[gen] reference inesistenti: ${missing.join(", ")} (in ${refDir} ci sono: ${all.join(", ")})`); process.exit(1); }
  const refs = NO_REFS ? [] : (wanted ?? all).map((f) => join(refDir, f));
  if (!refs.length && !NO_REFS) console.warn("[gen] nessun reference in data/refs: le varianti non saranno coerenti fra loro");

  const photos = db()
    .query<{ id: string; original_path: string }, []>("SELECT id, original_path FROM photos ORDER BY id")
    .all();
  hasStyleRef = refs.some((r) => /style|stile/i.test(r));
  nRefs = refs.length;
  const recipes = only ? RECIPES.filter((r) => only.includes(r.key)) : RECIPES;
  const targets = limit > 0 ? photos.slice(0, limit) : photos;
  console.log(`[gen] canale=${CHANNEL} progetto=${pid} ${TOGETHER ? `INSIEME ${targets.length} sorgenti x${Math.max(1, rounds)} giri` : `foto=${targets.length}`} ricette=${recipes.map((r) => r.key).join(",")} refs=${refs.length}`);

  together = TOGETHER;
  // With --together the outer loop is no longer "one photo at a time": there is
  // a single set of sources, and it loops over the recipes (`--rounds` times, to
  // get several variants of the same recipe instead of just one).
  const units: { label: string; photoId: string; sources: string[] }[] = TOGETHER
    ? Array.from({ length: Math.max(1, rounds) }, (_, r) => ({
        label: `insieme g${r + 1}`,
        // The version is appended to the FIRST photo: the schema has only one
        // photo_id. The real sources all stay in lineage, which is the only
        // place where the information that there were three is not lost.
        photoId: targets[0]!.id,
        sources: targets.map((t) => t.original_path),
      }))
    : targets.map((t) => ({ label: t.id, photoId: t.id, sources: [t.original_path] }));

  let ok = 0, ko = 0, streak = 0;
  let quotaResetsAt: number | null = null;
  for (const unit of units) {
    for (const recipe of recipes) {
      if (streak >= 4) { console.error("[gen] 4 fallimenti di fila: mi fermo, non è un caso"); process.exit(1); }
      if (quotaResetsAt) {
        // The quota wall is not a failure to retry: insisting burns time and does
        // not move the reopening hour. Better to stop saying WHEN, so you pick
        // it up again instead of guessing.
        const when = new Date(quotaResetsAt * 1000).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
        console.error(`[gen] quota ChatGPT esaurita, riapre alle ${when}. Mi fermo qui.`);
        process.exit(2);
      }
      // The reference set must be recorded with the variant: two passes made with
      // different references are not comparable, and with no label on the strip
      // they look like just two attempts at the same thing.
      // The label has to tell different sets apart: "id+stile" with three
      // references and "id+stile" with four are different experiments, and
      // calling them the same makes the comparison impossible exactly where it
      // is needed.
      // Counting the references is not enough: two passes with the SAME files
      // but different instructions produce different things, and on the strip
      // they would end up under the same label. "id+look" is the preamble that
      // asks to follow the references' appearance too, not only the identity.
      const refset = TOGETHER
        ? `${unit.sources.length} sorgenti insieme${refs.length ? (hasStyleRef ? " + stile" : " + rif") : ""}`
        : `${refs.length} rif: ${hasStyleRef ? (refs.length > 1 ? "id+stile" : "stile") : "id+look"}`;
      const cfg = JSON.stringify({
        recipe: recipe.key,
        refset,
        refs: refs.map((r) => r.split("/").pop()),
        sources: unit.sources.map((r) => r.split("/").pop()),
      });
      const prompt = ROLES() + recipe.body;
      const job = enqueueJob(unit.photoId, prompt, cfg, "chatgpt", null, "edit", null, JSON.stringify(refs));
      db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
      const n = nextVersionNumber(unit.photoId);
      const dir = join(d.GEN_DIR, unit.photoId);
      mkdirSync(dir, { recursive: true });
      // The file name follows darkroom's convention (vNN.png): the interface
      // rebuilds it from the version number, it does not read it from the
      // database, so a "more descriptive" name makes the image unreachable from
      // the UI. The recipe is already saved in the version's config: it is not
      // needed in the name.
      const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
      // A pause between one job and the next: without it the site rate-limits and
      // stops generating altogether (measured 25/08, 9 jobs lost). Better 20
      // seconds than a whole pass thrown away.
      if (ok + ko > 0 && PACE > 0) await new Promise((r) => setTimeout(r, PACE * 1000));
      const t0 = Date.now();
      const res =
        CHANNEL === "cdp"
          ? await runWorker({
              image: unit.sources[0]!,
              prompt,
              output: out,
              refs: [...unit.sources.slice(1), ...refs],
            })
          : await runWorkerCodexHttp({ images: unit.sources, prompt, output: out, refs });
      if (res.status === "ok") {
        // config and lineage are NOT the same data: config is what was asked for,
        // lineage is what the variant was born from. The tree reads lineage,
        // and with --together it is the only place where it stays written that
        // there were three sources: the schema has a single photo_id, so
        // without this field two of the three would disappear.
        const lineage = JSON.stringify({
          recipe: recipe.key,
          refset,
          preamble: ROLES_NAME(),
          sources: unit.sources.map((r) => r.split("/").pop()),
          refs: refs.map((r) => r.split("/").pop()),
          backend: CHANNEL === "cdp" ? "web-cdp" : "codex-http",
        });
        const ins = db().run(
          `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, provider_params, credits, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', NULL, 0, 'generated', ?)`,
          [unit.photoId, n, out, prompt, cfg, lineage, Date.now()],
        );
        db().run("UPDATE jobs SET status='done', result_version_id=?, finished_at=? WHERE id=?", [Number(ins.lastInsertRowid), Date.now(), job.id]);
        ok++; streak = 0;
        console.log(`  ok  ${unit.label.slice(0, 14)} ${recipe.key} — ${res.size_kb}KB ${res.duration_s.toFixed(0)}s`);
      } else {
        db().run("UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=?", [String(res.error).slice(0, 500), Date.now(), job.id]);
        ko++; streak++;
        // The site's throttle is not a failure to retry: insisting prolongs it. It
        // stops asking you to wait, as for the quota.
        if (String(res.error).includes("chatgpt-throttled")) {
          console.error(`[gen] ChatGPT ha limitato l'accesso per troppe richieste. Mi fermo: riprendere fra qualche minuto, piu' lenti (DARKROOM_PACE).`);
          console.log(`[gen] fatte ${ok}, fallite ${ko}`);
          process.exit(3);
        }
        const m = /"resets_at":(\d+)/.exec(String(res.error));
        if (m) quotaResetsAt = Number(m[1]);
        console.log(`  KO  ${unit.label.slice(0, 14)} ${recipe.key} — ${String(res.error).slice(0, 120)}`);
      }
    }
  }
  console.log(`[gen] fatte ${ok}, fallite ${ko}`);
});
