import { app } from "./app.ts";
import { finalDir, genDir, listProjects, rawDir } from "./project.ts";
import { startRunner } from "./jobs.ts";
import { REPO_ROOT } from "./config.ts";
import { staleDistWarning } from "./distFreshness.ts";
import { realListeners, busyMessage, checkPort } from "./portGuard.ts";

/** Boot: start the job runner and serve the app (see app.ts for the routes). */

const PORT = Number(process.env.PORT ?? 3535);
// Bun senza `hostname` ascolta su 0.0.0.0: Darkroom non ha autenticazione,
// quindi su una rete condivisa (coworking, hotel) le foto e i controlli di
// generazione sarebbero di chiunque. Loopback di default; per l'accesso da
// telefono usa `tailscale serve` (cifrato e legato al tuo tailnet) oppure
// HOST=0.0.0.0 se sei consapevolmente su una rete fidata.
const HOST = process.env.HOST ?? "127.0.0.1";

// Chi arriva su una porta gia' servita e' l'intruso: si ferma qui, prima di
// avviare il job runner e di rubare traffico a un altro progetto. Vedi
// `portGuard.ts` per il guasto reale che questo controllo evita.
if (process.env.DARKROOM_PORT_FORCE !== "1") {
  const outcome = checkPort(PORT, { listeners: realListeners, ourPid: process.pid });
  if (outcome.state === "occupata") {
    console.error(busyMessage(PORT, outcome.occupants));
    process.exit(1);
  }
  if (outcome.state === "ignoto") {
    // Non blocca: un controllo che non sa non ha il diritto di fermare il boot.
    console.warn(`[porta] controllo saltato (${outcome.why}) — parto lo stesso.`);
  }
}

startRunner();
// I job di generazione video che un riavvio ha lasciato a meta' si riagganciano
// al loro prompt invece di restare "in corso" per sempre.
try { (await import("./comfy.ts")).riprendiInterrotti(); } catch { /* progetto senza video */ }

// Il client si ricostruisce da solo quando i sorgenti sono piu' recenti del
// build servito. Nove giorni di dashboard vecchia sono passati senza un
// segnale: un avviso nei log non basta, perche' nessuno li legge. Qui il
// problema si risolve invece di essere annunciato. Disattivabile con
// DARKROOM_NO_AUTOBUILD=1 (utile in dev, dove ci pensa Vite).
if (staleDistWarning(REPO_ROOT) && process.env.DARKROOM_NO_AUTOBUILD !== "1") {
  console.log("[dist] build del client non aggiornato — ricostruisco…");
  const t0 = Date.now();
  // `bunx` per nome non si trova sotto launchd: il servizio parte con un PATH
  // minimo, e `Bun.spawnSync` su un eseguibile inesistente NON torna un codice
  // diverso da zero — solleva, e il modulo muore prima di mettersi in ascolto.
  // Un server che non parte perche' non sa ricompilare la dashboard e' peggio
  // di uno che serve la dashboard vecchia dicendolo. Quindi: si usa la bun che
  // sta gia' girando (`bun x` e' bunx), e si prende la sollevazione.
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
    // Un build fallito non deve impedire al server di partire: la dashboard
    // vecchia e' meglio di nessuna dashboard. Ma va detto forte.
    console.error("[dist] BUILD FALLITO — la dashboard servita resta quella vecchia:");
    console.error(new TextDecoder().decode(proc.stderr).slice(-800));
  }
}
// Se resta vecchio (build fallito, o autobuild disattivato) lo si vede anche
// dalla dashboard: /api/pipeline/status espone stale_dist.
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
