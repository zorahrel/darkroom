/**
 * Ri-inquadra una versione come la ripresa del video di riferimento: scura, lontana, dietro le foglie.
 * Il riferimento e' un fotogramma del video VERO di Attilio (non una generazione): serve solo a luce e taglio.
 *   bun run scripts/kaumat_scena.ts <base.png> <fotogramma.png|-> <uscita.png>
 * Con `-` al posto del fotogramma la scena si descrive solo a parole (nessun allegato).
 */
import { runWorkerOpenBrowser } from "../server/worker.ts";

const [src, ref, out] = process.argv.slice(2);
if (!src || !ref || !out) throw new Error("uso: kaumat_scena.ts <base> <fotogramma-rif|-> <uscita>");
const conRif = ref !== "-";
/** SCENA_TONO=soft: luce leggibile e creatura a tre quarti verso l'obiettivo (la prima scena era troppo scura e di spalle). */
const soft = process.env.SCENA_TONO === "soft";

const PROMPT = `
${
  conRif
    ? "The FIRST image is a wildlife photo of a feathered reptile creature. The SECOND image is a frame from a real hidden-camera clip: it is ONLY a reference for the light, the mood and the camera position, never for the creature."
    : "The attached image is a wildlife photo of a feathered reptile creature."
}

${soft ? `Re-shoot the photo as if it were a stolen telephoto frame from a hidden camera in the forest:
- Cold but READABLE light: soft diffuse overcast daylight filtering through the canopy, a gentle fill so the creature is clearly exposed, the iridescent violet and teal scales visibly shimmer, open midtones, shadows not crushed. NOT a night scene and NOT a dark mood: the animal must read at a glance. No sun rays, no warm glow, no rim light, natural film grain.
- The creature stands three-quarters TOWARD the camera: chest and shoulder facing us, the head looking straight into the lens. Not a back view, not walking away, not turned over the shoulder.
- It is smaller in the frame (about 45% of the frame height), seen from some distance, standing still.
- Big out-of-focus dark leaves and a mossy trunk in the foreground frame the lower and the side edges, like it was filmed from behind cover; the creature itself stays clear and unobstructed.
- The tail lies on the ground far from the feet: a clear gap of bare ground between the tail and every leg and foot. The tail must never touch, cross or overlap a foot or a leg.

` : `Re-shoot the photo as if it were a stolen telephoto frame from a hidden camera in the forest:
- MUCH darker and colder: dim overcast forest dusk, desaturated cold greens and browns, no sun rays, no warm glow, no rim light. Deep shadows, natural film grain.
- The creature is clearly smaller in the frame (about 40% of the frame height), seen from farther away, standing still, head turned over the shoulder toward the camera.
- Big out-of-focus dark leaves and a mossy trunk in the foreground, partly covering the lower and the side edges of the frame, like it was filmed from behind cover.
- The tail lies on the ground far from the feet: a clear gap of bare ground between the tail and every leg and foot. The tail must never touch, cross or overlap a foot or a leg.

`}Keep the creature itself the same animal: the same head with the amber eye and the two ivory tusks, the same iridescent violet scales, the neck feather ruff, the dorsal ridge, the feathered tail tip. Photographic, not an illustration, no glow, no CGI look. Vertical 9:16 frame.
`.trim();

const res = await runWorkerOpenBrowser({ image: src, refs: conRif ? [ref] : [], prompt: PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
