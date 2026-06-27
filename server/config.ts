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

export const DB_PATH = envPath("DARKROOM_DB") ?? join(ROOT, "photos.db");

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
/** Active edit/generate worker: "cdp" (ChatGPT-web, default, free) or "codex". */
export const WORKER_BACKEND = (process.env.WORKER_BACKEND ?? "cdp").toLowerCase();

/** Higgsfield is opt-in: enabled only when a token file exists or HIGGSFIELD_ENABLED=1. */
export const HIGGSFIELD_ENABLED =
  process.env.HIGGSFIELD_ENABLED === "1" ||
  existsSync(join(DATA_DIR, "higgsfield.json"));
