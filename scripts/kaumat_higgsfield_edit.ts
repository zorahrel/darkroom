/**
 * Modifica una versione del Kaumat con un modello immagine di Higgsfield (es. 4K), a crediti.
 *
 * PERCHE'. ChatGPT gratis esce a 1672 px: per vedere se una risoluzione nativa piu' alta
 * (Nano Banana Pro, GPT Image 2, Cinema Studio 2.5 a 4K) rende la scena piu' fotografica
 * serve lo stesso prompt sulla stessa base, cambiando solo il modello.
 *
 * Usage: bun run scripts/kaumat_higgsfield_edit.ts --from 360 --model nano_banana_pro
 *          --params '{"resolution":"4k","aspect_ratio":"16:9"}' --prompt-file p.txt [--note "..."]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { generateEdit } from "../server/higgsfield.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = "kaumat";
const PHOTO = "kaumat-nuovo";
const FROM = Number(arg("--from") ?? 0);
// --base <file>: parte da un file vero (foto, fotogramma) invece che da una versione generata.
const BASE = arg("--base");
const MODEL = arg("--model");
const PARAMS = JSON.parse(arg("--params") ?? "{}");
const promptFile = arg("--prompt-file");
if ((!FROM && !BASE) || !MODEL || !promptFile) throw new Error("servono --from o --base, --model, --prompt-file");
const PROMPT = readFileSync(promptFile, "utf8").trim();
const ROLE = arg("--role");
const EXTRA = (arg("--extra") ?? "").split(",").filter(Boolean);
const NOTE = arg("--note") ?? `Higgsfield ${MODEL} ${PARAMS.resolution ?? ""} da ${BASE ? "file" : `v${FROM}`}`;

withProject(PID, async () => {
  initSchema();
  const base = BASE
    ? { image_path: BASE }
    : db()
        .query<{ image_path: string }, [string, number]>(
          "SELECT image_path FROM versions WHERE photo_id=? AND version_number=?",
        )
        .get(PHOTO, FROM);
  if (!base || !existsSync(base.image_path)) throw new Error(BASE ? `manca ${BASE}` : `manca la v${FROM}`);
  const dir = join(dirsFor(PID).GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });
  const n = nextVersionNumber(PHOTO);
  const out = join(dir, `v${n}.png`);
  const t0 = Date.now();
  const { credits } = await generateEdit({
    imagePath: base.image_path, prompt: PROMPT, model: MODEL, params: PARAMS, outputPath: out, mediaRole: ROLE, extraImagePaths: EXTRA,
    onLog: (m) => console.log(`[hf ${MODEL}] ${m}`),
  });
  if (!existsSync(out)) throw new Error("file di uscita assente");
  const cfg = JSON.stringify({ recipe: "kaumat-higgsfield-edit", model: MODEL, params: PARAMS, from: FROM || null, base: BASE ?? null, extra: EXTRA });
  db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'higgsfield', ?, 'generated', ?, ?)`,
    [PHOTO, n, out, PROMPT, cfg, cfg, credits ?? null, NOTE, Date.now()],
  );
  if (FROM) db().run("INSERT OR IGNORE INTO version_parents (photo_id, version_number, parent) VALUES (?, ?, ?)", [PHOTO, n, FROM]);
  console.log(`[hf] v${n} ok in ${Math.round((Date.now() - t0) / 1000)}s, ${credits ?? "?"} crediti → ${out}`);
});
