import { Hono } from "hono";
import { existsSync, unlinkSync } from "node:fs";
import {
  db,
  effectivePrompt,
  effectiveGrade,
  getGlobalPrompt,
  type VersionRow,
} from "../db.ts";
import { genDir } from "../project.ts";
import { effectiveConfig, getPhoto, getVersionsFor, promptFor, withExtra } from "../photos.ts";

/** Photos: the grid, one photo's detail, and its per-photo fields. */
export const photoRoutes = new Hono();

// ---- API: photos -----------------------------------------------------------

photoRoutes.get("/api/photos", (c) => {
  const filter = c.req.query("filter") ?? "all";
  const where: string[] = [];
  if (filter === "no_versions") {
    where.push("(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) = 0");
  } else if (filter === "with_versions") {
    where.push("(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) > 0");
  } else if (filter === "no_favorite") {
    where.push("p.favorite_version_id IS NULL");
  } else if (filter === "with_favorite") {
    where.push("p.favorite_version_id IS NOT NULL");
  } else if (filter === "in_queue") {
    where.push(
      "EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status IN ('pending','running'))",
    );
  } else if (filter === "failed") {
    where.push(
      "EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status = 'failed') AND NOT EXISTS (SELECT 1 FROM versions v WHERE v.photo_id = p.id)",
    );
  } else if (filter === "with_override") {
    where.push("p.config_override IS NOT NULL");
  } else if (filter === "picked") {
    where.push("p.picked = 1");
  } else if (filter === "not_picked") {
    where.push("p.picked = 0");
  } else if (filter === "pro") {
    // Render dal modello a pagamento: è il master, distinto dalla bozza web.
    where.push(`EXISTS (
      SELECT 1 FROM versions v WHERE v.photo_id = p.id AND v.provider = 'higgsfield'
    )`);
  } else if (filter === "pro_todo") {
    // Il complemento di "pro", ed e' la domanda che ci si fa davvero prima di
    // spendere: cosa MANCA da rifinire. Solo foto gia' assegnate a un post e
    // non saltate — le altre non usciranno, quindi un master su di esse e'
    // denaro buttato. E si guarda la PREFERITA, non una versione qualsiasi:
    // e' quella che finira' nel post.
    where.push(`EXISTS (SELECT 1 FROM collection_photos cp WHERE cp.photo_id = p.id)
      AND p.skipped = 0
      AND NOT EXISTS (
        SELECT 1 FROM versions v
         WHERE v.id = p.favorite_version_id AND v.provider = 'higgsfield'
      )`);
  } else if (filter === "recent") {
    // Le foto rigenerate di recente: dopo una tornata di modifiche al prompt o
    // al grade, è l'unico gruppo che vale la pena riguardare. 24 ore, non 12:
    // il cap di ChatGPT dura mezza giornata, quindi l'ultima tornata finisce
    // quasi sempre "ieri sera" e con una finestra corta sparirebbe.
    where.push(`EXISTS (
      SELECT 1 FROM versions v WHERE v.photo_id = p.id
        AND v.created_at > (strftime('%s','now') - 24*3600) * 1000
    )`);
  } else if (filter === "unassigned") {
    // Not in any post yet: the working queue while you're still curating.
    where.push("NOT EXISTS (SELECT 1 FROM collection_photos cp WHERE cp.photo_id = p.id)");
  } else if (filter === "assigned") {
    where.push("EXISTS (SELECT 1 FROM collection_photos cp WHERE cp.photo_id = p.id)");
  }
  const sql = `
    SELECT
      p.id,
      p.original_ext,
      p.favorite_version_id,
      p.taken_at,
      p.feedback,
      p.picked,
      p.skipped,
      p.skip_reason,
      (SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) AS version_count,
      (SELECT v.version_number FROM versions v
         WHERE v.photo_id = p.id AND v.id = p.favorite_version_id) AS favorite_version_number,
      (SELECT v.id FROM versions v
         WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1) AS latest_version_id,
      (SELECT v.version_number FROM versions v
         WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1) AS latest_version_number,
      -- Provider del render che si sta guardando. La versione web di ChatGPT è
      -- una bozza: serve a decidere l'inquadratura e il colore, ma esce a 1 MP
      -- e schiaccia i neri. Quella "pro" (GPT Image 2 via Higgsfield) è il
      -- master. In griglia devono distinguersi a colpo d'occhio, altrimenti non
      -- si sa cosa è già stato rifinito e cosa no.
      -- COALESCE invece di ORDER BY sulla preferita: dentro una sottoquery
      -- correlata SQLite non risolve la colonna esterna nella clausola ORDER BY,
      -- e l'intera lista falliva con 500. Qui si chiede prima il provider della
      -- preferita, poi quello dell'ultima.
      COALESCE(
        (SELECT v.provider FROM versions v WHERE v.id = p.favorite_version_id),
        (SELECT v.provider FROM versions v
           WHERE v.photo_id = p.id ORDER BY v.id DESC LIMIT 1)
      ) AS shown_provider
    FROM photos p
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY (p.taken_at IS NULL) ASC, p.taken_at ASC, p.id ASC
  `;
  const rows = db()
    .query<
      {
        id: string;
        original_ext: string;
        favorite_version_id: number | null;
        taken_at: number | null;
        feedback: string | null;
        picked: number;
        skipped: number;
        skip_reason: string | null;
        version_count: number;
        favorite_version_number: number | null;
        latest_version_id: number | null;
        latest_version_number: number | null;
        shown_provider: string | null;
      },
      []
    >(sql)
    .all();
  return c.json({ photos: rows });
});

