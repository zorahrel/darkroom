/**
 * Stadio di upscale locale (Real-ESRGAN via il binario di Upscayl).
 *
 * Sta qui e non nella pipeline di generazione perché è un'operazione a valle e
 * costosa in disco: una variante da 1122x1402 diventa 4488x5608 e passa da 2 MB
 * a ~43 MB. Upscalare tutte le varianti prima di sceglierle significa scrivere
 * un gigabyte per buttarne il 90%. Si upscala ciò che è stato scelto.
 *
 * Uso:
 *   bun run scripts/upscale.ts <projectId> --versions 12,15   # id specifici
 *   bun run scripts/upscale.ts <projectId> --favorites        # i preferiti
 *   bun run scripts/upscale.ts <projectId> --recipe bw-hard   # tutta una ricetta
 */
import { spawn } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const BIN = process.env.UPSCAYL_BIN ?? "/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin";
const MODELS = process.env.UPSCAYL_MODELS ?? "/Applications/Upscayl.app/Contents/Resources/models";

const pid = process.argv[2] ?? "profilo";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const has = (k: string) => process.argv.includes(k);
const model = arg("--model") ?? "high-fidelity-4x";
const scale = arg("--scale") ?? "4";

if (!existsSync(BIN)) {
  console.error(`upscayl-bin non trovato in ${BIN} — 'brew install --cask upscayl' oppure imposta UPSCAYL_BIN`);
  process.exit(1);
}

withProject(pid, async () => {
  initSchema();
  const d = dirsFor(pid);
  const outDir = join(d.DATA_DIR, "upscaled");
  mkdirSync(outDir, { recursive: true });

  let rows: { id: number; photo_id: string; image_path: string; config: string | null }[] = [];
  const ids = arg("--versions");
  if (ids) {
    const list = ids.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    rows = db().query<any, []>(`SELECT id, photo_id, image_path, config FROM versions WHERE id IN (${list.join(",") || "-1"})`).all();
  } else if (has("--favorites")) {
    rows = db().query<any, []>(
      `SELECT v.id, v.photo_id, v.image_path, v.config FROM versions v
       JOIN photos p ON p.favorite_version_id = v.id`).all();
  } else if (arg("--recipe")) {
    const r = arg("--recipe")!;
    rows = db().query<any, [string]>(
      `SELECT id, photo_id, image_path, config FROM versions WHERE source='generated' AND config LIKE ?`).all(`%"recipe":"${r}"%`);
  } else {
    console.error("serve --versions, --favorites o --recipe: upscalare tutto scrive un giga per niente");
    process.exit(1);
  }
  console.log(`[upscale] ${rows.length} versioni, modello ${model}, x${scale}`);

  let ok = 0;
  for (const v of rows) {
    if (!existsSync(v.image_path)) { console.log(`  skip ${v.id}: file assente`); continue; }
    const out = join(outDir, basename(v.image_path).replace(/\.png$/i, `_${model}.png`));
    if (existsSync(out)) { console.log(`  gia' fatto ${basename(out)}`); ok++; continue; }
    const t0 = Date.now();
    const p = spawn({ cmd: [BIN, "-i", v.image_path, "-o", out, "-n", model, "-m", MODELS, "-s", scale], stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    if (code !== 0 || !existsSync(out)) { console.log(`  KO  ${v.id}: upscayl exit ${code}`); continue; }
    const mb = (statSync(out).size / 1048576).toFixed(1);
    console.log(`  ok  v${v.id} ${v.photo_id.slice(0, 10)} -> ${basename(out)} ${mb} MB ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    ok++;
  }
  console.log(`[upscale] fatte ${ok}/${rows.length} in ${outDir}`);
});
