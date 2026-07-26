import { app } from "./app.ts";
import { finalDir, genDir, listProjects, rawDir } from "./project.ts";
import { startRunner } from "./jobs.ts";

/** Boot: start the job runner and serve the app (see app.ts for the routes). */

const PORT = Number(process.env.PORT ?? 3535);
startRunner();

console.log(`Darkroom server listening on http://localhost:${PORT}`);
console.log(`  projects:    ${listProjects().map((p) => p.id).join(", ")}`);
console.log(`  RAW:         ${rawDir()}`);
console.log(`  generations: ${genDir()}`);
console.log(`  final:       ${finalDir()}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
