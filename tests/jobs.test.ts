import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cancelPending, listJobs, looksLikePolicyRefusal, parseRefPaths } from "../server/jobs.ts";
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

describe("listJobs: an error that was overcome is no longer an error", () => {
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

  test("a failure followed by a success leaves the list", () => {
    job("a", "failed");
    job("a", "done");
    const ids = listJobs(100).map((j) => j.status);
    // The grid reads the LAST job to decide the badge: if the old failed one
    // stays in the list and the done one falls outside the LIMIT, it marks a
    // healthy photo red.
    expect(ids).toEqual(["done"]);
  });

  test("a failure followed by a job still running leaves it too", () => {
    job("a", "failed");
    job("a", "running");
    expect(listJobs(100).map((j) => j.status)).toEqual(["running"]);
  });

  test("a failure that is still the last word stays", () => {
    job("a", "done");
    job("a", "failed");
    expect(listJobs(100).map((j) => j.status)).toContain("failed");
  });

  test("the success of ANOTHER photo does not hide this error", () => {
    job("a", "failed");
    job("b", "done");
    const rows = listJobs(100);
    expect(rows.find((j) => j.photo_id === "a")?.status).toBe("failed");
  });

  test("a failure already archived by the user stays out", () => {
    job("a", "failed", 1);
    expect(listJobs(100)).toHaveLength(0);
  });
});

describe("ChatGPT anti-saturation strategy", () => {
  test("the pause between jobs is configurable and has a sensible default", async () => {
    // The value cannot be read from a test (it is an already-loaded module), but
    // the contract can: a pause must exist, and it must be overridable when the
    // account has already been squeezed.
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    expect(src).toContain("JOB_GAP_MS");
    expect(src).toContain("process.env.JOB_GAP_MS");
    // The jitter is what avoids a perfectly regular rhythm.
    expect(src).toContain("JOB_GAP_JITTER_MS");
    expect(src).toMatch(/Math\.random\(\)\s*\*\s*JOB_GAP_JITTER_MS/);
  });

  test("the watchdog restarts the loop only if there are jobs waiting", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // Restarting a healthy loop is worse than the problem: the guard on pending
    // stops it being relaunched when the queue is simply empty.
    expect(src).toMatch(/const pending = pickNextPending\(\);\s*\n\s*if \(!pending\) return;/);
    expect(src).toContain("loopBeatMs");
  });

  test("the attachment is retried before the job is declared failed", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // "image not attached" was 62% of the failures and is not a refusal from
    // ChatGPT: it is the slow thumbnail. There must be a retry with a new chat.
    expect(py).toContain("async def attach_with_retries");
    expect(py).toContain("attach_with_retries(cdp, [str(resized)], ref_paths, image.name)");
    // And the pause between attempts must grow, not be fixed.
    expect(py).toContain("wait_s = 5 * i");
  });
});

describe("ChatGPT's explicit cap", () => {
  test("a hint in hours is not truncated to half an hour", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // The real case: reset_hint="in 13 hour" was cut down to 30 minutes, so we
    // came back knocking 26 times, burning a job each time.
    expect(src).toContain("MAX_EXPLICIT_PAUSE_MS");
    expect(src).not.toMatch(/pausedUntilMs = Math\.min\(explicitReset \+ 2 \* 60 \* 1000, cap\)/);
    // And a pause already under way must not be shortened by a briefer hint.
    expect(src).toContain("Math.max(pausedUntilMs, until)");
  });
});

describe("the downloaded render must be of THIS photo", () => {
  test("the worker compares the downloaded image with the original", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // 116 renders belonging to other jobs got into the set: a plate of sushi had
    // become a street at night, and nothing flagged it. The baseline excludes
    // images already seen, but not a NEW image generated for another job.
    expect(py).toContain("def looks_like_same_scene");
    expect(py).toContain("does not match the source photo");
    // The wrong file must be deleted, not left there passing itself off as valid.
    expect(py).toContain("output.unlink(missing_ok=True)");
    // Adjustable threshold: on a heavily recomposed set it might need to be
    // lower.
    expect(py).toContain("SCENE_MIN_CORR");
  });

  test("if the comparison errors, the generation passes", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // A check that fails good renders because numpy is missing would be worse
    // than the problem: the fallback returns 1.0 (= identical).
    expect(py).toMatch(/except Exception:\s*\n\s*#[^\n]*\n\s*#[^\n]*\n\s*return 1\.0/);
  });
});

