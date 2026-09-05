import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { costUsd } from "../server/worker-openai.ts";

/**
 * The OpenAI backend is the only one costing real money on every generation, so
 * what is checked here is what an oversight makes you pay for: that the default
 * does not become the paid backend, that whoever is not driving a browser does
 * not start one, and that the cost is read from the tokens the API reports
 * instead of from a table (measured on 26/08: one `high` 1024² consumed 7024
 * tokens where the docs gave 4160 — estimating it would have been 70% out).
 */

/** config.ts reads the env at import: to try several backends you need a
 *  fresh module each time, otherwise you would always be testing the first
 *  read. */
async function loadConfig(backend?: string) {
  const prev = process.env.WORKER_BACKEND;
  if (backend === undefined) delete process.env.WORKER_BACKEND;
  else process.env.WORKER_BACKEND = backend;
  const mod = await import(`../server/config.ts?t=${Date.now()}${Math.random()}`);
  if (prev === undefined) delete process.env.WORKER_BACKEND;
  else process.env.WORKER_BACKEND = prev;
  return mod;
}

describe("the paid backend is not chosen on its own", () => {
  test("without WORKER_BACKEND it stays cdp, which is free", async () => {
    const c = await loadConfig(undefined);
    expect(c.WORKER_BACKEND).toBe("cdp");
  });

  test("openai activates only when explicitly asked for", async () => {
    const c = await loadConfig("openai");
    expect(c.WORKER_BACKEND).toBe("openai");
  });
});

describe("only the cdp backend drives a browser", () => {
  // The guard excluded only "codex" by name: with codex-http and openai
  // Darkroom launched Chrome to watch a window it does not use.
  test("cdp sì, gli altri no", async () => {
    expect((await loadConfig(undefined)).BACKEND_USES_BROWSER).toBe(true);
    expect((await loadConfig("codex")).BACKEND_USES_BROWSER).toBe(false);
    expect((await loadConfig("codex-http")).BACKEND_USES_BROWSER).toBe(false);
    expect((await loadConfig("openai")).BACKEND_USES_BROWSER).toBe(false);
  });
});

describe("the cost is computed on the real tokens", () => {
  test("a measured high costs what it was actually billed", () => {
    // 7024 tokens observed on the 26/08 batch → $0.2107 at the sync price.
    expect(costUsd("gpt-image-2", 7024)).toBeCloseTo(0.2107, 4);
  });

  test("a low costs two orders of magnitude less", () => {
    expect(costUsd("gpt-image-2", 196)).toBeCloseTo(0.00588, 5);
  });

  test("an unknown model does not zero the bill", () => {
    // Returning 0 would make a pass that is actually paid for look free.
    expect(costUsd("gpt-image-9-inesistente", 7024)).toBeGreaterThan(0);
  });
});

describe("gpt-image-1-mini è la via economica", () => {
  test("costa meno di gpt-image-2 a parità di token", () => {
    expect(costUsd("gpt-image-1-mini", 7024)).toBeLessThan(costUsd("gpt-image-2", 7024));
  });
});

