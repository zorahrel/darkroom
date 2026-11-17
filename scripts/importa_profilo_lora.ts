/**
 * Porta in Darkroom, come versioni della foto profilo («1»), le foto generate col
 * modello personale di Attilio (LoRA Z-Image) sul PC: cosi' stanno nella stessa
 * striscia di v611 e si confrontano con lei, non in una foto a parte.
 *
 * Uso: bun run scripts/importa_profilo_lora.ts <prompt.txt> <file.png>...
 * Il nome del file dice checkpoint, forza e seme (profilo_lora.py sul PC).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";

const PROGETTO = "profilo";
const FOTO = "1";
const [promptFile, ...file] = process.argv.slice(2);
if (!promptFile || !file.length) throw new Error("uso: <prompt.txt> <file.png>...");
const prompt = readFileSync(promptFile, "utf8").trim();

withProject(PROGETTO, () => {
  initSchema();
  const out = join(dirsFor(PROGETTO).DATA_DIR, "generations", FOTO);
  for (const f of file) {
    const n = nextVersionNumber(FOTO);
    const dest = join(out, `v${n}.png`);
    execFileSync("sips", ["-s", "format", "png", f, "--out", dest]);
    const m = f.match(/attilio_zimage(?:_0*(\d+))?_s([\d.]+)_(\d+)\.png$/);
    const ck = m?.[1] ? Number(m[1]) : 2000;
    const cfg = JSON.stringify({ recipe: "lora-zimage-attilio-v611", checkpoint: ck, forza: Number(m?.[2]), seme: Number(m?.[3]) });
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'local', 'generated', ?, ?)`,
      [FOTO, n, dest, prompt, cfg, cfg, `modello personale ${ck} step, forza ${m?.[2]}, seme ${m?.[3]}, posa v611`, Date.now()],
    );
    console.log(`v${n} ← ${f.split("/").pop()}`);
  }
});
