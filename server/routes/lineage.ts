// Vista di scelta: l'albero delle varianti (LIN-02).
//
// La griglia risponde a "quali foto ho". Questo endpoint risponde a "quale
// variante tengo, e da cosa e' nata" — che e' una relazione, non un elenco, e
// per questo non si ottiene filtrando la griglia.
//
// Il raggruppamento e' per CONFIGURAZIONE e non per variante: due varianti
// della stessa ricetta ma con riferimenti diversi sono due esperimenti, e
// vanno letti come tali. Con 162 varianti in sei configurazioni, distinguerle
// ha richiesto query SQL a mano — il buco che questa vista chiude.
import { Hono } from "hono";
import { db } from "../db.ts";

export const lineageRoutes = new Hono();

type VersionRow = {
  id: number;
  photo_id: string;
  version_number: number;
  image_path: string;
  config: string | null;
  lineage: string | null;
  verdict: string | null;
  note: string | null;
  created_at: number;
};

/** Configurazione leggibile di una variante, ricavata da lineage o, per lo
 *  storico che lineage non ce l'ha, da config. Cio' che non e' registrato
 *  resta dichiarato come non registrato: inventarlo sarebbe peggio del vuoto. */
function configOf(v: VersionRow): { recipe: string; refset: string; preamble: string | null } {
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
  return {
    recipe: String(lin.recipe ?? cfg.recipe ?? "senza ricetta"),
    refset: String(lin.refset ?? cfg.refset ?? "origine non registrata"),
    preamble: (lin.preamble as string | undefined) ?? null,
  };
}

lineageRoutes.get("/api/lineage", (c) => {
  const photos = db()
    .query<{ id: string; original_path: string; favorite_version_id: number | null }, []>(
      "SELECT id, original_path, favorite_version_id FROM photos ORDER BY id",
    )
    .all();

  const out = photos.map((p) => {
    const versions = db()
      .query<VersionRow, [string]>(
        `SELECT id, photo_id, version_number, image_path, config, lineage, verdict, note, created_at
           FROM versions WHERE photo_id = ? AND source = 'generated'
          ORDER BY version_number`,
      )
      .all(p.id);

    // Una mappa per non perdere l'ordine di apparizione dei gruppi: chi ha
    // generato per primo compare per primo, che e' l'ordine in cui si e'
    // lavorato e quindi quello in cui si ricorda.
    const groups = new Map<
      string,
      { recipe: string; refset: string; preamble: string | null; variants: unknown[] }
    >();
    for (const v of versions) {
      const cfg = configOf(v);
      const key = `${cfg.refset}|${cfg.recipe}|${cfg.preamble ?? ""}`;
      if (!groups.has(key)) groups.set(key, { ...cfg, variants: [] });
      groups.get(key)!.variants.push({
        id: v.id,
        version_number: v.version_number,
        verdict: v.verdict,
        note: v.note,
        favorite: p.favorite_version_id === v.id,
        created_at: v.created_at,
      });
    }

    return {
      photo: p.id,
      variants: versions.length,
      recipes: new Set(versions.map((v) => configOf(v).recipe)).size,
      groups: [...groups.values()],
    };
  });

  return c.json({ photos: out });
});

/** Giudizio e nota su una variante. Il giudizio sta sulla VERSIONE, non sulla
 *  foto: "mi piace" sceglie una foto, questo sceglie fra le sue varianti. */
lineageRoutes.patch("/api/versions/:id/verdict", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id non valido" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { verdict?: unknown; note?: unknown };
  const allowed = ["tieni", "forse", "scarta"];
  let verdict: string | null | undefined;
  if ("verdict" in body) {
    // Stringa vuota e null significano entrambi "torna a non giudicata": e' il
    // quarto stato del ciclo, non un errore di chi chiama.
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
