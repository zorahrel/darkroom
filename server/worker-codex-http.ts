// The "codex-http" backend: generates via the endpoint the Codex CLI uses,
// with the OAuth token of the ChatGPT subscription.
//
// Why it exists, alongside `worker-codex.ts` and the CDP worker:
//   * the CDP worker reads chatgpt.com's DOM. On 24/08 an attachment of ours
//     (the colour reference) ended up downloaded instead of the render, 222
//     jobs in a row. Here there is no DOM: the image arrives base64 in the
//     stream.
//   * `worker-codex.ts` launches the Codex binary and fishes the most recent
//     PNG out of ~/.codex/generated_images, and it IGNORES the references.
//     Without references there is no coherence between one variant and the
//     next, which is the reason references exist.
//
// Known and measured limit (24/08): the backend decides size and quality
// itself. Asked for 2048x2048/high it answered 1536x1024/low and
// 1254x1254/medium. The model is gpt-image 2.0 (verified in the signed C2PA
// manifest inside the PNG), but the quality is not negotiable from here.
import { spawn } from "bun";
import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkerResult } from "./worker.ts";

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const MODEL = process.env.CODEX_HTTP_MODEL ?? "gpt-5.5";
const TIMEOUT_MS = 6 * 60 * 1000;
/** Maximum side of the attachments. The payload is JSON: a 12 MP photo in
 *  base64 is ~16 MB of request, and the backend closes the connection. */
const MAX_EDGE = Number(process.env.CODEX_HTTP_MAX_EDGE ?? 1024);

function readToken(): { token: string; accountId?: string } {
  if (!existsSync(AUTH_PATH)) throw new Error(`~/.codex/auth.json assente: fai 'codex login'`);
  const j = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
  const t = j?.tokens?.access_token;
  if (!t) throw new Error("nessun access_token in ~/.codex/auth.json");
  return { token: t, accountId: j?.tokens?.account_id };
}

/** Resizes to JPEG inside tmp; returns the path to attach. */
async function shrink(src: string): Promise<string> {
  const out = join(tmpdir(), `dk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
  const p = spawn({
    cmd: ["magick", src, "-auto-orient", "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "88", out],
    stdout: "pipe", stderr: "pipe",
  });
  if ((await p.exited) !== 0 || !existsSync(out)) return src; // better the original than nothing
  return out;
}

async function dataUri(path: string): Promise<string> {
  const small = await shrink(path);
  const b64 = readFileSync(small).toString("base64");
  const mime = small.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

/** Structural correlation via the python script (numpy/Pillow are already
 *  there). `null` when it cannot be measured: a check that breaks good
 *  generations is worse than the problem it solves. */
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
  /** Several source photos attached to the same request (GEN-01). A source is
   *  material the result comes out of; a reference is a target to resemble.
   *  Three portraits of the same person as simultaneous input are the first
   *  case, and treating them as references would tell the model to copy their
   *  look instead of using them as material. */
  images?: string[];
  prompt: string;
  output: string;
  refs?: string[];
}): Promise<WorkerResult> {
  const startedAt = Date.now();
  try {
    const { token, accountId } = readToken();
    const sources = input.images?.length ? input.images : input.image ? [input.image] : [];
    const attachments: string[] = [];
    for (const src of sources) {
      if (!existsSync(src)) return { status: "error", error: `foto sorgente assente: ${src}` };
      attachments.push(await dataUri(src));
    }
    for (const r of input.refs ?? []) if (existsSync(r)) attachments.push(await dataUri(r));

    // Declared limit: the payload is JSON, and six base64 images are already
    // several MB. Better a readable error than a connection closed halfway.
    if (attachments.length > 6) {
      return { status: "error", error: `troppi allegati: ${attachments.length} (massimo 6)`, duration_s: 0 };
    }
    const content: Record<string, unknown>[] = attachments.map((u) => ({ type: "input_image", image_url: u }));
    content.push({ type: "input_text", text: input.prompt });

    const sid = crypto.randomUUID();
    const body = {
      model: MODEL,
      stream: true,
      instructions: "You are an image generation assistant.",
      input: [{ type: "message", role: "user", content }],
      tools: [{ type: "image_generation", output_format: "png" }],
      // With attachments the tool MUST fire: without it the model answers in
      // words and the job dies for "no image" after paying for the upload.
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
      // 401/403 = expired token: it is a condition to state plainly, not a
      // generic failure that sends the queue retrying for hours.
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
          // The model answered in words: almost always a policy refusal.
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

    // The only check needed here, and the only one that can be made without
    // getting it wrong: the image returned must NOT be one of the attachments.
    // On 24/08 the CDP worker downloaded the colour reference instead of the
    // render 222 times; that way of failing is real and is closed here too.
    //
    // What is deliberately NOT checked: how much the result resembles the
    // source. The recipes change the framing (square crop, tight crop), and on
    // a legitimate crop the correlation drops to 0.03: a gate on that number
    // would fail the right work.
    const attachedFiles = [...sources, ...(input.refs ?? [])].filter((f) => existsSync(f));
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
