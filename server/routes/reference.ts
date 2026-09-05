// From the reference to the recipe (REF-02).
//
// Why not a single caption: "a black and white portrait of a man" describes the
// subject, not the treatment — and the treatment is the only thing you want to
// reuse. The questions are aimed at what can be asked of a generator: light,
// tonality, framing, skin, rendering.
//
// The local model gets things wrong and sometimes contradicts itself: that is
// why the extraction is an editable PROPOSAL, and an extraction that produces
// nothing useful is declared failed instead of saving a generic sentence that
// would then look like a real recipe.
import { Hono } from "hono";
import { moondreamBin } from "../config.ts";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { refsDir } from "../project.ts";

export const referenceRoutes = new Hono();

/** The project's references, with how many variants really used them.
 *
 *  The count is not an ornament: it is the defect this view exists to make
 *  visible. On `profilo` a reference went unused on 12 generations out of 12
 *  while the refset kept promising "+ style", and there was nowhere that number
 *  could be read. A reference at zero is not a detail: it is a whole pass that
 *  went the wrong way. */
referenceRoutes.get("/api/references", (c) => {
  const dir = refsDir();
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    : [];

  // VERSIONS are counted, not jobs: a failed job produced nothing to look at,
  // and counting it would call a reference "used" when it has not yet shown any
  // result.
  const uses = new Map<string, number>();
  for (const row of db()
    .query<{ lineage: string | null; config: string | null }, []>(
      "SELECT lineage, config FROM versions WHERE source='generated'",
    )
    .all()) {
    const seen = new Set<string>();
    for (const raw of [row.lineage, row.config]) {
      if (!raw) continue;
      try {
        const refs = (JSON.parse(raw) as { refs?: unknown }).refs;
        if (Array.isArray(refs)) for (const r of refs) seen.add(String(r).split("/").pop() ?? String(r));
      } catch {
        // an unreadable row must not make the list disappear
      }
    }
    for (const f of seen) uses.set(f, (uses.get(f) ?? 0) + 1);
  }

  const references = files.map((f) => {
    const st = statSync(join(dir, f));
    return {
      file: f,
      bytes: st.size,
      modified_at: st.mtimeMs,
      /** How many variants were born with this reference attached. */
      used_in: uses.get(f) ?? 0,
    };
  });
  // The never-used ones first: they are the ones with a decision to make.
  references.sort((a, b) => a.used_in - b.used_in || a.file.localeCompare(b.file));
  return c.json({ references });
});

const ASPECTS: { key: string; question: string }[] = [
  { key: "luce", question: "Describe only the lighting: direction, hardness, key-to-fill ratio, where the shadows fall." },
  { key: "tonalita", question: "Describe only the tonality: black and white or colour, contrast, how deep the blacks are, whether highlights are clipped or lifted." },
  { key: "inquadratura", question: "Describe only the framing: how tight the crop is, head position, aspect ratio, camera height and distance." },
  { key: "pelle", question: "Describe only the skin rendering: texture, grain, sharpness, whether pores are visible or smoothed." },
  { key: "resa", question: "Describe only the overall photographic treatment: film or digital look, lens character, background treatment." },
];

async function ask(image: string, question: string): Promise<string | null> {
  const p = Bun.spawn([moondreamBin(), image, question], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) return null;
  const t = out.trim().replace(/\s+/g, " ");
  // A three-word answer does not describe a treatment: it is noise that looks
  // like a result, and it is how a recipe is born empty.
  return t.length >= 25 ? t : null;
}

/** Extracts the reusable description of a reference image. */
referenceRoutes.post("/api/reference/extract", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
  const requested = typeof body.path === "string" ? body.path.trim() : "";
  // A bare name resolves inside the project's references: the gallery sends
  // the file, not the path, and asking the user to rebuild it by hand would be
  // asking them to know where Darkroom keeps its things.
  const path =
    requested && !requested.includes("/") && existsSync(join(refsDir(), requested))
      ? join(refsDir(), requested)
      : requested;
  if (!path || !existsSync(path)) return c.json({ error: "immagine non trovata" }, 400);

  const parts: string[] = [];
  const missing: string[] = [];
  for (const a of ASPECTS) {
    const r = await ask(path, a.question);
    if (r) parts.push(r);
    else missing.push(a.key);
  }

  // Fewer than three aspects out of five is not a recipe: it is a sketch that
  // would look complete once saved.
  if (parts.length < 3) {
    return c.json(
      { error: `estrazione non riuscita: descritti ${parts.length} aspetti su ${ASPECTS.length}`, missing },
      502,
    );
  }

  return c.json({
    text: parts.join(" "),
    aspects: parts.length,
    missing,
    from_reference: path.split("/").pop() ?? path,
  });
});

