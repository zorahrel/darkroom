import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";

/**
 * Smoke coverage of the real HTTP surface, driven through the same Hono app the
 * server boots. This is the net under the route split: every endpoint the client
 * calls must keep answering from the same URL, with the same shape.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function get(path: string) {
  const res = await app.request(path);
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeAll(() => {
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  const path = join(dirs().RAW_DIR, "api_photo.png");
  writeFileSync(path, PNG_1X1);
  const now = Date.now();
  db().run(
    `INSERT OR REPLACE INTO photos (id, original_path, original_ext, kind, duration_ms, created_at, updated_at)
     VALUES ('api_photo', ?, '.png', 'original', 3000, ?, ?)`,
    [path, now, now],
  );
});

describe("photos", () => {
  test("GET /api/photos lists the gallery", async () => {
    const { status, json } = await get("/api/photos");
    expect(status).toBe(200);
    expect(Array.isArray(json.photos)).toBe(true);
    expect(json.photos.some((p: { id: string }) => p.id === "api_photo")).toBe(true);
  });

  test("GET /api/photos/counts is not swallowed by /api/photos/:id", async () => {
    const { status, json } = await get("/api/photos/counts");
    expect(status).toBe(200);
    expect(json.counts).toBeTruthy();
    expect(json.counts.all).toBeGreaterThan(0);
  });

  test("GET /api/feedback is not swallowed by /api/photos/:id either", async () => {
    const { status, json } = await get("/api/feedback");
    expect(status).toBe(200);
    expect(Array.isArray(json.feedback)).toBe(true);
  });

  test("GET /api/photos/:id returns the photo with its effective prompt", async () => {
    const { status, json } = await get("/api/photos/api_photo");
    expect(status).toBe(200);
    expect(json.photo.id).toBe("api_photo");
    expect(typeof json.effective_prompt).toBe("string");
    expect(json.effective_config).toBeTruthy();
    expect(json.effective_grade).toBeTruthy();
  });

  test("an unknown photo is a 404", async () => {
    expect((await get("/api/photos/ghost")).status).toBe(404);
  });

  test("GET /api/photos/:id/jobs answers for a real photo", async () => {
    const { status, json } = await get("/api/photos/api_photo/jobs");
    expect(status).toBe(200);
    expect(Array.isArray(json.jobs)).toBe(true);
  });
});

describe("queue and settings", () => {
  test("GET /api/jobs reports summary, items and runner", async () => {
    const { status, json } = await get("/api/jobs");
    expect(status).toBe(200);
    expect(json.summary).toBeTruthy();
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.runner).toBeTruthy();
  });

  test("GET /api/settings/global-prompt", async () => {
    const { status, json } = await get("/api/settings/global-prompt");
    expect(status).toBe(200);
    expect(json.prompt.length).toBeGreaterThan(10);
  });

  test("GET /api/settings/default-config returns config + assembled prompt", async () => {
    const { status, json } = await get("/api/settings/default-config");
    expect(status).toBe(200);
    expect(json.config.preset).toBeTruthy();
    expect(json.prompt).toContain("Apply:");
  });

  test("GET /api/settings/color-grade and /api/luts", async () => {
    expect((await get("/api/settings/color-grade")).json.grade).toBeTruthy();
    const luts = await get("/api/luts");
    expect(luts.status).toBe(200);
    expect(Array.isArray(luts.json.luts)).toBe(true);
  });

  test("GET /api/presets", async () => {
    const { status, json } = await get("/api/presets");
    expect(status).toBe(200);
    expect(Array.isArray(json.presets)).toBe(true);
  });
});

describe("pipeline and orphans", () => {
  test("GET /api/pipeline/status describes generation, grade and queue", async () => {
    const { status, json } = await get("/api/pipeline/status");
    expect(status).toBe(200);
    expect(json.generation.prompt).toContain("Apply:");
    expect(json.grade).toBeTruthy();
    expect(typeof json.favorites).toBe("number");
  });

  test("GET /api/pipeline/bake-status", async () => {
    const { status, json } = await get("/api/pipeline/bake-status");
    expect(status).toBe(200);
    expect(json.running).toBe(false);
  });

  test("GET /api/runs", async () => {
    const { status, json } = await get("/api/runs");
    expect(status).toBe(200);
    expect(Array.isArray(json.runs)).toBe(true);
  });

  test("GET /api/orphans", async () => {
    const { status, json } = await get("/api/orphans");
    expect(status).toBe(200);
    expect(Array.isArray(json.orphans)).toBe(true);
  });
});

describe("storyboard is mounted", () => {
  test("GET /api/storyboard answers with the board", async () => {
    const { status, json } = await get("/api/storyboard");
    expect(status).toBe(200);
    expect(Array.isArray(json.panels)).toBe(true);
  });
});

describe("media", () => {
  test("GET /orig/:id serves the original", async () => {
    const res = await app.request("/orig/api_photo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  test("a missing original is a 404, not a crash", async () => {
    expect((await app.request("/orig/ghost")).status).toBe(404);
  });

  test("path traversal is rejected", async () => {
    for (const path of ["/raw/..%2Fsecrets", "/orphan/..%2Fsecrets", "/gen/..%2Fx/y"]) {
      const res = await app.request(path);
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
  });
});

describe("una foto rifiutata da ChatGPT si salta", () => {
  test("la flag si mette e si toglie", async () => {
    const id = "skip_test_1";
    db().run(
      "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?)",
      [id, Date.now(), Date.now()],
    );
    let r = await app.request(`/api/photos/${id}/skipped`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skipped: true, reason: "supermario" }),
    });
    expect(r.status).toBe(200);
    expect(
      db().query<{ skipped: number; skip_reason: string }, [string]>(
        "SELECT skipped, skip_reason FROM photos WHERE id = ?",
      ).get(id),
    ).toMatchObject({ skipped: 1, skip_reason: "supermario" });

    // Reversibile: le policy cambiano, e una foto ferma per sempre senza modo
    // di riprovarla e' un vicolo cieco.
    r = await app.request(`/api/photos/${id}/skipped`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skipped: false }),
    });
    expect(r.status).toBe(200);
    expect(
      db().query<{ skipped: number }, [string]>("SELECT skipped FROM photos WHERE id = ?").get(id)!.skipped,
    ).toBe(0);
  });

  test("'genera mancanti' non riaccoda una foto saltata", async () => {
    const id = "skip_test_2";
    db().run(
      "INSERT INTO photos (id, original_path, original_ext, skipped, skip_reason, created_at, updated_at) VALUES (?, '', '.jpg', 1, 'rifiutata', ?, ?)",
      [id, Date.now(), Date.now()],
    );
    db().run("DELETE FROM jobs");
    const r = await app.request("/api/generate-missing", { method: "POST" });
    expect(r.status).toBe(200);
    // Senza il filtro sarebbe la prima della lista a ogni giro: zero versioni
    // per sempre, e ogni volta un posto in coda bruciato per lo stesso no.
    const queued = db()
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM jobs WHERE photo_id = ?")
      .get(id)!.n;
    expect(queued).toBe(0);
  });
});
