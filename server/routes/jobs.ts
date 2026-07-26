import { Hono } from "hono";
import {
  cancelPending,
  getRunnerStatus,
  jobsSummary,
  listJobs,
  listJobsForPhoto,
  markAllFailedSeen,
  markJobSeen,
} from "../jobs.ts";

/** The queue: what is running, what failed, what the user dismissed. */
export const jobRoutes = new Hono();

// ---- API: jobs -------------------------------------------------------------

jobRoutes.get("/api/jobs", (c) => {
  const summary = jobsSummary();
  const items = listJobs(50);
  return c.json({ summary, items, runner: getRunnerStatus() });
});

jobRoutes.post("/api/jobs/:id/cancel", (c) => {
  const id = Number(c.req.param("id"));
  const ok = cancelPending(id);
  if (!ok) return c.json({ error: "cannot cancel" }, 400);
  return c.json({ ok: true });
});

jobRoutes.post("/api/jobs/:id/seen", (c) => {
  const id = Number(c.req.param("id"));
  const ok = markJobSeen(id);
  return c.json({ ok });
});

jobRoutes.post("/api/jobs/seen-failed", (c) => {
  const dismissed = markAllFailedSeen();
  return c.json({ ok: true, dismissed });
});

jobRoutes.get("/api/photos/:id/jobs", (c) => {
  const id = c.req.param("id");
  return c.json({ jobs: listJobsForPhoto(id) });
});
