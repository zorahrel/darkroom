import { Hono } from "hono";
import { serveFile } from "../http.ts";
import {
  shots, cuts, assets, setPick, clipPath, posterPath, assetPath,
  flagProblem, clearProblem, setShot, setPin, setDuration,
  setManualIntensity, setDescription, gate, startRebuild, rebuildState, wave, setMarker, markers, overrides, clearVerdict, swap, unpin, take } from "../video.ts";
import { listProjects, currentProjectId } from "../project.ts";
import { enqueueVideoJob, listVideoJobs, cancelVideoJob, DEFAULT_PARAMS, type ComfyParams } from "../comfy.ts";
import { normaliseVideoParams } from "../videoParams.ts";

/** Everything a video project's editor page needs. Read-only except for the
 *  keep/kill and the three forced edits, which are the decisions the pipeline
 *  cannot take by itself. */
export const videoRoutes = new Hono();

/** A fence: a photo project has no `plan.json` nor `master.sh`, and these
 *  routes would read its folder looking for them. Better an honest 404. */
videoRoutes.use("/api/video/*", async (c, next) => {
  const pid = currentProjectId();
  const p = listProjects().find((x) => x.id === pid);
  if (p && p.kind !== "video") {
    return c.json({ error: `'${p.name}' non e' un progetto video` }, 404);
  }
  await next();
});

videoRoutes.get("/api/video/shots", (c) => c.json({ shots: shots() }));
videoRoutes.get("/api/video/cuts", (c) => c.json(cuts()));
videoRoutes.get("/api/video/assets", (c) => c.json(assets()));

videoRoutes.post("/api/video/pick", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    shot?: string; kept?: boolean | null; why?: string;
  };
  if (!body.shot) return c.json({ error: "shot mancante" }, 400);
  // An explicit `kept: null` = remove the verdict (the undo). Distinct from
  // "field absent", which stays a yes: that is the signature it had before.
  const kept = body.kept === null ? null : body.kept !== false;
  const s = setPick(body.shot, kept, body.why);
  return c.json({ ok: true, discarded: s.discarded, shots: shots() });
});

videoRoutes.post("/api/video/intensity", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; value?: number | null };
  if (!b.shot) return c.json({ error: "shot mancante" }, 400);
  setManualIntensity(b.shot, typeof b.value === "number" ? b.value : null);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/description", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; text?: string };
  if (!b.shot) return c.json({ error: "shot mancante" }, 400);
  setDescription(b.shot, String(b.text ?? ""));
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/problem", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; text?: string; i?: number };
  if (!b.shot) return c.json({ error: "shot mancante" }, 400);
  if (typeof b.i === "number") clearProblem(b.shot, b.i);
  else flagProblem(b.shot, b.text ?? "");
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/take", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; take?: string; kept?: boolean };
  if (!b.shot || !b.take) return c.json({ error: "shot o take mancante" }, 400);
  setShot(b.shot, b.take, b.kept !== false);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.get("/api/video/clip/:shot/:take", (c) => {
  const p = clipPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/poster/:shot/:take", (c) => {
  const p = posterPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/asset/:name", (c) => {
  const p = assetPath(c.req.param("name"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});

videoRoutes.post("/api/video/pin", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { bar?: number; shot?: string | null };
  if (typeof b.bar !== "number") return c.json({ error: "battuta mancante" }, 400);
  setPin(b.bar, b.shot ?? null);
  return c.json({ ok: true });
});

videoRoutes.post("/api/video/duration", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { bar?: number; bars?: number | null };
  if (typeof b.bar !== "number") return c.json({ error: "battuta mancante" }, 400);
  setDuration(b.bar, b.bars ?? null);
  return c.json({ ok: true });
});

// The bar costs: `check.py` extracts frames with ffmpeg. The result is kept
// until the cut changes; `?force=1` redoes it anyway.
videoRoutes.post("/api/video/clear-verdict", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const shot = String(b.shot ?? "");
  if (!shot) return c.json({ error: "serve il piano" }, 400);
  clearVerdict(shot);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/swap", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const [ba, pa, bb, pb] = [Number(b.barA), String(b.shotA ?? ""), Number(b.barB), String(b.shotB ?? "")];
  if (!Number.isFinite(ba) || !Number.isFinite(bb) || !pa || !pb) return c.json({ error: "scambio incompleto" }, 400);
  if (ba === bb) return c.json({ error: "e' la stessa battuta" }, 400);
  return c.json({ pin: swap(ba, pa, bb, pb) });
});

videoRoutes.post("/api/video/unpin", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const bb = Array.isArray(b.bars) ? b.bars.map(Number).filter(Number.isFinite) : [];
  return c.json({ pin: unpin(bb) });
});

videoRoutes.get("/api/video/overrides", (c) => c.json(overrides()));

videoRoutes.get("/api/video/markers", (c) => c.json({ markers: markers() }));

videoRoutes.post("/api/video/marker", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const t = Number(b.t);
  if (!Number.isFinite(t) || t < 0) return c.json({ error: "istante non valido" }, 400);
  setMarker(t, b.note ? String(b.note).slice(0, 300) : null);
  return c.json({ markers: markers() });
});

videoRoutes.get("/api/video/wave", (c) => c.json(wave()));

videoRoutes.get("/api/video/gate", (c) => c.json(gate(c.req.query("force") === "1")));

videoRoutes.post("/api/video/rebuild", (c) => {
  const r = startRebuild();
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 409);
});
videoRoutes.get("/api/video/rebuild", (c) => c.json(rebuildState()));

/** Generation on the 3090. The Mac does not touch a frame: it is queued here,
 *  generated, collected and interpolated on the PC, and only the light clip
 *  comes back. */
videoRoutes.get("/api/video/provino/:shot/:take", (c) => {
  const f = take(c.req.param("shot"), c.req.param("take"));
  if (!f) return c.json({ error: "niente provino" }, 404);
  return serveFile(f, "image/jpeg", c.req.raw);
});

videoRoutes.get("/api/video/generations", (c) =>
  c.json({ jobs: listVideoJobs(), default: DEFAULT_PARAMS }));

videoRoutes.post("/api/video/generate", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const shot = String(b.shot ?? "").trim();
  const prompt = String(b.prompt ?? "").trim();
  if (!shot || !prompt) return c.json({ error: "servono piano e prompt" }, 400);
  // The shot's name ends up in a path and in a command line on the PC.
  if (!/^[a-z0-9_]+$/i.test(shot)) return c.json({ error: "nome piano non valido" }, 400);
  const take = String(b.take ?? "a");
  if (!/^[a-z]$/.test(take)) return c.json({ error: "take non valido" }, 400);

  const { params, ignored } = normaliseVideoParams(b);
  const job = enqueueVideoJob(shot, prompt, take, params as Partial<ComfyParams>);
  return c.json({ job, params, ignored });
});

videoRoutes.post("/api/video/generations/:id/cancel", (c) =>
  c.json({ ok: cancelVideoJob(Number(c.req.param("id"))) }));
