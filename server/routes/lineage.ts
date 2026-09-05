// The picking view: the tree of variants (LIN-02).
//
// The grid answers "which photos do I have". This endpoint answers "which
// variant do I keep, and what was it born from" — which is a relation, not a
// list, and that is why it cannot be got by filtering the grid.
//
// The grouping is by CONFIGURATION and not by variant: two variants of the same
// recipe but with different references are two experiments, and are to be read
// as such. With 162 variants across six configurations, telling them apart took
// hand-written SQL queries — the hole this view closes.
import { Hono } from "hono";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { REPO_ROOT } from "../config.ts";
import { refsDir } from "../project.ts";

export const lineageRoutes = new Hono();

type VersionRow = {
  id: number;
  photo_id: string;
  version_number: number;
  image_path: string;
  prompt_used: string;
  provider: string | null;
  provider_params: string | null;
  credits: number | null;
  config: string | null;
  lineage: string | null;
  verdict: string | null;
  note: string | null;
  created_at: number;
};

/** A variant's readable configuration, derived from the lineage or, for the
 *  historical rows that have none, from config. What is not recorded stays
 *  declared as not recorded: making it up would be worse than the blank. */
function configOf(v: VersionRow): {
  backend: string | null;
  recipe: string;
  refset: string;
  preamble: string | null;
  sources: string[];
  /** The style files attached to the generation. They are needed to overlay
   *  them on the variant: the refset is a phrase for a human, these are the
   *  real files. */
  refs: string[];
} {
  const read = (raw: string | null): Record<string, unknown> => {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const lin = read(v.lineage);
  const cfg = read(v.config);
  // The real sources, not the photo the row hangs from: a variant born from
  // three shots together has a single photo_id, and without this list the view
  // would show one of them passing it off as the only input.
  const rawSources = (lin.sources ?? cfg.sources) as unknown;
  const sources = Array.isArray(rawSources) ? rawSources.map(String) : [];
  const rawRefs = (lin.refs ?? cfg.refs) as unknown;
  const refs = Array.isArray(rawRefs) ? rawRefs.map(String) : [];
  // Which engine produced it. It changes the result more than half a recipe
  // (cdp, codex-http and openai render skin differently) and it was recorded
  // but invisible: it remained the only unexplainable difference between two
  // variants declaring the same configuration.
  const backend = (lin.backend ?? cfg.backend) as string | undefined;
  return {
    backend: backend ?? null,
    recipe: String(lin.recipe ?? cfg.recipe ?? "senza ricetta"),
    refset: String(lin.refset ?? cfg.refset ?? "origine non registrata"),
    preamble: (lin.preamble as string | undefined) ?? null,
    sources,
    refs,
  };
}

/**
 * What each version cost, in dollars.
 *
 * The cost lives in `api_calls` (you pay for the CALL, not for the version) and
 * has no key towards `versions`. The link is by proximity in time: a successful
 * call within a minute of the version is the one that produced it. It is not
 * exact by construction, so the client shows it as an estimate.
 */
function costPerVersion(): Map<number, { usd: number; model: string; quality: string | null }> {
  const out = new Map<number, { usd: number; model: string; quality: string | null }>();
  try {
    const chiamate = db()
      .query<{ cost_usd: number; model: string; quality: string | null; created_at: number }, []>(
        "SELECT cost_usd, model, quality, created_at FROM api_calls WHERE ok = 1 ORDER BY created_at",
      )
      .all();
    const versions = db()
      .query<{ id: number; created_at: number }, []>(
        "SELECT id, created_at FROM versions WHERE source = 'generated'",
      )
      .all();
    for (const v of versions) {
      let best: (typeof chiamate)[number] | null = null;
      let dist = 60_000; // one minute: beyond that, it is not the same generation
      for (const ch of chiamate) {
        const d = Math.abs(ch.created_at - v.created_at);
        if (d < dist) { dist = d; best = ch; }
      }
      if (best) out.set(v.id, { usd: best.cost_usd, model: best.model, quality: best.quality });
    }
  } catch {
    // With no table the view is not blocked: the cost is lost, not the tree.
  }
  return out;
}

lineageRoutes.get("/api/lineage", (c) => {
  const costs = costPerVersion();
  const photos = db()
    .query<{ id: string; original_path: string; favorite_version_id: number | null }, []>(
      "SELECT id, original_path, favorite_version_id FROM photos ORDER BY id",
    )
    .all();

  // the lineage records the NAMES of the source files, the view addresses
  // thumbnails by photo id: without this map the client would have to guess the
  // id from the name, and would get it wrong on every file with an unexpected
  // extension.
  const byBasename = new Map(photos.map((p) => [p.original_path.split("/").pop() ?? "", p.id]));
  const favOf = new Map(photos.map((p) => [p.id, p.favorite_version_id]));

  const versions = db()
    .query<VersionRow, []>(
      `SELECT id, photo_id, version_number, image_path, prompt_used, provider, provider_params, credits, config, lineage, verdict, note, created_at
         FROM versions WHERE source = 'generated'
        ORDER BY photo_id, version_number`,
    )
    .all();

  // The root is the input SET, not the single photo. Grouping by photo_id put
  // all the variants under the FIRST source and left the others at "0 variants"
  // despite having contributed to all of them; giving a root to each
  // contributing photo would have made the opposite mistake, showing the same
  // 12 variants three times. A single photo is the set of cardinality 1, so
  // single-source projects have no special case: measured on Japan, 189 roots
  // and 3007 variants, none counted twice.
  type Root = {
    photos: string[];
    variants: number;
    recipes: Set<string>;
    groups: Map<
      string,
      {
        recipe: string;
        refset: string;
        preamble: string | null;
        sources: string[];
        refs: string[];
        variants: unknown[];
      }
    >;
  };
  const roots = new Map<string, Root>();

  for (const v of versions) {
    const cfg = configOf(v);
    // Names that do not resolve to a known photo do not vanish: they stay in the
    // identity of the set, otherwise two different sets would merge into one.
    const ids = cfg.sources.map((f) => byBasename.get(f) ?? f);
    const members = ids.length > 0 ? ids : [v.photo_id];
    const key = [...members].sort().join("\u0000");
    if (!roots.has(key))
      roots.set(key, { photos: members, variants: 0, recipes: new Set(), groups: new Map() });
    const root = roots.get(key)!;
    root.variants++;
    root.recipes.add(cfg.recipe);

    const gkey = `${cfg.refset}|${cfg.recipe}|${cfg.preamble ?? ""}`;
    if (!root.groups.has(gkey)) root.groups.set(gkey, { ...cfg, variants: [] });
    root.groups.get(gkey)!.variants.push({
      id: v.id,
      version_number: v.version_number,
      verdict: v.verdict,
      note: v.note,
      favorite: favOf.get(v.photo_id) === v.id,
      created_at: v.created_at,
      /** The EXACT prompt it was generated with. It lived only in the database:
       *  to know why two variants differ you had to open sqlite, which is why
       *  people re-generated blindly instead of reading what had already been
       *  asked for. */
      prompt: v.prompt_used,
      /** The engine that produced it, when recorded. */
      backend: cfg.backend ?? v.provider,
      /** Cost in dollars. `credits` on the version is the AUTHORITATIVE datum:
       *  it is written when the version is born, by whoever knows the call. The
       *  link by temporal proximity stays as a fallback for the historical rows
       *  that lack it — but it is wrong on every version recorded hours after
       *  the paid call, and there it showed $0.000 while having the figure in
       *  the table. */
      cost_usd: v.credits ?? costs.get(v.id)?.usd ?? null,
      /** Model and quality, from provider_params. They are the difference
       *  between two variants declaring the same recipe and not resembling each
       *  other: `low` and `high` of the same model are two different
       *  experiments. */
      ...(() => {
        try {
          const pp = v.provider_params ? (JSON.parse(v.provider_params) as Record<string, unknown>) : {};
          const ch = costs.get(v.id);
          return {
            model: ((pp.model as string) ?? ch?.model) ?? null,
            quality: ((pp.quality as string) ?? ch?.quality) ?? null,
          };
        } catch {
          const ch = costs.get(v.id);
          return { model: ch?.model ?? null, quality: ch?.quality ?? null };
        }
      })(),
      /** The names of the input files, as they were recorded. `sources` on the
       *  group is translated into photo ids for the thumbnails and loses the
       *  names that do not resolve; the real ones stay here. */
      source_files: cfg.sources,
      /** The corresponding photo ids, for requesting the thumbnail. The client
       *  cannot derive them from the name: "1.PNG" -> "1" works by accident,
       *  and on a file with an unexpected extension it would give a broken
       *  image. */
      source_ids: cfg.sources.map((f) => byBasename.get(f) ?? null),
      file_refs: cfg.refs,
      // Is the file really there?
      //
      // On 27/08 two covers were recorded with a path outside the convention:
      // the row was there, the API returned it, the variant appeared in the
      // tree, and in its place came an empty rectangle because the thumbnail
      // answered 500. A variant without a file is not a variant: saying so here
      // costs one stat and turns a mute failure into a label.
      missing: !existsSync(v.image_path),
    });
  }

  /** When each root's most recent variant was born. It is there to put the
   *  work of right now on top: ordering by photo id is stable but arbitrary,
   *  and with 189 roots the generation just made ended up half a page down. */
  const mostRecent = (r: Root) =>
    Math.max(
      0,
      ...[...r.groups.values()].flatMap((g) =>
        g.variants.map((v) => (v as { created_at: number }).created_at),
      ),
    );

  const out = [...roots.values()]
    .sort((a, b) => mostRecent(b) - mostRecent(a))
    .map((r) => {
    for (const g of r.groups.values()) {
      g.sources = g.sources.map((f) => byBasename.get(f)).filter((x): x is string => !!x);
      // Inside the group too: the latest attempt first.
      g.variants.sort(
        (x, y) => (y as { created_at: number }).created_at - (x as { created_at: number }).created_at,
      );
    }
    return {
      // `photo` stays the first of the set: it is what the client uses for the
      // cover thumbnail and for the links. `photos` is the whole set.
      photo: r.photos[0],
      photos: r.photos,
      variants: r.variants,
      recipes: r.recipes.size,
      // The groups ordered by their most recent variant, not by insertion order:
      // a recipe picked up again today has to sit above one from yesterday.
      groups: [...r.groups.values()].sort(
        (a, b) =>
          Math.max(...b.variants.map((v) => (v as { created_at: number }).created_at)) -
          Math.max(...a.variants.map((v) => (v as { created_at: number }).created_at)),
      ),
    };
  });

  // Photos that generated nothing stay visible: a project just imported must
  // not look empty.
  for (const p of photos) {
    if (![...roots.values()].some((r) => r.photos.includes(p.id)))
      out.push({ photo: p.id, photos: [p.id], variants: 0, recipes: 0, groups: [] });
  }

  return c.json({ photos: out });
});

/** How closely a variant resembles the reference it was generated with.
 *
 *  Knowing it took a terminal. The measurement already existed as a script, but
 *  it stayed outside the page where the variants are looked at, so the question
 *  "am I getting closer?" could only be asked elsewhere — and yesterday's
 *  calibrations went on for three rounds on a wrong hypothesis for exactly that
 *  reason.
 *
 *  The reference is read from the version's lineage: it is not passed in from
 *  outside, otherwise you could compare a variant with an unrelated image and
 *  read a number that looks like a judgement. */
lineageRoutes.get("/api/versions/:id/gap", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id non valido" }, 400);

  const v = db()
    .query<{ image_path: string; lineage: string | null; config: string | null }, [number]>(
      "SELECT image_path, lineage, config FROM versions WHERE id = ?",
    )
    .get(id);
  if (!v) return c.json({ error: "versione non trovata" }, 404);
  if (!existsSync(v.image_path)) return c.json({ error: "immagine mancante" }, 404);

  const read = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const r = (JSON.parse(raw) as { refs?: unknown }).refs;
      return Array.isArray(r) ? r.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  };
  const name = (read(v.lineage)[0] ?? read(v.config)[0] ?? "").split("/").pop() ?? "";
  // No reference is not an error: it is the information that this variant had
  // no target, and it is exactly the case that cost 12 generations on one
  // project.
  if (!name) return c.json({ reference: null, gap: null });

  const refPath = join(refsDir(), name);
  if (!existsSync(refPath)) return c.json({ reference: name, gap: null, error: "reference mancante" });

  const r = spawnSync("python3", [join(REPO_ROOT, "scripts", "ref_match.py"), v.image_path, refPath], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (r.status !== 0) {
    return c.json({ reference: name, gap: null, error: (r.stderr || "misura fallita").slice(0, 200) });
  }
  try {
    return c.json({ reference: name, gap: JSON.parse(r.stdout) });
  } catch {
    return c.json({ reference: name, gap: null, error: "risposta illeggibile" });
  }
});

