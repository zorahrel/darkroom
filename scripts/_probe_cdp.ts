import { withProject, dirsFor } from "../server/project.ts";
import { initSchema, db } from "../server/db.ts";
import { runWorker } from "../server/worker.ts";
import { join } from "node:path";
withProject("profilo", async () => {
  initSchema();
  const d = dirsFor("profilo");
  const p = db().query<{id:string;original_path:string},[]>("SELECT id, original_path FROM photos LIMIT 1").get()!;
  const ref = join(d.DATA_DIR, "refs", "style-bw-wet-hair-hardlight.png");
  const out = "/tmp/probe_cdp.png";
  console.log("provo il canale WEB (cdp) su", p.id);
  const r = await runWorker({
    image: p.original_path,
    prompt: "Edit this photo of me into a black and white editorial portrait matching the attached reference: hard directional key light, clean background, tight crop. Keep my face and identity exactly as in the source photo.",
    output: out,
    refs: [ref],
  });
  console.log(JSON.stringify(r).slice(0, 400));
});
