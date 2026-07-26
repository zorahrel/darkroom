import { existsSync } from "node:fs";
import { db, type CharacterRow, type PhotoRow } from "./db.ts";
import { enqueueJob } from "./jobs.ts";

/**
 * Storyboard support.
 *
 * A storyboard is an ordinary Darkroom project whose photos are panels: same
 * versioning, same job queue, same grade — plus an order (`sequence_index`), a
 * duration, an optional scene label, and optional pinned characters. A photo
 * gallery leaves all of that NULL and behaves exactly as it always has.
 *
 * Everything here is plain SQLite work: sequencing a storyboard must never
 * touch the CDP worker or enqueue a job (see `createPanels` for the one place
 * that deliberately does enqueue).
 */

export type Panel = {
  id: string;
  sequence_index: number;
  duration_ms: number;
  scene_label: string | null;
  character_ids: string[];
  kind: "original" | "generated";
  favorite_version_id: number | null;
  version_count: number;
  /** Absolute path of the image this panel currently exports as, if any. */
  image_path: string | null;
  updated_at: number;
};

export type StoryboardSettings = {
  /** Style preamble prepended to every panel prompt. */
  style: string;
  /** Frame aspect ratio, mirrored into the exported file. */
  aspect_ratio: number;
  fps: number;
};

export const DEFAULT_STORYBOARD_SETTINGS: StoryboardSettings = {
  style:
    "A single cinematic storyboard panel: clean black-and-white sketch, confident marker linework with soft grey tone blocking, clear staging and a readable silhouette for every character. Draw only what the shot description says, framed as a real camera would see it. No text, no captions, no borders, no panel numbers, no watermark.",
  aspect_ratio: 16 / 9,
  fps: 24,
};

const SETTINGS_KEY = "storyboard";

export function getStoryboardSettings(): StoryboardSettings {
  const row = db()
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY);
  if (!row?.value) return { ...DEFAULT_STORYBOARD_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<StoryboardSettings>;
    return {
      style:
        typeof parsed.style === "string" && parsed.style.trim()
          ? parsed.style.trim()
          : DEFAULT_STORYBOARD_SETTINGS.style,
      aspect_ratio:
        Number.isFinite(parsed.aspect_ratio) && Number(parsed.aspect_ratio) > 0
          ? Number(parsed.aspect_ratio)
          : DEFAULT_STORYBOARD_SETTINGS.aspect_ratio,
      fps:
        Number.isFinite(parsed.fps) && Number(parsed.fps) > 0
          ? Math.round(Number(parsed.fps))
          : DEFAULT_STORYBOARD_SETTINGS.fps,
    };
  } catch {
    return { ...DEFAULT_STORYBOARD_SETTINGS };
  }
}

export function setStoryboardSettings(patch: Partial<StoryboardSettings>): StoryboardSettings {
  const next = { ...getStoryboardSettings(), ...patch };
  const clean = getStoryboardSettingsFrom(next);
  db().run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_KEY, JSON.stringify(clean)],
  );
  return clean;
}

/** Validate an arbitrary settings object, falling back per-field. */
function getStoryboardSettingsFrom(raw: Partial<StoryboardSettings>): StoryboardSettings {
  return {
    style:
      typeof raw.style === "string" && raw.style.trim()
        ? raw.style.trim()
        : DEFAULT_STORYBOARD_SETTINGS.style,
    aspect_ratio:
      Number.isFinite(raw.aspect_ratio) && Number(raw.aspect_ratio) > 0
        ? Number(raw.aspect_ratio)
        : DEFAULT_STORYBOARD_SETTINGS.aspect_ratio,
    fps:
      Number.isFinite(raw.fps) && Number(raw.fps) > 0
        ? Math.round(Number(raw.fps))
        : DEFAULT_STORYBOARD_SETTINGS.fps,
  };
}

// ---- Panels ----------------------------------------------------------------

/** Parse a stored `character_ids` JSON array, tolerating anything else. */
export function parseCharacterIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The image a panel exports as: its favourite version, else the newest version,
 * else the original. Versions whose file is gone (or which are still being
 * written by a running job) are skipped rather than exported as a broken panel.
 */
