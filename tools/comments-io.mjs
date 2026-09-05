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

const W = "\\w\u00e0\u00e8\u00e9\u00ec\u00f2\u00f9\u00c0\u00c8\u00c9\u00cc\u00d2\u00d9";
// Italian words WITHOUT an English twin. `per`, `come`, `non`, `con`, `solo`,
// `serve`, `fare`, `dove`, `prima`, `foto`, `prova` and `si` are deliberately
// absent: they read as English too ("per clip", "non-smoothness", "serve"),
// and on their own they flagged files that were already translated.
const WORDS =
  "che|una|della|delle|dello|degli|dei|del|nel|nella|nelle|negli|dalla|dallo|sulla|sulle|sono|essere|viene|questo|questa|quello|quella|anche|quando|perche|perch\u00e9|piu|pi\u00f9|gia|gi\u00e0|cio\u00e8|ogni|tutti|tutte|tutto|senza|dopo|invece|quindi|oppure|proprio|dentro|deve|devono|fatto|cosa|quale|quali|adesso|ancora|niente|nessun|nessuna|riga|righe|scelta|verifica|schermo|griglia|puo|puoi|mentre|finche|finch\u00e9|appena|sempre|davvero|abbastanza|troppo|molto|meglio|peggio|soltanto|e'";
/** Elisions have no English twin at all: `un'immagine`, `dell'evento`. */
const ELISION = /\b(dell|nell|all|sull|dall|quell|un)'/i;
// `\b` is useless on the accented ones: `\b` is defined over [A-Za-z0-9_], so
// `\bperch\u00e9\b` never matched -- the letter before the boundary is not a word
// character. Every accented marker was silently dead, and with the two-marker
// rule that dropped real Italian comments. Explicit look-arounds instead.
const IT = new RegExp(`(?<![${W}])(${WORDS})(?![${W}])`, "i");

/**
 * Is this comment Italian PROSE?
 *
 * The names of the files on disk are Italian and stay that way — they are a
 * contract with Python living outside this repo. So `griglia.py` or
 * `atti.json`, quoted inside an otherwise English comment, used to flag the
 * whole file as untranslated: server/video.ts came up as 88 lines of work and
 * was already done. Code spans and quoted strings are stripped before asking.
 */
function isItalian(text, kind) {
  // A test NAME is entirely a quoted string: stripping quoted spans (which is
  // what kills `"griglia.py"` inside an English comment) deleted the whole
  // name, so every Italian test name looked already translated. 45 of them in
  // jobs.test.ts alone.
  const prose = kind === "name"
    ? text
    : text
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\b[\w./-]+\.(py|json|ts|tsx|sh|md|mjs)\b/gi, " ");
  return IT.test(prose) || ELISION.test(prose);
}

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
    // A `{/* ... */}` in JSX is a JsxExpression with NO expression: the comment
    // hangs off no node at all, so neither leading nor trailing trivia sees it.
    // That blind spot hid 100+ real comments in the UI files — the ones that
    // explain the layout, which is where the explaining is most needed.
    if (ts.isJsxExpression(n) && !n.expression) {
      const inner = text.slice(n.getStart(src) + 1, n.getEnd() - 1);
      const m = inner.match(/\/\*[\s\S]*\*\/|\/\/[^\n]*/);
      if (m) {
        const pos = n.getStart(src) + 1 + m.index;
        const key = `${pos}:${pos + m[0].length}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ pos, end: pos + m[0].length, text: m[0] });
        }
      }
    }
    // The name of a describe/test/it block is prose too, and reads in the CI
    // output where nobody can see the code beside it.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ["describe", "test", "it"].includes(n.expression.text) &&
      n.arguments.length &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      const a = n.arguments[0];
      const key = `${a.getStart(src)}:${a.getEnd()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ pos: a.getStart(src), end: a.getEnd(), text: text.slice(a.getStart(src), a.getEnd()), kind: "name" });
      }
    }
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
  return merged.filter((r) => isItalian(r.text, r.kind));
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
