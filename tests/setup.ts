import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test isolation. `server/config.ts` reads its paths from the environment at
 * import time, so this preload must run before any server module is loaded
 * (wired via `[test] preload` in bunfig.toml).
 *
 * Every run gets a fresh temp root: the project registry, the SQLite DB and all
 * data dirs land there, so a test can never read — let alone write — the real
 * gallery (the Japan project lives in this same repo, one `cwd` away).
 */
const root = mkdtempSync(join(tmpdir(), "darkroom-test-"));

process.env.GALLERY_ROOT = root;
process.env.DARKROOM_REGISTRY = join(root, "projects.json");
process.env.DARKROOM_DB = join(root, "photos.db");
// Keep the optional provider off regardless of what the dev machine has.
process.env.HIGGSFIELD_ENABLED = "0";

export const TEST_ROOT = root;