describe("cancelling a job that is running", () => {
  function mk(photo: string, status: string): number {
    db().run(
      `INSERT INTO jobs (photo_id, prompt, status, seen, created_at) VALUES (?, 'p', ?, 0, ?)`,
      [photo, status, Date.now()],
    );
    return Number(db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id);
  }
  const statusOf = (id: number) =>
    db().query<{ status: string }, [number]>("SELECT status FROM jobs WHERE id = ?").get(id)!.status;

  beforeEach(() => db().run("DELETE FROM jobs"));

  test("a job stuck in 'running' can be stopped", () => {
    // Only 'pending' ones used to be cancelled: a hung job held the browser lock
    // and the queue stopped advancing until the server was restarted.
    const id = mk("a", "running");
    expect(cancelPending(id)).toBe(true);
    expect(statusOf(id)).toBe("cancelled");
  });

  test("a job already finished is left alone", () => {
    const id = mk("a", "done");
    expect(cancelPending(id)).toBe(false);
    expect(statusOf(id)).toBe("done");
  });

  test("the runner's requeue does not resurrect a cancelled job", () => {
    const id = mk("a", "running");
    cancelPending(id);
    // this is the query the runner runs after a silent timeout
    db().run(
      "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=? AND status <> 'cancelled'",
      ["requeued: timeout", id],
    );
    expect(statusOf(id)).toBe("cancelled");
  });
});

describe("recognising the render when ChatGPT shows it small", () => {
  test("an alt of 'generated image' counts as much as the size", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Real case on IMG_2906: ChatGPT rendered the result in a 400px box with
    // naturalWidth still 0, the >=512 threshold discarded it and the job spun
    // for 6 minutes before requeueing itself.
    expect(py).toContain("const strongId = (i) =>");
    expect(py).toContain("alt.startsWith('immagine generata')");
    expect(py).toContain("strongId(i) || bigEnough(i)");
    // The hard threshold must not come back on its own.
    expect(py).not.toContain("(i.naturalWidth >= 512 || i.width >= 512));");
  });

  test("an attachment of ours is never the render", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // 24/08: 222 jobs failed in a row. The colour reference attached by
    // colorReference (alt 'ref_...') is served from the same
    // estuary/content?id=file_ URL as the render, so it passed isGen and was
    // downloaded instead of the generation: 12 seconds instead of 60, and a
    // correlation of ~0 (a different photo) or ~1 (the same scene) against the
    // source.
    expect(py).toContain("alt.startsWith('ref_')");
    // The real defence is not the prefix, which depends on what we call the
    // files: it is the conversation turn. Attachments live in the user's
    // message, the render in the assistant's.
    expect(py).toContain('i.closest(\'[data-message-author-role="user"]\')');
    expect(py).toContain("!fromUser(i)");
  });
});

describe("the worker script must at least compile", () => {
  test("edit_batch.py is valid Python", async () => {
    // A brace not doubled inside an f-string made the worker exit 1 on every
    // attempt: the queue requeued forever and no test noticed, because they
    // only checked the file's TEXT.
    const proc = Bun.spawnSync(["python3", "-c",
      "import ast,sys;ast.parse(open('scripts/edit_batch.py').read())"]);
    expect(new TextDecoder().decode(proc.stderr)).toBe("");
    expect(proc.exitCode).toBe(0);
  });

  test("color_grade.py is valid Python", () => {
    const proc = Bun.spawnSync(["python3", "-c",
      "import ast;ast.parse(open('scripts/color_grade.py').read())"]);
    expect(proc.exitCode).toBe(0);
  });
});

describe("ChatGPT's image limit has to be read in full", () => {
  test("the worker recognises 'You've hit the Plus plan limit'", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Real message: "You've hit the Plus plan limit for image generations
    // requests... resets in 3 hours and 36 minutes." It does not contain
    // "reached", so it passed for a mute timeout and the queue kept knocking.
    expect(py).toContain("hit the .*limit");
    expect(py).toContain("plan limit");
    expect(py).toContain("unable to invoke the image");
    // And "3 hours and 36 minutes" must be captured whole, not just the hours.
    expect(py).toContain("resets? in");
  });

  test("'3 hours and 36 minutes' does not become a flat 3 hours", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // Losing the 36 minutes means turning up before the reset and burning
    // another attempt: it is the same defect already fixed for "13 hour".
    expect(src).toContain("(?:hours?|ore|ora)\\s*(?:and|e)");
    expect(src).toContain("(Number(hm[1]) * 60 + Number(hm[2])) * 60 * 1000");
  });
});

