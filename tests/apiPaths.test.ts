import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { app } from "../server/app.ts";

/**
 * What the callers ask for has to exist on the server.
 *
 * The catalogue test next door checks the routes Darkroom *declares*. Nobody
 * was checking the ones it actually *calls*, and twice that let a rename land
 * on one side only: the client asked for `/api/tools/:id/avvia` and
 * `/api/tools/:id/progetti` while the server had moved to `/start` and
 * `/projects`. Both are a 404 at the moment a human clicks — the quick start
 * on the home page did nothing, the project picker came up empty — and neither
 * shows up in a type error, because a URL is a string.
 *
 * So: every literal `/api/...` in the two callers, matched against the routes
 * really mounted on Hono. Paths built by interpolation collapse to `:p`, which
 * is enough to catch a segment that changed name and cheap enough to stay
 * true.
 */

const normalise = (p: string) =>
  p
    .split("?")[0]!
    .replace(/\$\{[^}]*\}/g, ":p")
    .replace(/:[^/]+/g, ":p")
    .replace(/\/+$/, "") || "/";

const mounted = new Set(app.routes.map((r) => `${r.method} ${normalise(r.path)}`));

/** The literal API paths a file asks for, with the verb it asks them with. */
function calls(file: string): { method: string; path: string }[] {
  const src = readFileSync(file, "utf8");
  const out: { method: string; path: string }[] = [];
  const re = /["'`](\/api\/[^"'`\s]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // The verb has to belong to THIS call, so both windows are tight: a wide
    // look-back happily borrowed the "POST" of the line above and reported a
    // GET endpoint as missing.
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    const verb =
      /^\s*,?\s*\{[^}]*method:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/.exec(after)?.[1] ??
      /\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*$/.exec(before)?.[1] ??
      "GET";
    out.push({ method: verb, path: normalise(m[1]!) });
  }
  return out;
}

describe("the callers only ask for routes that exist", () => {
  for (const file of ["client/src/api/client.ts", "mcp/server.ts"]) {
    test(`${file} hits only mounted routes`, () => {
      const missing = calls(file)
        .filter((c) => !mounted.has(`${c.method} ${c.path}`) && !mounted.has(`ALL ${c.path}`))
        .map((c) => `${c.method} ${c.path}`);
      expect([...new Set(missing)]).toEqual([]);
    });
  }

  test("the check can actually fail", () => {
    // A guard nobody has seen fail is a guard nobody knows the shape of.
    expect(mounted.has("POST /api/tools/:p/avvia")).toBe(false);
    expect(mounted.has("POST /api/tools/:p/start")).toBe(true);
  });
});
