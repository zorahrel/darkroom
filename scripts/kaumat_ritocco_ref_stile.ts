/**
 * Come kaumat_ritocco_ref.ts, ma il riferimento e' lo STILE di un dettaglio gia' presente
 * nella stessa immagine (es. le piume del collo e della spalla), non una forma da copiare.
 * Usage: bun run scripts/kaumat_ritocco_ref_stile.ts <ritaglio> <rif> <uscita> "<cosa>"
 */
import { runWorkerOpenBrowser } from "../server/worker.ts";

const [src, ref, out, what] = process.argv.slice(2);
if (!src || !ref || !out || !what) throw new Error('uso: kaumat_ritocco_ref_stile.ts <ritaglio> <rif> <uscita> "<cosa>"');

const PROMPT = `
The FIRST image is a close crop of a wildlife photo (the one to edit). The SECOND image is only a style reference: it shows the feathers of the same animal (neck plumes and cream shoulder plume), so that new feathers match them in colour, material and light.

Make exactly ONE change to the first image: ${what}

Everything else must stay exactly as it is. Return only the edited first image, same size and framing. The result must look like an untouched photograph.
`.trim();

const res = await runWorkerOpenBrowser({ image: src, refs: [ref], prompt: PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
