import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import { storyboardRoutes } from "../server/routes/storyboard.ts";

const app = new Hono().route("/api/storyboard", storyboardRoutes);

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makePhoto(id: string): void {
  const path = join(dirs().RAW_DIR, `${id}.png`);
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  writeFileSync(path, PNG_1X1);
  const now = Date.now();
  db().run(
    `INSERT INTO photos (id, original_path, original_ext, kind, duration_ms, created_at, updated_at)
     VALUES (?, ?, '.png', 'original', 3000, ?, ?)`,
    [id, path, now, now],
  );
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await app.request(`/api/storyboard${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM jobs");
  d.run("DELETE FROM versions");
  d.run("DELETE FROM characters");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM settings WHERE key = 'storyboard'");
  rmSync(dirs().DATA_DIR, { recursive: true, force: true });
});

describe("GET /api/storyboard", () => {
  test("returns panels, characters and settings in one call", async () => {
    makePhoto("a");
    await call("PUT", "/sequence", { ids: ["a"] });

    // Mounted sub-app: the board lives at /api/storyboard, no trailing slash.
    const { status, json } = await call("GET", "");

    expect(status).toBe(200);
    expect(json.panels).toHaveLength(1);
    expect(json.characters).toEqual([]);
    expect(json.settings.fps).toBe(24);
  });
});

describe("PUT /sequence", () => {
  test("re-orders and echoes back the new board", async () => {
    makePhoto("a");
    makePhoto("b");

    const { status, json } = await call("PUT", "/sequence", { ids: ["b", "a"] });

    expect(status).toBe(200);
    expect(json.updated).toBe(2);
    expect(json.panels.map((p: { id: string }) => p.id)).toEqual(["b", "a"]);
  });

  test("rejects a body without an ids array", async () => {
    expect((await call("PUT", "/sequence", {})).status).toBe(400);
    expect((await call("PUT", "/sequence", { ids: "a,b" })).status).toBe(400);
    expect((await call("PUT", "/sequence")).status).toBe(400);
  });

  test("non-string ids are dropped rather than stored", async () => {
    makePhoto("a");
    const { json } = await call("PUT", "/sequence", { ids: ["a", 42, null] });
    expect(json.updated).toBe(1);
  });
});

describe("panels", () => {
  test("PATCH updates duration and label", async () => {
    makePhoto("a");
    await call("PUT", "/sequence", { ids: ["a"] });

    const { status, json } = await call("PATCH", "/panels/a", {
      duration_ms: 1200,
      scene_label: "EXT. STREET",
    });

    expect(status).toBe(200);
    expect(json.panel.duration_ms).toBe(1200);
    expect(json.panel.scene_label).toBe("EXT. STREET");
  });

  test("PATCH rejects an invalid duration with 400, not a 500", async () => {
    makePhoto("a");
    await call("PUT", "/sequence", { ids: ["a"] });
    const { status, json } = await call("PATCH", "/panels/a", { duration_ms: -1 });
    expect(status).toBe(400);
    expect(json.error).toContain("duration_ms");
  });

  test("PATCH on an unknown panel is a 404", async () => {
    expect((await call("PATCH", "/panels/ghost", { duration_ms: 1000 })).status).toBe(404);
  });

  test("DELETE takes a photo out of the board without deleting it", async () => {
    makePhoto("a");
    makePhoto("b");
    await call("PUT", "/sequence", { ids: ["a", "b"] });

    const { status, json } = await call("DELETE", "/panels/a");

    expect(status).toBe(200);
    expect(json.panels.map((p: { id: string }) => p.id)).toEqual(["b"]);
    expect(db().query("SELECT id FROM photos WHERE id = 'a'").get()).toBeTruthy();
  });

  test("POST /panels queues one generation per beat", async () => {
    const { status, json } = await call("POST", "/panels", {
      beats: [{ description: "wide shot" }, { description: "close up", duration_ms: 800 }],
    });

    expect(status).toBe(200);
    expect(json.enqueued).toBe(2);
    expect(json.panels).toHaveLength(2);
    expect(json.panels[1].duration_ms).toBe(800);
  });

  test("POST /panels validates the beat sheet", async () => {
    expect((await call("POST", "/panels", {})).status).toBe(400);
    expect((await call("POST", "/panels", { beats: [] })).status).toBe(400);
    expect((await call("POST", "/panels", { beats: [{ description: "" }] })).status).toBe(400);
  });
});

describe("characters", () => {
  test("create, list and delete", async () => {
    makePhoto("ref");
    const created = await call("POST", "/characters", {
      name: "Yuki",
      reference_photo_id: "ref",
      description: "red coat",
    });
    expect(created.status).toBe(200);
    expect(created.json.character.id).toBe("yuki");

    const list = await call("GET", "/characters");
    expect(list.json.characters).toHaveLength(1);

    expect((await call("DELETE", "/characters/yuki")).status).toBe(200);
    expect((await call("GET", "/characters")).json.characters).toEqual([]);
  });

  test("a bad reference is a 400 with a readable reason", async () => {
    const { status, json } = await call("POST", "/characters", {
      name: "Ghost",
      reference_photo_id: "nope",
    });
    expect(status).toBe(400);
    expect(json.error).toContain("reference photo not found");
  });

  test("deleting an unknown character is a 404", async () => {
    expect((await call("DELETE", "/characters/nobody")).status).toBe(404);
  });
});

describe("settings", () => {
  test("PUT stores and GET returns them", async () => {
    const put = await call("PUT", "/settings", { fps: 12, aspect_ratio: 2.39 });
    expect(put.json.settings.fps).toBe(12);
    expect((await call("GET", "/settings")).json.settings.aspect_ratio).toBeCloseTo(2.39);
  });
});

describe("export", () => {
  test("writes the file and reports where", async () => {
    makePhoto("a");
    await call("PUT", "/sequence", { ids: ["a"] });

    const { status, json } = await call("POST", "/export");

    expect(status).toBe(200);
    expect(json.boards).toBe(1);
    expect(json.path).toEndWith(".storyboarder");
  });

  test("an empty board is a 400 that says what to do", async () => {
    const { status, json } = await call("POST", "/export");
    expect(status).toBe(400);
    expect(json.error).toContain("no panels");
  });
});
