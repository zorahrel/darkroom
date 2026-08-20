import { Hono } from "hono";
import { serveFile } from "../http.ts";
import {
  shots, cuts, assets, setScelta, clipPath, posterPath, assetPath,
  segnalaProblema, togliProblema, setRipresa,
} from "../video.ts";

/** Everything a video project's editor page needs. Read-only except for the
 *  keep/kill, which is the one decision the pipeline cannot take by itself. */
export const videoRoutes = new Hono();

videoRoutes.get("/api/video/shots", (c) => c.json({ shots: shots() }));
videoRoutes.get("/api/video/cuts", (c) => c.json(cuts()));
videoRoutes.get("/api/video/assets", (c) => c.json(assets()));

videoRoutes.post("/api/video/pick", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    shot?: string; kept?: boolean; perche?: string;
  };
  if (!body.shot) return c.json({ error: "shot mancante" }, 400);
  const s = setScelta(body.shot, body.kept !== false, body.perche);
  return c.json({ ok: true, scartati: s.scartati, shots: shots() });
});

videoRoutes.post("/api/video/problema", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; testo?: string; i?: number };
  if (!b.shot) return c.json({ error: "shot mancante" }, 400);
  if (typeof b.i === "number") togliProblema(b.shot, b.i);
  else segnalaProblema(b.shot, b.testo ?? "");
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/ripresa", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; take?: string; kept?: boolean };
  if (!b.shot || !b.take) return c.json({ error: "shot o take mancante" }, 400);
  setRipresa(b.shot, b.take, b.kept !== false);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.get("/api/video/clip/:shot/:take", (c) => {
  const p = clipPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/poster/:shot/:take", (c) => {
  const p = posterPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/asset/:name", (c) => {
  const p = assetPath(c.req.param("name"));
  return p ? serveFile(p) : new Response("not found", { status: 404 });
});
