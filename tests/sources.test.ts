import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import { addSource, listSources, removeSource, rescanSources } from "../server/sources.ts";
import { TEST_ROOT } from "./setup.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A folder of photos somewhere else on disk — a card, a Lightroom export… */
function folder(name: string, files: string[]): string {
  const path = join(TEST_ROOT, "sources", name);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
  for (const f of files) writeFileSync(join(path, f), PNG);
  return path;
}

function photoRows(): { id: string; original_path: string }[] {
  return db()
    .query<{ id: string; original_path: string }, []>(
      "SELECT id, original_path FROM photos ORDER BY id",
    )
    .all();
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM versions");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM settings WHERE key = 'photo_sources'");
  rmSync(dirs().RAW_DIR, { recursive: true, force: true });
});

describe("linking a folder", () => {
  test("indexes the files where they are, copying nothing", () => {
    const src = folder("linked", ["a.jpg", "b.png"]);

    const { summary } = addSource({ path: src, mode: "link" });

    expect(summary).toMatchObject({ scanned: 2, added: 2, copied: 0 });
    expect(photoRows().map((p) => p.original_path)).toEqual([
      join(src, "a.jpg"),
      join(src, "b.png"),
    ]);
    // Nothing landed in the project's own folder.
    expect(existsSync(join(dirs().RAW_DIR, "a.jpg"))).toBe(false);
  });

  test("ignores non-photos and dotfiles", () => {
    const src = folder("mixed", ["photo.jpg", "notes.txt", ".DS_Store", "raw.CR2"]);
    const { summary } = addSource({ path: src, mode: "link" });
    expect(summary.scanned).toBe(1);
    expect(photoRows()).toHaveLength(1);
  });

  test("re-adding the same folder picks up what's new and skips what isn't", () => {
    const src = folder("growing", ["one.jpg"]);
    addSource({ path: src, mode: "link" });

    writeFileSync(join(src, "two.jpg"), PNG);
    const { summary } = addSource({ path: src, mode: "link" });

    expect(summary).toMatchObject({ scanned: 2, added: 1, skipped: 1 });
    expect(photoRows()).toHaveLength(2);
    expect(listSources()).toHaveLength(1); // registered once, not twice
  });

  test("two folders can each hold a DSC_0001 without one hiding the other", () => {
    const a = folder("card-a", ["DSC_0001.jpg"]);
    const b = folder("card-b", ["DSC_0001.jpg"]);

    addSource({ path: a, mode: "link" });
    addSource({ path: b, mode: "link" });

    const rows = photoRows();
    expect(rows.map((r) => r.id)).toEqual(["DSC_0001", "DSC_0001_2"]);
    expect(new Set(rows.map((r) => r.original_path)).size).toBe(2);
  });
});

describe("copying a folder", () => {
  test("brings the files into the project and indexes the copies", () => {
    const src = folder("to-copy", ["x.jpg"]);

    const { summary } = addSource({ path: src, mode: "copy" });

    expect(summary).toMatchObject({ added: 1, copied: 1 });
    expect(photoRows()[0]!.original_path).toBe(join(dirs().RAW_DIR, "x.jpg"));
    expect(existsSync(join(dirs().RAW_DIR, "x.jpg"))).toBe(true);
    // The original is left alone.
    expect(existsSync(join(src, "x.jpg"))).toBe(true);
  });

  test("copying twice does not duplicate the file", () => {
    const src = folder("copy-twice", ["y.jpg"]);
    addSource({ path: src, mode: "copy" });
    const { summary } = addSource({ path: src, mode: "copy" });
    expect(summary.copied).toBe(0);
    expect(photoRows()).toHaveLength(1);
  });
});

describe("managing sources", () => {
  test("a missing folder is refused with the path in the message", () => {
    expect(() => addSource({ path: "/tmp/nope-not-here-42" })).toThrow(/inesistente/);
    expect(() => addSource({ path: "" })).toThrow(/cartella/);
  });

  test("a file is not a folder", () => {
    const src = folder("with-file", ["a.jpg"]);
    expect(() => addSource({ path: join(src, "a.jpg") })).toThrow(/non è una cartella/);
  });

  test("forgetting a source keeps the photos already indexed", () => {
    const src = folder("forgettable", ["keep.jpg"]);
    addSource({ path: src, mode: "link" });

    expect(removeSource(src)).toBe(true);

    expect(listSources()).toEqual([]);
    expect(photoRows()).toHaveLength(1);
    expect(removeSource(src)).toBe(false);
  });

  test("a rescan picks up files added on disk afterwards", () => {
    const src = folder("rescan", ["first.jpg"]);
    addSource({ path: src, mode: "link" });
    writeFileSync(join(src, "second.jpg"), PNG);

    const summary = rescanSources();

    expect(summary.added).toBe(1);
    expect(photoRows()).toHaveLength(2);
  });

  test("a source whose folder disappeared is survivable", () => {
    const src = folder("vanishing", ["gone.jpg"]);
    addSource({ path: src, mode: "link" });
    rmSync(src, { recursive: true, force: true });

    const summary = rescanSources();

    expect(summary.scanned).toBe(0);
    expect(photoRows()).toHaveLength(1); // the row stays, the file is just missing
  });
});
