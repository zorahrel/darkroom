import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { WorkerResult } from "./worker.ts";
import { openaiDailyCapUsd, openaiSyncBudgetUsd, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_SIZE, openaiKey } from "./config.ts";
import { db } from "./db.ts";

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

/** Speso nelle ultime 24h, dalle chiamate registrate. */
export function spesoOggi(): number {
  try {
    const r = db()
      .query<{ tot: number | null }, [number]>(
        "SELECT SUM(cost_usd) AS tot FROM api_calls WHERE provider='openai' AND created_at > ?",
      )
      .get(Date.now() - 24 * 60 * 60 * 1000);
    return r?.tot ?? 0;
  } catch {
    // Senza DB non si puo' sapere: non si blocca una generazione per questo.
    return 0;
  }
}

/** Token di output osservati per una 1024², per qualita'.
 *
 *  MISURATI, non presi dalla tabella dei docs: una `high` 1024² ne consuma
 *  7024 dove i docs ne prevedevano 4160, e una `low` 196 dove ne prevedevano
 *  272. Servono per sapere quanto costa una chiamata PRIMA di farla. */
const TOKEN_ATTESI: Record<string, number> = { low: 200, medium: 1600, high: 7100 };

/** Quanto costera' la prossima chiamata, in dollari. Una stima per eccesso:
 *  un freno che sottostima non frena. */
export function costoAtteso(
  model: string = OPENAI_IMAGE_MODEL,
  quality: string = OPENAI_IMAGE_QUALITY,
): number {
  return costUsd(model, TOKEN_ATTESI[quality] ?? TOKEN_ATTESI.high!);
}

/** Il tetto morde PRIMA della chiamata: dopo, si e' gia' pagato. Restituisce
 *  l'errore da mostrare, o null se si puo' procedere. */
function oltreIlTetto(opzioni: { conRefs?: boolean } = {}): string | null {
  // La soglia del sincrono guarda quanto costa QUESTA chiamata, non quanto si
  // e' speso finora.
  //
  // Prima confrontava il totale del giorno con la soglia, e da li' in poi
  // bloccava tutto: il 27/08 si e' rifiutata una prova in `low` da mezzo
  // centesimo perche' nella giornata c'erano $2.81 di generazioni `high`. Una
  // prova economica e' esattamente il modo giusto di lavorare, ed era l'unica
  // cosa che il freno riusciva a fermare. Il tetto giornaliero, sotto, resta
  // il freno sul totale: quello e' il suo mestiere.
  const budget = openaiSyncBudgetUsd();
  const costo = costoAtteso();
  if (budget > 0 && costo > budget) {
    // Il batch NON accetta /edits, che e' l'unico endpoint che prende delle
    // reference: mandare li' chi sta usando una reference e' un vicolo cieco.
    const strada = opzioni.conRefs
      ? `Con delle reference il batch non e' una strada (non supporta /edits): ` +
        `prova prima in OPENAI_IMAGE_QUALITY=low (~$${costoAtteso(OPENAI_IMAGE_MODEL, "low").toFixed(3)}), ` +
        `oppure alza OPENAI_SYNC_BUDGET_USD.`
      : `Il batch costa META': bun run scripts/openai_batch.ts submit <file-prompt>. ` +
        `Per forzare il sincrono: OPENAI_SYNC_BUDGET_USD=0`;
    return (
      `questa chiamata costa ~$${costo.toFixed(2)} (${OPENAI_IMAGE_QUALITY}), ` +
      `sopra la soglia del sincrono ($${budget.toFixed(2)}). ${strada}`
    );
  }
  // Letto qui e non all'import: un tetto che si puo' alzare solo riavviando il
  // server e' un tetto che si aggira riavviando il server.
  const cap = openaiDailyCapUsd();
  if (!(cap > 0)) return null;
  const speso = spesoOggi();
  // Anche il tetto guarda avanti: fermarsi DOPO averlo superato significa
  // superarlo sempre di una chiamata.
  if (speso + costo <= cap) return null;
  return (
    `tetto giornaliero raggiunto: $${speso.toFixed(2)} spesi nelle ultime 24h ` +
    `piu' ~$${costo.toFixed(2)} di questa chiamata (limite $${cap.toFixed(2)}). ` +
    `Alza OPENAI_DAILY_CAP_USD o aspetta.`
  );
}

/** Ogni chiamata pagata finisce qui, in qualunque progetto si trovi il
 *  chiamante: si paga la richiesta, non la versione che ne esce. Uno script di
 *  calibrazione che scrive in /tmp costa come un job della coda.
 *
 *  Non deve mai far fallire una generazione: se il DB non e' raggiungibile
 *  (uno script fuori da un progetto) si perde la riga, non l'immagine. */
export function registraChiamata(
  model: string,
  outputTokens: number,
  ok: boolean,
  origin = process.env.DARKROOM_CALL_ORIGIN ?? "worker",
  /** Il batch paga meta': la tariffa e' una cosa, i token un'altra. Dimezzare
   *  i token per ottenere il costo giusto falserebbe la colonna che dice
   *  quanto ha prodotto il modello. */
  sconto = 1,
): void {
  try {
    db().run(
      `INSERT INTO api_calls (provider, model, quality, output_tokens, cost_usd, ok, origin, created_at)
       VALUES ('openai', ?, ?, ?, ?, ?, ?, ?)`,
      [
        model,
        OPENAI_IMAGE_QUALITY,
        outputTokens,
        costUsd(model, outputTokens) * sconto,
        ok ? 1 : 0,
        origin,
        Date.now(),
      ],
    );
  } catch (e) {
    // L'immagine conta piu' del conto, quindi non si fallisce. Ma il silenzio
    // era peggio: uno script lanciato fuori da un progetto non trovava il DB e
    // quattro generazioni pagate non comparivano da nessuna parte, mentre la
    // barra continuava a mostrare il totale di prima come se fosse aggiornato.
    console.warn(
      `[openai] chiamata NON registrata ($${costUsd(model, outputTokens).toFixed(4)}): ${String(e).slice(0, 120)}`,
    );
  }
}

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
  if (tok) registraChiamata(model, tok, true);
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
  const refs = (input.refs ?? []).filter((p) => existsSync(p));
  const oltre = oltreIlTetto({ conRefs: refs.length > 0 });
  if (oltre) return { status: "error", error: oltre };
  const startedAt = Date.now();

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
  // Un edit passa SEMPRE da /edits, che il batch non supporta: mandare qui
  // qualcuno al batch sarebbe un vicolo cieco anche senza reference.
  const oltre = oltreIlTetto({ conRefs: true });
  if (oltre) return { status: "error", error: oltre };
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
