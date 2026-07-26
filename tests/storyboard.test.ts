import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import {
  appendToSequence,
  createPanels,
  deleteCharacter,
  getStoryboardSettings,
  listCharacters,
  listPanels,
  panelPrompt,
  parseCharacterIds,
  referencePathsFor,
  removeFromSequence,
  resolvePanelImage,
  setSequence,
  setStoryboardSettings,
  updatePanel,
  upsertCharacter,
} from "../server/storyboard.ts";
import { buildScene, exportStoryboard, slugifyName, uidFor } from "../server/storyboardExport.ts";

/** Smallest valid PNG (1x1, transparent). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function writePng(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, PNG_1X1);
  return path;
}

/** Insert a photo, optionally already on disk and already sequenced. */
function makePhoto(
  id: string,
  opts: { file?: boolean; sequence?: number | null; label?: string | null; duration?: number } = {},
): string {
  const path = opts.file === false ? "" : writePng(join(dirs().RAW_DIR, `${id}.png`));
  const now = Date.now();
  db().run(
    `INSERT INTO photos (id, original_path, original_ext, kind, sequence_index, duration_ms, scene_label, created_at, updated_at)
     VALUES (?, ?, '.png', 'original', ?, ?, ?, ?, ?)`,
    [id, path, opts.sequence ?? null, opts.duration ?? 3000, opts.label ?? null, now, now],
  );
  return id;
}

