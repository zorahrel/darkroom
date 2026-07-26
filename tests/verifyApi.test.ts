import { beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { db } from "../server/db.ts";
import { FFMPEG_BIN } from "../server/config.ts";
import { verifyRoutes } from "../server/routes/verify.ts";
import { TEST_ROOT } from "./setup.ts";

const app = new Hono().route("/api/verify", verifyRoutes);

function png(name: string, color: string): string {
  const dir = join(TEST_ROOT, "api-images");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  spawnSync({
    cmd: [FFMPEG_BIN, "-v", "error", "-y", "-f", "lavfi", "-i", `color=${color}:s=64x64`, "-frames:v", "1", path],
    stdout: "ignore",
    stderr: "ignore",
  });
  return path;
}

function stubVision(answer: string): void {
  const path = join(TEST_ROOT, "api-moondream.sh");
  writeFileSync(path, `#!/bin/sh\necho "${answer}"\n`);
  chmodSync(path, 0o755);
  process.env.MOONDREAM_BIN = path;
}

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/api/verify${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

function seedVersion(photoId: string, versionNumber: number, color: string): number {
  const path = png(`${photoId}_${versionNumber}.png`, color);
  const now = Date.now();
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, duration_ms, created_at, updated_at)
     VALUES (?,?,'.png','original',3000,?,?)`,
    [photoId, path, now, now],
  );
  const res = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?,?,?,'p','generated',?)`,
    [photoId, versionNumber, path, now],
  );
  return Number(res.lastInsertRowid);
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM version_checks");
  d.run("DELETE FROM versions");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM failure_modes");
  stubVision("no");
});

describe("failure modes", () => {
  test("GET lists the built-in catalogue", async () => {
    const { status, json } = await call("GET", "/modes");
    expect(status).toBe(200);
    expect(json.modes.length).toBeGreaterThan(3);
    expect(json.modes.some((m: { code: string }) => m.code === "burnt_highlights")).toBe(true);
  });

  test("POST adds one and DELETE removes it", async () => {
    const created = await call("POST", "/modes", {
      code: "milky_sky",
      label: "Cielo lattiginoso",
      question: "Is the sky milky? Answer yes or no.",
    });
    expect(created.status).toBe(200);
    expect(created.json.mode.code).toBe("milky_sky");

    expect((await call("DELETE", "/modes/milky_sky")).status).toBe(200);
    expect((await call("DELETE", "/modes/milky_sky")).status).toBe(404);
  });

  test("a built-in cannot be deleted, only disabled", async () => {
    await call("GET", "/modes"); // seeds
    const del = await call("DELETE", "/modes/burnt_highlights");
    expect(del.status).toBe(400);
    expect(del.json.error).toContain("built in");

    const off = await call("POST", "/modes", { code: "burnt_highlights", gate_enabled: false });
    expect(off.json.mode.gate_enabled).toBe(false);
  });

  test("a malformed mode is a 400 with a readable reason", async () => {
    const res = await call("POST", "/modes", { code: "NOPE" });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain("lowercase");
  });
});

describe("checking renders", () => {
  test("POST checks one version and GET reads the stored verdicts back", async () => {
    const id = seedVersion("api_p1", 1, "white");

    const run = await call("POST", `/versions/${id}`, { only: ["burnt_highlights"] });

    expect(run.status).toBe(200);
    expect(run.json.report.hits).toEqual(["burnt_highlights"]);

    const stored = await call("GET", `/versions/${id}`);
    expect(stored.json.report.score).toBe(7);
  });

  test("an unchecked version reports no report rather than 404", async () => {
    const id = seedVersion("api_p2", 1, "gray");
    const res = await call("GET", `/versions/${id}`);
    expect(res.status).toBe(200);
    expect(res.json.report).toBeNull();
  });

  test("checking a missing version is a 400, not a crash", async () => {
    expect((await call("POST", "/versions/424242")).status).toBe(400);
  });

  test("POST on a photo checks every render and returns the suggestion", async () => {
    seedVersion("api_p3", 1, "white");
    seedVersion("api_p3", 2, "gray");

    const res = await call("POST", "/photos/api_p3", { only: ["burnt_highlights"] });

    expect(res.json.reports).toHaveLength(2);
    expect(res.json.suggestion.suggested_version_number).toBe(2);
  });
});

describe("summary and batch", () => {
  test("summary counts checks per mode", async () => {
    const id = seedVersion("api_p4", 1, "white");
    await call("POST", `/versions/${id}`, { only: ["burnt_highlights"] });

    const { json } = await call("GET", "/summary");

    expect(json.summary.checked_versions).toBe(1);
    expect(json.summary.flagged_versions).toBe(1);
  });

  test("batch runs in the background and reports progress", async () => {
    seedVersion("api_p5", 1, "white");
    seedVersion("api_p5", 2, "gray");

    const started = await call("POST", "/batch", { limit: 10 });
    expect(started.json.started).toBe(2);

    // Let the background pass finish.
    for (let i = 0; i < 60; i++) {
      const status = await call("GET", "/batch");
      if (!status.json.running) {
        expect(status.json.done).toBe(2);
        expect(status.json.flagged).toBeGreaterThanOrEqual(1);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("batch did not finish in time");
  });

  test("batch skips renders that were already checked", async () => {
    const id = seedVersion("api_p6", 1, "gray");
    await call("POST", `/versions/${id}`, { only: ["burnt_highlights"] });

    const again = await call("POST", "/batch", { limit: 10 });

    expect(again.json.started).toBe(0);
  });
});
