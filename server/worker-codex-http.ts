// Backend "codex-http": genera via l'endpoint che usa la CLI Codex, con il token
// OAuth della sottoscrizione ChatGPT.
//
// Perché esiste, accanto a `worker-codex.ts` e al worker CDP:
//   * il worker CDP legge il DOM di chatgpt.com. Il 24/08 un allegato nostro
//     (il riferimento cromatico) è finito scaricato al posto del render, 222 job
//     di fila. Qui non c'è DOM: l'immagine arriva in base64 nello stream.
//   * `worker-codex.ts` lancia il binario Codex e pesca il PNG più recente in
//     ~/.codex/generated_images, e i reference li IGNORA. Senza reference non
//     c'è coerenza fra una variante e l'altra, che è il motivo per cui i
//     reference esistono.
//
// Limite noto e misurato (24/08): il backend decide lui dimensione e qualità.
// Chiedendo 2048x2048/high ha risposto 1536x1024/low e 1254x1254/medium. Il
// modello è gpt-image 2.0 (verificato nel manifest C2PA firmato dentro il PNG),
// ma la qualità non è negoziabile da qui.
import { spawn } from "bun";
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkerResult } from "./worker.ts";

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const MODEL = process.env.CODEX_HTTP_MODEL ?? "gpt-5.5";
const TIMEOUT_MS = 6 * 60 * 1000;
/** Lato massimo degli allegati. Il payload è JSON: una foto da 12 MP in base64
 *  sono ~16 MB di richiesta, e il backend chiude la connessione. */
const MAX_EDGE = Number(process.env.CODEX_HTTP_MAX_EDGE ?? 1024);

function readToken(): { token: string; accountId?: string } {
  if (!existsSync(AUTH_PATH)) throw new Error(`~/.codex/auth.json assente: fai 'codex login'`);
  const j = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
  const t = j?.tokens?.access_token;
  if (!t) throw new Error("nessun access_token in ~/.codex/auth.json");
  return { token: t, accountId: j?.tokens?.account_id };
}

