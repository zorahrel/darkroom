import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

/**
 * Central configuration for Darkroom. Everything personal/host-specific is
 * resolved from environment variables with sensible defaults, so the same code
 * runs on any machine. Copy `.env.example` → `.env` (or export the vars) to
 * override.
 */

function envPath(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? resolve(v.trim()) : undefined;
}

/** Where Darkroom keeps its gallery data and SQLite DB. */
export const ROOT = envPath("GALLERY_ROOT") ?? join(homedir(), "Darkroom");

/** The repository root (one level up from /server), used to locate bundled scripts. */
export const REPO_ROOT = resolve(import.meta.dir, "..");

export const DATA_DIR = envPath("GALLERY_DATA_DIR") ?? join(ROOT, "data");
/** Source/original images to import (immutable). */
export const RAW_DIR = envPath("GALLERY_RAW_DIR") ?? join(DATA_DIR, "RAW");
/** Pre-existing renders to reconcile as "orphans" (optional feature). */
export const TEST1_DIR = envPath("GALLERY_IMPORT_DIR") ?? join(DATA_DIR, "TEST1");
/** Worker output, one sub-dir per photo. */
export const GEN_DIR = envPath("GALLERY_GEN_DIR") ?? join(DATA_DIR, "generations");
/** Exported favorites. */
export const FINAL_DIR = envPath("GALLERY_FINAL_DIR") ?? join(DATA_DIR, "final");
/** Uploads scratch dir (resized inputs, oriented images). */
export const UPLOADS_DIR = join(DATA_DIR, "uploads");
/** Directory scanned (recursively) for .cube LUT files used by the local color
 *  grade. Drop your own LUTs here; none ship with Darkroom. */
export const LUT_DIR = envPath("GALLERY_LUT_DIR") ?? join(DATA_DIR, "luts");
/** On-disk cache for graded renders (keyed by source + grade params + width). */
export const GRADED_DIR = envPath("GALLERY_GRADED_DIR") ?? join(DATA_DIR, "graded");

export const DB_PATH = envPath("DARKROOM_DB") ?? join(ROOT, "photos.db");

/** Where Darkroom puts projects it creates itself, one folder per project.
 *  Deliberately not under ROOT: ROOT is one gallery's data (and on some setups
 *  it IS a repo checkout), while this is the shelf every new project lands on. */
export const PROJECTS_DIR =
  envPath("DARKROOM_PROJECTS_DIR") ?? join(homedir(), "Darkroom", "projects");

// --- Server ---------------------------------------------------------------
export const PORT = Number(process.env.PORT ?? 3535);

// --- ChatGPT-web (CDP) backend -------------------------------------------
export const CHATGPT_CDP_PORT = Number(process.env.CHATGPT_CDP_PORT ?? 19223);
export const CHATGPT_CDP_URL =
  process.env.CHATGPT_CDP_URL ?? `http://127.0.0.1:${CHATGPT_CDP_PORT}`;

/** Persistent Chrome profile dir for the dedicated ChatGPT browser. */
export const CHROME_PROFILE =
  envPath("DARKROOM_CHROME_PROFILE") ??
  join(homedir(), ".cache", "darkroom", "chatgpt-profile");

/** Cross-process lock so only one driver talks to the shared ChatGPT tab. */
export const WORKER_LOCK =
  envPath("DARKROOM_WORKER_LOCK") ??
  join(homedir(), ".cache", "darkroom", "chatgpt-worker.lock");

/** The RUNNER's lock: it identifies which process works this DB's queue.
 *  Distinct from WORKER_LOCK (which serialises the browser between jobs): here
 *  it is about stopping TWO servers opening two queues on the same
 *  installation. */
export const RUNNER_LOCK =
  envPath("DARKROOM_RUNNER_LOCK") ??
  join(homedir(), ".cache", "darkroom", "runner.lock");

/** Bundled Python worker that drives ChatGPT-web over CDP. */
export const PYTHON_SCRIPT = join(REPO_ROOT, "scripts", "edit_batch.py");

