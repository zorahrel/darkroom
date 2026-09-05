import { app } from "./app.ts";
import { finalDir, genDir, listProjects, rawDir } from "./project.ts";
import { startRunner } from "./jobs.ts";
import { REPO_ROOT } from "./config.ts";
import { staleDistWarning } from "./distFreshness.ts";
import { realListeners, busyMessage, checkPort } from "./portGuard.ts";

/** Boot: start the job runner and serve the app (see app.ts for the routes). */

const PORT = Number(process.env.PORT ?? 3535);
// Bun without `hostname` listens on 0.0.0.0: Darkroom has no
// authentication, so on a shared network (coworking, hotel) the photos and the
// generation controls would be anybody's. Loopback by default; for access from
// a phone use `tailscale serve` (encrypted and tied to your tailnet) or
// HOST=0.0.0.0 if you are knowingly on a trusted network.
const HOST = process.env.HOST ?? "127.0.0.1";

// Whoever arrives on a port already served is the intruder: it stops here,
// before starting the job runner and stealing traffic from another project. See
// `portGuard.ts` for the real fault this check avoids.
if (process.env.DARKROOM_PORT_FORCE !== "1") {
  const outcome = checkPort(PORT, { listeners: realListeners, ourPid: process.pid });
  if (outcome.state === "busy") {
    console.error(busyMessage(PORT, outcome.occupants));
    process.exit(1);
  }
  if (outcome.state === "ignoto") {
    // It does not block: a check that cannot know has no right to stop the boot.
    console.warn(`[porta] controllo saltato (${outcome.why}) — parto lo stesso.`);
  }
}

startRunner();
// Video generation jobs left half-done by a restart re-attach to their prompt
// instead of staying "in progress" for ever.
try { (await import("./comfy.ts")).riprendiInterrotti(); } catch { /* progetto senza video */ }

// The client rebuilds itself when the sources are more recent than the build
// being served. Nine days of an old dashboard went by without a signal: a
// warning in the logs is not enough, because nobody reads them. Here the
// problem is solved instead of announced. Can be switched off with
// DARKROOM_NO_AUTOBUILD=1 (useful in dev, where Vite takes care of it).
if (staleDistWarning(REPO_ROOT) && process.env.DARKROOM_NO_AUTOBUILD !== "1") {
  console.log("[dist] build del client non aggiornato — ricostruisco…");
  const t0 = Date.now();
  // `bunx` by name is not found under launchd: the service starts with a
  // minimal PATH, and `Bun.spawnSync` on a non-existent executable does NOT
  // return a non-zero code — it throws, and the module dies before it starts
  // listening. A server that will not start because it cannot recompile the
  // dashboard is worse than one that serves the old dashboard and says so. So:
  // the bun already running is used (`bun x` is bunx), and the throw is
  // caught.
  let proc: { exitCode: number | null; stderr: Uint8Array } = { exitCode: 1, stderr: new Uint8Array() };
  try {
    proc = Bun.spawnSync([process.execPath, "x", "vite", "build", "--config", "client/vite.config.ts"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    }) as any;
  } catch (e) {
    proc = { exitCode: 1, stderr: new TextEncoder().encode(String(e)) };
  }
  if (proc.exitCode === 0) {
    console.log(`[dist] client ricostruito in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    // A failed build must not stop the server starting: the old dashboard is
    // better than no dashboard. But it has to be said loudly.
    console.error("[dist] BUILD FALLITO — la dashboard servita resta quella vecchia:");
    console.error(new TextDecoder().decode(proc.stderr).slice(-800));
  }
}
// If it stays old (failed build, or autobuild switched off) it is visible
// from the dashboard too: /api/pipeline/status exposes stale_dist.
const distWarn = staleDistWarning(REPO_ROOT);
if (distWarn) console.warn(distWarn);

console.log(`Darkroom server listening on http://${HOST}:${PORT}`);
console.log(`  projects:    ${listProjects().map((p) => p.id).join(", ")}`);
console.log(`  RAW:         ${rawDir()}`);
console.log(`  generations: ${genDir()}`);
console.log(`  final:       ${finalDir()}`);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};
