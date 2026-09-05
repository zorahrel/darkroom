import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";

/**
 * A tree root is the SET of sources, not the first photo in it.
 *
 * Two wrong rules sit on either side of this one: grouping by `photo_id` put
 * every variant under the first source and left the others showing "0
 * variants"; giving each contributing photo its own root would have shown the
 * same 12 variants three times over. What is checked here is that we slide
 * into neither.
 */

function photo(id: string) {
  db().run(
    "INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES (?,?,'.png',1,1)",
    [id, `/src/${id}.png`],
  );
}

function variant(n: number, sources: string[], photoId = sources[0]!) {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES (?,?,?,'p',NULL,?,'openai','generated',?)`,
    [
      photoId.replace(/\.png$/, ""),
      n,
      `/gen/v${n}.png`,
      JSON.stringify({ recipe: "r", refset: "rs", sources: sources }),
      Date.now(),
    ],
  );
}

async function tree(): Promise<{ photos: { photo: string; photos?: string[]; variants: number }[] }> {
  return (await (await app.request("/api/lineage")).json()) as never;
}

beforeEach(() => {
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
});

describe("the root is the set, not the first photo", () => {
  test("three shots used together give ONE root holding all three", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    for (let n = 1; n <= 12; n++) variant(n, ["A.png", "B.png", "C.png"]);

    const { photos } = await tree();
    const withVariants = photos.filter((p) => p.variants > 0);
    expect(withVariants).toHaveLength(1);
    expect(withVariants[0]!.photos).toHaveLength(3);
    expect(withVariants[0]!.variants).toBe(12);
    // The opposite defect: 3 roots x 12 = 36 appearances for 12 generations.
    expect(photos.reduce((a, p) => a + p.variants, 0)).toBe(12);
  });

  test("no photo of the set shows up separately with zero variants", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    variant(1, ["A.png", "B.png", "C.png"]);
    const { photos } = await tree();
    // B and C contributed: they must not appear as empty roots.
    expect(photos).toHaveLength(1);
  });

  test("a lone photo is a set of one, with no special case", async () => {
    photo("A");
    photo("B");
    variant(1, ["A.png"]);
    variant(2, ["B.png"], "B.png");
    const { photos } = await tree();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(2);
    for (const p of photos) expect(p.photos).toHaveLength(1);
  });

  test("overlapping sets stay distinct roots", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    variant(1, ["A.png", "B.png"]);
    variant(2, ["A.png", "B.png"]);
    variant(3, ["A.png", "B.png", "C.png"]);
    const { photos } = await tree();
    const roots = photos.filter((p) => p.variants > 0);
    expect(roots).toHaveLength(2);
    expect(roots.map((x) => x.variants).sort()).toEqual([1, 2]);
    // No variant counted twice: {A,B} is not a branch of {A,B,C}.
    expect(roots.reduce((a, p) => a + p.variants, 0)).toBe(3);
  });

  test("attachment order does not create two roots for the same set", async () => {
    for (const id of ["A", "B"]) photo(id);
    variant(1, ["A.png", "B.png"]);
    variant(2, ["B.png", "A.png"], "A.png");
    const { photos } = await tree();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(1);
  });

  test("photos that never generated stay visible", async () => {
    photo("A");
    photo("never-used");
    variant(1, ["A.png"]);
    const { photos } = await tree();
    expect(photos.some((p) => p.photo === "never-used" && p.variants === 0)).toBe(true);
  });
});

describe("a reference can be looked at, not only measured", () => {
  // Distance from the reference is computed (background, area, light ratio),
  // but "how much it resembles it" stays a judgement made with the eyes. For
  // it to be possible to overlay them, the file has to be served and the
  // lineage has to say WHICH file it was: the refset is a phrase for a human,
  // not a path.
  test("lineage reports the reference files, not just the refset", async () => {
    photo("A");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('A',1,'/gen/v1.png','p',NULL,?,'openai','generated',?)`,
      [
        JSON.stringify({
          recipe: "r",
          refset: "3 sources + style",
          sources: ["A.png"],
          refs: ["style.png"],
        }),
        Date.now(),
      ],
    );
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    expect(photos[0]!.groups[0]!.refs).toEqual(["style.png"]);
  });

  test("a generation with no references does not invent any", async () => {
    photo("A");
    variant(1, ["A.png"]);
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    // Empty array, not undefined: the view decides whether to show the controls
    // by counting these, and an undefined would make it fail silently.
    expect(photos[0]!.groups[0]!.refs).toEqual([]);
  });

  test("the references route refuses path traversal", async () => {
    const r = await app.request("/refs/..%2f..%2fphotos.db");
    expect([400, 404]).toContain(r.status);
  });
});