export function resolvePanelImage(photo: PhotoRow): string | null {
  const rows = db()
    .query<{ id: number; image_path: string }, [string]>(
      `SELECT v.id, v.image_path FROM versions v
        WHERE v.photo_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM jobs j
             WHERE j.result_version_id = v.id AND j.status <> 'done'
          )
        ORDER BY v.id DESC`,
    )
    .all(photo.id);

  const favorite = rows.find((r) => r.id === photo.favorite_version_id);
  if (favorite && existsSync(favorite.image_path)) return favorite.image_path;
  for (const r of rows) {
    if (existsSync(r.image_path)) return r.image_path;
  }
  if (photo.original_path && existsSync(photo.original_path)) return photo.original_path;
  return null;
}

function toPanel(row: PhotoRow & { version_count: number }): Panel {
  return {
    id: row.id,
    sequence_index: row.sequence_index ?? 0,
    duration_ms: row.duration_ms,
    scene_label: row.scene_label,
    character_ids: parseCharacterIds(row.character_ids),
    kind: row.kind,
    favorite_version_id: row.favorite_version_id,
    version_count: row.version_count,
    image_path: resolvePanelImage(row),
    updated_at: row.updated_at,
  };
}

/** Every panel of the active project, in order. */
export function listPanels(): Panel[] {
  const rows = db()
    .query<PhotoRow & { version_count: number }, []>(
      `SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) AS version_count
         FROM photos p
        WHERE p.sequence_index IS NOT NULL
        ORDER BY p.sequence_index ASC, p.id ASC`,
    )
    .all();
  return rows.map(toPanel);
}

export function getPanel(id: string): Panel | null {
  const row = db()
    .query<PhotoRow & { version_count: number }, [string]>(
      `SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.photo_id = p.id) AS version_count
         FROM photos p WHERE p.id = ?`,
    )
    .get(id);
  return row ? toPanel(row) : null;
}

/**
 * Rewrite the whole order in one transaction: the ids given become panels
 * 0..N-1, in that order. Ids that don't exist are ignored (a stale client must
 * not be able to corrupt the sequence). Photos left out keep whatever index
 * they had — use `removeFromSequence` to pull one out of the storyboard.
 */
export function setSequence(ids: string[]): { updated: number; skipped: string[] } {
  const d = db();
  const skipped: string[] = [];
  let updated = 0;
  const exists = d.prepare<{ id: string }, [string]>("SELECT id FROM photos WHERE id = ?");
  const update = d.prepare(
    "UPDATE photos SET sequence_index = ?, updated_at = ? WHERE id = ?",
  );
  const now = Date.now();
  d.transaction(() => {
    let index = 0;
    for (const id of ids) {
      if (!exists.get(id)) {
        skipped.push(id);
        continue;
      }
      update.run(index, now, id);
      index++;
      updated++;
    }
  })();
  return { updated, skipped };
}

/**
 * Bring existing photos into the storyboard, appended in the order given.
 * Photos already in the sequence keep their place (this is "add", not "move").
 */
export function appendToSequence(ids: string[]): { added: number } {
  const current = listPanels().map((p) => p.id);
  const fresh = ids.filter((id) => typeof id === "string" && !current.includes(id));
  if (!fresh.length) return { added: 0 };
  const { updated } = setSequence([...current, ...fresh]);
  return { added: Math.max(0, updated - current.length) };
}

/** Drop a photo out of the storyboard without deleting it. */
export function removeFromSequence(id: string): boolean {
  const res = db().run(
    "UPDATE photos SET sequence_index = NULL, updated_at = ? WHERE id = ? AND sequence_index IS NOT NULL",
    [Date.now(), id],
  );
  if (res.changes === 0) return false;
  compactSequence();
  return true;
}

