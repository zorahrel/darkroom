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
  config: string | null;
  lineage: string | null;
  verdict: string | null;
  note: string | null;
  created_at: number;
};

/** Configurazione leggibile di una variante, ricavata da lineage o, per lo
 *  storico che lineage non ce l'ha, da config. Cio' che non e' registrato
 *  resta dichiarato come non registrato: inventarlo sarebbe peggio del vuoto. */
function configOf(v: VersionRow): {
  recipe: string;
  refset: string;
  preamble: string | null;
  sources: string[];
  /** I file di stile allegati alla generazione. Servono per sovrapporli alla
   *  variante: il refset e' una frase per un umano, questi sono i file veri. */
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
  // Le sorgenti vere, non la foto a cui la riga e' appesa: una variante nata da
  // tre scatti insieme ha un photo_id solo, e senza questo elenco la vista ne
  // mostrerebbe uno spacciandolo per l'unico ingresso.
  const rawSources = (lin.sources ?? cfg.sources) as unknown;
  const sources = Array.isArray(rawSources) ? rawSources.map(String) : [];
  const rawRefs = (lin.refs ?? cfg.refs) as unknown;
  const refs = Array.isArray(rawRefs) ? rawRefs.map(String) : [];
  return {
    recipe: String(lin.recipe ?? cfg.recipe ?? "senza ricetta"),
    refset: String(lin.refset ?? cfg.refset ?? "origine non registrata"),
    preamble: (lin.preamble as string | undefined) ?? null,
    sources,
    refs,
  };
}

lineageRoutes.get("/api/lineage", (c) => {
  const photos = db()
    .query<{ id: string; original_path: string; favorite_version_id: number | null }, []>(
      "SELECT id, original_path, favorite_version_id FROM photos ORDER BY id",
    )
    .all();

  // lineage registra i NOMI dei file sorgente, la vista indirizza le miniature
  // per id foto: senza questa mappa il client dovrebbe indovinare l'id dal nome,
  // e sbaglierebbe su ogni file con un'estensione inattesa.
  const byBasename = new Map(photos.map((p) => [p.original_path.split("/").pop() ?? "", p.id]));
  const favOf = new Map(photos.map((p) => [p.id, p.favorite_version_id]));

  const versions = db()
    .query<VersionRow, []>(
      `SELECT id, photo_id, version_number, image_path, config, lineage, verdict, note, created_at
         FROM versions WHERE source = 'generated'
        ORDER BY photo_id, version_number`,
    )
    .all();

  // La radice e' l'INSIEME di ingresso, non la singola foto. Raggruppare per
  // photo_id metteva tutte le varianti sotto la PRIMA sorgente e lasciava le
  // altre a "0 varianti" pur avendo contribuito a tutte; dare una radice a
  // ciascuna foto contribuente avrebbe fatto l'errore opposto, mostrando le
  // stesse 12 varianti tre volte. Una foto sola e' l'insieme di cardinalita' 1,
  // quindi i progetti a sorgente singola non hanno un caso speciale: misurato
  // su Japan, 189 radici e 3007 varianti, nessuna contata due volte.
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
    // I nomi che non si risolvono a una foto nota non spariscono: restano
    // nell'identita' dell'insieme, altrimenti due insiemi diversi si
    // fonderebbero in uno solo.
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
    });
  }

  const out = [...roots.values()].map((r) => {
    for (const g of r.groups.values()) {
      g.sources = g.sources.map((f) => byBasename.get(f)).filter((x): x is string => !!x);
    }
    return {
      // `photo` resta la prima dell'insieme: e' cio' che il client usa per la
      // miniatura di copertina e per i link. `photos` e' l'insieme intero.
      photo: r.photos[0],
      photos: r.photos,
      variants: r.variants,
      recipes: r.recipes.size,
      groups: [...r.groups.values()],
    };
  });

  // Le foto che non hanno generato niente restano visibili: un progetto appena
  // importato non deve sembrare vuoto.
  for (const p of photos) {
    if (![...roots.values()].some((r) => r.photos.includes(p.id)))
      out.push({ photo: p.id, photos: [p.id], variants: 0, recipes: 0, groups: [] });
  }

  return c.json({ photos: out });
});

/** Quanto una variante somiglia alla reference con cui e' stata generata.
 *
 *  Serviva un terminale per saperlo. La misura esisteva gia' come script, ma
 *  restava fuori dalla pagina dove si guardano le varianti, quindi la domanda
 *  "mi sto avvicinando?" si poteva porre solo altrove — e le calibrazioni di
 *  ieri sono andate avanti tre giri su un'ipotesi sbagliata proprio per quello.
 *
 *  La reference si legge dal lineage della versione: non la si passa da fuori,
 *  altrimenti si potrebbe confrontare una variante con un'immagine che non
 *  c'entra e leggere un numero che sembra un giudizio. */
lineageRoutes.get("/api/versions/:id/scarto", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id non valido" }, 400);

  const v = db()
    .query<{ image_path: string; lineage: string | null; config: string | null }, [number]>(
      "SELECT image_path, lineage, config FROM versions WHERE id = ?",
    )
    .get(id);
  if (!v) return c.json({ error: "versione non trovata" }, 404);
  if (!existsSync(v.image_path)) return c.json({ error: "immagine mancante" }, 404);

  const leggi = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const r = (JSON.parse(raw) as { refs?: unknown }).refs;
      return Array.isArray(r) ? r.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  };
  const nome = (leggi(v.lineage)[0] ?? leggi(v.config)[0] ?? "").split("/").pop() ?? "";
  // Nessuna reference non e' un errore: e' l'informazione che questa variante
  // non aveva un bersaglio, ed e' esattamente il caso che è costato 12
  // generazioni su profilo.
  if (!nome) return c.json({ reference: null, scarto: null });

  const refPath = join(refsDir(), nome);
  if (!existsSync(refPath)) return c.json({ reference: nome, scarto: null, error: "reference mancante" });

  const r = spawnSync("python3", [join(REPO_ROOT, "scripts", "ref_match.py"), v.image_path, refPath], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (r.status !== 0) {
    return c.json({ reference: nome, scarto: null, error: (r.stderr || "misura fallita").slice(0, 200) });
  }
  try {
    return c.json({ reference: nome, scarto: JSON.parse(r.stdout) });
  } catch {
    return c.json({ reference: nome, scarto: null, error: "risposta illeggibile" });
  }
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
