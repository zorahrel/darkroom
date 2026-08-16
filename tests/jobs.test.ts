import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listJobs, parseRefPaths } from "../server/jobs.ts";
import { db } from "../server/db.ts";
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

describe("listJobs: un errore superato non è più un errore", () => {
  function job(photo: string, status: string, seen = 0): number {
    const now = Date.now();
    db().run(
      `INSERT INTO jobs (photo_id, prompt, status, seen, created_at) VALUES (?, 'p', ?, ?, ?)`,
      [photo, status, seen, now],
    );
    return Number(db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id);
  }

  beforeEach(() => {
    db().run("DELETE FROM jobs");
  });

  test("un fallimento seguito da un successo esce dalla lista", () => {
    job("a", "failed");
    job("a", "done");
    const ids = listJobs(100).map((j) => j.status);
    // La griglia legge l'ULTIMO job per decidere il badge: se il vecchio failed
    // resta in lista e il done cade fuori dal LIMIT, marca rossa una foto sana.
    expect(ids).toEqual(["done"]);
  });

  test("un fallimento seguito da un job ancora in corso esce comunque", () => {
    job("a", "failed");
    job("a", "running");
    expect(listJobs(100).map((j) => j.status)).toEqual(["running"]);
  });

  test("un fallimento che è ancora l'ultima parola resta", () => {
    job("a", "done");
    job("a", "failed");
    expect(listJobs(100).map((j) => j.status)).toContain("failed");
  });

  test("il successo di UN'ALTRA foto non nasconde questo errore", () => {
    job("a", "failed");
    job("b", "done");
    const rows = listJobs(100);
    expect(rows.find((j) => j.photo_id === "a")?.status).toBe("failed");
  });

  test("un fallimento già archiviato dall'utente resta fuori", () => {
    job("a", "failed", 1);
    expect(listJobs(100)).toHaveLength(0);
  });
});
