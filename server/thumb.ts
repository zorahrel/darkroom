import { spawn } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./db.ts";

const CACHE_ROOT = join(ROOT, "dashboard", ".cache", "thumbs");

/**
 * Generate a thumbnail (max dim) using macOS sips, cached on disk.
 * Returns the absolute thumbnail path.
 */
export async function thumbnailPath(
  source: string,
  maxDim = 480,
): Promise<string> {
  if (!existsSync(source)) throw new Error(`source missing: ${source}`);

  // Cache key: <maxDim>/<inode-mtime-name>.jpg
  const st = statSync(source);
  const safe = source.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cachePath = join(
    CACHE_ROOT,
    String(maxDim),
    `${st.size}_${Math.floor(st.mtimeMs)}_${safe}.jpg`,
  );

  if (existsSync(cachePath)) return cachePath;

  mkdirSync(dirname(cachePath), { recursive: true });

  const proc = spawn({
    cmd: [
      "sips",
      "-Z", String(maxDim),
      "-s", "format", "jpeg",
      "-s", "formatOptions", "high",
      source, "--out", cachePath,
    ],
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`sips failed (${code}): ${err}`);
  }
  return cachePath;
}
