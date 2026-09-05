import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { withProject, genDir } from "../server/project.ts";
import { versionFileName, versionPath, pathOutsideConvention } from "../server/db.ts";

/**
 * On 27/08 two generated covers did not appear in the tree. The row was in the
 * database, the API returned it, the variant showed on the page: only the image
 * was missing, because `image_path` pointed at
 * `generations/cover-scena-gel-high.png` while the client asks for the
 * thumbnail at the address it rebuilds itself, `generations/1/v30.png`.
 *
 * It is the worst kind of failure: nothing breaks, everything looks fine, and
 * the data is invisible until somebody goes looking for that exact one.
 */
describe("a version's file name", () => {
  test("below ten it is padded with a zero", () => {
    expect(versionFileName(1)).toBe("v01.png");
    expect(versionFileName(9)).toBe("v09.png");
  });

  test("da dieci in su resta com'e'", () => {
    expect(versionFileName(10)).toBe("v10.png");
    expect(versionFileName(30)).toBe("v30.png");
  });

  test("past the hundredth it is NOT truncated to two digits", () => {
    // Japan has versions past the hundredth: a padding that truncates would
    // pass them off as outside the convention, and that is exactly the mistake
    // I made writing the census (159 false positives with substr(-2)).
    expect(versionFileName(100)).toBe("v100.png");
    expect(versionFileName(3007)).toBe("v3007.png");
  });
});

describe("where a version's file must live", () => {
  test("under ITS OWN photo's folder, not in the root", () => {
    withProject("conv-a", () => {
      expect(versionPath("foto1", 30)).toBe(join(genDir(), "foto1", "v30.png"));
    });
  });

  test("two photos do not share the same file", () => {
    withProject("conv-b", () => {
      expect(versionPath("a", 1)).not.toBe(versionPath("b", 1));
    });
  });
});

describe("il controllo sulla convenzione", () => {
  test("a correct path has nothing to say", () => {
    withProject("conv-c", () => {
      expect(pathOutsideConvention("f", 3, versionPath("f", 3))).toBeNull();
    });
  });

  test("a file in the root instead of the photo's folder is spotted", () => {
    withProject("conv-d", () => {
      const wrong = join(genDir(), "cover-scena-gel-high.png");
      const msg = pathOutsideConvention("1", 30, wrong);
      expect(msg).not.toBeNull();
      // The message has to say what will happen, not just that it is different:
      // it is the only thing linking the cause to the observed symptom (a 500).
      expect(msg).toContain("500");
      expect(msg).toContain("v30.png");
    });
  });

  test("a number without a leading zero is outside the convention all the same", () => {
    // `v3.png` instead of `v03.png`: the file exists, the thumbnail does not.
    withProject("conv-e", () => {
      expect(pathOutsideConvention("f", 3, join(genDir(), "f", "v3.png"))).not.toBeNull();
    });
  });

  test("ANOTHER photo's folder is outside the convention", () => {
    withProject("conv-f", () => {
      expect(pathOutsideConvention("a", 1, versionPath("b", 1))).not.toBeNull();
    });
  });

  test("the wrong version number in the right folder is outside the convention", () => {
    withProject("conv-g", () => {
      expect(pathOutsideConvention("a", 2, versionPath("a", 1))).not.toBeNull();
    });
  });
});

describe("instants are written in milliseconds", () => {
  test("now() is in milliseconds, like Date.now()", async () => {
    const { adesso } = await import("../server/db.ts");
    const t = adesso();
    // Un valore in secondi sarebbe ~1.7e9, uno in millisecondi ~1.7e12.
    expect(t).toBeGreaterThan(1_000_000_000_000);
    expect(Math.abs(t - Date.now())).toBeLessThan(1000);
  });

  test("riconosce un istante scritto in secondi", async () => {
    // THE BUG: three versions recorded by hand with Date.now()/1000 ended up at
    // the bottom of the chronological order, looking decades old.
    const { suspectInstant } = await import("../server/db.ts");
    expect(suspectInstant(1787854707)).toBe(true); // v31, as it was written
    expect(suspectInstant(1787854707000)).toBe(false); // as it should be
  });

  test("zero is not suspicious: it is absent, not wrong", async () => {
    const { suspectInstant } = await import("../server/db.ts");
    expect(suspectInstant(0)).toBe(false);
  });
});

describe("il lineage viaggia dal job alla versione", () => {
  // The queue did not write it before: generations made the correct way ended
  // up under "origin not recorded" in the tree, while those launched by hand
  // from a script had the right grouping. The perverse effect is that writing
  // INSERTs by hand paid off — and that is how, in a single day, a path outside
  // the convention and timestamps in seconds were born.
  test("enqueueJob accetta e conserva il lineage", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("lin-test", () => {
      initSchema();
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p1','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const lin = JSON.stringify({ recipe: "prova", refset: "1 sorgente", sources: ["x.png"], refs: [] });
      const job = enqueueJob("p1", "prompt", null, "chatgpt", null, "edit", null, null, lin);
      const reread = db()
        .query<{ lineage: string | null }, [number]>("SELECT lineage FROM jobs WHERE id = ?")
        .get(job.id);
      expect(reread?.lineage).toBe(lin);
      expect(JSON.parse(reread!.lineage!).recipe).toBe("prova");
    });
  });

  test("without a lineage the job stays valid: old calls do not change", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("lin-test2", () => {
      initSchema();
      // Id diverso dal test precedente: i due condividono il database, e
      // riusare 'p1' viola la chiave primaria.
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p2','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const job = enqueueJob("p2", "prompt");
      expect(job.status).toBe("pending");
      const reread = db()
        .query<{ lineage: string | null }, [number]>("SELECT lineage FROM jobs WHERE id = ?")
        .get(job.id);
      expect(reread?.lineage).toBeNull();
    });
  });
});

describe("the channel is chosen per job, not per process", () => {
  // It was a constant computed at import: to generate with a different backend
  // you had to restart the service, and the restart changes the behaviour of
  // EVERY project instead of the single generation.
  test("with nothing specified the system one is used", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: null })).toBe("cdp"); // default di WORKER_BACKEND
    expect(backendDi(undefined)).toBe("cdp");
  });

  test("a job can carry its own channel", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "openai" })).toBe("openai");
    expect(backendDi({ backend: "codex-http" })).toBe("codex-http");
    expect(backendDi({ backend: "codex" })).toBe("codex");
  });

  test("an unknown channel does not break the queue: it falls back to the browser", async () => {
    // A crooked value in a text column must not make the job fail.
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "banana" })).toBe("cdp");
    expect(backendDi({ backend: "" })).toBe("cdp");
  });

  test("il canale e' insensibile alle maiuscole", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "OpenAI" })).toBe("openai");
  });

  test("enqueueJob conserva il canale scelto", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("backend-test", () => {
      initSchema();
      // Id unico: i test condividono il database e riusare 'p1' violerebbe la
      // chiave primaria.
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p3','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const job = enqueueJob("p3", "prompt", null, "chatgpt", null, "edit", null, null, null, "openai");
      const reread = db()
        .query<{ backend: string | null }, [number]>("SELECT backend FROM jobs WHERE id = ?")
        .get(job.id);
      expect(reread?.backend).toBe("openai");
    });
  });
});
