import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { WorkerResult } from "./worker.ts";
import { OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_SIZE, openaiKey } from "./config.ts";

/**
 * Backend OpenAI: parla direttamente all'Images API invece di guidare una
 * sessione interattiva. Esiste per il caso che gli altri tre backend non
 * reggono — una passata lunga, dove la quota di un account Plus finisce a metà
 * strada — e per il testo dentro l'immagine, dove `gpt-image-2` è l'unico che
 * non produce lettere storte.
 *
 * Questo worker è SINCRONO di proposito. La Batch API costa metà, ma su un
 * batch reale da 2 immagini high era ancora `in_progress` dopo 3 minuti: dentro
 * il job loop, che aspetta il ritorno per scrivere 'done', quell'attesa
 * bloccherebbe il runner. Il batch vive in `scripts/openai_batch.ts`, fuori dal
 * loop, dove l'attesa è il prezzo che si accetta consapevolmente.
 */

const TIMEOUT_MS = 6 * 60 * 1000; // come gli altri worker

/** Prezzi per 1M token di output immagine (docs OpenAI, ago 2026). */
const OUTPUT_RATE_PER_M: Record<string, number> = {
  "gpt-image-2": 30.0,
  "gpt-image-1.5": 32.0,
  "gpt-image-1": 40.0,
  "gpt-image-1-mini": 8.0,
};

/** Costo in dollari di una generazione, dai token che l'API riporta davvero.
 *  Stimarlo dalla dimensione richiesta darebbe un numero sbagliato: una 1024²
 *  low ha consumato 196 token dove la tabella ne prevedeva 272. */
export function costUsd(model: string, outputTokens: number): number {
  const rate = OUTPUT_RATE_PER_M[model] ?? 30.0;
  return (outputTokens / 1e6) * rate;
}

type ImagesResponse = {
  data?: { b64_json?: string; url?: string }[];
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

async function callImages(
  path: "generations" | "edits",
  key: string,
  body: FormData | string,
): Promise<ImagesResponse> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (typeof body === "string") headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.openai.com/v1/images/${path}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json: ImagesResponse;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: { message: `HTTP ${res.status}: ${text.slice(0, 300)}` } };
  }
  // Un 4xx/5xx senza campo `error` non deve passare per buono.
  if (!res.ok && !json.error) json.error = { message: `HTTP ${res.status}` };
  return json;
}

/** Scrive il PNG e restituisce il risultato nel formato comune ai worker. */
async function saveResult(
  json: ImagesResponse,
  output: string,
  startedAt: number,
  model: string = OPENAI_IMAGE_MODEL,
): Promise<WorkerResult> {
  const duration_s = Math.round((Date.now() - startedAt) / 1000);
  if (json.error) return { status: "error", error: json.error.message ?? "errore sconosciuto", duration_s };
  const first = json.data?.[0];
  const b64 = first?.b64_json;
  const url = first?.url;
  if (!b64 && !url) return { status: "error", error: "risposta senza immagine", duration_s };
  const bytes = b64
    ? Buffer.from(b64, "base64")
    : Buffer.from(await (await fetch(url as string)).arrayBuffer());
  await Bun.write(output, bytes);
  // Il file va riletto da disco: una write parziale qui diventerebbe una
  // versione rotta in galleria, che è esattamente ciò che non si vede in griglia.
  if (!existsSync(output)) return { status: "error", error: `scrittura fallita: ${output}`, duration_s };
  // Si guarda i BYTE, non i kilobyte arrotondati: `size_kb` di un file da 500
  // byte e' 0, e la guardia scartava come "vuoto" un file che c'era.
  const bytes_reali = statSync(output).size;
  if (bytes_reali === 0) return { status: "error", error: `file vuoto: ${basename(output)}`, duration_s };
  const size_kb = Math.round(bytes_reali / 1024);
  // I token si leggono dalla risposta: la tabella dei docs dava 4160 per una
  // high 1024 dove ne sono stati consumati 7024, il 69% in piu'.
  const tok = json.usage?.output_tokens;
  return {
    status: "ok",
    output,
    duration_s,
    size_kb,
    ...(tok ? { cost_usd: costUsd(model, tok) } : {}),
  };
}

/** Text-to-image. `refs` sono accettate e allegate: l'endpoint edits con più
 *  immagini è ciò che tiene coerente un volto fra i pannelli di uno storyboard. */
export async function runWorkerOpenAiGenerate(input: {
  prompt: string;
  output: string;
  refs?: string[];
}): Promise<WorkerResult> {
  const key = openaiKey();
  if (!key) {
    return {
      status: "error",
      error:
        'nessuna chiave OpenAI. Salvala nel Keychain:\n  security add-generic-password -s openai -a darkroom -w "<chiave>" -U',
    };
  }
  const startedAt = Date.now();
  const refs = (input.refs ?? []).filter((p) => existsSync(p));

  // Con reference si passa da /edits, che è l'unico endpoint che le accetta.
  if (refs.length > 0) return runEdits(key, refs, input.prompt, input.output, startedAt);

  const json = await callImages(
    "generations",
    key,
    JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: input.prompt,
      size: OPENAI_IMAGE_SIZE,
      quality: OPENAI_IMAGE_QUALITY,
    }),
  ).catch((e): ImagesResponse => ({ error: { message: String(e) } }));
  return saveResult(json, input.output, startedAt);
}

/** Edit di una foto sorgente, con eventuali reference allegate. */
export async function runWorkerOpenAi(input: {
  image: string;
  prompt: string;
  output: string;
  refs?: string[];
}): Promise<WorkerResult> {
  const key = openaiKey();
  if (!key) {
    return {
      status: "error",
      error:
        'nessuna chiave OpenAI. Salvala nel Keychain:\n  security add-generic-password -s openai -a darkroom -w "<chiave>" -U',
    };
  }
  if (!existsSync(input.image)) {
    return { status: "error", error: `source image not found: ${input.image}` };
  }
  const startedAt = Date.now();
  const images = [input.image, ...(input.refs ?? []).filter((p) => existsSync(p))];
  return runEdits(key, images, input.prompt, input.output, startedAt);
}

/** MIME dall'estensione: un Blob senza `type` arriva come
 *  `application/octet-stream` e l'endpoint edits lo rifiuta. */
function mimeOf(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

async function runEdits(
  key: string,
  images: string[],
  prompt: string,
  output: string,
  startedAt: number,
): Promise<WorkerResult> {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", OPENAI_IMAGE_SIZE);
  form.append("quality", OPENAI_IMAGE_QUALITY);
  for (const p of images) {
    const bytes = await Bun.file(p).arrayBuffer();
    form.append("image[]", new Blob([bytes], { type: mimeOf(p) }), basename(p));
  }
  const json = await callImages("edits", key, form).catch(
    (e): ImagesResponse => ({ error: { message: String(e) } }),
  );
  return saveResult(json, output, startedAt);
}