/** Close the holes left by removals so indices stay 0..N-1. */
export function compactSequence(): void {
  const ids = db()
    .query<{ id: string }, []>(
      "SELECT id FROM photos WHERE sequence_index IS NOT NULL ORDER BY sequence_index ASC, id ASC",
    )
    .all()
    .map((r) => r.id);
  setSequence(ids);
}

export type PanelPatch = {
  duration_ms?: number;
  scene_label?: string | null;
  character_ids?: string[];
};

/** Update a panel's own fields. Never touches order or images. */
export function updatePanel(id: string, patch: PanelPatch): Panel | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.duration_ms !== undefined) {
    const ms = Math.round(Number(patch.duration_ms));
    if (!Number.isFinite(ms) || ms <= 0) throw new Error("duration_ms must be a positive number");
    sets.push("duration_ms = ?");
    params.push(ms);
  }
  if (patch.scene_label !== undefined) {
    const label = patch.scene_label?.trim() || null;
    sets.push("scene_label = ?");
    params.push(label);
  }
  if (patch.character_ids !== undefined) {
    if (!Array.isArray(patch.character_ids)) throw new Error("character_ids must be an array");
    const known = new Set(listCharacters().map((ch) => ch.id));
    const ids = patch.character_ids.filter((cid) => typeof cid === "string" && known.has(cid));
    sets.push("character_ids = ?");
    params.push(ids.length ? JSON.stringify(ids) : null);
  }
  if (!sets.length) return getPanel(id);
  sets.push("updated_at = ?");
  params.push(Date.now(), id);
  const res = db().run(`UPDATE photos SET ${sets.join(", ")} WHERE id = ?`, params);
  return res.changes ? getPanel(id) : null;
}

// ---- Characters ------------------------------------------------------------

export function listCharacters(): CharacterRow[] {
  return db()
    .query<CharacterRow, []>("SELECT * FROM characters ORDER BY created_at ASC, id ASC")
    .all();
}

export function getCharacter(id: string): CharacterRow | null {
  return (
    db().query<CharacterRow, [string]>("SELECT * FROM characters WHERE id = ?").get(id) ?? null
  );
}

export type CharacterInput = {
  id?: string;
  name: string;
  reference_photo_id?: string | null;
  description?: string | null;
};

/** Create or update a character. Ids are slugs derived from the name. */
export function upsertCharacter(input: CharacterInput): CharacterRow {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("name required");
  const id = (input.id?.trim() || slugify(name)) as string;
  if (!id) throw new Error("could not derive an id from the name");

  const ref = input.reference_photo_id?.trim() || null;
  if (ref && !db().query("SELECT id FROM photos WHERE id = ?").get(ref)) {
    throw new Error(`reference photo not found: ${ref}`);
  }
  const description = input.description?.trim() || null;

  const existing = getCharacter(id);
  if (existing) {
    db().run(
      "UPDATE characters SET name = ?, reference_photo_id = ?, description = ? WHERE id = ?",
      [name, ref, description, id],
    );
  } else {
    db().run(
      "INSERT INTO characters (id, name, reference_photo_id, description, created_at) VALUES (?,?,?,?,?)",
      [id, name, ref, description, Date.now()],
    );
  }
  return getCharacter(id)!;
}

