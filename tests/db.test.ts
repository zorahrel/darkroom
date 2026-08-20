import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchemaOn } from "../server/db.ts";
import { TEST_ROOT } from "./setup.ts";

/** Column names of a table, straight from SQLite. */
function columns(d: Database, table: string): string[] {
  return d
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name);
}

function tables(d: Database): string[] {
  return d
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
}

/** A DB shaped like the very first Darkroom schema, before any migration ran.
 *  This is the shape the real Japan DB started from — the migrations have to
 *  carry it forward without losing a single row. */
function legacyDb(): Database {
  const d = new Database(":memory:");
  d.run(`CREATE TABLE photos (
    id TEXT PRIMARY KEY,
    original_path TEXT NOT NULL,
    original_ext TEXT NOT NULL,
    favorite_version_id INTEGER,
    custom_prompt TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  d.run(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed','cancelled')),
    result_version_id INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  )`);
  return d;
}

describe("schema", () => {
  test("creates every table the app relies on", () => {
    const d = new Database(":memory:");
    initSchemaOn(d);
    for (const t of ["photos", "versions", "settings", "jobs", "orphans", "presets"]) {
      expect(tables(d)).toContain(t);
    }
  });

  test("seeds the global prompt exactly once", () => {
    const d = new Database(":memory:");
    initSchemaOn(d);
    initSchemaOn(d);
    const n = d
      .query<{ c: number }, []>(
        "SELECT COUNT(*) c FROM settings WHERE key = 'global_prompt'",
      )
      .get()!.c;
    expect(n).toBe(1);
  });

  test("re-opening an initialized DB is a no-op (idempotent migrations)", () => {
    const d = new Database(":memory:");
    initSchemaOn(d);
    const before = columns(d, "photos");
    // Three more passes: this is what every server boot does.
    initSchemaOn(d);
    initSchemaOn(d);
    initSchemaOn(d);
    const after = columns(d, "photos");
    expect(after).toEqual(before);
    // No duplicated column names either.
    expect(new Set(after).size).toBe(after.length);
  });
});

describe("migrations on a legacy DB", () => {
  test("adds the newer photo columns without touching existing rows", () => {
    const d = legacyDb();
    d.run(
      "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["p1", "/raw/p1.jpg", "jpg", 1, 2],
    );

    initSchemaOn(d);

    const cols = columns(d, "photos");
    for (const c of [
      "config_override",
      "taken_at",
      "higgsfield_selection",
      "extra_instructions",
      "grade_override",
      "feedback",
      "kind",
    ]) {
      expect(cols).toContain(c);
    }

    const row = d
      .query<Record<string, unknown>, []>("SELECT * FROM photos WHERE id = 'p1'")
      .get()!;
    expect(row.original_path).toBe("/raw/p1.jpg");
    expect(row.created_at).toBe(1);
    // New columns are optional: nothing to backfill, nothing to break.
    expect(row.config_override).toBeNull();
    expect(row.taken_at).toBeNull();
    // …except the ones with a NOT NULL default, which must be filled in.
    expect(row.kind).toBe("original");
  });

  test("adds the newer job columns and keeps queued work", () => {
    const d = legacyDb();
    d.run(
      "INSERT INTO jobs (photo_id, prompt, status, created_at) VALUES (?,?,?,?)",
      ["p1", "edit it", "pending", 1],
    );

    initSchemaOn(d);

    const cols = columns(d, "jobs");
    for (const c of ["config", "provider", "provider_params", "progress", "seen", "attempts", "mode", "input_path"]) {
      expect(cols).toContain(c);
    }
    const row = d.query<Record<string, unknown>, []>("SELECT * FROM jobs").get()!;
    expect(row.status).toBe("pending");
    expect(row.provider).toBe("chatgpt");
    expect(row.mode).toBe("edit");
    expect(row.attempts).toBe(0);
  });

  test("requeues jobs left running by a crash", () => {
    const d = new Database(":memory:");
    initSchemaOn(d);
    d.run(
      "INSERT INTO jobs (photo_id, prompt, status, created_at, started_at) VALUES (?,?,?,?,?)",
      ["p1", "edit it", "running", 1, 2],
    );

    initSchemaOn(d); // simulates the next server boot

    const row = d
      .query<{ status: string; started_at: number | null }, []>(
        "SELECT status, started_at FROM jobs",
      )
      .get()!;
    expect(row.status).toBe("pending");
    expect(row.started_at).toBeNull();
  });

  test("adds the storyboard columns as opt-in, leaving plain photos untouched", () => {
    const d = legacyDb();
    d.run(
      "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["p1", "/raw/p1.jpg", "jpg", 1, 2],
    );

    initSchemaOn(d);

    const row = d
      .query<Record<string, unknown>, []>("SELECT * FROM photos WHERE id = 'p1'")
      .get()!;
    // A gallery photo is not a panel: no order, no label, no characters…
    expect(row.sequence_index).toBeNull();
    expect(row.scene_label).toBeNull();
    expect(row.character_ids).toBeNull();
    // …but it does carry the default panel duration, which costs nothing.
    expect(row.duration_ms).toBe(3000);
    expect(columns(d, "jobs")).toContain("ref_paths");
    expect(tables(d)).toContain("characters");
  });

  test("keeps the gallery index and drops the one it supersedes", () => {
    const d = new Database(":memory:");
    // Pretend this DB was created before the covering index existed.
    d.run(`CREATE TABLE versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      prompt_used TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('imported','generated')),
      created_at INTEGER NOT NULL,
      UNIQUE(photo_id, version_number)
    )`);
    d.run("CREATE INDEX idx_versions_photo ON versions(photo_id)");

    initSchemaOn(d);

    const idx = d
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='versions'",
      )
      .all()
      .map((r) => r.name);
    expect(idx).toContain("idx_versions_photo_id");
    expect(idx).not.toContain("idx_versions_photo");
  });

  test("leaves finished jobs alone on boot", () => {
    const d = new Database(":memory:");
    initSchemaOn(d);
    for (const s of ["done", "failed", "cancelled"]) {
      d.run("INSERT INTO jobs (photo_id, prompt, status, created_at) VALUES (?,?,?,?)", [
        "p1",
        "x",
        s,
        1,
      ]);
    }
    initSchemaOn(d);
    const statuses = d
      .query<{ status: string }, []>("SELECT status FROM jobs ORDER BY id")
      .all()
      .map((r) => r.status);
    expect(statuses).toEqual(["done", "failed", "cancelled"]);
  });
});

