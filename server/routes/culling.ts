import { Hono } from "hono";
import {
  COLORI,
  GiudizioNonValido,
  calcolaFirme,
  correggiGruppo,
  giudica,
  pianificaSidecar,
  raggruppa,
  rendiconto,
  scriviSidecar,
  type Colore,
} from "../culling.ts";
import * as motore from "../core.ts";
import { db } from "../db.ts";

/**
 * Il culling: si guarda, si giudica, si scrive fuori.
 *
 * Due cose che l'API impone e che non sono cerimonia. La scrittura dei sidecar è in
 * due tempi — prima si dice quanti file e dove, poi si scrive — perché quei file
 * finiscono nella cartella di un cliente accanto ai suoi RAW. E i criteri della
 * sessione si chiedono ogni volta: i criteri di un matrimonio non sono quelli di un
 * reportage, e riproporre quelli di ieri è una scorciatoia che produce scelte
 * sbagliate con l'aria di essere già decise.
 */
export const cullingRoutes = new Hono();

cullingRoutes.get("/api/culling/rendiconto", (c) => c.json(rendiconto()));

cullingRoutes.get("/api/culling/colori", (c) => c.json({ colori: COLORI }));

cullingRoutes.put("/api/culling/:id/giudizio", async (c) => {
  const body = await c.req.json<{ stelle?: number | null; colore?: Colore | null }>();
  try {
    return c.json({ ok: true, giudizio: giudica(c.req.param("id"), body) });
  } catch (e) {
    if (e instanceof GiudizioNonValido) return c.json({ error: e.message }, 400);
    throw e;
  }
});

/** Il giudizio già scritto nel sidecar accanto al file, per non ripartire da zero. */
cullingRoutes.get("/api/culling/:id/sidecar", async (c) => {
  const foto = db()
    .query<{ original_path: string }, [string]>(
      "SELECT original_path FROM photos WHERE id = ?",
    )
    .get(c.req.param("id"));
  if (!foto) return c.json({ error: "not found" }, 404);
  try {
    return c.json(await motore.xmpLeggi(foto.original_path));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** Primo tempo: cosa verrebbe scritto, dove, e quanti file. Non scrive niente. */
cullingRoutes.post("/api/culling/sidecar/piano", async (c) => {
  const body = await c.req
    .json<{ photo_ids?: string[]; vocabolario?: string }>()
    .catch(() => ({}) as { photo_ids?: string[]; vocabolario?: string });
  return c.json(await pianificaSidecar(body.photo_ids, body.vocabolario ?? "it"));
});

/** Secondo tempo: si scrive. Ogni sidecar ha la sua copia di sicurezza. */
cullingRoutes.post("/api/culling/sidecar/scrivi", async (c) => {
  const body = await c.req
    .json<{ photo_ids?: string[]; vocabolario?: string }>()
    .catch(() => ({}) as { photo_ids?: string[]; vocabolario?: string });
  return c.json(await scriviSidecar(body.photo_ids, body.vocabolario ?? "it"));
});

/**
 * Il passo caro. Una passata dura al massimo qualche secondo e dice quante ne
 * restano: il server chiude le connessioni inattive dopo dieci secondi, e un
 * archivio vero ne richiede molti di più.
 */
cullingRoutes.post("/api/culling/firme", async (c) => {
  const budget = Number(c.req.query("budget_ms"));
  return c.json(await calcolaFirme(Number.isFinite(budget) && budget > 0 ? budget : undefined));
});

cullingRoutes.post("/api/culling/raffiche", (c) => c.json(raggruppa()));

cullingRoutes.put("/api/culling/:id/gruppo", async (c) => {
  const body = await c.req.json<{ gruppo: string | null }>();
  try {
    correggiGruppo(c.req.param("id"), body.gruppo ?? null);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof GiudizioNonValido) return c.json({ error: e.message }, 400);
    throw e;
  }
});

/**
 * La diagnosi di un file: quanto è grande l'anteprima che la fotocamera ci ha
 * lasciato dentro, e quali livelli riesce a servire senza decodifica piena.
 *
 * È il numero da leggere prima di fissare qualunque soglia, perché cambia da corpo a
 * corpo: su una NEF l'anteprima è grande quanto lo scatto, su una ARW si ferma a
 * 1616 px e il visore cade nella decodifica piena.
 */
cullingRoutes.get("/api/culling/:id/diagnosi", async (c) => {
  const foto = db()
    .query<{ original_path: string }, [string]>(
      "SELECT original_path FROM photos WHERE id = ?",
    )
    .get(c.req.param("id"));
  if (!foto) return c.json({ error: "not found" }, 404);
  try {
    return c.json(await motore.diagnosi(foto.original_path));
  } catch (e) {
    return c.json(
      {
        error: e instanceof Error ? e.message : String(e),
        codice: e instanceof motore.ErroreMotore ? e.codice : "sconosciuto",
      },
      502,
    );
  }
});

/** Se il motore nativo c'è, e cosa sa fare su questa macchina. */
cullingRoutes.get("/api/culling/motore", async (c) => {
  if (!motore.motoreDisponibile()) {
    return c.json({ disponibile: false, come: "bun run core:build" });
  }
  const f = await motore.formati();
  return c.json({ disponibile: true, formati: f });
});