// Per-filter counts for the grid filter bar (one pass, conditional aggregation).
// Keys match the client Filter ids so the bar can index directly. MUST be
// registered before "/api/photos/:id" or that route captures "counts" as :id.
photoRoutes.get("/api/photos/counts", (c) => {
  const hasVersions = "(SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id)";
  const row = db()
    .query<Record<string, number>, []>(
      `SELECT
         COUNT(*) AS "all",
         SUM(CASE WHEN ${hasVersions} = 0 THEN 1 ELSE 0 END) AS no_versions,
         SUM(CASE WHEN ${hasVersions} > 0 THEN 1 ELSE 0 END) AS with_versions,
         SUM(CASE WHEN p.favorite_version_id IS NULL THEN 1 ELSE 0 END) AS no_favorite,
         SUM(CASE WHEN p.favorite_version_id IS NOT NULL THEN 1 ELSE 0 END) AS with_favorite,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status IN ('pending','running')) THEN 1 ELSE 0 END) AS in_queue,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.photo_id = p.id AND j.status = 'failed') AND ${hasVersions} = 0 THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN p.config_override IS NOT NULL THEN 1 ELSE 0 END) AS with_override,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM collection_photos cp WHERE cp.photo_id = p.id) THEN 1 ELSE 0 END) AS assigned,
         SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM collection_photos cp WHERE cp.photo_id = p.id) THEN 1 ELSE 0 END) AS unassigned,
         SUM(CASE WHEN p.picked = 1 THEN 1 ELSE 0 END) AS picked,
         SUM(CASE WHEN p.picked = 0 THEN 1 ELSE 0 END) AS not_picked,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM versions v
               WHERE v.photo_id = p.id AND v.provider = 'higgsfield') THEN 1 ELSE 0 END) AS pro,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM versions v WHERE v.photo_id = p.id
               AND v.created_at > (strftime('%s','now') - 24*3600) * 1000) THEN 1 ELSE 0 END) AS recent
       FROM photos p`,
    )
    .get();
  return c.json({ counts: row ?? {} });
});

// Every photo that carries a review note — for distilling the next run's
// direction in one pass. Registered before "/api/photos/:id" so "feedback"
// isn't captured as an :id.
photoRoutes.get("/api/feedback", (c) => {
  const rows = db()
    .query<{ id: string; feedback: string; updated_at: number }, []>(
      "SELECT id, feedback, updated_at FROM photos WHERE feedback IS NOT NULL AND TRIM(feedback) <> '' ORDER BY updated_at DESC",
    )
    .all();
  return c.json({ feedback: rows, count: rows.length });
});

photoRoutes.get("/api/photos/:id", (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const versions = getVersionsFor(id);
  const cfg = effectiveConfig(photo);
  return c.json({
    photo,
    versions,
    effective_prompt: promptFor(withExtra(cfg, photo)),
    effective_config: cfg,
    has_override: photo.config_override !== null,
    legacy_prompt: effectivePrompt(photo),
    global_prompt: getGlobalPrompt(),
    effective_grade: effectiveGrade(photo),
    has_grade_override: photo.grade_override !== null,
  });
});

