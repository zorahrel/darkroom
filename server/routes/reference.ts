// Dal riferimento alla ricetta (REF-02).
//
// Perche' non una didascalia sola: "un ritratto in bianco e nero di un uomo"
// descrive il soggetto, non il trattamento — e il trattamento e' l'unica cosa
// che si vuole riusare. Le domande sono mirate a cio' che si puo' chiedere a un
// generatore: luce, tonalita', taglio, pelle, resa.
//
// Il modello locale sbaglia e a volte si contraddice: per questo l'estrazione
// e' una PROPOSTA modificabile, e un'estrazione che non produce niente di utile
// viene dichiarata fallita invece di salvare una frase generica che poi
// sembrerebbe una ricetta vera.
import { Hono } from "hono";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { refsDir } from "../project.ts";

export const referenceRoutes = new Hono();

/** I riferimenti del progetto, con quante varianti li hanno davvero usati.
 *
 *  Il conteggio non e' un ornamento: e' il difetto che questa vista esiste per
 *  rendere visibile. Su `profilo` una reference e' rimasta inutilizzata su
 *  12 generazioni su 12 mentre il refset continuava a promettere "+ stile", e
 *  non c'era nessun posto dove quel numero si potesse leggere. Una reference a
 *  zero non e' un dettaglio: e' una passata intera andata nella direzione
 *  sbagliata. */
referenceRoutes.get("/api/references", (c) => {
  const dir = refsDir();
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    : [];

  // Si contano le VERSIONI, non i job: un job fallito non ha prodotto niente da
  // guardare, e contarlo direbbe "usata" di una reference che non ha ancora
  // mostrato nessun risultato.
  const usi = new Map<string, number>();
  for (const row of db()
    .query<{ lineage: string | null; config: string | null }, []>(
      "SELECT lineage, config FROM versions WHERE source='generated'",
    )
    .all()) {
    const letti = new Set<string>();
    for (const raw of [row.lineage, row.config]) {
      if (!raw) continue;
      try {
        const refs = (JSON.parse(raw) as { refs?: unknown }).refs;
        if (Array.isArray(refs)) for (const r of refs) letti.add(String(r).split("/").pop() ?? String(r));
      } catch {
        // una riga illeggibile non deve far sparire l'elenco
      }
    }
    for (const f of letti) usi.set(f, (usi.get(f) ?? 0) + 1);
  }

  const references = files.map((f) => {
    const st = statSync(join(dir, f));
    return {
      file: f,
      bytes: st.size,
      modified_at: st.mtimeMs,
      /** Quante varianti sono nate con questa reference allegata. */
      usata_in: usi.get(f) ?? 0,
    };
  });
  // Le mai usate in cima: sono quelle su cui c'e' una decisione da prendere.
  references.sort((a, b) => a.usata_in - b.usata_in || a.file.localeCompare(b.file));
  return c.json({ references });
});

const ASPETTI: { chiave: string; domanda: string }[] = [
  { chiave: "luce", domanda: "Describe only the lighting: direction, hardness, key-to-fill ratio, where the shadows fall." },
  { chiave: "tonalita", domanda: "Describe only the tonality: black and white or colour, contrast, how deep the blacks are, whether highlights are clipped or lifted." },
  { chiave: "inquadratura", domanda: "Describe only the framing: how tight the crop is, head position, aspect ratio, camera height and distance." },
  { chiave: "pelle", domanda: "Describe only the skin rendering: texture, grain, sharpness, whether pores are visible or smoothed." },
  { chiave: "resa", domanda: "Describe only the overall photographic treatment: film or digital look, lens character, background treatment." },
];

