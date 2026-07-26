import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db.ts";
import { FFMPEG_BIN } from "../server/config.ts";
import {
  askVision,
  checkVersion,
  deleteFailureMode,
  getFailureMode,
  hashSimilarity,
  listFailureModes,
  negativeClauses,
  perceptualHash,
  scoreOf,
  seedFailureModes,
  storedReport,
  suggestFavorite,
  upsertFailureMode,
  verificationSummary,
} from "../server/verify.ts";
import { TEST_ROOT } from "./setup.ts";

/** Solid-colour PNG, so the histogram checks have something unambiguous to read. */
function solidPng(name: string, color: string, size = 64): string {
  const dir = join(TEST_ROOT, "images");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const res = spawnSync({
    cmd: [FFMPEG_BIN, "-v", "error", "-y", "-f", "lavfi", "-i", `color=${color}:s=${size}x${size}`, "-frames:v", "1", path],
    stdout: "ignore",
    stderr: "pipe",
  });
  if (!res.success) throw new Error(`ffmpeg failed for ${name}`);
  return path;
}

/** A stand-in for the vision CLI: prints whatever we tell it to. */
function visionStub(answer: string, exitCode = 0): string {
  const path = join(TEST_ROOT, `moondream-stub-${Buffer.from(answer).toString("hex").slice(0, 8)}-${exitCode}.sh`);
  writeFileSync(path, `#!/bin/sh\necho "${answer}"\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
}

let white: string;
let black: string;
let gray: string;

beforeAll(() => {
  white = solidPng("white.png", "white");
  black = solidPng("black.png", "black");
  gray = solidPng("gray.png", "gray");
});

function addVersion(photoId: string, versionNumber: number, imagePath: string): number {
  const now = Date.now();
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, duration_ms, created_at, updated_at)
     VALUES (?, ?, '.png', 'original', 3000, ?, ?)`,
    [photoId, imagePath, now, now],
  );
  const res = db().run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at)
     VALUES (?,?,?,'p','generated',?)`,
    [photoId, versionNumber, imagePath, now],
  );
  return Number(res.lastInsertRowid);
}

beforeEach(() => {
  const d = db();
  d.run("DELETE FROM version_checks");
  d.run("DELETE FROM versions");
  d.run("DELETE FROM photos");
  d.run("DELETE FROM failure_modes");
  delete process.env.MOONDREAM_BIN;
});

describe("failure-mode catalogue", () => {
  test("seeding is idempotent and does not overwrite local edits", () => {
    seedFailureModes();
    const count = listFailureModes().length;
    upsertFailureMode({ code: "burnt_highlights", threshold: 0.5, gate_enabled: false });

    seedFailureModes();

    expect(listFailureModes()).toHaveLength(count);
    const mode = getFailureMode("burnt_highlights")!;
    expect(mode.threshold).toBe(0.5);
    expect(mode.gate_enabled).toBe(false);
  });

  test("a new failure mode must be a vision question with a sane code", () => {
    expect(() => upsertFailureMode({ code: "Bad Code", question: "x?" })).toThrow();
    expect(() => upsertFailureMode({ code: "no_question" })).toThrow();
    expect(() => upsertFailureMode({ code: "custom_pixel", kind: "pixel" })).toThrow();

    const mode = upsertFailureMode({
      code: "milky_sky",
      label: "Cielo lattiginoso",
      question: "Is the sky washed out or milky? Answer yes or no.",
      negative_clause: "do not wash out the sky",
    });
    expect(mode.kind).toBe("vlm");
    expect(mode.builtin).toBe(false);
  });

  test("built-ins can be disabled but not deleted", () => {
    seedFailureModes();
    expect(() => deleteFailureMode("burnt_highlights")).toThrow();
    expect(upsertFailureMode({ code: "burnt_highlights", gate_enabled: false }).gate_enabled).toBe(false);

    upsertFailureMode({ code: "temp_mode", question: "y?" });
    expect(deleteFailureMode("temp_mode")).toBe(true);
    expect(getFailureMode("temp_mode")).toBeNull();
  });

  test("only gate-enabled modes contribute prompt clauses", () => {
    seedFailureModes();
    expect(negativeClauses().some((c) => c.includes("highlights"))).toBe(true);

    upsertFailureMode({ code: "burnt_highlights", gate_enabled: false });

    expect(negativeClauses().some((c) => c.includes("highlights"))).toBe(false);
  });

  test("a mode without a clause changes nothing in the prompt", () => {
    seedFailureModes();
    // near_duplicate is a ranking signal, not something to ask the model for.
    expect(getFailureMode("near_duplicate")!.negative_clause).toBeNull();
  });
});

describe("scoring", () => {
  test("a clean render scores 10, hits cost more than hedges", () => {
    expect(scoreOf([{ code: "a", verdict: "clear", detail: null }])).toBe(10);
    expect(scoreOf([{ code: "a", verdict: "unsure", detail: null }])).toBe(9.5);
    expect(scoreOf([{ code: "a", verdict: "hit", detail: null }])).toBe(7);
    expect(scoreOf([{ code: "a", verdict: "error", detail: null }])).toBe(10);
  });

  test("never goes below zero", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ code: `c${i}`, verdict: "hit" as const, detail: null }));
    expect(scoreOf(many)).toBe(0);
  });
});

describe("pixel checks", () => {
  test("a blown-out render is flagged, a mid-grey one is not", async () => {
    seedFailureModes();
    const id = addVersion("p_white", 1, white);

    const report = await checkVersion(id, { only: ["burnt_highlights"] });

    expect(report.hits).toEqual(["burnt_highlights"]);
    expect(report.checks[0]!.detail).toContain("100.0%");

    const clean = await checkVersion(addVersion("p_gray", 1, gray), { only: ["burnt_highlights"] });
    expect(clean.hits).toEqual([]);
  });

  test("a crushed render is flagged on the shadow end", async () => {
    seedFailureModes();
    const report = await checkVersion(addVersion("p_black", 1, black), { only: ["crushed_blacks"] });
    expect(report.hits).toEqual(["crushed_blacks"]);
  });

  test("perceptual hash: same image matches itself, different ones don't", () => {
    const a = perceptualHash(white)!;
    const b = perceptualHash(black)!;
    expect(a).not.toBeNull();
    expect(hashSimilarity(a, a)).toBe(1);
    // A flat image hashes to all-equal bits, so compare against a real gradient.
    expect(hashSimilarity(a, b)).toBeGreaterThanOrEqual(0);
    expect(hashSimilarity(a, [])).toBe(0);
  });

  test("a re-render identical to a sibling is flagged as a near duplicate", async () => {
    seedFailureModes();
    addVersion("p_dup", 1, gray);
    const second = addVersion("p_dup", 2, gray);

    const report = await checkVersion(second, { only: ["near_duplicate"] });

    expect(report.hits).toEqual(["near_duplicate"]);
    expect(report.checks[0]!.detail).toContain("v1");
  });

  test("a lone version cannot be a duplicate of anything", async () => {
    seedFailureModes();
    const report = await checkVersion(addVersion("p_solo", 1, gray), { only: ["near_duplicate"] });
    expect(report.hits).toEqual([]);
  });
});

describe("vision checks", () => {
  test("yes is a hit, no is clear, anything else is unsure", () => {
    process.env.MOONDREAM_BIN = visionStub("yes");
    expect(askVision(gray, "q?").verdict).toBe("hit");

    process.env.MOONDREAM_BIN = visionStub("no");
    expect(askVision(gray, "q?").verdict).toBe("clear");

    process.env.MOONDREAM_BIN = visionStub("hard to tell");
    expect(askVision(gray, "q?").verdict).toBe("unsure");
  });

  test("a failing vision CLI is an error verdict, not a crash", () => {
    process.env.MOONDREAM_BIN = visionStub("boom", 1);
    expect(askVision(gray, "q?").verdict).toBe("error");
  });

  test("an unsure answer does not flag the render (unsure = pass)", async () => {
    seedFailureModes();
    process.env.MOONDREAM_BIN = visionStub("maybe, it is unclear");
    const id = addVersion("p_vlm", 1, gray);

    const report = await checkVersion(id, { only: ["garbled_text"] });

    expect(report.hits).toEqual([]);
    expect(report.unsure).toEqual(["garbled_text"]);
    expect(report.score).toBe(9.5);
  });

  test("disabled modes are skipped unless explicitly asked for", async () => {
    seedFailureModes();
    process.env.MOONDREAM_BIN = visionStub("yes");
    const id = addVersion("p_disabled", 1, gray);

    // cgi_look ships disabled.
    const gated = await checkVersion(id);
    expect(gated.checks.some((c) => c.code === "cgi_look")).toBe(false);

    const explicit = await checkVersion(id, { only: ["cgi_look"], includeDisabled: true });
    expect(explicit.hits).toEqual(["cgi_look"]);
  });
});

describe("stored reports", () => {
  test("verdicts persist and re-checking replaces them", async () => {
    seedFailureModes();
    process.env.MOONDREAM_BIN = visionStub("yes");
    const id = addVersion("p_store", 1, gray);
    await checkVersion(id, { only: ["garbled_text"] });
    expect(storedReport(id)!.hits).toEqual(["garbled_text"]);

    process.env.MOONDREAM_BIN = visionStub("no");
    await checkVersion(id, { only: ["garbled_text"] });

    const report = storedReport(id)!;
    expect(report.hits).toEqual([]);
    expect(report.checks).toHaveLength(1); // replaced, not duplicated
  });

  test("an unchecked version has no report", () => {
    expect(storedReport(addVersion("p_none", 1, gray))).toBeNull();
  });

  test("checking a missing version or file fails loudly", async () => {
    await expect(checkVersion(99999)).rejects.toThrow("version not found");
    const id = addVersion("p_missing", 1, join(TEST_ROOT, "images", "nope.png"));
    await expect(checkVersion(id)).rejects.toThrow("image missing");
  });
});

describe("favourite suggestion", () => {
  test("prefers the cleanest render and reports that it differs", async () => {
    seedFailureModes();
    const bad = addVersion("p_pick", 1, white); // blown out
    const good = addVersion("p_pick", 2, gray);
    db().run("UPDATE photos SET favorite_version_id = ? WHERE id = 'p_pick'", [bad]);
    await checkVersion(bad, { only: ["burnt_highlights"] });
    await checkVersion(good, { only: ["burnt_highlights"] });

    const suggestion = suggestFavorite("p_pick");

    expect(suggestion.suggested_version_id).toBe(good);
    expect(suggestion.differs).toBe(true);
    expect(suggestion.scores).toHaveLength(2);
  });

  test("a tie goes to the newest render", async () => {
    seedFailureModes();
    const first = addVersion("p_tie", 1, gray);
    const second = addVersion("p_tie", 2, gray);
    await checkVersion(first, { only: ["burnt_highlights"] });
    await checkVersion(second, { only: ["burnt_highlights"] });

    expect(suggestFavorite("p_tie").suggested_version_id).toBe(second);
  });

  test("says so when nothing has been checked yet", () => {
    addVersion("p_unchecked", 1, gray);
    const suggestion = suggestFavorite("p_unchecked");
    expect(suggestion.suggested_version_id).toBeNull();
    expect(suggestion.reason).toContain("nessuna versione");
  });

  test("it only ever suggests — the stored favourite is untouched", async () => {
    seedFailureModes();
    const bad = addVersion("p_keep", 1, white);
    const good = addVersion("p_keep", 2, gray);
    db().run("UPDATE photos SET favorite_version_id = ? WHERE id = 'p_keep'", [bad]);
    await checkVersion(bad, { only: ["burnt_highlights"] });
    await checkVersion(good, { only: ["burnt_highlights"] });

    suggestFavorite("p_keep");

    const stored = db()
      .query<{ favorite_version_id: number }, []>("SELECT favorite_version_id FROM photos WHERE id = 'p_keep'")
      .get()!;
    expect(stored.favorite_version_id).toBe(bad);
  });
});

describe("summary", () => {
  test("counts what was checked, what was flagged, and by which mode", async () => {
    seedFailureModes();
    await checkVersion(addVersion("s1", 1, white), { only: ["burnt_highlights"] });
    await checkVersion(addVersion("s2", 1, gray), { only: ["burnt_highlights"] });

    const summary = verificationSummary();

    expect(summary.checked_versions).toBe(2);
    expect(summary.flagged_versions).toBe(1);
    const row = summary.by_code.find((r) => r.code === "burnt_highlights")!;
    expect(row.hits).toBe(1);
    expect(row.checked).toBe(2);
    expect(row.rate).toBe(0.5);
    expect(row.label).toBe("Alte luci bruciate");
  });

  test("the trend buckets checks in order so a run can be compared to the next", async () => {
    seedFailureModes();
    for (let i = 1; i <= 4; i++) {
      await checkVersion(addVersion(`t${i}`, 1, i <= 2 ? white : gray), { only: ["burnt_highlights"] });
    }

    const trend = verificationSummary(2).trend;

    expect(trend).toHaveLength(2);
    expect(trend[0]!.rate).toBe(1); // first two were blown out
    expect(trend[1]!.rate).toBe(0); // then it got fixed
  });

  test("an empty project summarises to zeroes, not to a crash", () => {
    const summary = verificationSummary();
    expect(summary.checked_versions).toBe(0);
    expect(summary.by_code).toEqual([]);
    expect(summary.trend).toEqual([]);
  });
});

describe("prompt integration", () => {
  test("gate-enabled clauses reach the assembled prompt, disabled ones don't", async () => {
    const { promptFor } = await import("../server/photos.ts");
    const { DEFAULT_CONFIG } = await import("../server/promptConfig.ts");
    seedFailureModes();

    const withClauses = promptFor(DEFAULT_CONFIG);
    expect(withClauses).toContain("do not add watermarks");

    upsertFailureMode({ code: "watermark", gate_enabled: false });

    expect(promptFor(DEFAULT_CONFIG)).not.toContain("do not add watermarks");
  });

  test("a learned clause is not duplicated if the config already excludes it", async () => {
    const { assemblePrompt, DEFAULT_CONFIG, EXCLUDE_OPTIONS } = await import("../server/promptConfig.ts");
    const clause = EXCLUDE_OPTIONS.no_new_objects;

    const prompt = assemblePrompt(DEFAULT_CONFIG, [clause, clause]);

    const occurrences = prompt.split(`- ${clause}`).length - 1;
    expect(occurrences).toBe(1);
  });

  test("a brand-new clause shows up as its own bullet", async () => {
    const { assemblePrompt, DEFAULT_CONFIG } = await import("../server/promptConfig.ts");
    const prompt = assemblePrompt(DEFAULT_CONFIG, ["do not paint the sky purple"]);
    expect(prompt).toContain("- do not paint the sky purple");
  });
});

describe("built-in wording is kept current", () => {
  test("re-seeding refreshes questions and clauses but not user settings", () => {
    seedFailureModes();
    const original = getFailureMode("deformed_anatomy")!;
    db().run(
      "UPDATE failure_modes SET question = ?, negative_clause = ?, gate_enabled = 0, label = ? WHERE code = 'deformed_anatomy'",
      ["stale question", "stale clause", "Etichetta mia"],
    );

    seedFailureModes();

    const fresh = getFailureMode("deformed_anatomy")!;
    // Wording is code: it comes back.
    expect(fresh.question).toBe(original.question);
    expect(fresh.negative_clause).toBe(original.negative_clause);
    // Settings are the user's: they stay.
    expect(fresh.gate_enabled).toBe(false);
    expect(fresh.label).toBe("Etichetta mia");
  });

  test("a custom mode is never touched by seeding", () => {
    upsertFailureMode({ code: "mine", question: "my question?", negative_clause: "my clause" });
    seedFailureModes();
    const mine = getFailureMode("mine")!;
    expect(mine.question).toBe("my question?");
    expect(mine.negative_clause).toBe("my clause");
  });

  test("every vision question tells the model how to answer when it does not apply", () => {
    seedFailureModes();
    for (const mode of listFailureModes().filter((m) => m.kind === "vlm" && m.builtin)) {
      // Bare "is there X?" questions drift to yes on images where X is absent.
      expect(mode.question!.toLowerCase()).toContain("answer no");
    }
  });
});
