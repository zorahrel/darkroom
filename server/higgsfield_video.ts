import { readFileSync } from "node:fs";
import { mcpCall } from "./higgsfield.ts";

/**
 * Video da una versione, via Higgsfield: preventivo per modello, lancio, attesa, scarico.
 *
 * Nasce per CONFRONTARE i modelli sullo stesso primo fotogramma e sullo stesso prompt: i preset
 * sono la scelta di qualita' massima di ciascuno, non quella economica. Il preventivo non spende
 * (`get_cost`): il lancio e' un'altra chiamata, che chi usa questo modulo fa solo dopo un ok.
 *
 * Il primo fotogramma si carica com'e' (PNG): `uploadImage` di higgsfield.ts lo ricodifica in
 * JPEG, il che per un video che parte da quel fotogramma e' una perdita gratuita.
 */

export type VideoPreset = {
  model: string;
  label: string;
  /** Parametri del modello; la durata e il formato si aggiungono dopo. */
  params: Record<string, unknown>;
  /** Intervallo di durata che il modello accetta. */
  durations: [number, number] | number[];
  note: string;
};

export const VIDEO_PRESETS: Record<string, VideoPreset> = {
  h3_2k: {
    model: "minimax_h3",
    label: "MiniMax H3",
    params: { resolution: "2K" },
    durations: [4, 15],
    note: "2K, audio nativo",
  },
  kling_pro: {
    model: "kling3_0",
    label: "Kling 3.0 pro",
    params: { mode: "pro", sound: "on" },
    durations: [3, 15],
    note: "pro, audio",
  },
  seedance_1080: {
    model: "seedance_2_0",
    label: "Seedance 2.0",
    params: { mode: "std", resolution: "1080p", bitrate_mode: "high" },
    durations: [4, 15],
    note: "1080p, bitrate alto",
  },
  veo_high: {
    model: "veo3_1",
    label: "Veo 3.1",
    params: { variant: "veo-3-1-preview", quality: "high" },
    durations: [4, 6, 8],
    note: "preview, qualita' alta",
  },
};

/** Porta la durata voluta dentro quello che il modello permette. */
export function fitDuration(p: VideoPreset, wanted: number): number {
  const d = p.durations;
  // Due numeri sono un intervallo; piu' di due (o `[4, 6, 8]`) sono i soli valori ammessi.
  if (d.length === 2 && d[1]! - d[0]! > 2) return Math.min(d[1]!, Math.max(d[0]!, Math.round(wanted)));
  return d.reduce((best, x) => (Math.abs(x - wanted) < Math.abs(best - wanted) ? x : best), d[0]!);
}

type Upload = { uploads: { upload_url: string; media_id: string }[] };

/** Carica il primo fotogramma senza ricodificarlo. */
export async function uploadStartFrame(path: string): Promise<string> {
  const png = path.toLowerCase().endsWith(".png");
  const contentType = png ? "image/png" : "image/jpeg";
  const up = await mcpCall<Upload>("media_upload", {
    filename: `frame.${png ? "png" : "jpg"}`,
    content_type: contentType,
  });
  const slot = up.uploads?.[0];
  if (!slot?.upload_url || !slot.media_id) throw new Error("media_upload: nessuna upload_url");
  const put = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: readFileSync(path),
  });
  if (!put.ok) throw new Error(`upload PUT fallito: ${put.status}`);
  await mcpCall("media_confirm", { media_id: slot.media_id, type: "image" });
  return slot.media_id;
}

export type VideoRequest = {
  preset: VideoPreset;
  prompt: string;
  mediaId: string;
  duration: number;
  aspect: string;
};

const buildParams = (r: VideoRequest, extra: Record<string, unknown> = {}) => ({
  model: r.preset.model,
  prompt: r.prompt,
  aspect_ratio: r.aspect,
  duration: fitDuration(r.preset, r.duration),
  medias: [{ value: r.mediaId, role: "start_image" }],
  ...r.preset.params,
  ...extra,
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * Higgsfield a volte propone un suo preset di stile prima di generare, e chiede di rifiutarlo
 * con `declined_preset_id`: senza, la richiesta non parte. Il preset cambia il prompt, e noi
 * vogliamo il nostro alla lettera, quindi si rifiuta sempre.
 */
async function callVideo(params: Record<string, unknown>): Promise<any> {
  const first = await mcpCall<any>("generate_video", { params });
  if (first?.cost || first?.jobs || first?.job_id || first?.jobId || first?.generation) return first;
  const text = JSON.stringify(first);
  const m = /preset/i.test(text) ? UUID.exec(text) : null;
  if (!m) return first;
  return mcpCall<any>("generate_video", { params: { ...params, declined_preset_id: m[0] } });
}

/** Preventivo: nessun job parte, nessun credito si spende. */
export async function quote(r: VideoRequest): Promise<number> {
  const out = await callVideo(buildParams(r, { get_cost: true }));
  const c = out?.cost?.credits_exact ?? out?.cost?.credits;
  if (typeof c !== "number") throw new Error(`preventivo non leggibile: ${JSON.stringify(out).slice(0, 200)}`);
  return c;
}

const findJobId = (o: unknown): string | null => {
  if (typeof o === "string") return UUID.test(o) && o.length === 36 ? o : null;
  if (Array.isArray(o)) return o.map(findJobId).find(Boolean) ?? null;
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["job_id", "jobId", "id"]) {
      const v = r[k];
      if (typeof v === "string" && v.length === 36) return v;
    }
    return Object.values(r).map(findJobId).find(Boolean) ?? null;
  }
  return null;
};

/** SPENDE crediti. Torna l'id del job. */
export async function launch(r: VideoRequest): Promise<string> {
  const out = await callVideo(buildParams(r));
  const id = findJobId(out);
  if (!id) throw new Error(`nessun job id nella risposta: ${JSON.stringify(out).slice(0, 300)}`);
  return id;
}

/** Aspetta il video e torna l'indirizzo del file ORIGINALE (rawUrl), non della copia web. */
export async function waitForVideo(
  jobId: string,
  opts: { timeoutMs?: number; onTick?: (status: string, s: number) => void } = {},
): Promise<{ url: string; generation: any }> {
  const t0 = Date.now();
  const limit = opts.timeoutMs ?? 25 * 60_000;
  while (Date.now() - t0 < limit) {
    const r = await mcpCall<any>("job_status", { jobId });
    const g = r?.generation ?? r;
    const status = String(g?.status ?? "?");
    opts.onTick?.(status, Math.round((Date.now() - t0) / 1000));
    if (status === "completed") {
      const res = g.results?.[0] ?? {};
      const url = res.rawUrl ?? res.raw_url ?? res.url;
      if (!url) throw new Error(`video completato ma senza indirizzo: ${JSON.stringify(g).slice(0, 300)}`);
      return { url, generation: g };
    }
    if (/fail|error|cancel|nsfw/i.test(status)) throw new Error(`generazione ${status}: ${JSON.stringify(g).slice(0, 300)}`);
    await Bun.sleep(8000);
  }
  throw new Error(`il video non e' arrivato entro ${Math.round(limit / 60000)} minuti (job ${jobId})`);
}
