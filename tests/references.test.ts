import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { refsDir } from "../server/project.ts";

/**
 * The References section showed zero images: it asked you to paste a path for a
 * file that was already inside the project.
 *
 * The cost is not the friction, it is what the friction hides. On `profilo` a
 * reference went unused on 12 generations out of 12 while the refset kept
 * promising "+ style", and there was nowhere that number could be read: twelve
 * paid images went the wrong way before anybody noticed by looking at them.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function put(name: string): void {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), name), PNG);
}

function variant(n: number, refs: string[]): void {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES ('p',?,?,'x',NULL,?,'openai','generated',?)`,
    [n, `/gen/v${n}.png`, JSON.stringify({ recipe: "r", refset: "rs", sources: ["p.png"], refs }), Date.now()],
  );
}

async function list(): Promise<{ file: string; used_in: number }[]> {
  const r = (await (await app.request("/api/references")).json()) as {
    references: { file: string; used_in: number }[];
  };
  return r.references;
}

beforeEach(() => {
  // The references folder is shared between tests: without emptying it, a
  // previous test's files enter the next one's list and the ordering is judged
  // on data nobody put there on purpose.
  rmSync(refsDir(), { recursive: true, force: true });
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
  db().run("INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES ('p','/p.png','.png',1,1)");
});

describe("the project's references are visible", () => {
  test("the list shows the files in the folder", async () => {
    put("style.png");
    const refs = await list();
    expect(refs.some((r) => r.file === "style.png")).toBe(true);
  });

  test("files that are not images stay out", async () => {
    put("style.png");
    mkdirSync(refsDir(), { recursive: true });
    writeFileSync(join(refsDir(), "notes.txt"), "I am not an image");
    const refs = await list();
    expect(refs.some((r) => r.file === "notes.txt")).toBe(false);
  });
});

describe("a reference never used shows that it was never used", () => {
  test("zero variants when no generation attached it", async () => {
    put("never-used.png");
    variant(1, []);
    variant(2, []);
    const r = (await list()).find((x) => x.file === "never-used.png");
    expect(r!.used_in).toBe(0);
  });

  test("the count follows the variants that really attached it", async () => {
    put("used.png");
    variant(1, ["used.png"]);
    variant(2, ["used.png"]);
    variant(3, []);
    const r = (await list()).find((x) => x.file === "used.png");
    expect(r!.used_in).toBe(2);
  });

  test("the profilo case: promised in the refset, absent from the files", async () => {
    // Twelve variants declaring a style and attaching nothing. Before this view
    // the number existed nowhere.
    put("promised-style.png");
    for (let n = 1; n <= 12; n++) variant(n, []);
    const r = (await list()).find((x) => x.file === "promised-style.png");
    expect(r!.used_in).toBe(0);
  });

  test("the never-used ones come first: they are the ones to decide about", async () => {
    // The names are chosen so that alphabetical order gives the OPPOSITE
    // result: if the ordering by usage disappeared, 'a-used-a-lot' would come
    // first and the test would fail — instead of passing while checking
    // nothing.
    put("a-used-a-lot.png");
    put("z-never-used.png");
    variant(1, ["a-used-a-lot.png"]);
    const refs = await list();
    expect(refs.map((r) => r.file)).toEqual(["z-never-used.png", "a-used-a-lot.png"]);
  });

  test("an unreadable lineage does not make the list disappear", async () => {
    put("style.png");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('p',9,'/gen/v9.png','x',NULL,'{rotto',  'openai','generated',?)`,
      [Date.now()],
    );
    const refs = await list();
    expect(refs.some((r) => r.file === "style.png")).toBe(true);
  });
});

describe("from the gallery it is extracted without rebuilding the path", () => {
  test("a bare name resolves inside the project's references", async () => {
    put("style.png");
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "style.png" }),
    });
    // The file exists: whatever the outcome of the extraction, it must NOT be
    // "image not found".
    const body = (await r.json()) as { error?: string };
    expect(body.error ?? "").not.toBe("immagine non trovata");
    // Timeout generoso: questa rotta interroga il modello di visione, che gira
    // fuori dal processo. Con i 5s di default la suite falliva a intermittenza
    // -- un test rosso che non dice niente sul codice insegna a ignorare il
    // rosso, che e' peggio del test mancante.
  }, 60_000);

  test("a name that does not exist stays an error", async () => {
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "non-esiste-affatto.png" }),
    });
    expect(r.status).toBe(400);
  });
});

describe("a reference is uploaded from inside Darkroom", () => {
  // Prima un file entrava in data/refs solo copiandocelo dal Finder: la
  // galleria mostrava i riferimenti ma non c'era modo di aggiungerne uno.
  async function load(name: string, bytes: Buffer, contentType = "image/png") {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(bytes)], name, { type: contentType }));
    return app.request("/api/references", { method: "POST", body: fd });
  }

  test("an uploaded png appears in the list", async () => {
    const r = await load("nuovo.png", PNG);
    expect(r.status).toBe(200);
    expect((await list()).some((x) => x.file === "nuovo.png")).toBe(true);
  });

  test("a format that is not allowed is refused", async () => {
    const r = await load("notes.txt", Buffer.from("ciao"), "text/plain");
    expect(r.status).toBe(400);
    // And nothing must be left on disk.
    expect((await list()).some((x) => x.file === "notes.txt")).toBe(false);
  });

  test("an empty file is refused", async () => {
    const r = await load("vuoto.png", Buffer.alloc(0));
    expect(r.status).toBe(400);
  });

  test("a name with separators does not leave the folder", async () => {
    const r = await load("../../fuga.png", PNG);
    expect(r.status).toBe(200);
    const refs = await list();
    // The file is there, but with a sanitised name: no directory traversal.
    expect(refs.some((x) => x.file.includes("/") || x.file.includes(".."))).toBe(false);
    expect(refs.some((x) => x.file.endsWith("fuga.png"))).toBe(true);
  });

  test("a name longer than the filesystem allows is shortened, it does not blow up", async () => {
    // 300 characters: beyond the 255 bytes filesystems accept. Before, the
    // write failed with ENAMETOOLONG and the route died instead of
    // answering.
    const r = await load("a".repeat(300) + ".png", PNG);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { file: string };
    expect(body.file.length).toBeLessThanOrEqual(200);
    expect(body.file.endsWith(".png")).toBe(true);
  });

  test("a double suffix does not get around the format check", async () => {
    // "x.png.exe" has .png in the name but the real extension is .exe.
    const r = await load("x.png.exe", PNG, "image/png");
    expect(r.status).toBe(400);
  });

  test("a name already taken does not overwrite the existing reference", async () => {
    // Overwriting would change the meaning of the lineage of variants already
    // generated with that file, without telling anybody.
    await load("style.png", PNG);
    variant(1, ["style.png"]);
    const r = await load("style.png", PNG);
    const body = (await r.json()) as { file: string; renamed: boolean };
    expect(body.renamed).toBe(true);
    expect(body.file).toBe("style-2.png");
    // The original keeps its count.
    const orig = (await list()).find((x) => x.file === "style.png");
    expect(orig!.used_in).toBe(1);
  });
});

describe("how far a variant strays from the reference", () => {
  // The measurement existed as a script but stayed outside the page where the
  // variants are looked at: the question "am I getting closer?" could only be
  // asked from a terminal, and the calibrations went on for three rounds on a
  // wrong hypothesis for exactly that reason.
  function version(n: number, refs: string[], imagePath: string): number {
    const r = db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('p',?,?,'x',NULL,?,'openai','generated',?)`,
      [n, imagePath, JSON.stringify({ recipe: "r", refset: "rs", sources: ["p.png"], refs }), Date.now()],
    );
    return Number(r.lastInsertRowid);
  }

  test("a variant with no reference says so instead of inventing a number", async () => {
    const id = version(1, [], join(refsDir(), "qualsiasi.png"));
    put("qualsiasi.png");
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      reference: string | null;
      gap: unknown;
    };
    // This is the case that cost 12 generations on profilo: no target.
    expect(r.reference).toBeNull();
    expect(r.gap).toBeNull();
  });

  test("a vanished reference does not let the measurement pass as successful", async () => {
    const id = version(2, ["mai-esistita.png"], join(refsDir(), "x.png"));
    put("x.png");
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      reference: string;
      gap: unknown;
      error?: string;
    };
    expect(r.reference).toBe("mai-esistita.png");
    expect(r.gap).toBeNull();
    // The message must say WHAT is missing: without the explicit check the
    // error arrives anyway, but as the spit of a python stack that explains
    // nothing to whoever is reading the page.
    expect(r.error).toBe("reference mancante");
  });

  test("a non-existent version is a 404, not a measurement error", async () => {
    const r = await app.request("/api/versions/999999/gap");
    expect(r.status).toBe(404);
  });

  test("a non-numeric id is refused", async () => {
    const r = await app.request("/api/versions/pippo/gap");
    expect(r.status).toBe(400);
  });

  test("measuring an image against itself gives distance zero", async () => {
    // The check that the measurement is a measurement: if a thing is not
    // distant from itself, the scale has a fixed point and the numbers above it
    // mean something.
    put("uguale.png");
    const p = join(refsDir(), "uguale.png");
    const id = version(3, ["uguale.png"], p);
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      gap: { distance: number } | null;
    };
    expect(r.gap).not.toBeNull();
    expect(r.gap!.distance).toBe(0);
  }, 30_000);
});

describe("the distance behaves like a distance", () => {
  // A number that rises orders things; a number that sometimes falls when
  // things get worse orders nothing, and would be worse than no number because
  // it looks like a judgement.
  const py = (a: string, b: string) => {
    const r = Bun.spawnSync(["python3", "scripts/ref_match.py", a, b], { cwd: process.cwd() });
    return JSON.parse(new TextDecoder().decode(r.stdout)) as {
      distance: number;
      saturated: boolean;
    };
  };

  test("degrading progressively NEVER makes the distance fall", async () => {
    const src = join(refsDir(), "base.png");
    put("base.png");
    // The reference is degraded against itself: every step is further away.
    const steps = [1.0, 0.85, 0.7, 0.55];
    const done: string[] = [];
    for (const f of steps) {
      const out = `/tmp/darkroom-degrado-${f}.png`;
      const r = Bun.spawnSync([
        "python3",
        "-c",
        `from PIL import Image, ImageEnhance; ImageEnhance.Contrast(Image.open(${JSON.stringify(src)}).convert("RGB")).enhance(${f}).save(${JSON.stringify(out)})`,
      ]);
      expect(r.exitCode).toBe(0);
      done.push(out);
    }
    let prec = -1;
    for (const f of done) {
      const d = py(f, src).distance;
      expect(d).toBeGreaterThanOrEqual(prec);
      prec = d;
    }
  }, 60_000);

  test("an image is distance zero from itself", () => {
    put("identica.png");
    const p = join(refsDir(), "identica.png");
    expect(py(p, p).distance).toBe(0);
  }, 30_000);

  test("when the silhouette vanishes into the background, the measurement says so", async () => {
    const src = join(refsDir(), "sat.png");
    put("sat.png");
    const out = "/tmp/darkroom-saturo.png";
    Bun.spawnSync([
      "python3",
      "-c",
      `from PIL import Image, ImageEnhance; ImageEnhance.Contrast(Image.open(${JSON.stringify(src)}).convert("RGB")).enhance(0.3).save(${JSON.stringify(out)})`,
    ]);
    const r = py(out, src);
    // Past this threshold the distance is a lower bound, not the exact value:
    // without the flag two different degradations would read the same.
    expect(r.saturated).toBe(true);
  }, 30_000);
});
