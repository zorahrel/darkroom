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

/** Lock del RUNNER: identifica quale processo lavora la coda di questo DB.
 *  Distinto da WORKER_LOCK (che serializza il browser fra job): qui si tratta
 *  di impedire che DUE server aprano due code sulla stessa installazione. */
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

/** Solo il backend "cdp" guida un browser. Gli altri non hanno una finestra da
 *  sorvegliare, e chiederglielo faceva partire Chrome senza motivo: il guard
 *  escludeva per nome il solo "codex", quindi "codex-http" e "openai" cadevano
 *  nel ramo del browser. */
export const BACKEND_USES_BROWSER = WORKER_BACKEND === "cdp";

/** Modello e resa del backend OpenAI. `gpt-image-2` in `high` è il motivo per
 *  cui questo backend esiste: è l'unico che rende leggibile il testo dentro
 *  l'immagine. Si abbassa a `low` per le prove, dove costa ~20x di meno. */
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
export const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? "high";
export const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";

/** Chiave OpenAI dal Keychain, mai da un file in chiaro (stessa convenzione di
 *  `scripts/imagerouter_check.ts`; il .env del progetto è world-readable).
 *  OPENAI_API_KEY nell'ambiente vince, per CI e test.
 *
 *  Letta una volta sola: `security` costa ~50ms e un job loop la chiederebbe
 *  a ogni generazione. `null` significa "cercata e non trovata". */
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