/** Ridimensiona in JPEG dentro tmp; ritorna il path da allegare. */
async function shrink(src: string): Promise<string> {
  const out = join(tmpdir(), `dk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
  const p = spawn({
    cmd: ["magick", src, "-auto-orient", "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "88", out],
    stdout: "pipe", stderr: "pipe",
  });
  if ((await p.exited) !== 0 || !existsSync(out)) return src; // meglio l'originale che niente
  return out;
}

async function dataUri(path: string): Promise<string> {
  const small = await shrink(path);
  const b64 = readFileSync(small).toString("base64");
  const mime = small.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

/** Correlazione strutturale via lo script python (numpy/Pillow ci sono gia').
 *  `null` quando non si puo' misurare: un controllo che rompe le generazioni
 *  buone e' peggio del problema che risolve. */
async function correlation(a: string, b: string): Promise<number | null> {
  try {
    const p = spawn({ cmd: ["python3", new URL("../scripts/img_corr.py", import.meta.url).pathname, a, b], stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(p.stdout).text()).trim();
    if ((await p.exited) !== 0) return null;
    const n = Number(out);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function runWorkerCodexHttp(input: {
  image?: string;
  prompt: string;
  output: string;
  refs?: string[];
}): Promise<WorkerResult> {
  const startedAt = Date.now();
  try {
    const { token, accountId } = readToken();
    const attachments: string[] = [];
    if (input.image) {
      if (!existsSync(input.image)) return { status: "error", error: `foto sorgente assente: ${input.image}` };
      attachments.push(await dataUri(input.image));
    }
    for (const r of input.refs ?? []) if (existsSync(r)) attachments.push(await dataUri(r));

    const content: Record<string, unknown>[] = attachments.map((u) => ({ type: "input_image", image_url: u }));
    content.push({ type: "input_text", text: input.prompt });

    const sid = crypto.randomUUID();
    const body = {
      model: MODEL,
      stream: true,
      instructions: "You are an image generation assistant.",
      input: [{ type: "message", role: "user", content }],
      tools: [{ type: "image_generation", output_format: "png" }],
      // Con allegati il tool DEVE scattare: senza, il modello risponde a parole
      // e il job muore per "nessuna immagine" dopo aver pagato l'upload.
      tool_choice: attachments.length ? "required" : "auto",
      parallel_tool_calls: false,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      text: { verbosity: "low" },
    };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
          version: "0.149.0",
          session_id: sid,
          "x-client-request-id": sid,
          originator: "codex_cli_rs",
          "User-Agent": "codex_cli_rs/0.149.0 (Mac OS 26.0.1; arm64)",
          ...(accountId ? { "chatgpt-account-id": accountId } : {}),
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      // 401/403 = token scaduto: è una condizione da dire chiaramente, non un
      // fallimento generico che manda la coda a ritentare per ore.
      const hint = res.status === 401 || res.status === 403 ? " (token scaduto: 'codex login')" : "";
      return { status: "error", error: `HTTP ${res.status}${hint}: ${txt}`, duration_s: (Date.now() - startedAt) / 1000 };
    }

    let b64: string | null = null;
    let refusal: string | null = null;
    let buf = "";
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break;
        let ev: any;
        try { ev = JSON.parse(payload); } catch { continue; }
        const t = ev?.type as string | undefined;
        if (t === "response.image_generation_call.partial_image" && typeof ev.partial_image_b64 === "string") {
          b64 = ev.partial_image_b64;
        } else if (t === "response.output_item.done" && ev.item?.type === "image_generation_call" && typeof ev.item?.result === "string") {
          b64 = ev.item.result;
        } else if (t === "response.output_item.done" && ev.item?.type === "message") {
          // Il modello ha risposto a parole: quasi sempre un rifiuto di policy.
          const txt = (ev.item.content ?? []).map((c: any) => c?.text ?? "").join(" ");
          if (txt && !b64) refusal = txt.slice(0, 200);
        } else if (t === "error" || t === "response.failed") {
          refusal = JSON.stringify(ev?.response?.error ?? ev)?.slice(0, 200) ?? null;
        }
      }
    }
    if (!b64) {
      return { status: "error", error: refusal ? `nessuna immagine: ${refusal}` : "nessuna immagine nello stream", duration_s: (Date.now() - startedAt) / 1000 };
    }
    mkdirSync(dirname(input.output), { recursive: true });
    writeFileSync(input.output, Buffer.from(b64, "base64"));

    // L'unico controllo che serve qui, e l'unico che si puo' fare senza
    // sbagliare: l'immagine tornata NON deve essere uno degli allegati. Il 24/08
    // il worker CDP ha scaricato per 222 volte il riferimento cromatico al posto
    // del render; quel modo di fallire e' reale e va chiuso anche qui.
    //
    // Quel che NON si controlla, di proposito: quanto il risultato somigli alla
    // sorgente. Le ricette cambiano inquadratura (ritaglio quadrato, crop
    // stretto), e su un ritaglio legittimo la correlazione scende a 0.03:
    // un cancello su quel numero boccerebbe il lavoro giusto.
    const attachedFiles = [input.image, ...(input.refs ?? [])].filter((f): f is string => !!f && existsSync(f));
    for (const f of attachedFiles) {
      const c = await correlation(f, input.output);
      if (c !== null && c > 0.9) {
        const which = f === input.image ? "la foto di partenza, non modificata" : `l'allegato ${f.split("/").pop()}`;
        return {
          status: "error",
          error: `ha restituito ${which} (correlazione ${c.toFixed(2)})`,
          duration_s: (Date.now() - startedAt) / 1000,
        };
      }
    }
    const size_kb = Math.round(statSync(input.output).size / 1024);
    return { status: "ok", output: input.output, duration_s: (Date.now() - startedAt) / 1000, size_kb };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      duration_s: (Date.now() - startedAt) / 1000,
    };
  }
}