/** Judgement and note on a variant. The judgement sits on the VERSION, not on
 *  the photo: the pick chooses a photo, this chooses among its variants. */
lineageRoutes.patch("/api/versions/:id/verdict", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id non valido" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { verdict?: unknown; note?: unknown };
  const allowed = ["keep", "maybe", "discard"];
  let verdict: string | null | undefined;
  if ("verdict" in body) {
    // Empty string and null both mean "back to not judged": it is the fourth
    // state of the cycle, not a caller's mistake.
    if (body.verdict === null || body.verdict === "") verdict = null;
    else if (typeof body.verdict === "string" && allowed.includes(body.verdict)) verdict = body.verdict;
    else return c.json({ error: `verdict ammessi: ${allowed.join(", ")} o vuoto` }, 400);
  }
  const note =
    "note" in body ? (typeof body.note === "string" ? body.note.slice(0, 2000) : null) : undefined;

  const exists = db().query<{ id: number }, [number]>("SELECT id FROM versions WHERE id = ?").get(id);
  if (!exists) return c.json({ error: "versione inesistente" }, 404);

  if (verdict !== undefined) db().run("UPDATE versions SET verdict = ? WHERE id = ?", [verdict, id]);
  if (note !== undefined) db().run("UPDATE versions SET note = ? WHERE id = ?", [note, id]);

  const row = db()
    .query<{ id: number; verdict: string | null; note: string | null }, [number]>(
      "SELECT id, verdict, note FROM versions WHERE id = ?",
    )
    .get(id);
  return c.json(row);
});
