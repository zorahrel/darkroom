import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { staleDist, staleDistWarning } from "../server/distFreshness.ts";
import { TEST_ROOT } from "./setup.ts";

function repo(name: string): string {
  const root = join(TEST_ROOT, "distfresh", name);
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, "client", "src"), { recursive: true });
  return root;
}
const at = (p: string, secondsAgo: number) => {
  const t = Date.now() / 1000 - secondsAgo;
  utimesSync(p, t, t);
};

describe("the dist being served must not be older than the client", () => {
  test("a build more recent than the sources is fine", () => {
    const root = repo("fresh");
    writeFileSync(join(root, "client", "src", "App.tsx"), "x");
    at(join(root, "client", "src", "App.tsx"), 600);
    writeFileSync(join(root, "dist", "index.html"), "<html>");
    expect(staleDist(root)).toBeNull();
    expect(staleDistWarning(root)).toBeNull();
  });

  test("a source touched after the build is flagged, with the file name", () => {
    // The real case: dist from 10 August, PhotoCard.tsx modified on the 18th.
    // The dashboard showed the old UI and nothing said so.
    const root = repo("stale");
    writeFileSync(join(root, "dist", "index.html"), "<html>");
    at(join(root, "dist", "index.html"), 7200);
    writeFileSync(join(root, "client", "src", "PhotoCard.tsx"), "x");
    const s = staleDist(root);
    expect(s).not.toBeNull();
    expect(s!.newest).toContain("PhotoCard.tsx");
    expect(staleDistWarning(root)).toContain("VECCHIO");
  });

  test("a missing dist is a warning, not a crash", () => {
    const root = join(TEST_ROOT, "distfresh", "nodist");
    mkdirSync(join(root, "client"), { recursive: true });
    expect(staleDistWarning(root)).toContain("MANCA");
  });

  test("node_modules does not count: it would keep the alarm permanently on", () => {
    const root = repo("nm");
    writeFileSync(join(root, "dist", "index.html"), "<html>");
    at(join(root, "dist", "index.html"), 3600);
    mkdirSync(join(root, "client", "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "client", "node_modules", "pkg", "index.ts"), "x");
    expect(staleDist(root)).toBeNull();
  });
});
