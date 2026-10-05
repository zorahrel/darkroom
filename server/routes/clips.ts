import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { db } from "../db.ts";
import { downloadName, forgetClip, getClip, importClip, listClips, saveToDownloads, type ClipRow } from "../clips.ts";

/**
 * Clip: i video nati da una versione di una foto. Elenco, riproduzione (con Range, perche'
 * un video senza Range non si puo' scorrere), download dal browser e salvataggio rapido in
 * ~/Downloads. L'originale non viene mai ricodificato.
 */
export const clipRoutes = new Hono();

/**
 * Serve il file di un clip rispettando `Range`, che e' cio' che rende il video scorrevole.
 *
 * Non uso `serveFile`: dentro l'app una richiesta `bytes=0-99` tornava l'intero file con
 * l'intestazione di 100 byte (Hono rimpacchetta il corpo di un file a fette). Qui il pezzo si
 * legge in memoria e si restituisce come buffer, cosi' i byte sono quelli chiesti. Un
 * intervallo aperto (`bytes=N-`) torna al massimo 8 MB: HTTP lo consente e il player chiede il
 * resto da solo.
 */
const CHUNK = 8 * 1024 * 1024;
async function serveClipFile(path: string, req: Request): Promise<Response> {
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  const size = statSync(path).size;
  const common = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=300" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range")?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response(Bun.file(path), { headers: { ...common, "content-length": String(size) } });
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    // `bytes=-500`: gli ultimi 500 byte, non i primi.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || start >= size || end < start) {
    return new Response("range non soddisfacibile", { status: 416, headers: { ...common, "content-range": `bytes */${size}` } });
  }
  end = Math.min(end, start + CHUNK - 1);
  const body = await Bun.file(path).slice(start, end + 1).arrayBuffer();
  return new Response(body, {
    status: 206,
    headers: { ...common, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(body.byteLength) },
  });
}

const photoExists = (id: string) => !!db().query("SELECT 1 FROM photos WHERE id = ?").get(id);

function view(c: ClipRow) {
  return {
    id: c.id,
    photo_id: c.photo_id,
    version_number: c.version_number,
    model: c.model,
    prompt: c.prompt,
    params: c.params ? (JSON.parse(c.params) as unknown) : null,
    remote_id: c.remote_id,
    credits: c.credits,
    width: c.width,
    height: c.height,
    duration: c.duration,
    fps: c.fps,
    has_audio: !!c.has_audio,
    codec: c.codec,
    size: c.size,
    note: c.note,
    created_at: c.created_at,
    available: existsSync(c.file),
    download_name: downloadName(c),
  };
}

clipRoutes.get("/api/photos/:id/clips", (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  return c.json({ clips: listClips(id).map(view) });
});

clipRoutes.post("/api/photos/:id/clips", async (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.path !== "string" || !b.path) return c.json({ error: "manca `path`" }, 400);
  try {
    const row = importClip(id, {
      path: b.path,
      version_number: typeof b.version_number === "number" ? b.version_number : null,
      model: typeof b.model === "string" ? b.model : null,
      prompt: typeof b.prompt === "string" ? b.prompt : null,
      params: b.params,
      remote_id: typeof b.remote_id === "string" ? b.remote_id : null,
      credits: typeof b.credits === "number" ? b.credits : null,
      note: typeof b.note === "string" ? b.note : null,
    });
    return c.json({ clip: view(row) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

clipRoutes.get("/api/clips/:cid/file", (c) => {
  const clip = getClip(Number(c.req.param("cid")));
  if (!clip) return c.json({ error: "clip non trovato" }, 404);
  return serveClipFile(clip.file, c.req.raw);
});

/** Download dal browser: gli stessi byte dell'archivio, con il nome leggibile. */
clipRoutes.get("/api/clips/:cid/download", (c) => {
  const clip = getClip(Number(c.req.param("cid")));
  if (!clip) return c.json({ error: "clip non trovato" }, 404);
  if (!existsSync(clip.file)) return c.json({ error: "file non nell'archivio" }, 404);
  return new Response(Bun.file(clip.file), {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(statSync(clip.file).size),
      "content-disposition": `attachment; filename="${downloadName(clip)}"`,
    },
  });
});

/** Il tasto rapido: copia l'originale in ~/Downloads e dice dove l'ha messo. */
clipRoutes.post("/api/clips/:cid/save-to-downloads", (c) => {
  const clip = getClip(Number(c.req.param("cid")));
  if (!clip) return c.json({ error: "clip non trovato" }, 404);
  try {
    const path = saveToDownloads(clip);
    return c.json({ path, size: statSync(path).size });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

clipRoutes.delete("/api/clips/:cid", (c) => {
  const ok = forgetClip(Number(c.req.param("cid")));
  return ok ? c.json({ ok: true }) : c.json({ error: "clip non trovato" }, 404);
});
