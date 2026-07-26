import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

/** Small HTTP helpers shared by the route modules. */

export function serveFile(absPath: string, mime?: string): Response {
  if (!existsSync(absPath)) return new Response("not found", { status: 404 });
  const stat = statSync(absPath);
  const data = readFileSync(absPath);
  return new Response(data, {
    headers: {
      "content-type": mime ?? guessMime(absPath),
      "content-length": String(stat.size),
      "cache-control": "public, max-age=300",
    },
  });
}

export function guessMime(p: string): string {
  const ext = extname(p).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  // ES modules and CSS MUST have correct MIME or the browser refuses them.
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

/** Clamp a `?w=` query into a sane pixel width. */
export function parseWidth(
  c: { req: { query: (k: string) => string | undefined } },
  def: number,
  max = 3200,
): number {
  const w = Number(c.req.query("w"));
  if (!Number.isFinite(w) || w <= 0) return def;
  return Math.min(Math.round(w), max);
}

/** A single path segment that cannot escape its directory. */
export function safeSeg(s: string): boolean {
  return !(s.includes("..") || s.includes("/"));
}
