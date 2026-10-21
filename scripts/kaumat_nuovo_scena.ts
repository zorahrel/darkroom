/**
 * Una variante del Kaumat DA ZERO per la scena 16:9, con prompt e riferimenti scelti da riga di comando.
 *
 * PERCHE'. A forza di ritocchi a catena (100 rigenerazioni dalla v240 alla v341) la nitidezza cala
 * e i dettagli gia' approvati (i piedi palmati) si perdono. Qui si genera una volta sola, da un prompt
 * unico che contiene tutte le richieste, come per la v176. Registra la versione con i riferimenti
 * DAVVERO allegati, cosi' il Flusso li mostra.
 *
 * Usage: bun run scripts/kaumat_nuovo_scena.ts --prompt-file p.txt --refs a.png,b.png [--note "..."]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerOpenBrowserGenerate } from "../server/worker.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = "kaumat";
const PHOTO = "kaumat-nuovo";
const promptFile = arg("--prompt-file");
const REFS = (arg("--refs") ?? "").split(",").filter(Boolean);
const NOTE = arg("--note") ?? "Kaumat da zero, scena 16:9, prompt unico";
if (!promptFile) throw new Error("manca --prompt-file");
const PROMPT = readFileSync(promptFile, "utf8").trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  for (const r of REFS) if (!existsSync(r)) throw new Error(`manca il riferimento: ${r}`);
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });
  const names = REFS.map((r) => r.split("/").pop()!);
  const cfg = JSON.stringify({ recipe: "kaumat-scena-da-zero", refs: names });
  const job = enqueueJob(
    PHOTO, PROMPT, cfg, "chatgpt", null, "generate", null,
    JSON.stringify(REFS), null, "cft", JSON.stringify(names),
  );
  db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
  const n = nextVersionNumber(PHOTO);
  const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
  const t0 = Date.now();
  const res = await runWorkerOpenBrowserGenerate({ prompt: PROMPT, output: out, refs: REFS });
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.status !== "ok" || !existsSync(out)) {
    const why = res.status === "ok" ? "file di uscita assente" : res.error;
    db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), why ?? "?", job.id]);
    console.error(`[scena] FALLITA in ${secs}s: ${why}`);
    process.exit(1);
  }
  const lineage = JSON.stringify({ recipe: "kaumat-scena-da-zero", refs: names, backend: "cft", retouch: NOTE });
  const ins = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?, ?)`,
    [PHOTO, n, out, PROMPT, cfg, lineage, NOTE, Date.now()],
  );
  scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
  db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
  console.log(`[scena] v${n} ok in ${secs}s → ${out}`);
});
