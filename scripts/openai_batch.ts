/**
 * Batch OpenAI: accoda una lista di prompt e la raccoglie dopo, a metà prezzo.
 *
 * Vive fuori dal job loop di proposito. Il loop è sincrono — scrive 'done'
 * appena il worker ritorna — mentre un batch reale da 2 immagini `high` ha
 * impiegato 708s (misurato il 26/08). Dentro il loop terrebbe il runner
 * occupato per minuti; qui l'attesa è esplicita e la si accetta in cambio del
 * 50% di sconto.
 *
 * Uso:
 *   bun run scripts/openai_batch.ts submit prompts.txt   # una riga = un prompt
 *   bun run scripts/openai_batch.ts status <batch_id>
 *   bun run scripts/openai_batch.ts fetch  <batch_id> [outdir]
 *
 * La chiave si legge dal Keychain, mai da un file in chiaro:
 *   security add-generic-password -s openai -a darkroom -w "<chiave>" -U
 */
import { openaiKey, openaiDailyCapUsd, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_SIZE } from "../server/config.ts";
import { registraChiamata, spesoOggi } from "../server/worker-openai.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const key = openaiKey();
if (!key) {
  console.error('nessuna chiave OpenAI nel Keychain:\n  security add-generic-password -s openai -a darkroom -w "<chiave>" -U');
  process.exit(1);
}
const API = "https://api.openai.com/v1";
const auth = { Authorization: `Bearer ${key}` };

/** Prezzi per 1M token di output immagine; il batch paga metà. */
const RATE_PER_M: Record<string, number> = {
  "gpt-image-2": 30.0,
  "gpt-image-1.5": 32.0,
  "gpt-image-1": 40.0,
  "gpt-image-1-mini": 8.0,
};
const batchCost = (model: string, tokens: number) => (tokens / 1e6) * ((RATE_PER_M[model] ?? 30.0) / 2);

async function submit(file: string): Promise<void> {
  const prompts = (await Bun.file(file).text())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (prompts.length === 0) {
    console.error(`nessun prompt in ${file} (una riga = un prompt, '#' per i commenti)`);
    process.exit(1);
  }
  // Il tetto e il conteggio vivevano nel worker, ma il batch chiama l'API da
  // solo: cinquanta prompt in high sono ~$5 che non comparivano da nessuna
  // parte e che nessun limite fermava. Qui si stima PRIMA di accodare, perche'
  // dopo il batch e' partito e si paga comunque.
  const tokAttesi = OPENAI_IMAGE_QUALITY === "low" ? 200 : OPENAI_IMAGE_QUALITY === "medium" ? 1100 : 7000;
  const stima = prompts.length * batchCost(OPENAI_IMAGE_MODEL, tokAttesi);
  const cap = openaiDailyCapUsd();
  if (cap > 0 && spesoOggi() + stima > cap) {
    console.error(
      `il batch costerebbe ~$${stima.toFixed(2)} e supererebbe il tetto giornaliero ` +
        `($${spesoOggi().toFixed(2)} gia' spesi, limite $${cap.toFixed(2)}).\n` +
        `Alza OPENAI_DAILY_CAP_USD, riduci i prompt, o usa OPENAI_IMAGE_QUALITY=low.`,
    );
    process.exit(1);
  }

  const jsonl = prompts
    .map((prompt, i) =>
      JSON.stringify({
        custom_id: `img_${String(i + 1).padStart(4, "0")}`,
        method: "POST",
        url: "/v1/images/generations",
        body: {
          model: OPENAI_IMAGE_MODEL,
          prompt,
          size: OPENAI_IMAGE_SIZE,
          quality: OPENAI_IMAGE_QUALITY,
        },
      }),
    )
    .join("\n");

  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), "batch.jsonl");
  const up: any = await (await fetch(`${API}/files`, { method: "POST", headers: auth, body: form })).json();
  if (!up.id) {
    console.error("upload fallito:", JSON.stringify(up).slice(0, 300));
    process.exit(1);
  }
  const b: any = await (
    await fetch(`${API}/batches`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        input_file_id: up.id,
        endpoint: "/v1/images/generations",
        completion_window: "24h",
      }),
    })
  ).json();
  if (!b.id) {
    console.error("batch non creato:", JSON.stringify(b).slice(0, 300));
    process.exit(1);
  }
  console.log(`batch ${b.id} — ${prompts.length} prompt, ${OPENAI_IMAGE_MODEL} ${OPENAI_IMAGE_QUALITY}`);
  console.log(`  stato:    bun run scripts/openai_batch.ts status ${b.id}`);
  console.log(`  raccogli: bun run scripts/openai_batch.ts fetch ${b.id}`);
}

