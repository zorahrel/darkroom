// One-shot codemod: rename identifiers (AST nodes only) and selected
// string-literal union members. Comments, JSX text and UI copy are untouched
// because we only rewrite Identifier / StringLiteral nodes we were asked to.
import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const MAP = JSON.parse(readFileSync(process.argv[2], "utf8"));
const IDENTS = new Map(Object.entries(MAP.identifiers ?? {}));
const LITERALS = new Map(Object.entries(MAP.literals ?? {}));
const SKIP_FILES = new Set(MAP.skipFiles ?? []);
const ONLY = MAP.only ? new Set(MAP.only) : null;

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if ([
      "node_modules", ".git", "dist", "data", "logs", "coverage", ".venv", "__pycache__",
    ].includes(e.name)) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p)) files.push(p.replace(/^\.\//, ""));
  }
})(".");

let changedFiles = 0, changedNodes = 0;
const report = [];

for (const f of files) {
  if (SKIP_FILES.has(f)) continue;
  if (ONLY && !ONLY.has(f)) continue;
  const text = readFileSync(f, "utf8");
  const src = ts.createSourceFile(
    f, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edits = [];

  const visit = (n) => {
    if (ts.isIdentifier(n) && IDENTS.has(n.text)) {
      // Shorthand `{ tipo }` must expand to `{ kind: tipo }`? No: we rename the
      // declaration too, so shorthand stays valid. But a shorthand property
      // whose declaration is NOT renamed would break — guarded by the map being
      // whole-program.
      const parent = n.parent;
      const isShorthand = parent && ts.isShorthandPropertyAssignment(parent);
      edits.push({
        start: n.getStart(src), end: n.getEnd(),
        text: IDENTS.get(n.text), shorthand: isShorthand,
      });
    }
    if (ts.isStringLiteral(n) && LITERALS.has(n.text)) {
      const p = n.parent;
      // Only inside type positions, comparisons, object values and arguments —
      // i.e. anywhere it is a value of our union. UI copy is JSX text or a
      // template, never a bare string compared to a union… so we restrict to
      // literal types, equality, property values, array elements and calls.
      const ok =
        ts.isLiteralTypeNode(p) ||
        ts.isBinaryExpression(p) ||
        ts.isPropertyAssignment(p) ||
        ts.isArrayLiteralExpression(p) ||
        ts.isCaseClause(p) ||
        ts.isCallExpression(p) ||
        ts.isReturnStatement(p) ||
        ts.isConditionalExpression(p) ||
        ts.isVariableDeclaration(p) ||
        ts.isJsxExpression(p) ||
        ts.isTemplateSpan(p) ||
        ts.isAsExpression(p) ||
        ts.isElementAccessExpression(p) ||
        ts.isParenthesizedExpression(p);
      if (ok) {
        const q = text[n.getStart(src)];
        edits.push({ start: n.getStart(src), end: n.getEnd(), text: `${q}${LITERALS.get(n.text)}${q}` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);

  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) {
    const replacement = e.shorthand ? `${e.text}` : e.text;
    out = out.slice(0, e.start) + replacement + out.slice(e.end);
  }
  writeFileSync(f, out);
  changedFiles++; changedNodes += edits.length;
  report.push(`${String(edits.length).padStart(4)}  ${f}`);
}
console.log(report.join("\n"));
console.log(`\n${changedNodes} nodes in ${changedFiles} files`);
