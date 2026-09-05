import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { WorkerResult } from "./worker.ts";
import { openaiDailyCapUsd, openaiSyncBudgetUsd, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_SIZE, openaiKey } from "./config.ts";
import { db } from "./db.ts";
import { prepareAttachments, type Attachment } from "./attachments.ts";

/**
 * OpenAI backend: talks to the Images API directly instead of driving an
 * interactive session. It exists for the case the other three backends cannot
 * carry — a long pass, where a Plus account's quota runs out halfway — and for
 * text inside the image, where `gpt-image-2` is the only one that does not
 * produce crooked letters.
 *
 * This worker is SYNCHRONOUS on purpose. The Batch API costs half, but on a
 * real batch of 2 high images it was still `in_progress` after 3 minutes:
 * inside the job loop, which waits for the return to write 'done', that wait
 * would block the runner. Batching lives in `scripts/openai_batch.ts`, outside
 * the loop, where the wait is a price knowingly accepted.
 */

const TIMEOUT_MS = 6 * 60 * 1000; // like the other workers

/** Prices per 1M image output tokens (OpenAI docs, Aug 2026). */
const OUTPUT_RATE_PER_M: Record<string, number> = {
  "gpt-image-2": 30.0,
  "gpt-image-1.5": 32.0,
  "gpt-image-1": 40.0,
  "gpt-image-1-mini": 8.0,
};

/** Spent in the last 24h, from the recorded calls. */
export function spentToday(): number {
  try {
    const r = db()
      .query<{ tot: number | null }, [number]>(
        "SELECT SUM(cost_usd) AS tot FROM api_calls WHERE provider='openai' AND created_at > ?",
      )
      .get(Date.now() - 24 * 60 * 60 * 1000);
    return r?.tot ?? 0;
  } catch {
    // Without a DB there is no way to know: a generation is not blocked over this.
    return 0;
  }
}

/** Output tokens observed for a 1024², by quality.
 *
 *  MEASURED, not taken from the docs table: a `high` 1024² consumes 7024 where
 *  the docs predicted 4160, and a `low` one 196 where they predicted 272. They
 *  are needed to know what a call costs BEFORE making it. */
const TOKEN_ATTESI: Record<string, number> = { low: 200, medium: 1600, high: 7100 };

/** What the next call will cost, in dollars. An over-estimate on purpose: a
 *  brake that under-estimates does not brake. */
export function expectedCost(
  model: string = OPENAI_IMAGE_MODEL,
  quality: string = OPENAI_IMAGE_QUALITY,
): number {
  return costUsd(model, TOKEN_ATTESI[quality] ?? TOKEN_ATTESI.high!);
}

/** The cap bites BEFORE the call: afterwards, it has already been paid.
 *  Returns the error to show, or null if we can proceed. */
function overCap(options: { withRefs?: boolean; quality?: string } = {}): string | null {
  // The synchronous threshold looks at what THIS call costs, not at what has
  // been spent so far.
  //
  // It used to compare the day's total against the threshold, and from then on
  // it blocked everything: on 27/08 a half-cent `low` trial was refused because
  // there were $2.81 of `high` generations that day. A cheap trial is exactly
  // the right way to work, and it was the only thing the brake managed to stop.
  // The daily cap, below, stays the brake on the total: that is its job.
  const budget = openaiSyncBudgetUsd();
  // THIS call's quality: weighing the system one meant letting a high through
  // while believing you had asked for a low.
  const cost = expectedCost(OPENAI_IMAGE_MODEL, options.quality ?? OPENAI_IMAGE_QUALITY);
  if (budget > 0 && cost > budget) {
    // The batch does NOT accept /edits, which is the only endpoint that takes
    // references: sending somebody using a reference there is a dead end.
    const path = options.withRefs
      ? `Con delle reference il batch non e' una strada (non supporta /edits): ` +
        `prova prima in OPENAI_IMAGE_QUALITY=low (~$${expectedCost(OPENAI_IMAGE_MODEL, "low").toFixed(3)}), ` +
        `oppure alza OPENAI_SYNC_BUDGET_USD.`
      : `Il batch costa META': bun run scripts/openai_batch.ts submit <file-prompt>. ` +
        `Per forzare il sincrono: OPENAI_SYNC_BUDGET_USD=0`;
    return (
      `questa chiamata costa ~$${cost.toFixed(2)} (${OPENAI_IMAGE_QUALITY}), ` +
      `sopra la soglia del sincrono ($${budget.toFixed(2)}). ${path}`
    );
  }
  // Read here and not at import: a cap you can only raise by restarting the
  // server is a cap you get around by restarting the server.
  const cap = openaiDailyCapUsd();
  if (!(cap > 0)) return null;
  const spent = spentToday();
  // The cap looks ahead too: stopping AFTER exceeding it means always
  // exceeding it by one call.
  if (spent + cost <= cap) return null;
  return (
    `tetto giornaliero raggiunto: $${spent.toFixed(2)} spesi nelle ultime 24h ` +
    `piu' ~$${cost.toFixed(2)} di questa chiamata (limite $${cap.toFixed(2)}). ` +
    `Alza OPENAI_DAILY_CAP_USD o aspetta.`
  );
}

/** Every paid call ends up here, whatever project the caller is in: you pay
 *  for the request, not for the version that comes out of it. A calibration
 *  script writing into /tmp costs the same as a queue job.
 *
 *  It must never make a generation fail: if the DB is unreachable (a script
 *  outside a project) the row is lost, not the image. */
