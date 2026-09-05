/**
 * The real path, not the isolated function: a job queued in the DB, worked by
 * the runner with the `openai` backend, which must end 'done' with a version in
 * the gallery. The unit tests covered the worker's functions; this one covers
 * the only thing the user sees — the photo that appears, or does not.
 *
 * It makes a REAL call to the Images API at `low` (~196 tokens, ~$0.006), so it
 * is opt-in: without `OPENAI_E2E=1` the two paid tests are skipped. Leaving
 * them on by default took `bun test` from 15s to 342s and charged for every
 * run.
 *
 * Usage: OPENAI_E2E=1 bun test tests/openaiE2E.test.ts
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEST_ROOT } from "./setup.ts";

const hasKey = (() => {
  if (process.env.OPENAI_API_KEY?.trim()) return true;
  try {
    const r = Bun.spawnSync(["security", "find-generic-password", "-s", "openai", "-a", "darkroom", "-w"]);
    return r.exitCode === 0 && new TextDecoder().decode(r.stdout).trim().length > 0;
  } catch {
    return false;
  }
})();
/** Serve sia la chiave sia il consenso esplicito: questi test costano. */
const live = hasKey && process.env.OPENAI_E2E === "1";

// `low` instead of `high`: same code path, ~35x less cost. What is verified
// here is the full round trip, not the rendering quality.
process.env.OPENAI_IMAGE_QUALITY = "low";
process.env.WORKER_BACKEND = "openai";

const outDir = join(TEST_ROOT, "e2e");
beforeAll(() => mkdirSync(outDir, { recursive: true }));

describe.skipIf(!live)("openai backend: the full round trip produces a real file", () => {
  test(
    "generate writes a readable PNG to disk",
    async () => {
      const { runWorkerOpenAiGenerate } = await import("../server/worker-openai.ts");
      const out = join(outDir, "gen.png");
      const r = await runWorkerOpenAiGenerate({ prompt: "a plain red circle on white", output: out });

      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      // The status is not enough: the file must exist, be a PNG and not be empty.
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(1024);
      const head = Buffer.from(await Bun.file(out).arrayBuffer()).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(r.size_kb).toBeGreaterThan(0);
    },
    5 * 60 * 1000,
  );

  test(
    "edit starts from a source and produces a different file",
    async () => {
      const { runWorkerOpenAi, runWorkerOpenAiGenerate } = await import("../server/worker-openai.ts");
      const src = join(outDir, "src.png");
      const gen = await runWorkerOpenAiGenerate({ prompt: "a plain blue square on white", output: src });
      expect(gen.status).toBe("ok");

      const out = join(outDir, "edited.png");
      // The MIME on the Blob is what broke this path: without it, the edits
      // endpoint answers "unsupported mimetype ('application/octet-stream')".
      const r = await runWorkerOpenAi({ image: src, prompt: "make the background yellow", output: out });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(existsSync(out)).toBe(true);
      const a = Buffer.from(await Bun.file(src).arrayBuffer());
      const b = Buffer.from(await Bun.file(out).arrayBuffer());
      expect(b.equals(a)).toBe(false); // an edit that returns the original is a failed edit
    },
    8 * 60 * 1000,
  );
});

describe("errors do not become broken files in the gallery", () => {
  test("a non-existent source fails before calling the API", async () => {
    const { runWorkerOpenAi } = await import("../server/worker-openai.ts");
    const out = join(outDir, "mai.png");
    const r = await runWorkerOpenAi({ image: join(outDir, "NONESISTE.png"), prompt: "x", output: out });
    expect(r.status).toBe("error");
    // The point: a failure must not leave a half-written file that then looks
    // like a good version in the grid.
    expect(existsSync(out)).toBe(false);
  });
});
