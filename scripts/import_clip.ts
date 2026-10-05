/**
 * Archivia un video in Darkroom come clip di una foto.
 *
 * Uso: bun run scripts/import_clip.ts <progetto> <foto> <file.mp4>
 *        [--version 240] [--model "MiniMax H3"] [--prompt-file p.txt]
 *        [--remote-id <id>] [--credits 20] [--params '{"resolution":"2K"}'] [--note "..."]
 *
 * Il file viene COPIATO nell'archivio del progetto (data/video/<foto>/), mai spostato e mai
 * ricodificato: e' lo stesso file che il tasto «Salva in Download» consegna.
 */
import { readFileSync } from "node:fs";
import { importClip } from "../server/clips.ts";
import { withProject } from "../server/project.ts";

const [progetto, foto, file] = process.argv.slice(2);
if (!progetto || !foto || !file) {
  console.error("uso: import_clip.ts <progetto> <foto> <file.mp4> [--version N] [--model M] [--prompt-file F] [--remote-id ID] [--credits N] [--params JSON] [--note T]");
  process.exit(2);
}
const flag = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const row = withProject(progetto, () =>
  importClip(foto, {
    path: file,
    version_number: flag("version") ? Number(flag("version")) : null,
    model: flag("model") ?? null,
    prompt: flag("prompt-file") ? readFileSync(flag("prompt-file")!, "utf8").trim() : null,
    remote_id: flag("remote-id") ?? null,
    credits: flag("credits") ? Number(flag("credits")) : null,
    params: flag("params") ? JSON.parse(flag("params")!) : undefined,
    note: flag("note") ?? null,
  }),
);
console.log(JSON.stringify({ id: row.id, file: row.file, width: row.width, height: row.height, duration: row.duration, fps: row.fps, has_audio: !!row.has_audio, size: row.size }));
