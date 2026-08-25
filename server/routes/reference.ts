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
import { existsSync } from "node:fs";
import { db } from "../db.ts";

export const referenceRoutes = new Hono();

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
  const path = typeof body.path === "string" ? body.path : "";
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
