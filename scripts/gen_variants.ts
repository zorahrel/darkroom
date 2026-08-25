/**
 * Generatore di varianti per un progetto darkroom, con reference allegato.
 *
 * Non usa startRunner() di proposito: quel runner pesca i pending di TUTTI i
 * progetti, e in questo momento Japan ne ha in coda che sono stati fermati
 * apposta. Qui si lavora solo il progetto richiesto, in sequenza, e ci si ferma
 * da soli dopo N fallimenti consecutivi invece di macinare la quota a vuoto.
 *
 * Uso: bun run scripts/gen_variants.ts <projectId> [--variants a,b,c] [--limit N]
 */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { runWorkerCodexHttp } from "../server/worker-codex-http.ts";

const pid = process.argv[2] ?? "profilo";
/** Scelto a runtime: dipende da quali reference sono stati effettivamente
 *  allegati, non da come e' fatta la cartella. */
let hasStyleRef = false;
let nRefs = 0;
const ROLES = () =>
  !hasStyleRef ? ROLES_ID_ONLY : nRefs > 1 ? ROLES_MIXED : ROLES_STYLE_ONLY;
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg("--limit") ?? 0);
const only = arg("--variants")?.split(",").map((s) => s.trim()).filter(Boolean);

/** Le ricette. Tutte citano il reference allegato: è quello che tiene insieme
 *  le varianti fra loro, invece di avere nove foto ritoccate ognuna a modo suo. */
/** Preambolo comune. I reference allegati non hanno lo stesso ruolo: quelli a
 *  colori sono altre foto della stessa persona (identita'), quello in bianco e
 *  nero e' di un altro soggetto e serve solo come modello di luce e taglio.
 *  Senza dirlo, il modello media i volti e restituisce una persona che non
 *  esiste. */
const ROLES_MIXED =
  "The attached images have two different roles. The COLOUR photos are other photographs of me: use them only to keep my face, bone structure and identity consistent — that is who the person in the result must be. The BLACK AND WHITE photo is a different person: never copy that face, take from it only the lighting, mood, framing and treatment. ";

/** Quando i reference sono TUTTI foto della persona, non c'e' nessun ruolo da
 *  distinguere: dire "il bianco e nero e' un altro soggetto" quando quel file
 *  non e' allegato confonde e basta. Lo stile, in quel caso, sta gia' scritto
 *  per esteso nella ricetta. */
const ROLES_ID_ONLY =
  "The attached images are reference photographs of me that I like. Match them on BOTH counts: keep my face, bone structure and identity exactly as they show it, AND follow their visual language \u2014 the lighting, the tonality, the framing, the way the skin and hair are rendered. The result should look like it belongs in the same set as the attached references. "

/** Un solo reference, ed e' di STILE: il volto deve restare quello della foto
 *  sorgente. Senza dirlo, il modello prende anche la faccia dal riferimento —
 *  che e' un'altra persona. */
const ROLES_STYLE_ONLY =
  "The attached image is a photograph of a DIFFERENT person, attached only as a styling reference. Never copy that face. Take from it the lighting, tonality, framing and treatment. The face, bone structure and identity must remain exactly those of the photo being edited. ";

const RECIPES: { key: string; body: string }[] = [
  {
    key: "bw-hard",
    body:
      "Edit this photo of me into a black and white editorial portrait matching the attached reference image: same hard directional key light, same deep contrast with clean white background, same wet-look hair styling, same tight head-and-shoulders crop. Keep my face, bone structure and identity exactly as in the source photo — do not change my features. Sharp skin texture, visible pores and stubble, no beauty smoothing, no makeup look.",
  },
  {
    key: "bw-soft",
    body:
      "Edit this photo of me into a black and white portrait in the style of the attached reference, but with a softer large-source light from the front-left and a gentle falloff on the background. Same monochrome treatment and same clean framing. Keep my face and identity exactly as in the source photo. Natural skin texture, no retouching of features.",
  },
  {
    key: "square-profile",
    body:
      "Edit this photo of me into a square 1:1 profile picture that borrows the lighting and mood of the attached reference: hard directional key light, clean uncluttered background, head centred with a little headroom, shoulders visible. Black and white. Keep my face, bone structure and identity exactly as in the source photo. Natural skin texture, no beauty smoothing. Composition must read well when displayed small and circular-cropped.",
  },
  {
    key: "bw-grain",
    body:
      "Edit this photo of me into a black and white portrait in the style of the attached reference, but with the texture of pushed 35mm film: visible grain, deep blacks, slightly lifted highlights, a touch of contrast. Same tight framing and same directional light. Keep my face and identity exactly as in the source photo. No smoothing, grain must sit over skin texture rather than replace it.",
  },
  {
    key: "color-editorial",
    body:
      "Edit this photo of me into a colour editorial portrait that borrows the lighting and framing language of the attached black and white reference: hard directional key, clean neutral background, tight crop. Keep natural skin tones, muted desaturated palette. Keep my face and identity exactly as in the source photo. Crisp detail, no smoothing.",
  },
];

