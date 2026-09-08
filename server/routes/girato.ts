import { Hono } from "hono";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { serveFile } from "../http.ts";
import { ROOT } from "../db.ts";
import {
  durataTenuta,
  elenca,
  fotogramma,
  leggiScelte,
  perchePerSilenzio,
  riordina,
  scelteIniziali,
  scriviScelte,
  unisci,
  type Scelta,
} from "../girato.ts";

/**
 * Il girato: si apre una cartella di riprese, si tiene o si scarta, si segna dove
 * attacca e dove stacca, si riordina.
 *
 * La cartella arriva come parametro e non da un progetto: il girato di un lavoro sta
 * dov'è stato scaricato, e obbligare a importarlo dentro Darkroom vorrebbe dire
 * copiare decine di gigabyte per rispondere a «questa la tengo?».
 */
export const giratoRoutes = new Hono();

const CACHE = join(ROOT, "dashboard", ".cache", "girato");

function cartellaDa(c: { req: { query: (k: string) => string | undefined } }): string | null {
  const d = c.req.query("cartella");
  if (!d || !d.startsWith("/") || !existsSync(d)) return null;
  try {
    return statSync(d).isDirectory() ? d : null;
  } catch {
    return null;
  }
}

/** Le clip con le scelte già unite: è tutto quello che serve per disegnare le due viste. */
giratoRoutes.get("/api/girato", async (c) => {
  const cartella = cartellaDa(c);
  if (!cartella) return c.json({ error: "cartella non valida o inesistente" }, 400);

  const clip = await elenca(cartella);
  const salvate = leggiScelte(cartella).clip;
  const scelte = salvate.length ? unisci(clip, salvate) : scelteIniziali(clip);

  return c.json({
    cartella,
    clip,
    scelte,
    durataTenuta: durataTenuta(clip, scelte),
    perchePerSilenzio: perchePerSilenzio(clip, scelte),
    illeggibili: clip.filter((x) => x.illeggibile).length,
    livePhoto: clip.filter((x) => x.livePhoto).length,
  });
});

/** Salva. Il file nasce solo se c'è qualcosa da dire, e sparisce se non c'è più. */
giratoRoutes.post("/api/girato/scelte", async (c) => {
  const cartella = cartellaDa(c);
  if (!cartella) return c.json({ error: "cartella non valida o inesistente" }, 400);
  const body = await c.req.json<{ scelte: Scelta[] }>().catch(() => null);
  if (!body?.scelte || !Array.isArray(body.scelte)) {
    return c.json({ error: "servono le scelte" }, 400);
  }
  return c.json(scriviScelte(cartella, body.scelte));
});

/** Sposta una clip nella fila e salva subito: una scelta persa è peggio di una lenta. */
giratoRoutes.post("/api/girato/riordina", async (c) => {
  const cartella = cartellaDa(c);
  if (!cartella) return c.json({ error: "cartella non valida o inesistente" }, 400);
  const body = await c.req.json<{ da: number; a: number }>().catch(() => null);
  if (!body || typeof body.da !== "number" || typeof body.a !== "number") {
    return c.json({ error: "servono da e a" }, 400);
  }
  const clip = await elenca(cartella);
  const salvate = leggiScelte(cartella).clip;
  const scelte = riordina(salvate.length ? unisci(clip, salvate) : scelteIniziali(clip), body.da, body.a);
  scriviScelte(cartella, scelte);
  return c.json({ scelte });
});

/**
 * Un fotogramma della clip, in cache su disco.
 *
 * La cache è nella cartella di lavoro di Darkroom e non accanto alle riprese: là
 * dentro finiscono solo le decisioni, mai i pixel.
 */
giratoRoutes.get("/api/girato/fotogramma", async (c) => {
  const cartella = cartellaDa(c);
  const nome = c.req.query("clip");
  if (!cartella || !nome || nome.includes("/")) {
    return c.json({ error: "servono cartella e clip" }, 400);
  }
  const percorso = join(cartella, nome);
  if (!existsSync(percorso)) return c.json({ error: "clip non trovata" }, 404);

  const secondo = Math.max(0, Number(c.req.query("t") ?? 0) || 0);
  const lato = Math.min(1920, Math.max(64, Number(c.req.query("w") ?? 480) || 480));
  const st = statSync(percorso);
  const chiave = `${st.size}_${Math.floor(st.mtimeMs)}_${nome.replace(/[^a-zA-Z0-9._-]/g, "_")}_${secondo.toFixed(2)}_${lato}.jpg`;
  const uscita = join(CACHE, chiave);

  if (!existsSync(uscita)) {
    mkdirSync(CACHE, { recursive: true });
    if (!(await fotogramma(percorso, secondo, lato, uscita))) {
      return c.json({ error: "il fotogramma non si estrae" }, 502);
    }
  }
  return serveFile(uscita, "image/jpeg");
});

/** La clip stessa, per l'anteprima con l'audio. Si serve, non si copia. */
giratoRoutes.get("/api/girato/clip", (c) => {
  const cartella = cartellaDa(c);
  const nome = c.req.query("clip");
  if (!cartella || !nome || nome.includes("/")) {
    return c.json({ error: "servono cartella e clip" }, 400);
  }
  const percorso = join(cartella, nome);
  if (!existsSync(percorso)) return c.json({ error: "clip non trovata" }, 404);
  return serveFile(percorso);
});