describe("a refusal from ChatGPT is not a fault", () => {
  test("a policy no is told apart from a transient error", () => {
    // A fault passes on a retry, a policy "no" does not: without telling them
    // apart the photo went back into the queue every round to collect the same
    // refusal.
    expect(looksLikePolicyRefusal("content-policy refusal (copyright/likeness) — skipped")).toBe(true);
    expect(looksLikePolicyRefusal("no image in 360s (early-exit)")).toBe(false);
    expect(looksLikePolicyRefusal("Connection refused")).toBe(false);
  });

  test("the runner marks the photo when the refusal arrives", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    expect(src).toContain("if (looksLikePolicyRefusal(err)) {");
    expect(src).toContain("markSkipped(job.photo_id, err)");
    expect(src).toContain("UPDATE photos SET skipped = 1, skip_reason = ?");
  });
});

describe("a render that changed nothing is not a render", () => {
  test("the worker also rejects the image IDENTICAL to the original", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Real case on 19A084A4: ChatGPT returned the source photo, resized
    // (correlation 1.000). The check only looked at the "too different" side,
    // so it entered the library as a new version: the amber defect it was meant
    // to remove stayed identical.
    expect(py).toContain("SCENE_MAX_CORR");
    expect(py).toContain("returned the source photo unedited");
    // The low threshold (a render from another job) must stay.
    expect(py).toContain("SCENE_MIN_CORR");
    expect(py).toContain("does not match the source photo");
  });
});

describe("the audit scripts must compile", () => {
  // Same lesson as the broken f-string in edit_batch.py: a test that only
  // checks a file's TEXT does not notice that it does not run.
  for (const f of ["scripts/audit_set.py", "scripts/pick_favorites.py"]) {
    test(`${f} e' Python valido`, () => {
      const proc = Bun.spawnSync(["python3", "-c", `import ast;ast.parse(open('${f}').read())`]);
      expect(proc.exitCode).toBe(0);
    });
  }
});

describe("the audit threshold is not invented", () => {
  test("it is calibrated on real judgements, not on a round number picked at random", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    // v83 measured +23 and had been rejected by eye ("still too yellow"), v93
    // +16.8 accepted: a threshold at 25 would have promoted precisely the
    // version already rejected.
    expect(py).toContain("AMBRA_SOGLIA = 20.0");
    expect(py).toContain('v83 = +23.0');
    expect(py).toContain('v93 = +16.8');
  });

  test("the exceptions are named one by one, not a rule that covers everything", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    expect(py).toContain("AMBRA_ACCETTATA");
    // every exception carries its reason with it
    expect(py).toMatch(/"IMG_2913": "[^"]{20,}"/);
  });

  test("the audit does NOT compare against its own original", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    // Tried twice, wrong twice, and the second time with the numbers in hand:
    // the comparison puts the GRADED file (cooled by the pipeline) against the
    // original shot (warm with lamps). On 19A084A4 the original measures +114
    // and every render sits below it, so the difference is almost always
    // negative and does not discriminate. Measured: the poison test went from
    // 3/3 to 1/3 — the audit went blind on exactly the cases that had already
    // been rejected by eye.
    expect(py).not.toContain("def originale_ambra");
    expect(py).toContain("AMBRA_SOGLIA = 20.0");
    // The genuinely warm scenes stay handled by hand, one at a time with the
    // reason.
    expect(py).toContain("AMBRA_ACCETTATA");
  });
});

describe("the audit measurements must not degenerate silently", () => {
  test("a uniform surface does not produce NaN", () => {
    // With a strict ">", on a uniform image the percentile filter selects no
    // pixel: the mean of an empty array = NaN, and a NaN fails EVERY comparison
    // without saying anything. The most degenerate case would also have been
    // the only invisible one.
    const py = Bun.spawnSync(["python3", "-c", `
import numpy as np, sys, importlib.util
from PIL import Image
spec = importlib.util.spec_from_file_location("aud", "scripts/audit_set.py")
aud = importlib.util.module_from_spec(spec); sys.argv = ["audit"]
spec.loader.exec_module(aud)
m = aud.misura(Image.fromarray(np.full((80, 80, 3), 128, np.uint8)))
assert m["ambra"] == m["ambra"], "NaN"
assert m["piattezza"] < aud.PIATTO_SOGLIA, "una superficie piatta deve essere rilevata"
print("ok")
`]);
    expect(new TextDecoder().decode(py.stdout).trim()).toBe("ok");
    expect(py.exitCode).toBe(0);
  });
});