describe("without a key the network is not attempted", () => {
  // OAI-03: the message must contain the exact command, otherwise whoever
  // reads it has to go hunting for it — and it is the first error anybody
  // trying this backend on a new machine will see.
  //
  // The "no Keychain" case is not simulated with PATH: Bun.spawnSync does not
  // respect a PATH changed at runtime and found the real key, starting a paid
  // call inside the suite. It is checked against the source instead, which is
  // the only deterministic thing here.
  test("the error says how to register the key", async () => {
    const src = await Bun.file(new URL("../server/worker-openai.ts", import.meta.url)).text();
    expect(src).toContain("add-generic-password");
    expect(src).toContain("-s");
    expect(src).toContain("openai");
    // Every public entry point must check the key as its first act: if the
    // guard came later, whoever lacks one would see a network error instead of
    // the instruction to fix it. Each function is inspected, not the file: the
    // helpers with the fetches are declared above.
    for (const fn of ["runWorkerOpenAiGenerate", "runWorkerOpenAi"]) {
      const start = src.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf("\nexport ", start + 1) >>> 0 || undefined);
      const guard = body.indexOf("openaiKey()");
      const call = body.indexOf("runEdits");
      const gen = body.indexOf("callImages");
      const firstCall = Math.min(...[call, gen].filter((i) => i > 0));
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstCall);
    }
  });

  test("the key appears in no versioned file", async () => {
    // The project's convention is the Keychain, not .env (which here is
  // world-readable).
    const example = await Bun.file(new URL("../.env.example", import.meta.url)).text();
    expect(example).not.toMatch(/sk-(proj-)?[A-Za-z0-9_-]{20,}/);
    expect(example).toContain("add-generic-password");
  });
});

