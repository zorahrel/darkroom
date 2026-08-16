import { app } from "./app.ts";
import { finalDir, genDir, listProjects, rawDir } from "./project.ts";
import { startRunner } from "./jobs.ts";

/** Boot: start the job runner and serve the app (see app.ts for the routes). */

const PORT = Number(process.env.PORT ?? 3535);
// Bun senza `hostname` ascolta su 0.0.0.0: Darkroom non ha autenticazione,
// quindi su una rete condivisa (coworking, hotel) le foto e i controlli di
// generazione sarebbero di chiunque. Loopback di default; per l'accesso da
// telefono usa `tailscale serve` (cifrato e legato al tuo tailnet) oppure
// HOST=0.0.0.0 se sei consapevolmente su una rete fidata.
const HOST = process.env.HOST ?? "127.0.0.1";
startRunner();

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
