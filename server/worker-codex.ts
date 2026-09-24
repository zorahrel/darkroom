import { spawn } from "bun";
import { existsSync, statSync, copyFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkerResult } from "./worker.ts";

/**
 * Dove sta `codex`, cercato invece che assunto.
 *
 * Il default era il solo bundle dell'app. Su questa macchina Codex e' installato
 * da Homebrew (`/opt/homebrew/bin/codex`, `codex-cli 0.153.4`) e il bundle non
 * esiste: il backend moriva con `codex binary not found at /Applications/...`,
 * cioe' un errore che accusa Codex di non esserci mentre e' sul PATH. Si prova
 * il primo percorso che esiste davvero; l'ultimo resta il nome nudo, cosi' su
 * una macchina che lo ha altrove l'errore arriva da `spawn` con il PATH vero
 * invece che da un controllo su un percorso inventato.
 */
const CODEX_BIN =
  process.env.CODEX_BIN ??
  [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
  ].find((p) => existsSync(p)) ??
  "codex";
const GENERATED_DIR = join(homedir(), ".codex", "generated_images");

/**
 * Il modello si fissa qui, non si eredita da `~/.codex/config.toml`.
 * Il 23/09 il default globale e' diventato `gpt-6-sol`, che con un account
 * ChatGPT Codex rifiuta (400 «model is not supported»): due lavori sono
 * falliti al primo secondo. `gpt-5.6-sol` e' quello su cui giravano le
 * passate riuscite. `CODEX_MODEL` lo cambia senza toccare il codice.
 */
const CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-5.6-sol";
const WORKER_TIMEOUT_MS = 6 * 60 * 1000; // 6 min, matches CDP worker

// Newest *.png anywhere under ~/.codex/generated_images (mtime), or null.
function newestGenerated(sinceMs: number): string | null {
  if (!existsSync(GENERATED_DIR)) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const sub of readdirSync(GENERATED_DIR, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const dir = join(GENERATED_DIR, sub.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".png")) continue;
      const p = join(dir, f);
      const m = statSync(p).mtimeMs;
      if (m >= sinceMs && (!best || m > best.mtime)) best = { path: p, mtime: m };
    }
  }
  return best?.path ?? null;
}

export async function runWorkerCodex(input: {
  image: string;
  prompt: string;
  output: string;
  /** Accepted for interface parity with the CDP worker; the Codex backend
   *  drives a single image per call, so extra references are ignored. */
  refs?: string[];
}): Promise<WorkerResult> {
  if (!existsSync(CODEX_BIN)) {
    return { status: "error", error: `codex binary not found at ${CODEX_BIN}` };
  }
  if (!existsSync(input.image)) {
    return { status: "error", error: `source image not found: ${input.image}` };
  }
  const startedAt = Date.now();

  // The prompt is fed via stdin (codex's -i flag is variadic and would otherwise
  // swallow a positional prompt as another image). We instruct codex to use the
  // built-in $imagegen to EDIT the attached photo and save straight to output,
  // forbidding heavy agentic post-processing to keep latency down.
  const fullPrompt =
    `$imagegen ${input.prompt}\n\n` +
    `Usa la foto allegata come base. Salva l'immagine editata in '${input.output}'. ` +
    `Non fare resize inutili. Come ultimissima riga stampa SOLO il path assoluto del PNG salvato.`;

  const proc = spawn({
    cmd: [
      CODEX_BIN,
      "exec",
      "--skip-git-repo-check",
      "-s",
      "workspace-write",
      "-c",
      "approval_policy=never",
      "-m",
      CODEX_MODEL,
      "-i",
      input.image,
    ],
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(fullPrompt);
  await proc.stdin.end();

  const timeoutHandle = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }, WORKER_TIMEOUT_MS);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timeoutHandle);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      return {
        status: "error",
        error: `codex exited ${exitCode}: ${truncate(stderr || stdout)}`,
        duration_s: (Date.now() - startedAt) / 1000,
      };
    }

    // Resolve the produced file: prefer output, else codex-reported path, else
    // newest file in generated_images created during this run.
    let produced = "";
    if (existsSync(input.output)) {
      produced = input.output;
    } else {
      const reported = (stdout.match(/\/[^\s'"]+\.png/g) ?? []).pop();
      if (reported && existsSync(reported)) produced = reported;
      else {
        const newest = newestGenerated(startedAt - 2000);
        if (newest) produced = newest;
      }
    }

    if (!produced) {
      return {
        status: "error",
        error: `no output image produced. stdout tail: ${truncate(stdout)}`,
        duration_s: (Date.now() - startedAt) / 1000,
      };
    }
    if (produced !== input.output) copyFileSync(produced, input.output);

    const size_kb = Math.round(statSize(input.output) / 1024);
    return {
      status: "ok",
      output: input.output,
      duration_s: (Date.now() - startedAt) / 1000,
      size_kb,
    };
  } catch (err) {
    clearTimeout(timeoutHandle);
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      duration_s: (Date.now() - startedAt) / 1000,
    };
  }
}

function statSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

function truncate(s: string, max = 500): string {
  return s.length <= max ? s : s.slice(-max);
}