describe("the backend really talks to OpenAI", () => {
  // The tests above look at the source; this one looks at the traffic. With a
  // fake key you get as far as the request without spending: if the routing
  // were wrong, the URL would not be OpenAI's.
  test("generate hits /v1/images/generations and an error leaves no file", async () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevFetch = globalThis.fetch;
    const urls: string[] = [];
    process.env.OPENAI_API_KEY = "sk-test-non-valida-per-il-routing";
    // It is intercepted and NOT forwarded: this way the test says the same
    // thing on a machine with no network, and does not even spend the rejected
    // request.
    globalThis.fetch = ((u: unknown) => {
      urls.push(String(u));
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
          status: 401,
        }),
      );
    }) as typeof fetch;
    const out = "/tmp/darkroom-routing-test.png";
    try {
      const mod = await import(`../server/worker-openai.ts?routing=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: out });
      expect(urls[0]).toBe("https://api.openai.com/v1/images/generations");
      // An invalid key = a clean error, not a crash and not an empty file in
      // the gallery (which would be indistinguishable from a good version).
      expect(r.status).toBe("error");
      expect(existsSync(out)).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  }, 60_000);
});

describe("the batch really asks for what it says it asks for", () => {
  // "obviously batch high" is a directive about configuration, and the place
  // it can break silently is the JSONL: a wrong default in there produces fifty
  // images in low without anybody noticing until they look at them.
  test("submit writes model and quality into the JSONL", async () => {
    const prevFetch = globalThis.fetch;
    const prevArgv = process.argv;
    let jsonl = "";
    globalThis.fetch = (async (u: unknown, o: { body?: unknown }) => {
      const url = String(u);
      if (url.endsWith("/files")) {
        jsonl = await ((o.body as FormData).get("file") as File).text();
        return new Response(JSON.stringify({ id: "file-fake" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "batch-fake" }), { status: 200 });
    }) as unknown as typeof fetch;
    const promptFile = "/tmp/darkroom-batch-spec.txt";
    await Bun.write(promptFile, "# commento\nuna insegna\n\nun gatto\n");
    process.argv = [prevArgv[0] as string, "x", "submit", promptFile];
    try {
      await import(`../scripts/openai_batch.ts?spec=${Date.now()}${Math.random()}`);
      const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
      // A comment and a blank line do not become paid images.
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        expect(l.url).toBe("/v1/images/generations");
        expect(l.body.model).toBe("gpt-image-2");
        expect(l.body.quality).toBe("high");
      }
    } finally {
      globalThis.fetch = prevFetch;
      process.argv = prevArgv;
    }
  }, 30_000);
});

describe("how much has been spent is visible before, not after", () => {
  // With a paid backend the only way to know what a project costs was to look
  // at the invoice at the end of the month. The remaining balance cannot be
  // read: /organization/costs and /dashboard/billing answer 403 "Missing
  // scopes: api.usage.read" to a project key. So what the API reported on each
  // generation is summed instead.
  test("the worker returns the cost from the response's tokens", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-costo";
    // 1x1 PNG valido: saveResult rilegge il file da disco.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 7024 } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?costo=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({
        prompt: "x",
        output: "/tmp/darkroom-costo-test.png",
      });
      expect(r.status).toBe("ok");
      // 7024 token a $30/M = $0.2107, il costo vero misurato il 26/08.
      expect(r.cost_usd).toBeCloseTo(0.2107, 4);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);

  test("without usage the cost stays absent, not zero", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-costo";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?nousage=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-costo2.png" });
      expect(r.status).toBe("ok");
      // Zero would say "free", which is a different answer from "not
  // measurable".
      expect(r.cost_usd).toBeUndefined();
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);
});

describe("you pay for the call, not for the version saved", () => {
  // Counting `versions` gave $1.26 over 6 images where the calls were 21 for
  // ~$2.79: the calibration attempts end up in /tmp, the discards are not
  // saved, and failures after the generation are paid for all the same. None of
  // those left a version to count, so the number in the bar was not imprecise:
  // it was structurally incomplete.
  test("a successful generation leaves a row in api_calls", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-chiamate";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 7024 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      const before = db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM api_calls").get()?.n ?? 0;
      const mod = await import(`../server/worker-openai.ts?call=${Date.now()}${Math.random()}`);
      await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-call-test.png" });
      const after = db().query<{ n: number; tot: number }, []>(
        "SELECT COUNT(*) AS n, SUM(cost_usd) AS tot FROM api_calls",
      ).get();
      expect(after!.n).toBe(before + 1);
      // The recorded cost is the real one, not an estimate from a table.
      const last = db().query<{ cost_usd: number; output_tokens: number }, []>(
        "SELECT cost_usd, output_tokens FROM api_calls ORDER BY id DESC LIMIT 1",
      ).get();
      expect(last!.output_tokens).toBe(7024);
      expect(last!.cost_usd).toBeCloseTo(0.2107, 4);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);
});

describe("the daily cap bites before spending", () => {
  // The real limit sits on the OpenAI account but cannot be set from here
  // (403) and arrives as an alert AFTERWARDS. This one applies before the call:
  // it is the only brake Darkroom can pull by itself.
  test("past the cap no request leaves", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    process.env.OPENAI_API_KEY = "sk-test-tetto";
    process.env.OPENAI_DAILY_CAP_USD = "0.01"; // already exceeded by the rows below
    // The sync threshold is switched off: what is measured here is the CAP, and
    // with both active the other would fire and the test would be describing a
    // different brake.
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?cap=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-cap.png" });
      expect(r.status).toBe("error");
      expect(r.error).toContain("tetto giornaliero");
      // The point: blocking AFTER the fetch would save nothing.
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
    }
  }, 30_000);

  test("under the cap the generation proceeds", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    process.env.OPENAI_API_KEY = "sk-test-tetto2";
    process.env.OPENAI_DAILY_CAP_USD = "999";
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?cap2=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-cap2.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
    }
  }, 30_000);
});

describe("the batch is not a back door", () => {
  // The cap and the counting lived in the worker, but scripts/openai_batch.ts
  // calls the API on its own: fifty prompts in high is ~$5 that appeared
  // nowhere and that no limit stopped.
  test("submit refuses when the batch would exceed the cap", async () => {
    const prevFetch = globalThis.fetch;
    const prevArgv = process.argv;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevExit = process.exit;
    process.env.OPENAI_API_KEY = "sk-test-batchcap";
    process.env.OPENAI_DAILY_CAP_USD = "0.01";
    let chiamate = 0;
    let exited = false;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    // process.exit(1) here is the intended behaviour: it is intercepted so it
    // can be observed without killing the test runner.
    process.exit = ((code?: number) => {
      exited = code === 1;
      throw new Error("__exit__");
    }) as never;
    const file = "/tmp/darkroom-batch-cap.txt";
    await Bun.write(file, "un prompt\naltro prompt\n");
    process.argv = [prevArgv[0] as string, "x", "submit", file];
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test',?)`,
        [Date.now()],
      );
      await import(`../scripts/openai_batch.ts?bcap=${Date.now()}${Math.random()}`).catch((e) => {
        if (!String(e?.message).includes("__exit__")) throw e;
      });
      expect(exited).toBe(true);
      // The point: no upload, no batch created, nothing spent.
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      process.argv = prevArgv;
      process.exit = prevExit;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);

  test("the batch discount halves the cost without falsifying the tokens", async () => {
    const { db } = await import("../server/db.ts");
    const mod = await import(`../server/worker-openai.ts?sconto=${Date.now()}${Math.random()}`);
    mod.recordCall("gpt-image-2", 7024, true, "test-sconto", 0.5);
    const r = db()
      .query<{ output_tokens: number; cost_usd: number }, []>(
        "SELECT output_tokens, cost_usd FROM api_calls WHERE origin='test-sconto' ORDER BY id DESC LIMIT 1",
      )
      .get();
    // The tokens stay the real ones: they are what the model produced.
    expect(r!.output_tokens).toBe(7024);
    // The cost is half: that is the tariff.
    expect(r!.cost_usd).toBeCloseTo(0.1054, 4);
  });
});

