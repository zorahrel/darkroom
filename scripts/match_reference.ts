/**
 * Calibra luce e inquadratura contro una reference, invece di descriverle a
 * parole e sperare. Il prompt e' stato riscritto tre volte a mano ottenendo
 * -3.4, poi -43.3, contro il -23.1 del target: il parametro risponde, ma "hard
 * light from the side" non dice al modello QUANTO. Qui la distanza si misura e
 * il giro successivo corregge nella direzione giusta.
 *
 * Uso: bun run scripts/match_reference.ts <reference.png> [giri]
 */
import { runWorkerOpenAi } from "../server/worker-openai.ts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REF = process.argv[2] ?? join(process.env.DARKROOM_DATA ?? "data", "refs", "riferimento.png");
const GIRI = Number(process.argv[3] ?? 3);
// La cartella dati del progetto su cui si calibra: si passa da fuori, perché
// il percorso di casa di chi ha scritto lo script non è un default.
const DATA = process.env.DARKROOM_DATA ?? "data";

type Metriche = { luce: number; soggetto: number; p5: number; p95: number; neri: number };

/** Le metriche si leggono dai pixel: un VLM descriveva come "hard light from
 *  the side" sia il target sia una resa piatta a -3.4. */
function misura(file: string): Metriche {
  const py = `
from PIL import Image
import numpy as np, json
a=np.asarray(Image.open(${JSON.stringify(file)}).convert("L").resize((256,256)),dtype=float)
sog=(a<200)
print(json.dumps({
 "luce": round(float(a[:,128:].mean()-a[:,:128].mean()),1),
 "soggetto": round(float(sog.mean()),3),
 "p5": int(np.percentile(a,5)), "p95": int(np.percentile(a,95)),
 "neri": round(float((a<30).mean()*100),1)}))`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`misura fallita: ${r.stderr?.slice(0, 200)}`);
  return JSON.parse(r.stdout) as Metriche;
}

/** Le correzioni sono in inglese e descrivono la GEOMETRIA, non l'atmosfera:
 *  gradi, direzione, presenza o assenza di fill. */
function correzioni(t: Metriche, c: Metriche): string[] {
  const out: string[] = [];
  const dLuce = c.luce - t.luce;
  if (Math.abs(dLuce) > 6) {
    out.push(
      dLuce < 0
        ? `The key light is TOO extreme and the shadow side too dark. Move the key light closer to the camera axis (about 40 degrees off-axis instead of 90) and add a soft fill on the shadow side so the dark side of the face keeps visible detail.`
        : `The lighting is TOO FLAT. Move the key light further to the side (about 70 degrees off-axis, camera right, above eye level) and remove any fill, so the far side of the face falls into clear shadow.`,
    );
  }
  const dSog = c.soggetto - t.soggetto;
  if (Math.abs(dSog) > 0.05) {
    out.push(
      dSog < 0
        ? `The subject is TOO SMALL in the frame. Crop tighter: the head must fill the frame top to bottom, top of the head touching the upper edge, shoulders filling the bottom corners.`
        : `The subject is TOO LARGE / too tightly cropped. Pull back slightly so the full head and both shoulders fit inside the frame.`,
    );
  }
  if (c.p95 < t.p95 - 20) out.push(`The background must be clean bright white, not grey.`);
  if (c.neri < t.neri - 5) out.push(`Deepen the blacks: the shadow side and background corners should reach true black.`);
  return out;
}

const BASE = `The attached photographs are all of ME, the same person. Take my face and identity from them. The LAST attached image is the STYLE TARGET.

Reproduce a black and white editorial portrait: square frame, head-and-shoulders, head tilted slightly down and turned slightly to my right, gaze just off camera. Wet slicked-back hair with visible strands. Clean white background. Sharp skin texture, visible pores and stubble, no beauty smoothing, no makeup look.

Key light: a single hard source, camera right, above eye level, roughly 60 degrees off the camera axis, so the far side of the face carries a clear shadow while keeping detail.

Keep my face, bone structure and identity exactly as in the source photographs.`;

const refs = [
  `${DATA}/RAW/56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG`,
  `${DATA}/RAW/ChatGPT Image Aug 15, 2026, 11_25_32 AM.png`,
  REF,
];

const target = misura(REF);
console.log(`TARGET: luce=${target.luce} soggetto=${target.soggetto} p95=${target.p95} neri=${target.neri}%`);

let prompt = BASE;
let migliore: { file: string; dist: number; m: Metriche } | null = null;

for (let giro = 1; giro <= GIRI; giro++) {
  const out = `/tmp/match_giro${giro}.png`;
  const r = await runWorkerOpenAi({ image: `${DATA}/RAW/1.PNG`, refs, prompt, output: out });
  if (r.status !== "ok") {
    console.log(`giro ${giro}: FALLITO ${r.error?.slice(0, 80)}`);
    continue;
  }
  const m = misura(out);
  // Distanza normalizzata: la luce vale quanto l'inquadratura, altrimenti si
  // ottimizza il numero piu' grande e si perde l'altro.
  const dist = Math.abs(m.luce - target.luce) / 10 + Math.abs(m.soggetto - target.soggetto) * 20;
  console.log(
    `giro ${giro}: luce=${m.luce} (t ${target.luce}) soggetto=${m.soggetto} (t ${target.soggetto}) dist=${dist.toFixed(2)}`,
  );
  if (!migliore || dist < migliore.dist) migliore = { file: out, dist, m };

  const fix = correzioni(target, m);
  if (fix.length === 0) {
    console.log(`  dentro tolleranza al giro ${giro}`);
    break;
  }
  prompt = `${BASE}\n\nIMPORTANT CORRECTIONS to apply:\n${fix.map((f) => `- ${f}`).join("\n")}`;
}

console.log(`\nMIGLIORE: ${migliore?.file} dist=${migliore?.dist.toFixed(2)}`);
