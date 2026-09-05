/**
 * Extract / apply comment blocks, by byte offset.
 *
 * `extract <file...>` writes JSON of every comment range whose text looks
 * Italian. `apply <json>` writes the translations back at the exact same
 * offsets, longest-last, so no code can move: the only bytes that change are
 * the ones inside a comment.
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "fs";

const IT =
  /\b(che|non|una|per|con|della|delle|dello|degli|dei|del|nel|nella|sono|essere|viene|questo|questa|quello|quella|come|anche|quando|perche|perché|piu|più|gia|già|solo|ogni|tutti|tutte|tutto|senza|dopo|prima|invece|serve|deve|devono|fare|fatto|cosa|dove|quale|quali|adesso|ancora|niente|nessun|nessuna|foto|riga|righe|scelta|prova|verifica|schermo|griglia|puo|puoi|si|e')\b/i;

function ranges(file) {
  const text = readFileSync(file, "utf8");
  const src = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const seen = new Set();
  const out = [];
  const add = (rs) => {
    for (const r of rs ?? []) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pos: r.pos, end: r.end, text: text.slice(r.pos, r.end) });
    }
  };
  const walk = (n) => {
    add(ts.getLeadingCommentRanges(text, n.getFullStart()));
    add(ts.getTrailingCommentRanges(text, n.getEnd()));
    ts.forEachChild(n, walk);
  };
  walk(src);
  // Consecutive `//` lines are one thought: merge them so a translation can
  // reflow across them instead of being trapped line by line.
  out.sort((a, b) => a.pos - b.pos);
  const merged = [];
  for (const r of out) {
    const prev = merged[merged.length - 1];
    const between = prev ? text.slice(prev.end, r.pos) : null;
    if (prev && r.text.startsWith("//") && prev.text.startsWith("//") && /^\s*\n\s*$/.test(between)) {
      prev.end = r.end;
      prev.text = text.slice(prev.pos, r.end);
    } else merged.push({ ...r });
  }
  return merged.filter((r) => IT.test(r.text));
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "extract") {
  const payload = [];
  for (const f of args) for (const r of ranges(f)) payload.push({ file: f, ...r });
  console.log(JSON.stringify(payload, null, 1));
} else if (cmd === "apply") {
  const items = JSON.parse(readFileSync(args[0], "utf8"));
  const byFile = new Map();
  for (const it of items) {
    if (!byFile.has(it.file)) byFile.set(it.file, []);
    byFile.get(it.file).push(it);
  }
  for (const [file, list] of byFile) {
    let text = readFileSync(file, "utf8");
    list.sort((a, b) => b.pos - a.pos);
    for (const it of list) {
      if (text.slice(it.pos, it.end) !== it.text) {
        console.error(`STALE  ${file} @${it.pos}: source moved since extract`);
        process.exit(1);
      }
      text = text.slice(0, it.pos) + it.new + text.slice(it.end);
    }
    writeFileSync(file, text);
    console.log(`${String(list.length).padStart(3)}  ${file}`);
  }
} else {
  console.error("usage: comments-io.mjs extract <file...> | apply <json>");
  process.exit(2);
}
