import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test isolation. `server/config.ts` reads its paths from the environment at
 * import time, so this preload must run before any server module is loaded
 * (wired via `[test] preload` in bunfig.toml).
 *
 * Every run gets a fresh temp root: the project registry, the SQLite DB, the
 * folder new projects are created in, and all data dirs land there — so a test
 * can never read, let alone write, anything real (the Japan project lives in
 * this same repo, one `cwd` away).
 */
const root = mkdtempSync(join(tmpdir(), "darkroom-test-"));

process.env.GALLERY_ROOT = root;
process.env.DARKROOM_REGISTRY = join(root, "projects.json");
process.env.DARKROOM_DB = join(root, "photos.db");
// Projects created by a test land here, never in the real ~/Darkroom/projects.
process.env.DARKROOM_PROJECTS_DIR = join(root, "projects");
// Keep the optional provider off regardless of what the dev machine has.
process.env.HIGGSFIELD_ENABLED = "0";

export const TEST_ROOT = root;
