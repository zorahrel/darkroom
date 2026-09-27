/**
 * Un ritocco LOCALE su un ritaglio del Kaumat: una sola richiesta, poi
 * kaumat_zanne_innesta.sh rimette nel fotogramma solo i pixel cambiati.
 *
 * PERCHE'. La v94 e' la prima con le zanne generate dalla mandibola; le mancano
 * tre dettagli piccoli (punte delle dita chiare, striscia per il lungo, ciuffo
 * di spine sull'anca). Rigenerare da capo rimette in gioco le zanne, che in 90
 * versioni sono uscite giuste una volta: si corregge solo dove serve.
 *
 * Usage: bun run scripts/kaumat_ritocco.ts <ritaglio.png> <uscita.png> "<cosa cambiare>"
 */
import { runWorkerOpenBrowser } from "../server/worker.ts";

const [src, out, what] = process.argv.slice(2);
if (!src || !out || !what) throw new Error('uso: kaumat_ritocco.ts <ritaglio.png> <uscita.png> "<cosa cambiare>"');

const PROMPT = `
Edit this photograph. It is a close crop of a larger wildlife photo.

Make exactly ONE change: ${what}

Everything else must stay exactly as it is: same shapes, same textures, same light, same colours, same background, same framing. Do not redraw the image and do not add anything else. The result must look like the untouched original photo.
`.trim();

const res = await runWorkerOpenBrowser({ image: src, prompt: PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