function addVersion(photoId: string, versionNumber: number, opts: { file?: boolean } = {}): number {
  const path = join(dirs().GEN_DIR, photoId, `v${versionNumber}.png`);
  if (opts.file !== false) writePng(path);
  const res = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?,?,?,?,'generated',?)`,
    [photoId, versionNumber, path, "p", Date.now()],
  );
  return Number(res.lastInsertRowid);
}

function reset(): void {
  const d = db();
  d.run("DELETE FROM jobs");
  d.run("DELETE FROM versions");
  d.run("DELETE FROM characters");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM settings WHERE key = 'storyboard'");
  // Wipe the files too: image resolution reads the disk, so a leftover render
  // from an earlier test would quietly stand in for the one under test.
  rmSync(dirs().DATA_DIR, { recursive: true, force: true });
}

beforeEach(reset);

describe("sequencing", () => {
  test("assigns 0..N-1 in the order given", () => {
    makePhoto("a");
    makePhoto("b");
    makePhoto("c");

    const { updated, skipped } = setSequence(["c", "a", "b"]);

    expect(updated).toBe(3);
    expect(skipped).toEqual([]);
    expect(listPanels().map((p) => [p.id, p.sequence_index])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  test("ignores unknown ids instead of leaving holes in the order", () => {
    makePhoto("a");
    makePhoto("b");

    const { updated, skipped } = setSequence(["a", "ghost", "b"]);

    expect(updated).toBe(2);
    expect(skipped).toEqual(["ghost"]);
    expect(listPanels().map((p) => p.sequence_index)).toEqual([0, 1]);
  });

  test("photos outside the sequence are not panels", () => {
    makePhoto("a");
    makePhoto("loose");
    setSequence(["a"]);
    expect(listPanels().map((p) => p.id)).toEqual(["a"]);
  });

  test("adding photos appends them, keeping the existing order", () => {
    makePhoto("a");
    makePhoto("b");
    makePhoto("c");
    setSequence(["b", "a"]);

    const { added } = appendToSequence(["c", "a"]); // "a" is already in

    expect(added).toBe(1);
    expect(listPanels().map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  test("removing a panel closes the gap it leaves", () => {
    makePhoto("a");
    makePhoto("b");
    makePhoto("c");
    setSequence(["a", "b", "c"]);

    expect(removeFromSequence("b")).toBe(true);

    expect(listPanels().map((p) => [p.id, p.sequence_index])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
    // The photo itself survives — it just left the storyboard.
    expect(db().query("SELECT id FROM photos WHERE id = 'b'").get()).toBeTruthy();
  });

  test("removing something that is not a panel reports failure", () => {
    makePhoto("a");
    expect(removeFromSequence("a")).toBe(false);
  });

  test("re-ordering never enqueues a job", () => {
    makePhoto("a");
    makePhoto("b");
    setSequence(["b", "a"]);
    setSequence(["a", "b"]);
    const jobs = db().query<{ c: number }, []>("SELECT COUNT(*) c FROM jobs").get()!.c;
    expect(jobs).toBe(0);
  });
});

describe("panel fields", () => {
  test("duration and label round-trip", () => {
    makePhoto("a");
    setSequence(["a"]);

    const panel = updatePanel("a", { duration_ms: 1500, scene_label: "  INT. BAR - NIGHT  " })!;

    expect(panel.duration_ms).toBe(1500);
    expect(panel.scene_label).toBe("INT. BAR - NIGHT");
  });

  test("a blank label clears it", () => {
    makePhoto("a");
    setSequence(["a"]);
    updatePanel("a", { scene_label: "x" });
    expect(updatePanel("a", { scene_label: "   " })!.scene_label).toBeNull();
  });

  test("rejects a non-positive duration", () => {
    makePhoto("a");
    setSequence(["a"]);
    expect(() => updatePanel("a", { duration_ms: 0 })).toThrow();
    expect(() => updatePanel("a", { duration_ms: -5 })).toThrow();
    expect(() => updatePanel("a", { duration_ms: NaN })).toThrow();
  });

  test("pins only characters that exist", () => {
    makePhoto("a");
    setSequence(["a"]);
    upsertCharacter({ name: "Yuki" });

    const panel = updatePanel("a", { character_ids: ["yuki", "nobody"] })!;

    expect(panel.character_ids).toEqual(["yuki"]);
  });

  test("updating an unknown panel returns null", () => {
    expect(updatePanel("ghost", { duration_ms: 1000 })).toBeNull();
  });
});

describe("characters", () => {
  test("id is slugified from the name and updates are in place", () => {
    const ch = upsertCharacter({ name: "Yuki Tanaka", description: "red coat" });
    expect(ch.id).toBe("yuki-tanaka");

    upsertCharacter({ id: "yuki-tanaka", name: "Yuki Tanaka", description: "blue coat" });

    expect(listCharacters()).toHaveLength(1);
    expect(listCharacters()[0]!.description).toBe("blue coat");
  });

  test("requires a name", () => {
    expect(() => upsertCharacter({ name: "   " })).toThrow();
  });

  test("refuses a reference photo that does not exist", () => {
    expect(() => upsertCharacter({ name: "Ghost", reference_photo_id: "nope" })).toThrow();
  });

  test("deleting a character unpins it from every panel", () => {
    makePhoto("a");
    makePhoto("b");
    setSequence(["a", "b"]);
    upsertCharacter({ name: "Yuki" });
    upsertCharacter({ name: "Ken" });
    updatePanel("a", { character_ids: ["yuki", "ken"] });
    updatePanel("b", { character_ids: ["yuki"] });

    expect(deleteCharacter("yuki")).toBe(true);

    expect(listPanels().map((p) => p.character_ids)).toEqual([["ken"], []]);
  });

  test("reference paths resolve to the character's image", () => {
    makePhoto("ref");
    const ch = upsertCharacter({ name: "Yuki", reference_photo_id: "ref" });
    expect(referencePathsFor([ch.id])).toEqual([
      join(dirs().RAW_DIR, "ref.png"),
    ]);
  });

  test("a character with no reference contributes no attachment", () => {
    upsertCharacter({ name: "Voice" });
    expect(referencePathsFor(["voice"])).toEqual([]);
  });

  test("parseCharacterIds survives corrupt JSON", () => {
    expect(parseCharacterIds(null)).toEqual([]);
    expect(parseCharacterIds("{oops")).toEqual([]);
    expect(parseCharacterIds('["a", 3, "b"]')).toEqual(["a", "b"]);
  });
});

describe("panel image resolution", () => {
  test("prefers the favourite version over the newest one", () => {
    makePhoto("a");
    const v1 = addVersion("a", 1);
    addVersion("a", 2);
    db().run("UPDATE photos SET favorite_version_id = ? WHERE id = 'a'", [v1]);
    setSequence(["a"]);

    expect(listPanels()[0]!.image_path).toBe(join(dirs().GEN_DIR, "a", "v1.png"));
  });

  test("falls back to the newest version, then to the original", () => {
    makePhoto("a");
    addVersion("a", 1);
    addVersion("a", 2);
    setSequence(["a"]);
    expect(listPanels()[0]!.image_path).toBe(join(dirs().GEN_DIR, "a", "v2.png"));

    makePhoto("b");
    setSequence(["a", "b"]);
    expect(listPanels()[1]!.image_path).toBe(join(dirs().RAW_DIR, "b.png"));
  });

  test("skips a version whose job has not finished", () => {
    makePhoto("a");
    const v1 = addVersion("a", 1);
    const v2 = addVersion("a", 2);
    db().run(
      "INSERT INTO jobs (photo_id, prompt, status, result_version_id, created_at) VALUES (?,?,?,?,?)",
      ["a", "p", "running", v2, Date.now()],
    );
    db().run("UPDATE photos SET favorite_version_id = ? WHERE id = 'a'", [v2]);

    const photo = db().query<never, []>("SELECT * FROM photos WHERE id = 'a'").get()!;
    expect(resolvePanelImage(photo)).toBe(join(dirs().GEN_DIR, "a", `v${1}.png`));
    expect(v1).toBeGreaterThan(0);
  });

  test("skips a version whose file vanished", () => {
    makePhoto("a");
    addVersion("a", 1, { file: false });
    setSequence(["a"]);
    expect(listPanels()[0]!.image_path).toBe(join(dirs().RAW_DIR, "a.png"));
  });

  test("a panel with nothing on disk has no image", () => {
    db().run(
      `INSERT INTO photos (id, original_path, original_ext, kind, sequence_index, duration_ms, created_at, updated_at)
       VALUES ('empty', '', '.png', 'generated', 0, 3000, ?, ?)`,
      [Date.now(), Date.now()],
    );
    expect(listPanels()[0]!.image_path).toBeNull();
  });
});

describe("createPanels", () => {
  test("appends one generated panel per beat and queues its job", () => {
    makePhoto("existing");
    setSequence(["existing"]);

    const { ids, enqueued } = createPanels([
      { description: "wide shot of the empty street", scene_label: "EXT. STREET - DAWN" },
      { description: "close on her hands", duration_ms: 1200 },
    ]);

    expect(ids).toHaveLength(2);
    expect(enqueued).toBe(2);
    const panels = listPanels();
    expect(panels.map((p) => p.sequence_index)).toEqual([0, 1, 2]);
    expect(panels[1]!.scene_label).toBe("EXT. STREET - DAWN");
    expect(panels[2]!.duration_ms).toBe(1200);

    const jobs = db()
      .query<{ photo_id: string; mode: string; status: string; prompt: string }, []>(
        "SELECT photo_id, mode, status, prompt FROM jobs ORDER BY id",
      )
      .all();
    expect(jobs.map((j) => j.mode)).toEqual(["generate", "generate"]);
    expect(jobs.every((j) => j.status === "pending")).toBe(true);
    expect(jobs[0]!.prompt).toContain("wide shot of the empty street");
  });

  test("attaches character references to the queued job", () => {
    makePhoto("ref");
    upsertCharacter({ name: "Yuki", reference_photo_id: "ref" });

    createPanels([{ description: "Yuki walks in", character_ids: ["yuki"] }]);

    const job = db()
      .query<{ ref_paths: string | null; prompt: string }, []>(
        "SELECT ref_paths, prompt FROM jobs ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(job.ref_paths!)).toEqual([join(dirs().RAW_DIR, "ref.png")]);
    expect(job.prompt).toContain("Yuki");
    expect(job.prompt).toContain("reference images");
  });

  test("rejects an empty beat sheet or a beat with no description", () => {
    expect(() => createPanels([])).toThrow();
    expect(() => createPanels([{ description: "   " }])).toThrow();
  });

  test("a rejected beat sheet leaves no half-written board", () => {
    try {
      createPanels([{ description: "ok" }, { description: "" }]);
    } catch {
      /* expected */
    }
    expect(listPanels()).toHaveLength(0);
    expect(db().query<{ c: number }, []>("SELECT COUNT(*) c FROM jobs").get()!.c).toBe(0);
  });
});

describe("panelPrompt", () => {
  test("carries style, shot, scene and cast", () => {
    upsertCharacter({ name: "Yuki", description: "red coat" });
    const prompt = panelPrompt(
      getStoryboardSettings(),
      "she turns around",
      "INT. BAR - NIGHT",
      ["yuki"],
      false,
    );
    expect(prompt).toContain("storyboard panel");
    expect(prompt).toContain("Shot: she turns around");
    expect(prompt).toContain("Scene: INT. BAR - NIGHT");
    expect(prompt).toContain("Yuki (red coat)");
    // Without attachments we must not tell the model to look at references.
    expect(prompt).not.toContain("reference images");
  });
});

describe("settings", () => {
  test("defaults are returned when nothing is stored", () => {
    const s = getStoryboardSettings();
    expect(s.fps).toBe(24);
    expect(s.aspect_ratio).toBeCloseTo(16 / 9);
  });

  test("stored settings round-trip and bad values fall back", () => {
    setStoryboardSettings({ fps: 12, aspect_ratio: 2.39 });
    expect(getStoryboardSettings().fps).toBe(12);

    setStoryboardSettings({ fps: -3 as never, style: "   " });
    const s = getStoryboardSettings();
    expect(s.fps).toBe(24);
    expect(s.style.length).toBeGreaterThan(0);
    expect(s.aspect_ratio).toBeCloseTo(2.39);
  });
});

describe("scene building", () => {
  test("uid is stable for the same panel id", () => {
    expect(uidFor("panel_1")).toBe(uidFor("panel_1"));
    expect(uidFor("panel_1")).not.toBe(uidFor("panel_2"));
    expect(uidFor("panel_1")).toMatch(/^[0-9A-Z]{5}$/);
  });

  test("time is the cumulative offset of the previous durations", () => {
    makePhoto("a", { duration: 2000 });
    makePhoto("b", { duration: 500 });
    makePhoto("c");
    setSequence(["a", "b", "c"]);

    const scene = buildScene(listPanels());

    expect(scene.boards.map((b) => b.time)).toEqual([0, 2000, 2500]);
    expect(scene.boards.map((b) => b.duration)).toEqual([2000, 500, 3000]);
    expect(scene.boards.map((b) => b.number)).toEqual([1, 2, 3]);
    expect(scene.boards.map((b) => b.url)).toEqual(
      scene.boards.map((b) => `board-${b.number}-${b.uid}.png`),
    );
  });

  test("newShot marks the first panel of each scene", () => {
    makePhoto("a", { label: "EXT. STREET" });
    makePhoto("b", { label: "EXT. STREET" });
    makePhoto("c", { label: "INT. BAR" });
    setSequence(["a", "b", "c"]);

    expect(buildScene(listPanels()).boards.map((b) => b.newShot)).toEqual([true, false, true]);
  });

  test("the wrapper matches the format Storyboarder writes", () => {
    makePhoto("a");
    setSequence(["a"]);
    const scene = buildScene(listPanels());
    expect(scene.version).toBe("2.0.1");
    expect(scene.fps).toBe(24);
    expect(scene.defaultBoardTiming).toBe(3000);
    expect(Object.keys(scene).sort()).toEqual(
      ["aspectRatio", "boards", "defaultBoardTiming", "fps", "version"].sort(),
    );
  });

  test("slugifyName never yields an empty name", () => {
    expect(slugifyName("Japan Trip 2025")).toBe("japan-trip-2025");
    expect(slugifyName("   ")).toBe("storyboard");
    expect(slugifyName("!!!")).toBe("storyboard");
  });
});

describe("export", () => {
  test("writes a .storyboarder file plus one image per panel", () => {
    makePhoto("a", { label: "EXT. STREET" });
    makePhoto("b");
    setSequence(["a", "b"]);

    const res = exportStoryboard();

    expect(res.boards).toBe(2);
    expect(res.skipped).toEqual([]);
    expect(existsSync(res.path)).toBe(true);

    const scene = JSON.parse(readFileSync(res.path, "utf8"));
    expect(scene.boards).toHaveLength(2);
    for (const board of scene.boards) {
      expect(existsSync(join(res.dir, "images", board.url))).toBe(true);
    }
  });

  test("panels without an image are reported, not exported as broken boards", () => {
    makePhoto("a");
    db().run(
      `INSERT INTO photos (id, original_path, original_ext, kind, sequence_index, duration_ms, created_at, updated_at)
       VALUES ('empty', '', '.png', 'generated', 1, 3000, ?, ?)`,
      [Date.now(), Date.now()],
    );
    setSequence(["a", "empty"]);

    const res = exportStoryboard();

    expect(res.boards).toBe(1);
    expect(res.skipped).toEqual(["empty"]);
  });

  test("re-exporting drops the images of panels that are gone", () => {
    makePhoto("a");
    makePhoto("b");
    setSequence(["a", "b"]);
    const first = exportStoryboard();
    const staleImage = join(first.dir, "images", "board-2-" + uidFor("b") + ".png");
    expect(existsSync(staleImage)).toBe(true);

    removeFromSequence("b");
    const second = exportStoryboard();

    expect(second.boards).toBe(1);
    expect(existsSync(staleImage)).toBe(false);
  });

  test("refuses to export an empty storyboard", () => {
    expect(() => exportStoryboard()).toThrow();
  });
});
