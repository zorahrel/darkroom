/**
 * Toglie dal progetto le varianti nate da un set di riferimenti sbagliato.
 *
 * Sposta invece di cancellare: una passata scartata oggi e' la prova di cosa
 * NON funziona, e ricrearla costa quanto e' costata. I file finiscono in
 * data/archive/<set>/, le righe di versione e job spariscono dal progetto.
 *
 * Uso: bun run scripts/archive_variants.ts <projectId> --keep "3 rif: id,3 rif: id+look"
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const pid = process.argv[2] ?? "profilo";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const keep = (arg("--keep") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!keep.length) { console.error('serve --keep "<set>,<set>": senza, non si sa cosa salvare'); process.exit(1); }

withProject(pid, () => {
  initSchema();
  const d = dirsFor(pid);
  const rows = db().query<{ id: number; image_path: string; cfg: string | null }, []>(
    "SELECT id, image_path, config AS cfg FROM versions WHERE source='generated'").all();
  let moved = 0, missing = 0;
  for (const v of rows) {
    let set = "sconosciuto";
    try { set = JSON.parse(v.cfg ?? "{}").refset ?? "sconosciuto"; } catch {}
    if (keep.includes(set)) continue;
    const dir = join(d.DATA_DIR, "archive", set.replace(/[^\w+]+/g, "_"));
    mkdirSync(dir, { recursive: true });
    if (existsSync(v.image_path)) { renameSync(v.image_path, join(dir, basename(v.image_path))); moved++; }
    else missing++;
    db().run("UPDATE jobs SET result_version_id=NULL WHERE result_version_id=?", [v.id]);
    db().run("DELETE FROM versions WHERE id=?", [v.id]);
  }
  // I job che non hanno prodotto nulla di conservato non servono piu' al provino.
  const jobsGone = db().run(
    "DELETE FROM jobs WHERE result_version_id IS NULL AND status='done'").changes;
  const left = db().query<{ n: number }, []>("SELECT COUNT(*) n FROM versions WHERE source='generated'").get()?.n ?? 0;
  console.log(`[archive] spostate ${moved} immagini (${missing} gia' assenti), ${jobsGone} job rimossi`);
  console.log(`[archive] restano ${left} varianti, in ${join(d.DATA_DIR, "archive")} il resto`);
});
