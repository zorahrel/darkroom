import { Hono } from "hono";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { effectiveGrade, getColorGrade } from "../db.ts";
import { REPO_ROOT } from "../config.ts";
import { genDir, rawDir, test1Dir } from "../project.ts";
import { getPhoto } from "../photos.ts";
import { parseWidth, safeSeg, serveFile } from "../http.ts";
import { thumbnailPath } from "../thumb.ts";
import { gradeActive, gradeFromQuery, gradedFile, runColorGrade, sceneMatchRequested } from "../gradeCache.ts";
import { wbGainFor } from "../sceneWb.ts";

/** Everything that serves bytes: originals, generations, thumbs, graded
 *  renders, and the built SPA. Mounted last — it owns the catch-all. */
export const mediaRoutes = new Hono();

// ---- Static: raw, generations, thumbs --------------------------------------

mediaRoutes.get("/raw/:filename", (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(rawDir(), filename));
});

// Serve a photo's original by id, reading its stored path directly. Works for
// both imported originals (in RAW) and generated photos (in GEN), and is the
// canonical "original" URL used by the client.
mediaRoutes.get("/orig/:id", (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo || !photo.original_path || !existsSync(photo.original_path)) {
    return new Response("not found", { status: 404 });
  }
  return serveFile(photo.original_path);
});

mediaRoutes.get("/gen/:photoId/:filename", (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (
    photoId.includes("..") ||
    photoId.includes("/") ||
    filename.includes("..") ||
    filename.includes("/")
  ) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(genDir(), photoId, filename));
});

mediaRoutes.get("/orphan/:filename", (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  return serveFile(join(test1Dir(), filename));
});

mediaRoutes.get("/thumb/raw/:id", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return new Response("not found", { status: 404 });
  try {
    const path = await thumbnailPath(photo.original_path, parseWidth(c, 480));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

mediaRoutes.get("/thumb/gen/:photoId/:filename", async (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (
    photoId.includes("..") ||
    photoId.includes("/") ||
    filename.includes("..") ||
    filename.includes("/")
  ) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(genDir(), photoId, filename);
  try {
    const path = await thumbnailPath(source, parseWidth(c, 720));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

mediaRoutes.get("/thumb/orphan/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (filename.includes("..") || filename.includes("/")) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(test1Dir(), filename);
  try {
    const path = await thumbnailPath(source, parseWidth(c, 480));
    return serveFile(path, "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});

// Serve a generation with the color look (step engine: WB + levels + sakura +
// LUT + color) applied on the fly, cached on disk by a params-hash. Grade off /
// no active steps / grade error all fail open to the ungraded generation, so the
// grid never breaks.
mediaRoutes.get("/graded/:photoId/:filename", (c) => {
  const photoId = c.req.param("photoId");
  const filename = c.req.param("filename");
  if (!safeSeg(photoId) || !safeSeg(filename)) {
    return new Response("bad request", { status: 400 });
  }
  const source = join(genDir(), photoId, filename);
  if (!existsSync(source)) return new Response("not found", { status: 404 });

  // Grade base = per-photo override if present, else the global; then optional
  // query params (unsaved live preview) override it.
  const photo = getPhoto(photoId);
  const base = photo ? effectiveGrade(photo) : getColorGrade();
  const cfg = gradeFromQuery(c, base);
  if (!gradeActive(cfg)) {
    return serveFile(source); // passthrough — ungraded original
  }
  const width = parseWidth(c, 1600, 3200);
  const wbGain = sceneMatchRequested(cfg) ? wbGainFor(photoId) : null;
  const out = gradedFile(photoId, filename, source, cfg, width, wbGain);
  if (!existsSync(out)) {
    const ok = runColorGrade(source, out, cfg, width, 90, 60000, wbGain);
    if (!ok) return serveFile(source); // fail open on grade error
  }
  return serveFile(out, "image/jpeg");
});

// ---- Static: built SPA (dist) + live filter previews -----------------------
// Lets the dashboard be served from the backend port directly (no separate
// Vite needed). Previews are served live from client/public so freshly
// generated thumbnails show up without a rebuild.
// The built SPA + previews are part of the APP, not a project's data — serve
// them from the repo (where `vite build` emits dist/), independent of the
// active project. (Vite's outDir is <repo>/dist.)
const DIST_DIR = join(REPO_ROOT, "dist");
const PUBLIC_DIR = join(REPO_ROOT, "client", "public");

mediaRoutes.get("/previews/*", (c) => {
  const rel = c.req.path.replace(/^\/+/, "");
  if (rel.includes("..")) return new Response("bad request", { status: 400 });
  return serveFile(join(PUBLIC_DIR, rel));
});

mediaRoutes.get("/assets/*", (c) => {
  const rel = c.req.path.replace(/^\/+/, "");
  if (rel.includes("..")) return new Response("bad request", { status: 400 });
  return serveFile(join(DIST_DIR, rel));
});

// SPA fallback: any other GET serves index.html (client-side routing).
mediaRoutes.get("*", () => serveFile(join(DIST_DIR, "index.html"), "text/html; charset=utf-8"));
