/**
 * Registra un file come NUOVA versione di una foto, senza toccare le altre ne' la preferita.
 * Serve per i risultati fatti in locale (LUT, grade): provider `local`, quindi la UI li
 * etichetta «ritocco», come devono essere. L'originale resta dov'e'.
 *
 * Uso: bun run scripts/versione_da_file.ts --progetto profilo --foto 1 --file x.png \
 *        --ricetta lut-da-reference --partenza v318 --nota "cosa e' cambiato"
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const args = process.argv.slice(2);
const opt = (n: string, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const progetto = opt("progetto", "profilo");
const foto = opt("foto", "1");
const file = opt("file");
if (!file) throw new Error("--file obbligatorio");

await withProject(progetto, async () => {
  initSchema();
  const dir = join(dirsFor(progetto).DATA_DIR, "generations", foto);
  mkdirSync(dir, { recursive: true });
  const n = nextVersionNumber(foto);
  const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
  copyFileSync(file, out);
  // «v318» o «v318.png»: il server cerca il file nella cartella delle generazioni, quindi serve l'estensione.
  const partenzaArg = opt("partenza");
  const partenza = /^v\d+$/.test(partenzaArg) ? `${partenzaArg}.png` : partenzaArg;
  db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'local', 0, 'generated', ?)`,
    [
      foto, n, out, opt("nota", "versione locale"), JSON.stringify({ locale: true }),
      // `materia` e' la chiave che la UI legge come «ritocco»: qui lo e' davvero
      JSON.stringify({ recipe: opt("ricetta", "locale"), materia: partenza || null, partenza: partenza || null, cambiato: opt("nota") }),
      Date.now(),
    ],
  );
  // Gli ingressi: la partenza e', con i suoi riferimenti, quelli della generazione da cui nasce. Senza, la pagina mostrava
  // una partenza «ricostruita» sbagliata e nessun riferimento, e il prompt era solo la nota.
  const nuova = db().query<{ id: number }, [string, number]>("SELECT id FROM versions WHERE photo_id = ? AND version_number = ?").get(foto, n)!;
  const num = /^v(\d+)\.png$/.exec(partenza)?.[1];
  const madre = num
    ? db().query<{ id: number; prompt_used: string }, [string, number]>("SELECT id, prompt_used FROM versions WHERE photo_id = ? AND version_number = ?").get(foto, Number(num))
    : null;
  if (madre) {
    db().run("INSERT INTO version_inputs (version_id, kind, path, photo_id, position, origin) VALUES (?, 'source', ?, ?, 0, 'recorded')", [nuova.id, join(dir, partenza), foto]);
    db().run(
      `INSERT INTO version_inputs (version_id, kind, path, photo_id, position, origin)
       SELECT ?, 'reference', path, NULL, position, 'recorded' FROM version_inputs WHERE version_id = ? AND kind = 'reference'`,
      [nuova.id, madre.id],
    );
    db().run("UPDATE versions SET prompt_used = ? WHERE id = ?", [`${opt("nota", "versione locale")}\n\n--- prompt della generazione di partenza (${partenza}) ---\n${madre.prompt_used}`, nuova.id]);
  }
  console.log(`v${n}`);
});
