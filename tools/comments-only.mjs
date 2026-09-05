/**
 * Guard for a comment-only rewrite.
 *
 * Compares the working tree against a git ref and asserts that, for every
 * changed .ts/.tsx file, the CODE is identical once comments are removed —
 * with one allowance: the string literal naming a `describe`/`test`/`it` block
 * may change, because that is prose too.
 *
 * It works by re-printing both versions through the TypeScript printer with
 * comments off, which normalises formatting and cannot be fooled by a backtick
 * inside a comment the way raw token scanning was.
 *
 * Usage: bun tools/comments-only.mjs <ref>
 * Exits non-zero, naming the file and the first line that differs.
 */
import ts from "typescript";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const ref = process.argv[2] ?? "HEAD";
const changed = execSync(`git diff --name-only ${ref} -- "*.ts" "*.tsx"`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** The file's code, comments stripped and test names blanked. */
function codeOf(text, file) {
  const src = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest, true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const blankNames = (context) => (root) => {
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        ["describe", "test", "it"].includes(n.expression.text) &&
        n.arguments.length &&
        ts.isStringLiteralLike(n.arguments[0])
      ) {
        return ts.factory.updateCallExpression(
          n, n.expression, n.typeArguments,
          [ts.factory.createStringLiteral("<name>"), ...n.arguments.slice(1).map((a) => ts.visitNode(a, visit))],
        );
      }
      return ts.visitEachChild(n, visit, context);
    };
    return ts.visitNode(root, visit);
  };
  const out = ts.transform(src, [blankNames]);
  const printed = printer.printFile(out.transformed[0]);
  out.dispose();
  return printed;
}

let bad = 0;
for (const file of changed) {
  let before;
  try {
    before = execSync(`git show ${ref}:${file}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    continue; // new file: nothing to compare against
  }
  const a = codeOf(before, file).split("\n");
  const b = codeOf(readFileSync(file, "utf8"), file).split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      console.error(`CODE CHANGED  ${file}\n  - ${JSON.stringify(a[i] ?? "<eof>")}\n  + ${JSON.stringify(b[i] ?? "<eof>")}`);
      bad++;
      break;
    }
  }
}
console.log(bad ? `\n${bad} file(s) changed code, not just comments.` : `${changed.length} file(s): comments only.`);
process.exit(bad ? 1 : 0);
