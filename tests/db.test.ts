import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchemaOn } from "../server/db.ts";

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