async function getBatch(id: string): Promise<any> {
  return (await fetch(`${API}/batches/${id}`, { headers: auth })).json();
}

async function status(id: string): Promise<void> {
  const d = await getBatch(id);
  if (d.error || !d.status) {
    console.error("batch non trovato:", JSON.stringify(d).slice(0, 200));
    process.exit(1);
  }
  const c = d.request_counts ?? {};
  console.log(`${d.status} — ${c.completed ?? 0}/${c.total ?? 0} completate, ${c.failed ?? 0} fallite`);
  if (d.status === "completed") console.log(`pronto: fetch ${id}`);
}

async function fetchOut(id: string, outdir: string): Promise<void> {
  const d = await getBatch(id);
  if (d.status !== "completed") {
    console.error(`batch ${d.status}, non ancora pronto (${JSON.stringify(d.request_counts ?? {})})`);
    process.exit(1);
  }
  mkdirSync(outdir, { recursive: true });
  const body = await (await fetch(`${API}/files/${d.output_file_id}/content`, { headers: auth })).text();
  let tokens = 0;
  let saved = 0;
  const failures: string[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const rb = r.response?.body;
    const b64 = rb?.data?.[0]?.b64_json;
    // Una riga fallita nel mezzo non deve far perdere le altre.
    if (!b64) {
      failures.push(`${r.custom_id}: ${rb?.error?.message ?? r.error?.message ?? "senza immagine"}`);
      continue;
    }
    const bytes = Buffer.from(b64, "base64");
    const path = join(outdir, `${r.custom_id}.png`);
    await Bun.write(path, bytes);
    const tok = rb?.usage?.output_tokens ?? 0;
    tokens += tok;
    // Registrata alla raccolta, non alla sottomissione: qui i token sono quelli
    // veri, non una stima. Lo sconto 0.5 e' la tariffa batch.
    if (tok) registraChiamata(OPENAI_IMAGE_MODEL, tok, true, "batch", 0.5);
    saved++;
    console.log(`  ${r.custom_id}.png  ${Math.round(bytes.length / 1024)}KB`);
  }
  for (const f of failures) console.error(`  FALLITA ${f}`);
  console.log(
    `${saved} immagini in ${outdir} — ${tokens} token, $${batchCost(OPENAI_IMAGE_MODEL, tokens).toFixed(4)} ` +
      `(sync sarebbe $${(batchCost(OPENAI_IMAGE_MODEL, tokens) * 2).toFixed(4)})`,
  );
  if (failures.length) process.exit(1);
}

const [cmd, arg, arg2] = process.argv.slice(2);
if (cmd === "submit" && arg) await submit(arg);
else if (cmd === "status" && arg) await status(arg);
else if (cmd === "fetch" && arg) await fetchOut(arg, arg2 ?? `/tmp/openai_batch_${arg}`);
else {
  console.error(
    "uso:\n" +
      "  bun run scripts/openai_batch.ts submit <file-prompt>\n" +
      "  bun run scripts/openai_batch.ts status <batch_id>\n" +
      "  bun run scripts/openai_batch.ts fetch  <batch_id> [outdir]",
  );
  process.exit(1);
}
