import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRefPaths } from "../server/jobs.ts";
import { TEST_ROOT } from "./setup.ts";

function realFile(name: string): string {
  const dir = join(TEST_ROOT, "refs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "x");
  return path;
}

describe("parseRefPaths", () => {
  test("returns the stored paths", () => {
    const a = realFile("a.png");
    const b = realFile("b.png");
    expect(parseRefPaths(JSON.stringify([a, b]))).toEqual([a, b]);
  });

  test("drops paths whose file is gone instead of failing the job", () => {
    const a = realFile("a.png");
    expect(parseRefPaths(JSON.stringify([a, "/nope/missing.png"]))).toEqual([a]);
  });

  test("tolerates null, corrupt JSON and non-arrays", () => {
    expect(parseRefPaths(null)).toEqual([]);
    expect(parseRefPaths("")).toEqual([]);
    expect(parseRefPaths("{oops")).toEqual([]);
    expect(parseRefPaths('"a string"')).toEqual([]);
    expect(parseRefPaths("[1, 2]")).toEqual([]);
  });
});
