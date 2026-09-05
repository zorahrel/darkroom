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

describe("a photo refused by ChatGPT is skipped", () => {
  test("the flag is set and unset", async () => {
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

    // Reversible: policies change, and a photo stopped for ever with no way of
    // retrying it is a blind alley.
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

  test("'generate missing' does not requeue a skipped photo", async () => {
    const id = "skip_test_2";
    db().run(
      "INSERT INTO photos (id, original_path, original_ext, skipped, skip_reason, created_at, updated_at) VALUES (?, '', '.jpg', 1, 'rifiutata', ?, ?)",
      [id, Date.now(), Date.now()],
    );
    db().run("DELETE FROM jobs");
    const r = await app.request("/api/generate-missing", { method: "POST" });
    expect(r.status).toBe(200);
    // Without the filter it would be first in the list every round: zero
    // versions for ever, and every time a queue slot burned for the same no.
    const queued = db()
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM jobs WHERE photo_id = ?")
      .get(id)!.n;
    expect(queued).toBe(0);
  });
});

describe("what is left to refine in pro", () => {
  test("the pro_todo filter excludes the skipped, the unassigned and the already done", async () => {
    const now = Date.now();
    const mk = (id: string, skipped = 0) =>
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, skipped, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?, ?)",
        [id, skipped, now, now],
      );
    db().run("INSERT INTO collections (id, title, position, created_at) VALUES ('pt','T',98,?)", [now]);
    const inPost = (pid: string) =>
      db().run("INSERT INTO collection_photos (collection_id, photo_id, position) VALUES ('pt', ?, 0)", [pid]);
    const withFav = (pid: string, provider: string) => {
      db().run(
        "INSERT INTO versions (photo_id, version_number, image_path, provider, prompt_used, source, created_at) VALUES (?, 1, '/x.png', ?, 'p', 'generated', ?)",
        [pid, provider, now],
      );
      const vid = db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
      db().run("UPDATE photos SET favorite_version_id = ? WHERE id = ?", [vid, pid]);
    };

    mk("pt_todo"); inPost("pt_todo"); withFav("pt_todo", "chatgpt");     // to do
    mk("pt_done"); inPost("pt_done"); withFav("pt_done", "higgsfield");  // already pro
    mk("pt_skip", 1); inPost("pt_skip"); withFav("pt_skip", "chatgpt");  // won't come out
    mk("pt_free"); withFav("pt_free", "chatgpt");                        // outside any post

    const r = await app.request("/api/photos?filter=pro_todo");
    const ids = ((await r.json()) as { photos: { id: string }[] }).photos.map((p) => p.id);
    expect(ids).toContain("pt_todo");
    // A master on a photo that will not be published is money thrown away.
    expect(ids).not.toContain("pt_done");
    expect(ids).not.toContain("pt_skip");
    expect(ids).not.toContain("pt_free");
  });
});

describe("the covers are looked at all together", () => {
  test("filter=covers returns only the covers, with the post's title", async () => {
    const now = Date.now();
    db().run("INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('cv_a','', '.jpg', ?, ?)", [now, now]);
    db().run("INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('cv_b','', '.jpg', ?, ?)", [now, now]);
    db().run("INSERT INTO collections (id, title, position, created_at, cover_photo_id) VALUES ('cv','Il verde',97,?, 'cv_a')", [now]);

    const r = await app.request("/api/photos?filter=covers");
    const photos = ((await r.json()) as { photos: { id: string; cover_of: string | null }[] }).photos;
    const ids = photos.map((p) => p.id);
    expect(ids).toContain("cv_a");
    expect(ids).not.toContain("cv_b");
    // Seven covers side by side without the title of what they open are seven
    // photos like any others: the question is whether each promises its post.
    expect(photos.find((p) => p.id === "cv_a")!.cover_of).toBe("Il verde");
  });
});

describe("the covers still to refine", () => {
  test("covers_todo keeps only the covers with no pro master", async () => {
    const now = Date.now();
    const mk = (id: string) =>
      db().run("INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?)", [id, now, now]);
    const fav = (pid: string, provider: string) => {
      db().run(
        "INSERT INTO versions (photo_id, version_number, image_path, provider, prompt_used, source, created_at) VALUES (?, 1, '/x.png', ?, 'p', 'generated', ?)",
        [pid, provider, now],
      );
      const vid = db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
      db().run("UPDATE photos SET favorite_version_id = ? WHERE id = ?", [vid, pid]);
    };
    mk("ct_draft"); fav("ct_draft", "chatgpt");
    mk("ct_pro"); fav("ct_pro", "higgsfield");
    mk("ct_plain"); fav("ct_plain", "chatgpt");   // not the cover of anything
    db().run("INSERT INTO collections (id, title, position, created_at, cover_photo_id) VALUES ('ct1','A',95,?, 'ct_draft')", [now]);
    db().run("INSERT INTO collections (id, title, position, created_at, cover_photo_id) VALUES ('ct2','B',96,?, 'ct_pro')", [now]);

    const r = await app.request("/api/photos?filter=covers_todo");
    const ids = ((await r.json()) as { photos: { id: string }[] }).photos.map((p) => p.id);
    expect(ids).toContain("ct_draft");
    expect(ids).not.toContain("ct_pro");    // already refined
    expect(ids).not.toContain("ct_plain");  // opens no post
  });
});

describe("the credits are asked for, not discovered by walking into them", () => {
  test("there is a route for the Higgsfield balance", async () => {
    const src = await Bun.file(new URL("../server/routes/generation.ts", import.meta.url)).text();
    // The only way to know whether you could generate used to be LAUNCHING a
    // job and watching it fail with "Out of credits": you discovered the wall by
    // walking into it, one burned job at a time. It really happened, three times
    // in a row.
    expect(src).toContain('/api/higgsfield/balance');
    expect(src).toContain("hfBalance()");
  });
});