withProject(pid, async () => {
  initSchema();
  const d = dirsFor(pid);
  const refDir = join(d.DATA_DIR, "refs");
  // Quali reference allegare non e' sempre "tutti quelli nella cartella": la
  // cartella contiene sia foto della persona (identita') sia immagini di stile,
  // e mescolarle non e' neutro. --refs sceglie per nome.
  const wanted = arg("--refs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const all = existsSync(refDir)
    ? readdirSync(refDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    : [];
  const missing = (wanted ?? []).filter((w) => !all.includes(w));
  if (missing.length) { console.error(`[gen] reference inesistenti: ${missing.join(", ")} (in ${refDir} ci sono: ${all.join(", ")})`); process.exit(1); }
  const refs = (wanted ?? all).map((f) => join(refDir, f));
  if (!refs.length) console.warn("[gen] nessun reference in data/refs: le varianti non saranno coerenti fra loro");

  const photos = db()
    .query<{ id: string; original_path: string }, []>("SELECT id, original_path FROM photos ORDER BY id")
    .all();
  hasStyleRef = refs.some((r) => /style|stile/i.test(r));
  nRefs = refs.length;
  const recipes = only ? RECIPES.filter((r) => only.includes(r.key)) : RECIPES;
  const targets = limit > 0 ? photos.slice(0, limit) : photos;
  console.log(`[gen] progetto=${pid} foto=${targets.length} ricette=${recipes.map((r) => r.key).join(",")} refs=${refs.length}`);

  let ok = 0, ko = 0, streak = 0;
  for (const photo of targets) {
    for (const recipe of recipes) {
      if (streak >= 4) { console.error("[gen] 4 fallimenti di fila: mi fermo, non è un caso"); process.exit(1); }
      // Il set di reference va registrato con la variante: due passate fatte con
      // reference diversi non sono confrontabili, e senza etichetta nel provino
      // sembrano solo due tentativi della stessa cosa.
      // L'etichetta deve distinguere set diversi: "id+stile" con tre riferimenti
      // e "id+stile" con quattro sono esperimenti diversi, e chiamarli uguale
      // rende il confronto impossibile proprio dove serve.
      // Non basta contare i riferimenti: due passate con gli STESSI file ma
      // istruzioni diverse producono cose diverse, e nel provino finirebbero
      // sotto la stessa etichetta. "id+look" e' il preambolo che chiede di
      // seguire anche l'aspetto delle reference, non solo l'identita'.
      const refset = `${refs.length} rif: ${hasStyleRef ? (refs.length > 1 ? "id+stile" : "stile") : "id+look"}`;
      const cfg = JSON.stringify({ recipe: recipe.key, refset, refs: refs.map((r) => r.split("/").pop()) });
      const prompt = ROLES() + recipe.body;
      const job = enqueueJob(photo.id, prompt, cfg, "chatgpt", null, "edit", null, JSON.stringify(refs));
      db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
      const n = nextVersionNumber(photo.id);
      const dir = join(d.GEN_DIR, photo.id);
      mkdirSync(dir, { recursive: true });
      const out = join(dir, `v${String(n).padStart(2, "0")}_${recipe.key}.png`);
      const t0 = Date.now();
      const res = await runWorkerCodexHttp({ image: photo.original_path, prompt, output: out, refs });
      if (res.status === "ok") {
        const ins = db().run(
          `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, provider, provider_params, credits, source, created_at)
           VALUES (?, ?, ?, ?, ?, 'chatgpt', NULL, 0, 'generated', ?)`,
          [photo.id, n, out, prompt, JSON.stringify({ recipe: recipe.key, refset, backend: "codex-http" }), Date.now()],
        );
        db().run("UPDATE jobs SET status='done', result_version_id=?, finished_at=? WHERE id=?", [Number(ins.lastInsertRowid), Date.now(), job.id]);
        ok++; streak = 0;
        console.log(`  ok  ${photo.id.slice(0, 12)} ${recipe.key} — ${res.size_kb}KB ${res.duration_s.toFixed(0)}s`);
      } else {
        db().run("UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=?", [String(res.error).slice(0, 500), Date.now(), job.id]);
        ko++; streak++;
        console.log(`  KO  ${photo.id.slice(0, 12)} ${recipe.key} — ${String(res.error).slice(0, 120)}`);
      }
    }
  }
  console.log(`[gen] fatte ${ok}, fallite ${ko}`);
});
