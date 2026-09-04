import { Hono } from "hono";
import { cors } from "hono/cors";
import { initSchema } from "./db.ts";
import { getProject, withProject } from "./project.ts";
import { photoRoutes } from "./routes/photos.ts";
import { generationRoutes } from "./routes/generation.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { orphanRoutes } from "./routes/orphans.ts";
import { pipelineRoutes } from "./routes/pipeline.ts";
import { storyboardRoutes } from "./routes/storyboard.ts";
import { verifyRoutes } from "./routes/verify.ts";
import { studioRoutes } from "./routes/studio.ts";
import { strumentiRoutes } from "./routes/strumenti.ts";
import { videoRoutes } from "./routes/video.ts";
import { lineageRoutes } from "./routes/lineage.ts";
import { referenceRoutes } from "./routes/reference.ts";
import { mediaRoutes } from "./routes/media.ts";
import { collectionRoutes } from "./routes/collections.ts";

/**
 * The Darkroom HTTP app: middleware + every route module, with no side effects
 * beyond opening the DB. Boot (listening, starting the job runner) lives in
 * index.ts, so tests can exercise the real app without a server or a worker.
 *
 * Route modules declare absolute paths and are mounted in the original
 * registration order — Hono matches in that order, and a few routes depend on
 * it (`/api/photos/counts` must be seen before `/api/photos/:id`). `media`
 * comes last: it owns the SPA catch-all.
 */

initSchema();

export const app = new Hono();

app.use("*", cors());

// Resolve the active project for every request from `?project=` or the
// `x-darkroom-project` header, and run the handler inside that project's ALS
// context so db()/genDir()/… resolve to it. Unknown/absent → the default
// project (single-project back-compat). Static SPA assets are project-agnostic.
app.use("*", async (c, next) => {
  const pid = c.req.query("project") ?? c.req.header("x-darkroom-project") ?? "";
  if (pid && getProject(pid)) {
    return withProject(pid, () => next());
  }
  return next();
});

app.route("/", photoRoutes);
app.route("/", generationRoutes);
app.route("/", settingsRoutes);
app.route("/", jobRoutes);
app.route("/", orphanRoutes);
app.route("/", pipelineRoutes);
app.route("/api/storyboard", storyboardRoutes);
app.route("/api/verify", verifyRoutes);
app.route("/", collectionRoutes);
app.route("/", videoRoutes);
app.route("/", studioRoutes);
app.route("/", strumentiRoutes);
app.route("/", lineageRoutes);
app.route("/", referenceRoutes);
app.route("/", mediaRoutes);

export default app;
