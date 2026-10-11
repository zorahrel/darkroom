/**
 * Riempie `version_parents` leggendo le note delle versioni ("v196 + ...", "da v230: ...").
 * Solo per un progetto che ha gia' una storia scritta a parole: quelle nuove la registrano da sole.
 * Le eccezioni (sorelle che citano la sorella, non il genitore) si passano a mano con --fix N=P.
 *
 *   bun run scripts/seed_parents.ts <progetto> <foto> [--from 192] [--fix 231=228 --fix 241=238]
 */
import { setParent } from "../server/branches.ts";
import { db } from "../server/db.ts";
import { withProject } from "../server/project.ts";

const [progetto, foto] = process.argv.slice(2);
if (!progetto || !foto) {
  console.error("uso: seed_parents.ts <progetto> <foto> [--from N] [--fix N=P ...]");
  process.exit(2);
}
const args = process.argv.slice(4);
const from = Number(args[args.indexOf("--from") + 1]) || 0;
const fixes = new Map<number, number>();
args.forEach((a, i) => {
  if (a !== "--fix") return;
  const [n, p] = (args[i + 1] ?? "").split("=").map(Number);
  if (Number.isInteger(n) && Number.isInteger(p)) fixes.set(n, p);
});

const out = withProject(progetto, () => {
  const rows = db()
    .query("SELECT version_number AS n, note FROM versions WHERE photo_id = ? AND version_number >= ? ORDER BY n")
    .all(foto, from) as { n: number; note: string | null }[];
  const done: string[] = [];
  for (const r of rows) {
    const m = /\bv(\d{2,3})\b/.exec(r.note ?? "");
    const guess = m && Number(m[1]) < r.n ? Number(m[1]) : null;
    const parent = fixes.get(r.n) ?? guess;
    setParent(foto, r.n, parent);
    done.push(`v${r.n}<-${parent ?? "-"}`);
  }
  return done;
});
console.log(out.join(" "));
