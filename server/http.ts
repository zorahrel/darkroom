import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";

/** Small HTTP helpers shared by the route modules. */

/**
 * Serve un file, e se il chiamante chiede un pezzo glielo da'.
 *
 * `Range` non e' un dettaglio di efficienza: e' cio' che rende un video
 * *cercabile*. Senza, `currentTime = 120` non porta a 2:00 — il browser non ha
 * modo di prendere quel punto e riporta la testina a zero. Un player, una
 * striscia di fotogrammi e una timeline da trascinare sembravano tutti rotti
 * per questa sola riga mancante.
 *
 * E il corpo non si legge piu' tutto in memoria: `Bun.file` lo trasmette, cosi'
 * un master da 2,5 GB non diventa 2,5 GB di RAM per ogni richiesta.
 */
export function serveFile(absPath: string, mime?: string, req?: Request): Response {
  if (!existsSync(absPath)) return new Response("not found", { status: 404 });
  const size = statSync(absPath).size;
  const contentType = mime ?? guessMime(absPath);
  const file = Bun.file(absPath);
  const common = {
    "content-type": contentType,
    "cache-control": "public, max-age=300",
    "accept-ranges": "bytes",
  };

  const range = req?.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m) {
    // "bytes=-500" sono gli ULTIMI 500 byte, non i primi: il suffisso e' un
    // caso a parte, non un inizio mancante.
    const suffisso = m[1] === "";
    let da = suffisso ? Math.max(0, size - Number(m[2] || 0)) : Number(m[1]);
    let a = suffisso || m[2] === "" ? size - 1 : Number(m[2]);
    if (!Number.isFinite(da) || da >= size) {
      return new Response("range non soddisfacibile", {
        status: 416, headers: { ...common, "content-range": `bytes */${size}` },
      });
    }
    a = Math.min(a, size - 1);
    return new Response(file.slice(da, a + 1), {
      status: 206,
      headers: { ...common, "content-range": `bytes ${da}-${a}/${size}`, "content-length": String(a - da + 1) },
    });
  }

  return new Response(file, { headers: { ...common, "content-length": String(size) } });
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
  // Senza il tipo giusto un mp4 arriva come "application/octet-stream" e il
  // browser lo tratta come uno scarico, non come un video da mettere in pagina.
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
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
