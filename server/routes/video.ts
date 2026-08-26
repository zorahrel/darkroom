import { Hono } from "hono";
import { serveFile } from "../http.ts";
import {
  shots, cuts, assets, setScelta, clipPath, posterPath, assetPath,
  segnalaProblema, togliProblema, setRipresa, setPin, setDurata,
  barra, ricostruisci, statoRicostruzione, onda, setMarcatore, marcatori, forzature, annullaGiudizio, scambia, sganciaPin,
} from "../video.ts";
import { listProjects, currentProjectId } from "../project.ts";
import { accodaVideoJob, listaVideoJob, annullaVideoJob, PARAMETRI_DEFAULT } from "../comfy.ts";

/** Everything a video project's editor page needs. Read-only except for the
 *  keep/kill and the three forced edits, which are the decisions the pipeline
 *  cannot take by itself. */
export const videoRoutes = new Hono();

/** Recinzione: un progetto foto non ha `plan.json` ne' `master.sh`, e queste
 *  rotte leggerebbero la sua cartella cercandoli. Meglio un 404 onesto. */
videoRoutes.use("/api/video/*", async (c, next) => {
  const pid = currentProjectId();
  const p = listProjects().find((x) => x.id === pid);
  if (p && p.kind !== "video") {
    return c.json({ error: `'${p.name}' non e' un progetto video` }, 404);
  }
  await next();
});

videoRoutes.get("/api/video/shots", (c) => c.json({ shots: shots() }));
videoRoutes.get("/api/video/cuts", (c) => c.json(cuts()));
videoRoutes.get("/api/video/assets", (c) => c.json(assets()));

videoRoutes.post("/api/video/pick", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    shot?: string; kept?: boolean; perche?: string;
  };
  if (!body.shot) return c.json({ error: "shot mancante" }, 400);
  const s = setScelta(body.shot, body.kept !== false, body.perche);
  return c.json({ ok: true, scartati: s.scartati, shots: shots() });
});

videoRoutes.post("/api/video/problema", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; testo?: string; i?: number };
  if (!b.shot) return c.json({ error: "shot mancante" }, 400);
  if (typeof b.i === "number") togliProblema(b.shot, b.i);
  else segnalaProblema(b.shot, b.testo ?? "");
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/ripresa", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { shot?: string; take?: string; kept?: boolean };
  if (!b.shot || !b.take) return c.json({ error: "shot o take mancante" }, 400);
  setRipresa(b.shot, b.take, b.kept !== false);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.get("/api/video/clip/:shot/:take", (c) => {
  const p = clipPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/poster/:shot/:take", (c) => {
  const p = posterPath(c.req.param("shot"), c.req.param("take"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});
videoRoutes.get("/api/video/asset/:name", (c) => {
  const p = assetPath(c.req.param("name"));
  return p ? serveFile(p, undefined, c.req.raw) : new Response("not found", { status: 404 });
});

videoRoutes.post("/api/video/pin", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { bar?: number; shot?: string | null };
  if (typeof b.bar !== "number") return c.json({ error: "battuta mancante" }, 400);
  setPin(b.bar, b.shot ?? null);
  return c.json({ ok: true });
});

videoRoutes.post("/api/video/durata", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { bar?: number; battute?: number | null };
  if (typeof b.bar !== "number") return c.json({ error: "battuta mancante" }, 400);
  setDurata(b.bar, b.battute ?? null);
  return c.json({ ok: true });
});

// La barra costa: `check.py` estrae fotogrammi con ffmpeg. Il risultato e'
// tenuto finche' il montaggio non cambia; `?force=1` lo rifa comunque.
videoRoutes.post("/api/video/scordagiudizio", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const shot = String(b.shot ?? "");
  if (!shot) return c.json({ error: "serve il piano" }, 400);
  annullaGiudizio(shot);
  return c.json({ ok: true, shots: shots() });
});

videoRoutes.post("/api/video/scambia", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const [ba, pa, bb, pb] = [Number(b.barA), String(b.pianoA ?? ""), Number(b.barB), String(b.pianoB ?? "")];
  if (!Number.isFinite(ba) || !Number.isFinite(bb) || !pa || !pb) return c.json({ error: "scambio incompleto" }, 400);
  if (ba === bb) return c.json({ error: "e' la stessa battuta" }, 400);
  return c.json({ pin: scambia(ba, pa, bb, pb) });
});

videoRoutes.post("/api/video/sganciapin", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const bb = Array.isArray(b.battute) ? b.battute.map(Number).filter(Number.isFinite) : [];
  return c.json({ pin: sganciaPin(bb) });
});

videoRoutes.get("/api/video/forzature", (c) => c.json(forzature()));

videoRoutes.get("/api/video/marcatori", (c) => c.json({ marcatori: marcatori() }));

videoRoutes.post("/api/video/marcatore", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const t = Number(b.t);
  if (!Number.isFinite(t) || t < 0) return c.json({ error: "istante non valido" }, 400);
  setMarcatore(t, b.nota ? String(b.nota).slice(0, 300) : null);
  return c.json({ marcatori: marcatori() });
});

videoRoutes.get("/api/video/onda", (c) => c.json(onda()));

videoRoutes.get("/api/video/barra", (c) => c.json(barra(c.req.query("force") === "1")));

videoRoutes.post("/api/video/ricostruisci", (c) => {
  const r = ricostruisci();
  return r.ok ? c.json({ ok: true }) : c.json({ error: r.errore }, 409);
});
videoRoutes.get("/api/video/ricostruzione", (c) => c.json(statoRicostruzione()));

/** Generazione sulla 3090. Il Mac non tocca un fotogramma: qui si accoda, sul
 *  PC si genera, si raccoglie e si interpola, e torna solo la clip leggera. */
videoRoutes.get("/api/video/generazioni", (c) =>
  c.json({ jobs: listaVideoJob(), default: PARAMETRI_DEFAULT }));

videoRoutes.post("/api/video/genera", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const piano = String(b.piano ?? "").trim();
  const prompt = String(b.prompt ?? "").trim();
  if (!piano || !prompt) return c.json({ error: "servono piano e prompt" }, 400);
  // Il nome del piano finisce in un percorso e in una riga di comando sul PC.
  if (!/^[a-z0-9_]+$/i.test(piano)) return c.json({ error: "nome piano non valido" }, 400);
  const take = String(b.take ?? "a");
  if (!/^[a-z]$/.test(take)) return c.json({ error: "take non valido" }, 400);
  return c.json({ job: accodaVideoJob(piano, prompt, take, b.params ?? {}) });
});

videoRoutes.post("/api/video/genera/:id/annulla", (c) =>
  c.json({ ok: annullaVideoJob(Number(c.req.param("id"))) }));
