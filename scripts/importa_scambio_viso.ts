/**
 * Porta in Darkroom, come versioni della foto profilo («1»), le uscite dello scambio di viso
 * fatto con FaceFusion sul PC (viso delle foto vere di Attilio sopra una versione generata).
 * Provato il 25/11 su richiesta di Attilio («proviamo giusto per»).
 *
 * Uso: bun run scripts/importa_scambio_viso.ts <file.png>...
 * Il nome del file dice bersaglio e impostazione: v694_hyperswap1a_multi.png
 */
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";

const PROGETTO = "profilo";
const FOTO = "1";
const file = process.argv.slice(2);
// Quali foto vere hanno dato il viso, per impostazione (dal nome del file).
const RASATO = ["io-rasato-2025-03-08-m08.jpg", "io-rasato-2025-03-08-m13.jpg", "io-rasato-2025-03-08-m16.jpg"];
const sorgentiDi = (imp: string) =>
  imp === "rasatoA" ? RASATO
  : imp === "rasatoB" ? [...RASATO, "io-felpa-mano-1.png"]
  : ["io-felpa-mano-1.png", "io-libreria-48.jpg"];
if (!file.length) throw new Error("uso: <file.png>...");

withProject(PROGETTO, () => {
  initSchema();
  const out = join(dirsFor(PROGETTO).DATA_DIR, "generations", FOTO);
  for (const f of file) {
    const m = f.match(/v(\d+)_([\w]+)\.png$/);
    if (!m) throw new Error(`nome inatteso: ${f}`);
    const [, da, impostazione] = m;
    const n = nextVersionNumber(FOTO);
    const dest = join(out, `v${n}.png`);
    execFileSync("sips", ["-s", "format", "png", f, "--out", dest]);
    const cfg = JSON.stringify({ recipe: "scambio-viso-facefusion", sources: [`1/v${da}.png`], impostazione, sorgenti: sorgentiDi(impostazione) });
    db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'local', 'generated', ?, ?)`,
      [FOTO, n, dest, `FaceFusion 3.9.2, ${impostazione}, viso da foto vere su v${da}`, cfg, cfg, `scambio di viso ${impostazione} su v${da}`, Date.now()],
    );
    console.log(`v${n} ← ${f.split("/").pop()}`);
  }
});
