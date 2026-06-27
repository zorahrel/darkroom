import { spawn } from "bun";
import { existsSync, closeSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import {
  PYTHON_SCRIPT,
  CHATGPT_CDP_PORT,
  CHATGPT_CDP_URL,
  CHROME_PROFILE,
  WORKER_LOCK,
  resolveChromeBin,
} from "./config.ts";

export { CHATGPT_CDP_PORT, CHATGPT_CDP_URL };

const WORKER_TIMEOUT_MS = 11 * 60 * 1000; // 11 min/gen — image edits under load are slow (GEN_TIMEOUT_S=540 + overhead)

export type WorkerResult =
  | { status: "ok"; output: string; duration_s: number; size_kb: number }
  | { status: "error"; error: string; duration_s?: number };

// Cross-process mutex on the shared ChatGPT browser. The DB job runner and any
// external driver (e.g. scripts/gen_previews.ts) both go through runWorker but
// share one ChatGPT tab — two drivers at once cross-contaminate results (a job
// downloads another job's image). This serialises every browser session.
const LOCK_STALE_MS = WORKER_TIMEOUT_MS + 60 * 1000; // > one full session

async function acquireBrowserLock(timeoutMs = 30 * 60 * 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(WORKER_LOCK, "wx"); // exclusive create — fails if held
      writeSync(fd, `${process.pid} ${Date.now()}`);
      closeSync(fd);
      return;
    } catch {
      // Held by someone else; steal it if it went stale (holder died mid-session).
      try {
        if (Date.now() - statSync(WORKER_LOCK).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(WORKER_LOCK);
          continue;
        }
      } catch {
        continue; // lock vanished between checks — retry create
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error("timed out waiting for ChatGPT browser lock");
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function releaseBrowserLock(): void {
  try {
    unlinkSync(WORKER_LOCK);
  } catch {}
}

export async function runWorker(input: {
  image: string;
  prompt: string;
  output: string;
}): Promise<WorkerResult> {
  await acquireBrowserLock();
  try {
    return await runWorkerLocked(input);
  } finally {
    releaseBrowserLock();
  }
}

/** Text-to-image: no source photo. Reuses the same ChatGPT-web pipeline,
 *  skipping the upload step (driven by edit_batch.py --generate). */
export async function runWorkerGenerate(input: {
  prompt: string;
  output: string;
}): Promise<WorkerResult> {
  await acquireBrowserLock();
  try {
    return await runWorkerLocked({ prompt: input.prompt, output: input.output });
  } finally {
    releaseBrowserLock();
  }
}

async function runWorkerLocked(input: {
  image?: string;
  prompt: string;
  output: string;
}): Promise<WorkerResult> {
  const cmd = input.image
    ? [
        "python3",
        PYTHON_SCRIPT,
        "--single-shot",
        "--image",
        input.image,
        "--output",
        input.output,
        "--prompt-stdin",
      ]
    : [
        "python3",
        PYTHON_SCRIPT,
        "--generate",
        "--output",
        input.output,
        "--prompt-stdin",
      ];
  const proc = spawn({
    cmd,
    env: { ...process.env, CHATGPT_CDP_URL },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Feed prompt via stdin (Bun FileSink: write + end, not Web Streams API)
  proc.stdin.write(input.prompt);
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

    // Last JSON line on stdout is the worker result
    const lastLine = stdout
      .trim()
      .split("\n")
      .reverse()
      .find((l) => l.trim().startsWith("{"));

    if (!lastLine) {
      return {
        status: "error",
        error: `worker exited ${exitCode} without JSON output. stderr: ${truncate(stderr)}`,
      };
    }

    try {
      return JSON.parse(lastLine) as WorkerResult;
    } catch {
      return {
        status: "error",
        error: `invalid JSON from worker: ${truncate(lastLine)}`,
      };
    }
  } catch (err) {
    clearTimeout(timeoutHandle);
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function truncate(s: string, max = 500): string {
  if (s.length <= max) return s;
  return s.slice(-max);
}

/** Open a CDP page target and confirm its renderer answers a trivial eval.
 *  Catches the failure mode where Chrome's HTTP endpoint is up but the page
 *  renderer is hung — /json/version still 200s while every JS eval times out. */
async function pageResponds(wsUrl: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1+1", returnByValue: true } }));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (msg.id === 1) {
          clearTimeout(timer);
          finish(msg?.result?.result?.value === 2);
        }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); finish(false); };
  });
}

export async function checkChatgptBrowserAlive(): Promise<boolean> {
  let pages: Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  try {
    const res = await fetch(`${CHATGPT_CDP_URL}/json`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    pages = (await res.json()) as typeof pages;
  } catch {
    return false;
  }
  // Endpoint is up; now require a page renderer that actually responds.
  const page = pages.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) return false;
  return pageResponds(page.webSocketDebuggerUrl);
}

/** Hard kill of the CDP Chrome (used when the renderer is hung — a soft
 *  relaunch can't recover a wedged page and would just race the dead process). */
export async function killChatgptBrowser(): Promise<void> {
  try {
    spawn({ cmd: ["pkill", "-f", `remote-debugging-port=${CHATGPT_CDP_PORT}`], stdout: "ignore", stderr: "ignore" });
  } catch {}
  await new Promise((r) => setTimeout(r, 2500));
}

/** Kill + relaunch. Returns ok once the page renderer responds again. */
export async function restartChatgptBrowser(): Promise<{ ok: boolean; error?: string }> {
  await killChatgptBrowser();
  return launchChatgptBrowser();
}

export async function launchChatgptBrowser(): Promise<{ ok: boolean; error?: string }> {
  if (await checkChatgptBrowserAlive()) return { ok: true };
  const chromeBin = resolveChromeBin();
  if (!chromeBin || !existsSync(chromeBin)) {
    return {
      ok: false,
      error: chromeBin
        ? `Chrome not found at ${chromeBin}`
        : "No Chrome/Chromium found. Set CHROME_BIN to its path.",
    };
  }
  spawn({
    cmd: [
      chromeBin,
      `--user-data-dir=${CHROME_PROFILE}`,
      `--remote-debugging-port=${CHATGPT_CDP_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://chatgpt.com/",
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await checkChatgptBrowserAlive()) return { ok: true };
  }
  return { ok: false, error: "Chrome did not expose CDP within 15s" };
}
