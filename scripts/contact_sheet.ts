/**
 * Costruisce il manifest per la scheda di valutazione: ogni foto sorgente con
 * le sue varianti, ridotte a miniature webp incorporabili.
 *
 * Perché non un montage unico: una griglia appiattita non dice QUALE ricetta ha
 * prodotto cosa, e la valutazione serve a scegliere una ricetta, non una foto.
 *
 * Uso: bun run scripts/contact_sheet.ts <projectId> [--edge 760] [--out file.json]
 */
import { spawn } from "bun";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProject } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const pid = process.argv[2] ?? "profilo";
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const EDGE = arg("--edge", "760");
const OUT = arg("--out", join(tmpdir(), `sheet_${pid}.json`));

async function thumb(src: string): Promise<string | null> {
  if (!existsSync(src)) return null;
  const tmp = join(tmpdir(), `th_${Math.random().toString(36).slice(2)}.webp`);
  const p = spawn({ cmd: ["magick", src, "-auto-orient", "-resize", `${EDGE}x${EDGE}>`, "-quality", "72", tmp], stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0 || !existsSync(tmp)) return null;
  const b64 = readFileSync(tmp).toString("base64");
  unlinkSync(tmp);
  return `data:image/webp;base64,${b64}`;
}

withProject(pid, async () => {
  initSchema();
  const photos = db().query<{ id: string; original_path: string }, []>("SELECT id, original_path FROM photos ORDER BY id").all();
  const out: any[] = [];
  for (const p of photos) {
    const versions = db()
      .query<{ id: number; version_number: number; image_path: string; config: string | null; created_at: number }, [string]>(
        "SELECT id, version_number, image_path, config, created_at FROM versions WHERE photo_id = ? AND source='generated' ORDER BY version_number",
      )
      .all(p.id);
    if (!versions.length) continue;
    const src = await thumb(p.original_path);
    const vs: any[] = [];
    for (const v of versions) {
      const t = await thumb(v.image_path);
      if (!t) continue;
      let recipe = "?";
      try { recipe = JSON.parse(v.config ?? "{}").recipe ?? "?"; } catch {}
      vs.push({ id: v.id, n: v.version_number, recipe, path: v.image_path, thumb: t });
    }
    if (vs.length) out.push({ photo: p.id, source: src, sourcePath: p.original_path, variants: vs });
    console.log(`  ${p.id.slice(0, 14)}: ${vs.length} varianti`);
  }
  await Bun.write(OUT, JSON.stringify({ project: pid, builtAt: Date.now(), photos: out }));
  const kb = Math.round((await Bun.file(OUT).size) / 1024);
  console.log(`[sheet] ${out.length} foto, manifest ${kb} KB -> ${OUT}`);
});
