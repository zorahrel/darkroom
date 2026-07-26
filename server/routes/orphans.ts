import { Hono } from "hono";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { db, getGlobalPrompt, type OrphanRow } from "../db.ts";
import { genDir } from "../project.ts";
import { getPhoto, getVersionsFor } from "../photos.ts";

/** Renders found on disk with no photo attached yet. */
export const orphanRoutes = new Hono();

// ---- API: orphans ----------------------------------------------------------

orphanRoutes.get("/api/orphans", (c) => {
  const rows = db()
    .query<OrphanRow, []>(
      "SELECT * FROM orphans WHERE assigned_photo_id IS NULL AND skipped = 0 ORDER BY filename ASC",
    )
    .all();
  return c.json({ orphans: rows });
});

orphanRoutes.post("/api/orphans/:filename/assign", async (c) => {
  const filename = c.req.param("filename");
  const body = await c.req.json<{ photo_id: string }>();
  const orphan = db()
    .query<OrphanRow, [string]>(
      "SELECT * FROM orphans WHERE filename = ?",
    )
    .get(filename);
  if (!orphan) return c.json({ error: "orphan not found" }, 404);
  const photo = getPhoto(body.photo_id);
  if (!photo) return c.json({ error: "photo not found" }, 404);

  // Copy file into generations/<photo>/ and pick next free version slot
  const dstDir = join(genDir(), photo.id);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
  const existing = getVersionsFor(photo.id);
  const nextV = (existing.at(-1)?.version_number ?? 0) + 1;
  const dstPath = join(dstDir, `v${String(nextV).padStart(2, "0")}.png`);
  copyFileSync(orphan.source_path, dstPath);

  db().run(
    `INSERT INTO versions
      (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?, ?, ?, ?, 'imported', ?)`,
    [photo.id, nextV, dstPath, getGlobalPrompt(), Date.now()],
  );
  db().run(
    "UPDATE orphans SET assigned_photo_id = ? WHERE filename = ?",
    [photo.id, filename],
  );

  return c.json({ ok: true, version_number: nextV });
});

orphanRoutes.post("/api/orphans/:filename/skip", (c) => {
  const filename = c.req.param("filename");
  const r = db().run("UPDATE orphans SET skipped = 1 WHERE filename = ?", [
    filename,
  ]);
  return c.json({ ok: r.changes > 0 });
});
