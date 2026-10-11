/**
 * Genera video dallo stesso primo fotogramma con piu' modelli e li archivia come clip.
 *
 *   bun run scripts/gen_video.ts <progetto> <foto> --version 242 --prompt-file p.txt
 *        [--presets h3_2k,kling_pro,seedance_1080,veo_high] [--duration 10] [--aspect 9:16]
 *        [--yes --max-credits 120]
 *
 * SENZA --yes e' solo un preventivo: nessun credito si spende. Con --yes serve anche
 * --max-credits, e se il totale lo supera non parte niente. I clip nascono figli della versione
 * (il suo primo fotogramma) e appaiono nel flusso accanto agli altri, pronti per il confronto.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importClip } from "../server/clips.ts";
import { db } from "../server/db.ts";
import {
  VIDEO_PRESETS,
  fitDuration,
  launch,
  quote,
  uploadStartFrame,
  waitForVideo,
  type VideoRequest,
} from "../server/higgsfield_video.ts";
import { withProject } from "../server/project.ts";

const argv = process.argv.slice(2);
const [progetto, foto] = argv;
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i > 0 ? argv[i + 1] : undefined;
};
const version = Number(flag("version"));
const promptFile = flag("prompt-file");
if (!progetto || !foto || !Number.isInteger(version) || !promptFile) {
  console.error("uso: gen_video.ts <progetto> <foto> --version N --prompt-file F [--presets a,b] [--duration 10] [--aspect 9:16] [--yes --max-credits N]");
  process.exit(2);
}
const keys = (flag("presets") ?? Object.keys(VIDEO_PRESETS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
for (const k of keys) if (!VIDEO_PRESETS[k]) throw new Error(`preset sconosciuto: ${k} (ci sono: ${Object.keys(VIDEO_PRESETS).join(", ")})`);
const duration = Number(flag("duration") ?? 10);
const aspect = flag("aspect") ?? "9:16";
const yes = argv.includes("--yes");
const maxCredits = flag("max-credits") ? Number(flag("max-credits")) : null;
const prompt = readFileSync(promptFile, "utf8").trim();

const frame = withProject(progetto, () => {
  const r = db()
    .query("SELECT image_path FROM versions WHERE photo_id = ? AND version_number = ?")
    .get(foto, version) as { image_path: string } | null;
  if (!r) throw new Error(`${foto} non ha una v${version}`);
  return r.image_path;
});

console.log(`primo fotogramma: ${frame}\nprompt: ${prompt.slice(0, 90)}...\n`);
const mediaId = await uploadStartFrame(frame);

const reqs = keys.map((k) => ({ key: k, req: { preset: VIDEO_PRESETS[k]!, prompt, mediaId, duration, aspect } as VideoRequest }));
const costs = await Promise.all(reqs.map(async (x) => ({ ...x, credits: await quote(x.req) })));
let total = 0;
for (const c of costs) {
  total += c.credits;
  console.log(
    `${c.key.padEnd(14)} ${c.req.preset.label.padEnd(15)} ${String(fitDuration(c.req.preset, duration)).padStart(2)} s  ${String(c.credits).padStart(4)} crediti  (${c.req.preset.note})`,
  );
}
console.log(`${"".padEnd(31)}totale ${total} crediti`);

if (!yes) {
  console.log("\nSolo preventivo: per generare aggiungi --yes --max-credits <tetto>.");
  process.exit(0);
}
if (maxCredits == null) throw new Error("con --yes serve --max-credits: il tetto che mi dai tu");
if (total > maxCredits) throw new Error(`il totale (${total}) supera il tetto (${maxCredits}): non parte niente`);

console.log("\nLancio...");
const tmp = join(tmpdir(), `genvideo-${Date.now()}`);
mkdirSync(tmp, { recursive: true });
const results = await Promise.allSettled(
  costs.map(async (c) => {
    const jobId = await launch(c.req);
    console.log(`  ${c.key}: job ${jobId}`);
    const { url, generation } = await waitForVideo(jobId, {
      onTick: (st, s) => s % 40 < 8 && console.log(`  ${c.key}: ${st} (${s} s)`),
    });
    const file = join(tmp, `${c.key}.mp4`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`scarico ${c.key}: ${res.status}`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
    const row = withProject(progetto, () =>
      importClip(foto, {
        path: file,
        version_number: version,
        model: c.req.preset.label,
        prompt,
        remote_id: jobId,
        credits: c.credits,
        params: { ...c.req.preset.params, duration: fitDuration(c.req.preset, duration), aspect_ratio: aspect },
        note: c.req.preset.note,
      }),
    );
    console.log(`  ${c.key}: archiviato come clip #${row.id} (${row.width}x${row.height}, ${row.duration?.toFixed(1)} s)`);
    return { key: c.key, jobId, url, gen: generation?.id };
  }),
);
for (const [i, r] of results.entries()) if (r.status === "rejected") console.error(`FALLITO ${costs[i]!.key}: ${(r.reason as Error).message}`);
process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