/** Delete a character and unpin it from every panel that referenced it. */
export function deleteCharacter(id: string): boolean {
  const res = db().run("DELETE FROM characters WHERE id = ?", [id]);
  if (res.changes === 0) return false;
  for (const panel of listPanels()) {
    if (panel.character_ids.includes(id)) {
      const left = panel.character_ids.filter((c) => c !== id);
      db().run("UPDATE photos SET character_ids = ?, updated_at = ? WHERE id = ?", [
        left.length ? JSON.stringify(left) : null,
        Date.now(),
        panel.id,
      ]);
    }
  }
  return true;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Reference images to attach to a panel's generation request: the reference
 * photo of every character pinned on it, deduped, existing files only.
 */
export function referencePathsFor(characterIds: string[]): string[] {
  const out: string[] = [];
  for (const cid of characterIds) {
    const ch = getCharacter(cid);
    if (!ch?.reference_photo_id) continue;
    const photo = db()
      .query<PhotoRow, [string]>("SELECT * FROM photos WHERE id = ?")
      .get(ch.reference_photo_id);
    if (!photo) continue;
    const path = resolvePanelImage(photo);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

// ---- Creating panels from a beat sheet --------------------------------------

export type Beat = {
  /** What happens in this shot — the only required field. */
  description: string;
  duration_ms?: number;
  scene_label?: string | null;
  character_ids?: string[];
};

/**
 * Turn a beat sheet into panels: one generated photo per beat, appended to the
 * end of the sequence, each with a queued text-to-image job. This is the one
 * function here that talks to the queue.
 */
export function createPanels(beats: Beat[]): { ids: string[]; enqueued: number } {
  if (!Array.isArray(beats) || beats.length === 0) throw new Error("beats required");
  const settings = getStoryboardSettings();
  const d = db();
  const startRow = d
    .query<{ next: number | null }, []>(
      "SELECT MAX(sequence_index) + 1 AS next FROM photos WHERE sequence_index IS NOT NULL",
    )
    .get();
  let index = startRow?.next ?? 0;

  const now = Date.now();
  const ids: string[] = [];
  const insert = d.prepare(
    `INSERT INTO photos (id, original_path, original_ext, kind, sequence_index, duration_ms, scene_label, character_ids, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?, ?, ?, ?, ?)`,
  );

  const known = new Set(listCharacters().map((ch) => ch.id));
  const prepared = beats.map((beat, i) => {
    const description = String(beat.description ?? "").trim();
    if (!description) throw new Error(`beat ${i + 1} has no description`);
    const duration = Number.isFinite(beat.duration_ms) && Number(beat.duration_ms) > 0
      ? Math.round(Number(beat.duration_ms))
      : 3000;
    const characterIds = (beat.character_ids ?? []).filter(
      (cid) => typeof cid === "string" && known.has(cid),
    );
    return {
      description,
      duration,
      sceneLabel: beat.scene_label?.trim() || null,
      characterIds,
    };
  });

  // Insert every panel first, so a queue hiccup can't leave a half-written board.
  d.transaction(() => {
    for (const [i, beat] of prepared.entries()) {
      const id = `panel_${now}_${String(i).padStart(3, "0")}`;
      insert.run(
        id,
        index++,
        beat.duration,
        beat.sceneLabel,
        beat.characterIds.length ? JSON.stringify(beat.characterIds) : null,
        now,
        now,
      );
      ids.push(id);
    }
  })();

  let enqueued = 0;
  for (const [i, beat] of prepared.entries()) {
    const refs = referencePathsFor(beat.characterIds);
    enqueueJob(
      ids[i]!,
      panelPrompt(settings, beat.description, beat.sceneLabel, beat.characterIds, refs.length > 0),
      null,
      "chatgpt",
      null,
      "generate",
      null,
      refs.length ? JSON.stringify(refs) : null,
    );
    enqueued++;
  }
  return { ids, enqueued };
}

/** The prompt for one panel: style preamble, scene, action, cast. */
export function panelPrompt(
  settings: StoryboardSettings,
  description: string,
  sceneLabel: string | null,
  characterIds: string[],
  hasReferences: boolean,
): string {
  const parts = [settings.style, "", `Shot: ${description}`];
  if (sceneLabel) parts.push(`Scene: ${sceneLabel}`);
  const names = characterIds
    .map((id) => getCharacter(id))
    .filter((ch): ch is CharacterRow => Boolean(ch))
    .map((ch) => (ch.description ? `${ch.name} (${ch.description})` : ch.name));
  if (names.length) {
    parts.push(`Cast in frame: ${names.join("; ")}.`);
    if (hasReferences) {
      // The attached reference images are what makes a character recognisable
      // from one panel to the next — say so explicitly, or the model treats
      // them as scenery.
      parts.push(
        "The attached reference images show these characters — keep their faces, build, hair and outfit consistent with them. Do not copy the reference framing or background: draw the shot described above.",
      );
    }
  }
  return parts.join("\n");
}
