/**
 * Le zanne del Kaumat, aggiunte su un RITAGLIO del muso.
 *
 * PERCHE'. In circa 60 generazioni da zero il modello non ha mai fatto partire
 * le zanne dalla mandibola: le mette sulla linea della bocca o sul labbro
 * superiore. Qui gli si da' solo il muso, ingrandito, con una richiesta sola;
 * il risultato si rimette nell'immagine con una maschera che copre la bocca e
 * la zona delle zanne (kaumat_zanne_innesta.sh), quindi il resto resta suo al
 * pixel.
 *
 * Con --guida il ritaglio porta due linee ROSSE disegnate dove vanno le zanne
 * (radice sul bordo della mandibola, punta oltre il muso): a parole il modello
 * le metteva sull'angolo della bocca, la guida fissa il punto.
 *
 * Usage: bun run scripts/kaumat_zanne.ts <ritaglio.png> <uscita.png> [--guida]
 */
import { runWorkerOpenBrowser } from "../server/worker.ts";

const [src, out] = process.argv.slice(2);
const GUIDA = process.argv.includes("--guida");
if (!src || !out) throw new Error("uso: kaumat_zanne.ts <ritaglio.png> <uscita.png>");

const PROMPT = `
Edit this photograph. It is a close crop of an animal's head in profile, the snout pointing down to the lower left.

Add exactly ONE change: two long smooth ivory TUSKS rooted in the LOWER JAW. Each tusk grows out of the underside of the lower jawbone, below the lips, near the back of the mouth, like the lower tusks of a hippo or a warthog: its thick base sits on the outer bottom edge of the lower jaw, clearly below the mouth line, and the tusk sweeps FORWARD, in the direction the snout points, past the tip of the snout, curving slightly up at the end. The far tusk is partly hidden behind the jaw. Real ivory, matching the light and depth of field of the photo.

Everything else must stay exactly as it is: same head, same eye, same skin, same feathers, same background, same framing, same colours. Do not redraw the image. Do not add horns, teeth or anything else.
`.trim();

const PROMPT_GUIDA = `
Edit this photograph. It is a close crop of an animal's head, the snout pointing down. Two thick RED lines are drawn on it: they are a placement guide.

Replace each red line with a smooth ivory TUSK that follows the line exactly: the tusk's thick root is at the TOP end of the line, where it touches the edge of the lower jaw, and it grows out of the jawbone there, as if it came out from under the skin of the jaw; it tapers to a sharp point at the bottom end of the line. The tusk further from the camera is thinner and partly behind the chin. Real ivory with fine growth lines, lit by the same warm light from the upper left, with the same depth of field as the jaw. No red may remain.

Everything else must stay exactly as it is: same head, same eye, same skin, same feathers, same background, same framing, same colours. Do not redraw the image. Do not add anything else.
`.trim();

const res = await runWorkerOpenBrowser({ image: src, prompt: GUIDA ? PROMPT_GUIDA : PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