/** Allowed extensions: they are the ones the generation backends accept as an
 *  attachment. A .heic or a .tiff would land in the folder and then fail at
 *  generation time, i.e. at the most expensive point. */
const ESTENSIONI = new Set(["png", "jpg", "jpeg", "webp"]);
/** 20 MB: above that, uploading a file by mistake (a video, a RAW) fills the
 *  disk without anybody noticing. */
const MAX_BYTES = 20 * 1024 * 1024;

/** Uploads a reference image into the project.
 *
 *  Without this route a file only entered `data/refs` by copying it there by
 *  hand from the Finder: the gallery showed the references but there was no way
 *  to add one from inside Darkroom. */
referenceRoutes.post("/api/references", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "nessun file" }, 400);

  // The name comes from the client and is not a path: only the last segment is
  // kept and a restricted alphabet is allowed. Replacing only the slashes left
  // "../../escape.png" as "_.._escape.png": harmless for the filesystem, but it
  // is a name that carries around the intent of whoever sent it.
  const last = (file.name || "reference.png").split(/[/\\]/).pop() ?? "reference.png";
  const clean =
    last
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[._-]+/, "") || "reference.png";
  // Filesystems stop at 255 bytes per name: beyond that, the write blows up
  // with ENAMETOOLONG instead of refusing politely. The front part is shortened
  // and the extension kept, which is the part that counts.
  const tooLong = Buffer.byteLength(clean) > 200;
  const safeName = tooLong
    ? `${clean.slice(0, 180)}.${clean.split(".").pop()}`
    : clean;
  const ext = safeName.split(".").pop()?.toLowerCase() ?? "";
  if (!ESTENSIONI.has(ext)) {
    return c.json({ error: `formato non ammesso (.${ext}): servono png, jpg o webp` }, 400);
  }
  if (file.size === 0) return c.json({ error: "file vuoto" }, 400);
  if (file.size > MAX_BYTES) {
    return c.json({ error: `troppo grande (${Math.round(file.size / 1024 / 1024)} MB, massimo 20)` }, 400);
  }

  const dir = refsDir();
  mkdirSync(dir, { recursive: true });
  // A name already taken is not overwritten: the old reference might be the one
  // some variants were generated with, and replacing it would change the
  // meaning of their lineage without telling anybody.
  let name = safeName;
  if (existsSync(join(dir, name))) {
    const base = safeName.slice(0, -(ext.length + 1));
    let i = 2;
    while (existsSync(join(dir, `${base}-${i}.${ext}`))) i++;
    name = `${base}-${i}.${ext}`;
  }
  writeFileSync(join(dir, name), Buffer.from(await file.arrayBuffer()));
  return c.json({ file: name, renamed: name !== safeName || tooLong });
});

referenceRoutes.get("/api/recipes", (c) =>
  c.json({
    recipes: db()
      .query("SELECT id, name, body, from_reference, created_at FROM recipes ORDER BY id DESC")
      .all(),
  }),
);

referenceRoutes.post("/api/recipes", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const bodyTxt = typeof b.body === "string" ? b.body.trim() : "";
  if (!name || bodyTxt.length < 25)
    return c.json({ error: "servono un nome e un corpo di almeno 25 caratteri" }, 400);
  const from = typeof b.from_reference === "string" ? b.from_reference : null;
  const r = db().run(
    "INSERT INTO recipes (name, body, from_reference, created_at) VALUES (?, ?, ?, ?)",
    [name, bodyTxt, from, Date.now()],
  );
  return c.json({ id: Number(r.lastInsertRowid), name, body: bodyTxt, from_reference: from });
});

referenceRoutes.delete("/api/recipes/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id non valido" }, 400);
  const n = db().run("DELETE FROM recipes WHERE id = ?", [id]).changes;
  return n ? c.json({ ok: true }) : c.json({ error: "ricetta inesistente" }, 404);
});