async function chiedi(immagine: string, domanda: string): Promise<string | null> {
  const p = Bun.spawn(["$HOME/bin/moondream", immagine, domanda], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  if (code !== 0) return null;
  const t = out.trim().replace(/\s+/g, " ");
  // Una risposta di tre parole non descrive un trattamento: e' rumore che
  // sembra un risultato, ed e' il modo in cui una ricetta nasce vuota.
  return t.length >= 25 ? t : null;
}

/** Estrae la descrizione riusabile di un'immagine di riferimento. */
referenceRoutes.post("/api/reference/extract", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
  const richiesto = typeof body.path === "string" ? body.path.trim() : "";
  // Un nome nudo si risolve dentro i riferimenti del progetto: la galleria
  // manda il file, non il percorso, e chiedere all'utente di ricostruirlo a
  // mano sarebbe chiedergli di sapere dove Darkroom tiene le sue cose.
  const path =
    richiesto && !richiesto.includes("/") && existsSync(join(refsDir(), richiesto))
      ? join(refsDir(), richiesto)
      : richiesto;
  if (!path || !existsSync(path)) return c.json({ error: "immagine non trovata" }, 400);

  const parti: string[] = [];
  const mancanti: string[] = [];
  for (const a of ASPETTI) {
    const r = await chiedi(path, a.domanda);
    if (r) parti.push(r);
    else mancanti.push(a.chiave);
  }

  // Meno di tre aspetti su cinque non e' una ricetta: e' un abbozzo che
  // sembrerebbe completo una volta salvato.
  if (parti.length < 3) {
    return c.json(
      { error: `estrazione non riuscita: descritti ${parti.length} aspetti su ${ASPETTI.length}`, mancanti },
      502,
    );
  }

  return c.json({
    testo: parti.join(" "),
    aspetti: parti.length,
    mancanti,
    from_reference: path.split("/").pop() ?? path,
  });
});

/** Estensioni ammesse: sono quelle che i backend di generazione accettano come
 *  allegato. Un .heic o un .tiff finirebbe in cartella e poi fallirebbe al
 *  momento della generazione, cioe' nel punto piu' costoso. */
const ESTENSIONI = new Set(["png", "jpg", "jpeg", "webp"]);
/** 20 MB: sopra, l'upload di un file per sbaglio (un video, un RAW) riempie il
 *  disco senza che nessuno se ne accorga. */
const MAX_BYTES = 20 * 1024 * 1024;

/** Carica un'immagine di riferimento nel progetto.
 *
 *  Senza questa rotta un file entrava in `data/refs` solo copiandocelo a mano
 *  dal Finder: la galleria mostrava i riferimenti ma non c'era modo di
 *  aggiungerne uno da dentro Darkroom. */
referenceRoutes.post("/api/references", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json({ error: "nessun file" }, 400);

  // Il nome arriva dal client e non e' un percorso: si tiene solo l'ultimo
  // segmento e si ammette un alfabeto ristretto. Sostituire le sole barre
  // lasciava "../../fuga.png" come "_.._fuga.png": innocuo per il filesystem,
  // ma e' un nome che porta in giro l'intento di chi l'ha mandato.
  const ultimo = (file.name || "reference.png").split(/[/\\]/).pop() ?? "reference.png";
  const pulito =
    ultimo
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[._-]+/, "") || "reference.png";
  const ext = pulito.split(".").pop()?.toLowerCase() ?? "";
  if (!ESTENSIONI.has(ext)) {
    return c.json({ error: `formato non ammesso (.${ext}): servono png, jpg o webp` }, 400);
  }
  if (file.size === 0) return c.json({ error: "file vuoto" }, 400);
  if (file.size > MAX_BYTES) {
    return c.json({ error: `troppo grande (${Math.round(file.size / 1024 / 1024)} MB, massimo 20)` }, 400);
  }

  const dir = refsDir();
  mkdirSync(dir, { recursive: true });
  // Un nome gia' preso non si sovrascrive: la reference vecchia potrebbe essere
  // quella con cui sono state generate delle varianti, e sostituirla
  // cambierebbe il significato del loro lineage senza dirlo a nessuno.
  let nome = pulito;
  if (existsSync(join(dir, nome))) {
    const base = pulito.slice(0, -(ext.length + 1));
    let i = 2;
    while (existsSync(join(dir, `${base}-${i}.${ext}`))) i++;
    nome = `${base}-${i}.${ext}`;
  }
  writeFileSync(join(dir, nome), Buffer.from(await file.arrayBuffer()));
  return c.json({ file: nome, rinominato: nome !== pulito });
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
