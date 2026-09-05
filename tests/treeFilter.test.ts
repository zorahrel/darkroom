import { describe, expect, test } from "bun:test";
import {
  filterTree,
  countVerdicts,
  keepsVariant,
} from "../client/src/treeFilter";

/** A minimal tree but of the real shape: two roots, the second with two
 *  groups, so the pruning can be watched at all three levels. */
const tree = () => [
  {
    photo: "a",
    groups: [
      {
        recipe: "bw-hard",
        variants: [
          { id: 1, verdict: "keep" },
          { id: 2, verdict: null },
        ],
      },
    ],
  },
  {
    photo: "b",
    groups: [
      { recipe: "bw-soft", variants: [{ id: 3, verdict: "discard" }] },
      {
        recipe: "color",
        variants: [
          { id: 4, verdict: "maybe" },
          { id: 5, verdict: "discard" },
        ],
      },
    ],
  },
];

describe("tree filter by verdict", () => {
  test("«all» returns exactly the object it received", () => {
    // Identity, not equality: if it rebuilt the tree on every render, React
    // would redo all the thumbnails from scratch on every click.
    const a = tree();
    expect(filterTree(a, "all")).toBe(a);
  });

  test("a root left with no variants disappears", () => {
    // The real risk: filtering the leaves and leaving the header and thumbnail
    // of an empty source standing, which looks like a half-finished load.
    const r = filterTree(tree(), "keep");
    expect(r.map((n) => n.photo)).toEqual(["a"]);
    expect(r[0]!.groups).toHaveLength(1);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([1]);
  });

  test("an emptied group disappears but the full siblings stay", () => {
    const r = filterTree(tree(), "maybe");
    expect(r).toHaveLength(1);
    expect(r[0]!.photo).toBe("b");
    expect(r[0]!.groups.map((g) => g.recipe)).toEqual(["color"]);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([4]);
  });

  test("«discard» keeps the discarded ones scattered across different groups", () => {
    const r = filterTree(tree(), "discard");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([3, 5]);
  });

  test("«to see» means never judged, not discarded", () => {
    const r = filterTree(tree(), "unseen");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([2]);
  });

  test("a filter with no results comes back empty instead of showing shells", () => {
    const onlyDiscarded = [{ photo: "x", groups: [{ variants: [{ verdict: "discard" }] }] }];
    expect(filterTree(onlyDiscarded, "keep")).toEqual([]);
  });

  test("the input tree is not modified", () => {
    // The page keeps `nodes` as the source of truth and writes the verdicts
    // onto it: if the filter mutated, changing filter would lose data.
    const a = tree();
    filterTree(a, "keep");
    expect(a[1]!.groups).toHaveLength(2);
    expect(a[1]!.groups[1]!.variants).toHaveLength(2);
  });

  test("an empty string counts as to-see, not as a verdict", () => {
    // The DB can hold "" where the code expects null.
    expect(keepsVariant({ verdict: "" }, "unseen")).toBe(true);
    expect(keepsVariant({ verdict: "" }, "discard")).toBe(false);
  });
});

describe("counts on the pills", () => {
  test("every variant falls into one box only and «all» is the total", () => {
    const variants = tree().flatMap((n) => n.groups.flatMap((g) => g.variants));
    const c = countVerdicts(variants);
    expect(c).toEqual({ all: 5, keep: 1, maybe: 1, discard: 2, unseen: 1 });
    expect(c.keep + c.maybe + c.discard + c.unseen).toBe(c.all);
  });

  test("an empty tree counts zero everywhere without blowing up", () => {
    expect(countVerdicts([])).toEqual({
      all: 0,
      keep: 0,
      maybe: 0,
      discard: 0,
      unseen: 0,
    });
  });

  test("an unknown verdict ends up among the to-see ones instead of vanishing", () => {
    // Better to count it where you are looking than to lose it: the total has
    // to add up.
    const c = countVerdicts([{ verdict: "boh" }]);
    expect(c.all).toBe(1);
    expect(c.unseen).toBe(1);
  });
});

describe("the write queue on the URL", () => {
  // Reproduces, without React, the mechanism of `viewState`: two values
  // returning to their default in the same render pass.
  //
  // THE REGRESSION: each hook called `setSearchParams` on its own with the
  // functional update. It looks safe, but React Router propagates the new
  // location asynchronously: two hooks woken in the same cycle receive the SAME
  // `prev`, and the second overwrites the first. Opening
  // `?zoom=180&group=scene` (both defaults) made only one of them disappear.
  function simulate(
    edits: [string, string | null][],
    start: string,
    unite: boolean,
  ): string {
    let url = new URLSearchParams(start);
    if (unite) {
      const next = new URLSearchParams(url);
      for (const [k, v] of edits) v === null ? next.delete(k) : next.set(k, v);
      url = next;
    } else {
      // Each starts from the same snapshot: that is the bug.
      const istantanea = new URLSearchParams(url);
      for (const [k, v] of edits) {
        const next = new URLSearchParams(istantanea);
        v === null ? next.delete(k) : next.set(k, v);
        url = next;
      }
    }
    return url.toString();
  }

  test("due default insieme svuotano l'URL", () => {
    expect(simulate([["zoom", null], ["group", null]], "zoom=180&group=scene", true)).toBe("");
  });

  test("without joining them only one survives: it is the bug being prevented", () => {
    expect(simulate([["zoom", null], ["group", null]], "zoom=180&group=scene", false)).toBe("zoom=180");
  });

  test("writes and deletions together do not cancel each other out", () => {
    expect(simulate([["zoom", "340"], ["group", null]], "zoom=180&group=scene", true)).toBe("zoom=340");
  });

  test("other people's keys (the route, the search) are not touched", () => {
    expect(simulate([["zoom", null]], "zoom=180&q=tokyo", true)).toBe("q=tokyo");
  });
});