photoRoutes.put("/api/photos/:id/favorite", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ version_id: number | null }>();
  if (body.version_id !== null) {
    const exists = db()
      .query<{ id: number }, [number, string]>(
        "SELECT id FROM versions WHERE id = ? AND photo_id = ?",
      )
      .get(body.version_id, id);
    if (!exists) return c.json({ error: "version not found" }, 400);
  }
  db().run(
    "UPDATE photos SET favorite_version_id = ?, updated_at = ? WHERE id = ?",
    [body.version_id, Date.now(), id],
  );
  return c.json({ ok: true });
});

photoRoutes.put("/api/photos/:id/prompt", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ prompt: string | null }>();
  db().run(
    "UPDATE photos SET custom_prompt = ?, updated_at = ? WHERE id = ?",
    [body.prompt, Date.now(), id],
  );
  return c.json({ ok: true });
});

photoRoutes.put("/api/photos/:id/extra", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ extra: string | null }>();
  const value = (body.extra ?? "").trim() || null;
  db().run(
    "UPDATE photos SET extra_instructions = ?, updated_at = ? WHERE id = ?",
    [value, Date.now(), id],
  );
  return c.json({ ok: true });
});

// Freeform per-photo review note jotted on the grid. Read in bulk (below) to
// steer the next run; NOT injected into the prompt.
photoRoutes.put("/api/photos/:id/feedback", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ feedback: string | null }>();
  const value = (body.feedback ?? "").trim() || null;
  db().run("UPDATE photos SET feedback = ?, updated_at = ? WHERE id = ?", [
    value,
    Date.now(),
    id,
  ]);
  return c.json({ ok: true, feedback: value });
});

/** Salta/riprendi una foto.
 *
 *  ChatGPT rifiuta certe foto (personaggi protetti, somiglianze di terzi) e il
 *  suo "no" non cambia riprovando: la flag la toglie dagli accodamenti di
 *  massa. Si imposta da sola quando arriva il rifiuto, ma deve essere
 *  reversibile a mano — le policy cambiano, e una foto ferma per sempre senza
 *  un modo di riprovarla e' un vicolo cieco. */
photoRoutes.put("/api/photos/:id/skipped", async (c) => {
  const id = c.req.param("id");
  const photo = getPhoto(id);
  if (!photo) return c.json({ error: "not found" }, 404);
  const body = (await c.req
    .json<{ skipped?: boolean; reason?: string | null }>()
    .catch(() => ({}))) as { skipped?: boolean; reason?: string | null };
  const skipped = body.skipped !== false;
  const reason = skipped ? (body.reason ?? photo.skip_reason ?? "saltata a mano") : null;
  db().run("UPDATE photos SET skipped = ?, skip_reason = ?, updated_at = ? WHERE id = ?", [
    skipped ? 1 : 0,
    reason,
    Date.now(),
    id,
  ]);
  return c.json({ ok: true, skipped, reason });
});

/** "Mi piace" su una foto: un click nella griglia, niente altro. */
photoRoutes.put("/api/photos/:id/picked", async (c) => {
  const id = c.req.param("id");
  if (!getPhoto(id)) return c.json({ error: "not found" }, 404);
  const body = await c.req
    .json<{ picked?: boolean }>()
    .catch(() => ({}) as { picked?: boolean });
  const picked = body.picked ? 1 : 0;
  db().run("UPDATE photos SET picked = ?, updated_at = ? WHERE id = ?", [
    picked,
    Date.now(),
    id,
  ]);
  return c.json({ ok: true, picked: picked === 1 });
});

photoRoutes.delete("/api/photos/:id/versions/:vid", (c) => {
  const id = c.req.param("id");
  const vid = Number(c.req.param("vid"));
  const v = db()
    .query<VersionRow, [number, string]>(
      "SELECT * FROM versions WHERE id = ? AND photo_id = ?",
    )
    .get(vid, id);
  if (!v) return c.json({ error: "not found" }, 404);

  // If this is the favorite, clear it first
  db().run(
    "UPDATE photos SET favorite_version_id = NULL WHERE id = ? AND favorite_version_id = ?",
    [id, vid],
  );
  db().run("DELETE FROM versions WHERE id = ?", [vid]);

  // Remove the file from disk (only inside generations/)
  if (v.image_path.startsWith(genDir()) && existsSync(v.image_path)) {
    try {
      unlinkSync(v.image_path);
    } catch {}
  }

  return c.json({ ok: true });
});
