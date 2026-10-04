/**
 * Come kaumat_ritocco.ts, ma con un'immagine di RIFERIMENTO allegata (la faccia di una
 * versione vecchia che piaceva). Usage:
 *   bun run scripts/kaumat_ritocco_ref.ts <ritaglio.png> <riferimento.png> <uscita.png> "<cosa cambiare>"
 */
import { runWorkerOpenBrowser } from "../server/worker.ts";

const [src, ref, out, what] = process.argv.slice(2);
if (!src || !ref || !out || !what) throw new Error("uso: kaumat_ritocco_ref.ts <ritaglio> <rif> <uscita> \"<cosa>\"");

const PROMPT = `
The FIRST image is a close crop of a wildlife photo (the one to edit). The SECOND image is only a reference for the head shape.

Make exactly ONE change to the first image: ${what}

Everything else must stay exactly as it is: same pose, same eye, same tusks, same light, same colours, same background, same framing. Return only the edited first image, same size and framing. The result must look like an untouched photograph.
`.trim();

const res = await runWorkerOpenBrowser({ image: src, refs: [ref], prompt: PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