/** Locate a Chrome/Chromium binary across platforms (override with CHROME_BIN). */
export function resolveChromeBin(): string | null {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates =
    platform() === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : platform() === "win32"
        ? [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
          ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// --- Providers ------------------------------------------------------------
/** Active edit/generate worker: "cdp" (ChatGPT-web, default, free), "codex",
 *  "codex-http" or "openai". */
export const WORKER_BACKEND = (process.env.WORKER_BACKEND ?? "cdp").toLowerCase();

/** Only the "cdp" backend drives a browser. The others have no window to
 *  watch, and asking them to made Chrome start for no reason: the guard
 *  excluded only "codex" by name, so "codex-http" and "openai" fell into the
 *  browser branch. */
export const BACKEND_USES_BROWSER = WORKER_BACKEND === "cdp";

/** Model and quality of the OpenAI backend. `gpt-image-2` at `high` is why
 *  this backend exists: it is the only one that makes text inside the image
 *  readable. It is dropped to `low` for trials, where it costs ~20x less. */
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
export const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? "high";
export const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";

/** Daily spend cap in dollars, beyond which the paid backend stops
 *  generating.
 *
 *  The real limit sits on the OpenAI account, but it cannot be set from here
 *  (`/v1/organization/*` answers 403 with a project key) and in any case
 *  arrives as an alert AFTER the money is spent. This one applies before the
 *  call, on the `api_calls` rows of the last 24h: it is the only brake Darkroom
 *  can pull by itself.
 *
 *  On 26/08 a day of calibration produced 21 calls with nobody counting: they
 *  were not too many, but nobody knew that while it was happening. */
export function openaiDailyCapUsd(): number {
  return Number(process.env.OPENAI_DAILY_CAP_USD ?? "5");
}

/** Above this spend in one session, the sync worker refuses to generate and
 *  defers to the batch, which costs half.
 *
 *  The batch already existed and nobody used it: 25 calls out of 25 made
 *  synchronously, $2.81 where $1.40 would have done. Another option was not
 *  needed, what was needed was for the expensive road to stop being the
 *  comfortable one. Zero disables the brake. */
export function openaiSyncBudgetUsd(): number {
  return Number(process.env.OPENAI_SYNC_BUDGET_USD ?? "0.5");
}

/** OpenAI key from the Keychain, never from a plaintext file (same convention
 *  as `scripts/imagerouter_check.ts`; the project's .env is world-readable).
 *  OPENAI_API_KEY in the environment wins, for CI and tests.
 *
 *  Read once only: `security` costs ~50ms and a job loop would ask for it on
 *  every generation. `null` means "looked for and not found". */
let openaiKeyCache: string | null | undefined;
export function openaiKey(): string | null {
  if (openaiKeyCache !== undefined) return openaiKeyCache;
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return (openaiKeyCache = fromEnv);
  try {
    const out = Bun.spawnSync([
      "security",
      "find-generic-password",
      "-s",
      "openai",
      "-a",
      "darkroom",
      "-w",
    ]);
    const key = out.exitCode === 0 ? new TextDecoder().decode(out.stdout).trim() : "";
    return (openaiKeyCache = key || null);
  } catch {
    return (openaiKeyCache = null);
  }
}

/** Higgsfield is opt-in: enabled only when a token file exists or HIGGSFIELD_ENABLED=1. */
export const HIGGSFIELD_ENABLED =
  process.env.HIGGSFIELD_ENABLED === "1" ||
  existsSync(join(DATA_DIR, "higgsfield.json"));

/** ffmpeg for the color-grade LUT step (override with FFMPEG). Resolved to an
 *  absolute path so the grade works under a minimal launchd PATH. */
export const FFMPEG_BIN =
  process.env.FFMPEG ??
  ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) =>
    existsSync(p),
  ) ??
  "ffmpeg";

// --- The remote render box (optional) --------------------------------------
/**
 * The machine with the GPU, when there is one.
 *
 * These used to be constants typed into `comfy.ts` and `video.ts`: the login
 * and the address of ONE machine — a piece of the author's home wired into a
 * program that lives on GitHub. Anyone else cloning the repo got code that
 * tries to ssh into a stranger's private address. They are environment
 * variables now: without them shot generation stays off and Darkroom says so
 * instead of trying.
 */
export const COMFY_HOST = process.env.COMFY_HOST ?? "";
/** `user@host` of the machine that renders the frames. Empty = none. */
export const RENDER_SSH = process.env.RENDER_SSH ?? "";
/**
 * The working directories ON that machine (its paths, not this one's).
 *
 * No default: a path only its owner could guess is worse than an empty one,
 * because it fails deep inside an ssh call instead of at the gate. Empty is
 * what `renderConfigured()` reads to keep the feature off.
 */
export const RENDER_DIR = process.env.RENDER_DIR ?? "";
export const RENDER_OUT_DIR = process.env.RENDER_OUT_DIR ?? "";
/** The bash used to run the scripts over there (Git for Windows, usually). */
export const RENDER_BASH = process.env.RENDER_BASH ?? "C:\\Program Files\\Git\\bin\\bash.exe";

/** Every piece the remote render needs, or the feature cannot run at all. */
export const renderConfigured = (): boolean =>
  Boolean(RENDER_SSH && RENDER_DIR && RENDER_OUT_DIR);

/**
 * The music the edit is cut to, when the project has one.
 *
 * It used to be one filename, in one person's project. The waveform under the
 * timeline therefore only ever drew for them; for everybody else the panel was
 * empty with no explanation. Now: this variable if set, otherwise the first
 * audio file sitting next to the project folder.
 */
export const VIDEO_AUDIO = process.env.VIDEO_AUDIO ?? "";

/**
 * The assembled master the quality bar is measured on.
 *
 * Same defect the music had, and it survived that fix: the filename of one
 * person's edit was written into the code in three places, so the bar looked
 * for a file nobody else would ever have and reported "unknown" forever,
 * without saying why. The default is a neutral name; a project that calls its
 * master something else sets this.
 */
export const VIDEO_MASTER = process.env.VIDEO_MASTER ?? "MASTER.mp4";

/**
 * Moondream's CLI for the checks that look at the image.
 *
 * A function, not a constant: the tests replace the binary with a fake on every
 * case, and a constant read at import would have made them all talk to the
 * machine's real Moondream — which is slow and which, above all, really
 * answers, i.e. proves nothing any more.
 */
export function moondreamBin(): string {
  return process.env.MOONDREAM_BIN ?? "moondream";
}