export function recordCall(
  model: string,
  outputTokens: number,
  ok: boolean,
  origin = process.env.DARKROOM_CALL_ORIGIN ?? "worker",
  /** The batch pays half: the tariff is one thing, the tokens another.
   *  Halving the tokens to get the right cost would falsify the column that
   *  says how much the model produced. */
  discount = 1,
): void {
  try {
    db().run(
      `INSERT INTO api_calls (provider, model, quality, output_tokens, cost_usd, ok, origin, created_at)
       VALUES ('openai', ?, ?, ?, ?, ?, ?, ?)`,
      [
        model,
        OPENAI_IMAGE_QUALITY,
        outputTokens,
        costUsd(model, outputTokens) * discount,
        ok ? 1 : 0,
        origin,
        Date.now(),
      ],
    );
  } catch (e) {
    // The image counts more than the accounting, so we do not fail. But silence
    // was worse: a script launched outside a project could not find the DB and
    // four paid generations appeared nowhere, while the bar kept showing the
    // previous total as if it were up to date.
    console.warn(
      `[openai] chiamata NON registrata ($${costUsd(model, outputTokens).toFixed(4)}): ${String(e).slice(0, 120)}`,
    );
  }
}

/** A generation's cost in dollars, from the tokens the API actually reports.
 *  Estimating it from the requested size would give a wrong number: a 1024²
 *  low consumed 196 tokens where the table predicted 272. */
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
  // A 4xx/5xx with no `error` field must not pass for good.
  if (!res.ok && !json.error) json.error = { message: `HTTP ${res.status}` };
  return json;
}

/** Writes the PNG and returns the result in the shape common to the workers. */
async function saveResult(
  json: ImagesResponse,
  output: string,
  startedAt: number,
  model: string = OPENAI_IMAGE_MODEL,
  qualityUsed: string = OPENAI_IMAGE_QUALITY,
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
  // The file has to be read back from disk: a partial write here would become
  // a broken version in the gallery, which is exactly what you cannot see in
  // the grid.
  if (!existsSync(output)) return { status: "error", error: `scrittura fallita: ${output}`, duration_s };
  // It looks at the BYTES, not at rounded kilobytes: `size_kb` of a 500-byte
  // file is 0, and the guard discarded as "empty" a file that was there.
  const actual_bytes = statSync(output).size;
  if (actual_bytes === 0) return { status: "error", error: `file vuoto: ${basename(output)}`, duration_s };
  const size_kb = Math.round(actual_bytes / 1024);
  // The tokens are read from the response: the docs table gave 4160 for a high
  // 1024 where 7024 were consumed, 69% more.
  const tok = json.usage?.output_tokens;
  if (tok) recordCall(model, tok, true);
  return {
    status: "ok",
    output,
    model,
    quality: qualityUsed,
    output_tokens: tok,
    duration_s,
    size_kb,
    ...(tok ? { cost_usd: costUsd(model, tok) } : {}),
  };
}

/** Text-to-image. `refs` are accepted and attached: the edits endpoint with
 *  several images is what keeps a face consistent across a storyboard's
 *  panels. */
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
  const refs = (input.refs ?? []).filter((p) => existsSync(p));
  const over = overCap({ withRefs: refs.length > 0 });
  if (over) return { status: "error", error: over };
  const startedAt = Date.now();

  // With references we go through /edits, the only endpoint that accepts them.
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

/** Edit of a source photo, with any references attached. */
export async function runWorkerOpenAi(input: {
  image: string;
  prompt: string;
  output: string;
  refs?: string[];
  /** Attachments with their role. When present, the send order and the
   *  sentence describing them are born from the same list and cannot diverge:
   *  `refs` alone leaves the caller to keep them aligned by hand, and that is a
   *  promise nobody checks. */
  attachments?: Attachment[];
  /** Quality for THIS generation. Absent = the system one.
   *
   *  It used to be read only from the process environment: a job declaring
   *  `low` was produced in `high`, and a trial I thought cost half a cent cost
   *  21. The job declared one thing and the process did another, the same
   *  defect the channel had. */
  quality?: string;
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
  // An edit ALWAYS goes through /edits, which the batch does not support:
  // sending somebody here to the batch would be a dead end even without
  // references.
  const wantedQuality = input.quality ?? OPENAI_IMAGE_QUALITY;
  const over = overCap({ withRefs: true, quality: wantedQuality });
  if (over) return { status: "error", error: over };
  const startedAt = Date.now();
  // With the roles declared, the preamble is generated from the same list that
  // decides the order of the attachments: it is the only way for "the first two
  // are me" to stay true even after adding a reference.
  const withRoles = (input.attachments ?? []).filter((a) => existsSync(a.path));
  if (withRoles.length > 0) {
    const { files, preamble } = prepareAttachments(withRoles, { withSource: true });
    return runEdits(key, [input.image, ...files], `${preamble} ${input.prompt}`, input.output, startedAt, wantedQuality);
  }
  const images = [input.image, ...(input.refs ?? []).filter((p) => existsSync(p))];
  return runEdits(key, images, input.prompt, input.output, startedAt, wantedQuality);
}

/** MIME from the extension: a Blob without a `type` arrives as
 *  `application/octet-stream` and the edits endpoint refuses it. */
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
  quality: string = OPENAI_IMAGE_QUALITY,
): Promise<WorkerResult> {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", OPENAI_IMAGE_SIZE);
  form.append("quality", quality);
  for (const p of images) {
    const bytes = await Bun.file(p).arrayBuffer();
    form.append("image[]", new Blob([bytes], { type: mimeOf(p) }), basename(p));
  }
  const json = await callImages("edits", key, form).catch(
    (e): ImagesResponse => ({ error: { message: String(e) } }),
  );
  return saveResult(json, output, startedAt, OPENAI_IMAGE_MODEL, quality);
}
