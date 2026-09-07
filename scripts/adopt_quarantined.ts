/**
 * Recupera un render messo in quarantena da un guard che ha sbagliato.
 *
 * Il guard di edit_batch.py rifiuta il file scaricato quando la sua
 * correlazione strutturale con la foto sorgente scende sotto 0,05: serve a non
 * salvare il render DI UN ALTRO job. Su una ricetta che cambia la luce da capo
 * quella correlazione crolla da sola — il 07/09 quattro ritratti con i gel
 * colorati, corretti e riconoscibili, sono usciti a +0,01, -0,12, -0,14 e
 * +0,03 e sono finiti tutti in `_rifiutate/`. Il file resta su disco (per
 * questo la quarantena esiste invece del cestino), ma non c'era modo di
 * riportarlo dentro se non copiandolo a mano: e' quello che fa questo script,
 * con il prompt e la provenienza del job che lo ha prodotto, cosi' la versione
 * adottata non e' un file caduto dal cielo.
 *
 * Non tocca il guard: alzarne o abbassarne la soglia e' una decisione a parte,
 * e va presa guardando i numeri, non per sbloccare una serata.
 *
 * Uso: bun run scripts/adopt_quarantined.ts --job 261 [--progetto profilo]
 */
import { existsSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { withProject, genDir } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const jobId = Number(arg("--job"));
if (!Number.isFinite(jobId)) throw new Error("serve --job <id>");
const PID = arg("--progetto") ?? "profilo";

withProject(PID, () => {
  initSchema();
  const job = db()
    .query<
      { id: number; photo_id: string; prompt: string; lineage: string | null; error: string | null; status: string },
      [number]
    >("SELECT id, photo_id, prompt, lineage, error, status FROM jobs WHERE id = ?")
    .get(jobId);
  if (!job) throw new Error(`job ${jobId} non esiste in ${PID}`);

  const dir = join(genDir(), job.photo_id);
  const quarantena = join(dir, "_rifiutate");
  const file = readdirSync(quarantena).find((f) => f.endsWith(`.job-${jobId}.png`));
  if (!file) throw new Error(`nessun file in quarantena per il job ${jobId}: ${quarantena}`);
  const src = join(quarantena, file);

  const last = db()
    .query<{ n: number }, [string]>(
      "SELECT COALESCE(MAX(version_number), 0) AS n FROM versions WHERE photo_id = ?",
    )
    .get(job.photo_id)!.n;
  const n = last + 1;
  const dst = join(dir, `v${String(n).padStart(2, "0")}.png`);
  if (existsSync(dst)) throw new Error(`${dst} esiste gia': non sovrascrivo`);
  copyFileSync(src, dst);

  // La provenienza dice anche PERCHE' era in quarantena: una versione adottata
  // a mano non deve sembrare uscita dalla coda come tutte le altre.
  let lineage = job.lineage;
  try {
    const l = job.lineage ? JSON.parse(job.lineage) : {};
    lineage = JSON.stringify({ ...l, adottata_da_quarantena: { job: jobId, motivo: job.error?.slice(0, 200) ?? null, file } });
  } catch {
    /* lineage illeggibile: si tiene com'e' */
  }
  db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at, provider, lineage, note)
     VALUES (?, ?, ?, ?, 'generated', ?, 'chatgpt', ?, ?)`,
    [job.photo_id, n, dst, job.prompt, Date.now(), lineage,
     `adottata dalla quarantena del job ${jobId} (${file.split("_")[1] ?? "guard"})`],
  );
  console.log(`[adotta] job ${jobId} -> v${n}  ${dst}`);
});
