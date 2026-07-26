import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  addProject,
  currentProjectId,
  dirsFor,
  listProjects,
  updateProject,
  withProject,
} from "../server/project.ts";
import { PROJECTS_DIR, ROOT } from "../server/config.ts";
import { TEST_ROOT } from "./setup.ts";

/** A folder that exists, so "bring your own root" can be exercised. */
function mkTmp(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

describe("registry", () => {
  test("with no registry file there is still one project: the env-configured one", () => {
    const list = listProjects();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.root).toBe(ROOT);
  });

  test("a name is enough: the id is derived and the folder is created", () => {
    const project = addProject({ name: "Kyoto 2026" });

    expect(project.id).toBe("kyoto-2026");
    expect(project.root).toBe(join(PROJECTS_DIR, "kyoto-2026"));
    expect(existsSync(join(project.root, "data", "RAW"))).toBe(true);
    expect(project.kind).toBe("photo");
  });

  test("two projects with the same name get distinct ids", () => {
    addProject({ name: "Roma" });
    const second = addProject({ name: "Roma" });
    expect(second.id).toBe("roma-2");
  });

  test("accents and punctuation survive as a readable slug", () => {
    expect(addProject({ name: "Città di Ōsaka!" }).id).toBe("citta-di-osaka");
  });

  test("a name with nothing sluggable is refused with an explanation", () => {
    expect(() => addProject({ name: "   " })).toThrow(/nome/);
    expect(() => addProject({ name: "!!!" })).toThrow(/lettere/);
  });

  test("an explicit id must still be a safe slug", () => {
    for (const bad of ["../escape", "Has Spaces", "UPPER", "-leading"]) {
      expect(() => addProject({ name: "X", id: bad })).toThrow();
    }
  });

  test("refuses a duplicate id and a folder already taken", () => {
    const first = addProject({ name: "Dup Check" });
    expect(() => addProject({ name: "Whatever", id: first.id })).toThrow(/esistente/);
    expect(() => addProject({ name: "Same folder", root: first.root })).toThrow(/altro progetto/);
  });

  test("bringing your own folder requires it to exist", () => {
    expect(() => addProject({ name: "Ghost", root: "/tmp/definitely-not-here-9x" })).toThrow(
      /inesistente/,
    );
    const mine = join(TEST_ROOT, "mia-cartella");
    mkdirSync(mine, { recursive: true });
    expect(addProject({ name: "Mia", root: mine }).root).toBe(mine);
  });

  test("a project can be a storyboard, and change its mind later", () => {
    const project = addProject({ name: "Corto", kind: "storyboard" });
    expect(project.kind).toBe("storyboard");
    expect(updateProject(project.id, { kind: "photo" })!.kind).toBe("photo");
  });

  test("a registered project can be renamed without moving", () => {
    const project = addProject({ name: "Shots" });
    updateProject(project.id, { name: "Storyboard" });
    const fresh = listProjects().find((p) => p.id === project.id)!;
    expect(fresh.name).toBe("Storyboard");
    expect(fresh.root).toBe(project.root);
  });
});

describe("dirsFor", () => {
  test("a non-env project gets the conventional layout under its own root", () => {
    addProject({ name: "Layout", id: "layout", root: mkTmp("/tmp/layout-proj") });
    const d = dirsFor("layout");
    expect(d.ROOT).toBe("/tmp/layout-proj");
    expect(d.DB_PATH).toBe(join("/tmp/layout-proj", "photos.db"));
    expect(d.RAW_DIR).toBe(join("/tmp/layout-proj", "data", "RAW"));
    expect(d.GEN_DIR).toBe(join("/tmp/layout-proj", "data", "generations"));
  });

  test("two projects never share a data dir — the isolation the whole design rests on", () => {
    addProject({ name: "Iso A", id: "iso-a", root: mkTmp("/tmp/iso-a") });
    addProject({ name: "Iso B", id: "iso-b", root: mkTmp("/tmp/iso-b") });
    const a = dirsFor("iso-a");
    const b = dirsFor("iso-b");
    expect(a.DB_PATH).not.toBe(b.DB_PATH);
    expect(a.GEN_DIR).not.toBe(b.GEN_DIR);
  });

  test("an unknown project id falls back to the env project rather than throwing", () => {
    expect(dirsFor("does-not-exist").ROOT).toBe(ROOT);
  });
});

describe("withProject", () => {
  test("sets the active project for the duration of the call", () => {
    const outer = currentProjectId();
    const inner = withProject("shots", () => currentProjectId());
    expect(inner).toBe("shots");
    expect(currentProjectId()).toBe(outer);
  });

  test("the context survives awaits inside the callback", async () => {
    const seen = await withProject("shots", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentProjectId();
    });
    expect(seen).toBe("shots");
  });

  test("nested contexts restore the outer one", () => {
    withProject("iso-a", () => {
      withProject("iso-b", () => {
        expect(currentProjectId()).toBe("iso-b");
      });
      expect(currentProjectId()).toBe("iso-a");
    });
  });
});
