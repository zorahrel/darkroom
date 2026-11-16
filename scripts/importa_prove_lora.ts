/**
 * Porta in Darkroom i ritratti di prova dell'addestramento del modello personale
 * (LoRA Z-Image di Attilio, ai-toolkit sul PC): una foto «lora-prove», una versione
 * per ritratto, con checkpoint e prompt nella nota. Cosi' il confronto si fa in
 * Darkroom e non in un collage fuori.
 *
 * Uso: bun run scripts/importa_prove_lora.ts <cartella-samples> [step...]
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";

const PROGETTO = "profilo";
const FOTO = "lora-prove";
const PROMPT = [
  "portrait photo of attcnc man, frontal view, looking at the camera, neutral expression, soft studio light, plain grey background",
  "photo of attcnc man, three-quarter view, slight smile, soft studio lighting, 85mm lens, shallow depth of field",
  "side profile photo of attcnc man, looking to the left, studio light, plain dark background",
  "half-length studio portrait of attcnc man wearing a dark jacket, arms relaxed, softbox key light and rim light, neutral backdrop",
];

const [dir, ...stepArg] = process.argv.slice(2);
if (!dir) throw new Error("manca la cartella dei samples");
const step = dir === "--ritratti" ? [] : stepArg.length ? stepArg.map(Number) : [1250, 1750, 2000];

withProject(PROGETTO, () => {
  initSchema();
  const out = join(dirsFor(PROGETTO).DATA_DIR, "generations", FOTO);
  mkdirSync(out, { recursive: true });
  const now = Date.now();
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [FOTO, now, now],
  );
  // Ritratti generati a parte (prova_lora.py sul PC): un file per versione, la nota
  // dal nome (checkpoint_scena_sForza_seme). Si riconoscono dal primo argomento «--ritratti».
  if (dir === "--ritratti") {
    for (const f of stepArg) {
      const n = nextVersionNumber(FOTO);
      // Darkroom serve le versioni solo come vNN.png (client/src/api/urls.ts): un .jpg resta invisibile.
      const dest = join(out, `v${String(n).padStart(2, "0")}.png`);
      execFileSync("sips", ["-s", "format", "png", f, "--out", dest]);
      const m = f.match(/_0*(\d+)_([a-z]+)_s([\d.]+)_(\d+)\.jpg$/);
      const [ck, scena, forza, seme] = m ? [m[1], m[2], m[3], m[4]] : ["?", "?", "?", "?"];
      const cfg = JSON.stringify({ recipe: "lora-zimage-attilio", checkpoint: Number(ck), scena, forza: Number(forza), seme: Number(seme) });
      db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'local', 'generated', ?, ?)`,
        [FOTO, n, dest, scena, cfg, cfg, `modello personale ${ck} step, ${scena}, forza ${forza}, seme ${seme}`, Date.now()],
      );
      console.log(`v${n} ← ${scena} forza ${forza} seme ${seme}`);
    }
    return;
  }
  const file = readdirSync(dir);
  for (const s of step) {
    for (const k of [0, 1, 2, 3]) {
      const f = file.find((x) => x.endsWith(`__${String(s).padStart(9, "0")}_${k}.jpg`));
      if (!f) continue;
      const n = nextVersionNumber(FOTO);
      const dest = join(out, `v${String(n).padStart(2, "0")}.png`);
      execFileSync("sips", ["-s", "format", "png", join(dir, f), "--out", dest]);
      const cfg = JSON.stringify({ recipe: "lora-zimage-attilio", checkpoint: s, prompt_index: k });
      db().run(
        `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'local', 'generated', ?, ?)`,
        [FOTO, n, dest, PROMPT[k], cfg, cfg, `modello personale, ${s} step, prova ${k + 1}`, Date.now()],
      );
      console.log(`v${n} ← ${s} step, prova ${k + 1}`);
    }
  }
  if (!db().query("SELECT original_path FROM photos WHERE id=?").get(FOTO)?.original_path) {
    const prima = db().query("SELECT image_path FROM versions WHERE photo_id=? ORDER BY version_number LIMIT 1").get(FOTO) as { image_path: string };
    db().run("UPDATE photos SET original_path=? WHERE id=?", [prima.image_path, FOTO]);
  }
});