/**
 * The real gallery, migrated on a copy. This is the guard that matters for the
 * Japan project: whatever the migrations do, every row must survive. Skipped
 * on machines (and CI) without a local photos.db.
 */
const REAL_DB = join(import.meta.dir, "..", "photos.db");

describe.skipIf(!existsSync(REAL_DB))("real gallery DB", () => {
  test("migrating a copy preserves every row", () => {
    const copy = join(TEST_ROOT, "real-copy.db");
    copyFileSync(REAL_DB, copy);
    const d = new Database(copy);

    const before = Object.fromEntries(
      ["photos", "versions", "jobs", "orphans"].map((t) => [
        t,
        d.query<{ c: number }, []>(`SELECT COUNT(*) c FROM ${t}`).get()!.c,
      ]),
    );
    const favoritesBefore = d
      .query<{ c: number }, []>(
        "SELECT COUNT(*) c FROM photos WHERE favorite_version_id IS NOT NULL",
      )
      .get()!.c;

    initSchemaOn(d);

    for (const [table, count] of Object.entries(before)) {
      expect(d.query<{ c: number }, []>(`SELECT COUNT(*) c FROM ${table}`).get()!.c).toBe(count);
    }
    expect(
      d
        .query<{ c: number }, []>(
          "SELECT COUNT(*) c FROM photos WHERE favorite_version_id IS NOT NULL",
        )
        .get()!.c,
    ).toBe(favoritesBefore);
    // The gallery stays a gallery: nothing became a storyboard panel.
    expect(
      d.query<{ c: number }, []>("SELECT COUNT(*) c FROM photos WHERE sequence_index IS NOT NULL").get()!.c,
    ).toBe(0);
    d.close();
  });
});

describe("due scrittori non devono far esplodere il server", () => {
  test("il busy_timeout e' impostato, non lasciato a zero", () => {
    // Caso reale: uno script di manutenzione con una transazione aperta e ogni
    // scrittura del server rispondeva 500 (SQLITE_BUSY). WAL separa lettori e
    // scrittore, non due scrittori: senza timeout SQLite fallisce all'istante.
    const v = db().query<{ timeout: number }, []>("PRAGMA busy_timeout").get();
    expect(v!.timeout).toBeGreaterThanOrEqual(5000);
  });

  test("il WAL resta attivo", () => {
    const v = db().query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(v!.journal_mode.toLowerCase()).toBe("wal");
  });
});

describe("l'ordine dei PRAGMA all'apertura", () => {
  test("busy_timeout viene impostato PRIMA di journal_mode", async () => {
    const src = await Bun.file(new URL("../server/db.ts", import.meta.url)).text();
    // `journal_mode = WAL` e' una scrittura: con un altro processo sul DB
    // falliva con SQLITE_BUSY_RECOVERY prima ancora che il timeout esistesse,
    // e il server moriva all'avvio. Visto davvero sul backend.
    const iBusy = src.indexOf('PRAGMA busy_timeout');
    const iWal = src.indexOf('PRAGMA journal_mode');
    expect(iBusy).toBeGreaterThan(0);
    expect(iBusy).toBeLessThan(iWal);
  });
});