describe("the expensive road must not be the comfortable one", () => {
  // The batch costs half and had existed for days, but 25 calls out of 25 were
  // made synchronously: $2.81 where $1.40 would have done. An option was not
  // missing, friction on the wrong road was.
  test("past the threshold the sync path defers to the batch without calling the API", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    process.env.OPENAI_API_KEY = "sk-test-budget";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.01";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test-budget',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?bud=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-budget.png" });
      expect(r.status).toBe("error");
      // The message must say WHAT to do, not only that it is forbidden.
      expect(r.error).toContain("openai_batch.ts");
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
    }
  }, 30_000);

  test("a low trial passes even after a day of high", async () => {
    // THE BUG: the brake compared the DAY'S TOTAL with the threshold, so after
    // $2.81 of generations it refused even a half-cent trial — which is exactly
    // the right way to work. Now it weighs the cost of the call about to
    // leave.
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    const prevQ = process.env.OPENAI_IMAGE_QUALITY;
    process.env.OPENAI_API_KEY = "sk-test-low";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.5";
    process.env.OPENAI_IMAGE_QUALITY = "low";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      // A day already spent, well past the sync threshold.
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',93000,2.81,1,'test-low',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?low=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-low.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
      if (prevQ === undefined) delete process.env.OPENAI_IMAGE_QUALITY;
      else process.env.OPENAI_IMAGE_QUALITY = prevQ;
    }
  }, 30_000);

  test("with references it does not defer to the batch, which does not accept them", async () => {
    // The batch does not support /edits: recommending it to somebody using a
    // reference is sending them down a blind alley. It must suggest `low`.
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    const prevQ = process.env.OPENAI_IMAGE_QUALITY;
    process.env.OPENAI_API_KEY = "sk-test-refs";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.01";
    process.env.OPENAI_IMAGE_QUALITY = "high";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/darkroom-src-test.png", Buffer.from("x"));
    try {
      const mod = await import(`../server/worker-openai.ts?refs=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAi({
        image: "/tmp/darkroom-src-test.png",
        prompt: "x",
        output: "/tmp/darkroom-refs.png",
      });
      expect(r.status).toBe("error");
      expect(r.error).not.toContain("openai_batch.ts");
      expect(r.error).toContain("low");
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
      if (prevQ === undefined) delete process.env.OPENAI_IMAGE_QUALITY;
      else process.env.OPENAI_IMAGE_QUALITY = prevQ;
    }
  }, 30_000);

  test("at a threshold of zero there is no brake", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    process.env.OPENAI_API_KEY = "sk-test-budget0";
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?bud0=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-budget0.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
    }
  }, 30_000);
});
