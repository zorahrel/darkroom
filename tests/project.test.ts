import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  addProject,
  currentProjectId,
  dirsFor,
  listProjects,
  updateProject,
  withProject,
} from "../server/project.ts";
import { ROOT } from "../server/config.ts";

describe("registry", () => {
  test("with no registry file there is still one project: the env-configured one", () => {
    const list = listProjects();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.root).toBe(ROOT);
  });

  test("rejects an id that is not a safe slug", () => {
    for (const bad of ["../escape", "Has Spaces", "UPPER", "", "-leading"]) {
      expect(() => addProject({ id: bad, root: "/tmp/x" })).toThrow();
    }
  });

  test("refuses a duplicate id", () => {
    addProject({ id: "dup-check", root: "/tmp/dup-check" });
    expect(() => addProject({ id: "dup-check", root: "/tmp/elsewhere" })).toThrow();
  });

  test("a registered project keeps its own root and can be renamed", () => {
    addProject({ id: "shots", name: "Shots", root: "/tmp/shots" });
    expect(listProjects().find((p) => p.id === "shots")!.name).toBe("Shots");
    updateProject("shots", { name: "Storyboard" });
    expect(listProjects().find((p) => p.id === "shots")!.name).toBe("Storyboard");
  });
});

describe("dirsFor", () => {
  test("a non-env project gets the conventional layout under its own root", () => {
    addProject({ id: "layout", root: "/tmp/layout-proj" });
    const d = dirsFor("layout");
    expect(d.ROOT).toBe("/tmp/layout-proj");
    expect(d.DB_PATH).toBe(join("/tmp/layout-proj", "photos.db"));
    expect(d.RAW_DIR).toBe(join("/tmp/layout-proj", "data", "RAW"));
    expect(d.GEN_DIR).toBe(join("/tmp/layout-proj", "data", "generations"));
  });

  test("two projects never share a data dir — the isolation the whole design rests on", () => {
    addProject({ id: "iso-a", root: "/tmp/iso-a" });
    addProject({ id: "iso-b", root: "/tmp/iso-b" });
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
