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
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
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

  // Il ruolo dichiarato, quando c'e'. Non si indovina dal nome: «bocca-reale.png»
  // e «occhiali-gascan.jpg» sono tutti e due plausibili come identita' e come
  // stile, e sbagliare non da' un errore — da' una faccia diversa.
  const ruoli = new Map(
    db()
      .query<{ file: string; role: string }, []>("SELECT file, role FROM reference_meta")
      .all()
      .map((r) => [r.file, r.role] as const),
  );

  // Cosa c'e' dentro, letto dall'immagine. Arriva con l'elenco e non su
  // richiesta: una descrizione che si ottiene solo cliccando e' una descrizione
  // che nessuno legge mentre decide quale reference allegare.
  const descrizioni = new Map(
    db()
      .query<
        { file: string; body: string; aspects: number; missing: string },
        []
      >("SELECT file, body, aspects, missing FROM reference_prompt")
      .all()
      .map((r) => [r.file, r] as const),
  );

  const references = files.map((f) => {
    const st = statSync(join(dir, f));
    const d = descrizioni.get(f);
    return {
      file: f,
      bytes: st.size,
      modified_at: st.mtimeMs,
      /** How many variants were born with this reference attached. */
      used_in: uses.get(f) ?? 0,
      /** `stile` impone un aspetto, `identita` tiene il viso. `null` = nessuno
       *  l'ha ancora detto, ed e' un'informazione, non un valore di riposo. */
      role: ruoli.get(f) ?? null,
      /** Il deprompt: luce, tonalita', inquadratura, pelle, resa. `null` = non
       *  ancora letta, che e' diverso da «letta e vuota». */
      prompt: d ? d.body : null,
      prompt_aspects: d ? d.aspects : null,
      prompt_missing: d && d.missing ? d.missing.split(",") : [],
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

/** Is the vision CLI actually there? `Bun.spawn` THROWS on a missing binary
 *  (ENOENT), it does not return a code — so without this the route died with an
 *  unhandled error and answered a 500 with no JSON body, which the caller could
 *  not even parse. On a machine without Moondream that is every call. */
function visionAvailable(): boolean {
  const bin = moondreamBin();
  if (bin.includes("/")) return existsSync(bin);
  try {
    return Bun.spawnSync(["which", bin]).exitCode === 0;
  } catch {
    return false;
  }
}

async function ask(image: string, question: string): Promise<string | null> {
  let p;
  try {
    p = Bun.spawn([moondreamBin(), image, question], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    // A binary that disappears between the check and the call is not a reason
    // to lose the whole request: it counts as an aspect not described.
    return null;
  }
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

  // What is missing is said by name, with the gesture that fixes it — the same
  // rule the tool catalogue follows. Before, a machine without Moondream got an
  // unparsable 500 and no idea why.
  if (!visionAvailable())
    return c.json(
      {
        error: `il modello di visione non c'e': ${moondreamBin()} non e' installato o non e' nel PATH`,
        how: "installa la CLI di Moondream, oppure indica il binario con MOONDREAM_BIN",
      },
      503,
    );

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

  const nome = path.split("/").pop() ?? path;
  const testo = parts.join(" ");

  // La descrizione si SALVA sul file, qui, senza chiedere altro. Prima usciva
  // solo come risposta: per conservarla bisognava inventarle un nome e salvarla
  // come «ricetta», e infatti su profilo ne sono state salvate zero mentre la
  // stessa reference veniva ridescritta a mano sedici volte. Un fatto letto
  // dall'immagine non ha bisogno del permesso di nessuno per restare attaccato
  // all'immagine da cui viene.
  if (existsSync(join(refsDir(), nome))) {
    db().run(
      `INSERT INTO reference_prompt (file, body, aspects, missing, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET body = excluded.body, aspects = excluded.aspects,
                                       missing = excluded.missing, updated_at = excluded.updated_at`,
      [nome, testo, parts.length, missing.join(","), Date.now()],
    );
  }

  return c.json({ text: testo, aspects: parts.length, missing, from_reference: nome });
});

/** Allowed extensions: they are the ones the generation backends accept as an
 *  attachment. A .heic or a .tiff would land in the folder and then fail at
 *  generation time, i.e. at the most expensive point. */
const EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
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
  if (!EXTENSIONS.has(ext)) {
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

/** Dichiara a cosa serve una reference. `null` la riporta a «non dichiarato». */
referenceRoutes.put("/api/references/:file/role", async (c) => {
  const file = decodeURIComponent(c.req.param("file"));
  // Il nome arriva dal client: si accetta solo l'ultimo segmento, come per il
  // caricamento. Una reference «../../qualcosa» non deve nemmeno poter essere
  // annotata.
  if (file !== (file.split(/[/\\]/).pop() ?? "")) return c.json({ error: "nome non valido" }, 400);
  if (!existsSync(join(refsDir(), file))) return c.json({ error: "reference inesistente" }, 404);

  const b = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  const role = b.role === null ? null : String(b.role ?? "");
  if (role === null) {
    db().run("DELETE FROM reference_meta WHERE file = ?", [file]);
    return c.json({ file, role: null });
  }
  if (role !== "stile" && role !== "identita") {
    return c.json({ error: "il ruolo e' «stile» o «identita»" }, 400);
  }
  db().run(
    `INSERT INTO reference_meta (file, role, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(file) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
    [file, role, Date.now()],
  );
  return c.json({ file, role });
});

/**
 * Togliere un riferimento dall'elenco: SPOSTARE, non cancellare.
 *
 * PERCHE' IL CESTINO E NON `rm`. Il lineage di ogni versione salva i NOMI dei
 * file allegati: cancellare il file lascia le righe storiche che puntano nel
 * vuoto, e l'albero mostra riquadri rotti al posto degli allegati — e' successo
 * gia' una volta su questo progetto, con una foto di progetto scambiata per
 * reference mancante. Qui il file si sposta in `refs/_cestino/`: sparisce
 * dall'elenco (GET filtra per estensione immagine, una cartella non passa) ma
 * resta su disco, e `refFile` in media.ts continua a trovarlo, cosi' le
 * miniature delle varianti gia' generate restano intatte.
 *
 * E' anche l'unica forma reversibile: un riferimento tolto per sbaglio si
 * rimette con un `mv`, mentre da un `rm` non si torna indietro.
 */
referenceRoutes.delete("/api/references/:file", (c) => {
  const file = decodeURIComponent(c.req.param("file"));
  // Stessa guardia di caricamento e ruolo: si accetta solo l'ultimo segmento,
  // perche' «../../qualcosa» non deve poter essere spostato da qui.
  if (file !== (file.split(/[/\\]/).pop() ?? "")) return c.json({ error: "nome non valido" }, 400);
  const src = join(refsDir(), file);
  if (!existsSync(src)) return c.json({ error: "reference inesistente" }, 404);

  const cestino = join(refsDir(), "_cestino");
  if (!existsSync(cestino)) mkdirSync(cestino, { recursive: true });
  let dest = join(cestino, file);
  // Due riferimenti con lo stesso nome tolti in momenti diversi non si
  // sovrascrivono: il secondo prende un suffisso.
  if (existsSync(dest)) {
    const punto = file.lastIndexOf(".");
    const base = punto > 0 ? file.slice(0, punto) : file;
    const est = punto > 0 ? file.slice(punto) : "";
    dest = join(cestino, `${base}-${Date.now()}${est}`);
  }
  renameSync(src, dest);
  // Ruolo e descrizione se ne vanno con il file: se un giorno torna, torna
  // senza un'etichetta che nessuno ricorda di avergli dato, e la descrizione si
  // rilegge in un secondo dall'immagine.
  db().run("DELETE FROM reference_meta WHERE file = ?", [file]);
  db().run("DELETE FROM reference_prompt WHERE file = ?", [file]);
  return c.json({ file, cestinato: dest.split("/").pop() });
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
