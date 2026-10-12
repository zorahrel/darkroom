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
/** SCENA_SGUARDO=fuori: la creatura ignora la camera e guarda qualcosa fuori campo (un animale selvatico non posa). */
const fuori = process.env.SCENA_SGUARDO === "fuori";
/** SCENA_TONO=rim: come il video di riferimento: fondo quasi nero, una sola luce fredda di taglio, creatura grande e di profilo. */
const rim = process.env.SCENA_TONO === "rim";
/** SCENA_TONO=key: come il riferimento video: sfondo scuro ma creatura BEN ESPOSTA (pelle chiara, riflessi), non una silhouette. */
const key = process.env.SCENA_TONO === "key";
/** SCENA_TONO=close: come il riferimento video: PRIMO PIANO stretto su testa e collo di profilo, luce forte sulla creatura, sfondo scuro. */
const close = process.env.SCENA_TONO === "close";
/** SCENA_TONO=wide: come il riferimento video RADDRIZZATO: campo largo 16:9, animale intero in piedi da lontano, radura al tramonto. */
const wide = process.env.SCENA_TONO === "wide";
/** SCENA_TONO=cine: parte da una scena gia' buona (v260) e rifa SOLO la luce, come il riferimento: sfondo nel nero, luce direzionale morbida, riflessi sulla pelle, varco bruciato e sfocato. */
const cine = process.env.SCENA_TONO === "cine";
/** SCENA_TONO=vert: formato VERTICALE 9:16 (come il riferimento video vero, che e' 720x1280), creatura intera da lontano e luce del riferimento. */
const vert = process.env.SCENA_TONO === "vert";
/** SCENA_TONO=lens: come vert, ma con la RESA FOTOGRAFICA del riferimento: tele luminoso, camera bassa, sfondo scuro liscio, creatura unica zona nitida, grading desaturato. */
const lens = process.env.SCENA_TONO === "lens";
/** SCENA_TONO=lens2: parte dalla scena lens gia' buona e cambia SOLO due cose: la coda fugge all'indietro in prospettiva e lo sfondo diventa molto piu' scuro e liscio. */
const lens2 = process.env.SCENA_TONO === "lens2";
/** SCENA_TONO=lens3: parte dalla scena lens (v269) e cambia SOLO l'angolo di ripresa: di PROFILO e bassa come nel riferimento (non da dietro), con la coda distesa in orizzontale sul terreno. */
const lens3 = process.env.SCENA_TONO === "lens3";

/** SCENA_TONO=cinema: parte dalla scena di profilo (v275) e la rifa' in 16:9 CINEMA con la creatura GRANDE (nel 9:16 usciva piccolissima). Stessa luce e resa fotografica. */
const cinema = process.env.SCENA_TONO === "cinema";

/** SCENA_TONO=pos: parte dalla scena 16:9 (v278) e cambia SOLO la POSIZIONE e il taglio come nel riferimento video dritto (creatura alta e stretta sul terzo sinistro, piedi vicini al bordo basso, coda che scende a destra a terra, foglia sfocata in basso a sinistra, varco luminoso in alto a destra). SCENA_POS=prof tiene il profilo, SCENA_POS=tre usa il tre quarti da dietro del riferimento. */
const pos = process.env.SCENA_TONO === "pos";
const posTre = process.env.SCENA_POS === "tre";

const PROMPT = `
${
  conRif
    ? pos
      ? "The FIRST image is a wildlife photo of a feathered reptile creature: keep this exact animal, its design, its colours, the light and the photographic look. The SECOND image is a frame from a real wildlife clip of a different animal: use it ONLY as a reference for the PLACEMENT of the animal in the frame, its size, the camera height and the foreground, never for the animal itself, its colours or its head."
      : cinema
      ? "The attached image is a wildlife photo of a feathered reptile creature seen in profile: keep this exact animal, its design, its colours, the light and the photographic look."
      : lens3
      ? "The FIRST image is a wildlife photo of a feathered reptile creature: keep this exact animal, its design, its colours, the light and the photographic look. The SECOND image is a frame from a real wildlife clip of a different animal: use it ONLY as a reference for the CAMERA ANGLE (a low side-on view, the animal in profile, its tail laid out horizontally along the ground), never for the animal, its colours, its head or the background."
      : vert || lens
      ? "The FIRST image is a wildlife photo of a feathered reptile creature: keep this exact animal and its design. The SECOND image is a frame from a real wildlife clip: use it ONLY as a reference for the lighting, the contrast and the depth of field, never for the animal, its colours or its pose."
      : cine
      ? "The FIRST image is a finished wildlife photo: keep it exactly as it is, only the lighting changes. The SECOND image is a frame from a real wildlife clip: use it ONLY as a reference for the lighting, the contrast and the depth of field, never for the animal, its colours, its pose or the framing."
      : wide
      ? "The FIRST image is a wildlife photo of a feathered reptile creature: keep this exact animal. The SECOND image is a frame from a real wildlife clip of a different animal in the same pose: copy ONLY its pose, its framing, its distance and the clearing, never that animal's colours or head."
      : "The FIRST image is a wildlife photo of a feathered reptile creature. The SECOND image is a frame from a real hidden-camera clip: it is ONLY a reference for the light, the mood and the camera position, never for the creature."
    : "The attached image is a wildlife photo of a feathered reptile creature."
}

${pos ? `Re-frame this exact photo as a WIDE HORIZONTAL 16:9 cinema frame (landscape, never portrait). Keep the creature, its design, its iridescent violet-blue scales, the neck feather ruff, the head with the amber eye and the tusks, the soft dim light, the cold desaturated grade, the telephoto look IDENTICAL. Change ONLY the placement, the size and the camera angle, so that the composition matches a real wildlife clip frame:
- PLACEMENT: the creature stands in the LEFT-CENTRE of the frame: its head is about 35% of the frame width from the left edge and about 12% from the top edge; its body centre is at about 40% of the width. It is TALL: from the top of the head to the toes it spans about 80% of the frame height. The right 45% of the frame is the dark forest with the tail sweeping into it.
- ${posTre ? "VIEW: three-quarter view from behind-left, like a hidden camera low behind the animal: we see its back, its flank and its rump, the body is upright and relatively NARROW in the frame (about 25-30% of the frame width), the neck rises and curves so that the head is lowered at the upper left, looking at the ground off-frame to the left, never at the camera. The feather ruff is visible on the chest side at the left." : "VIEW: keep the clean PROFILE, but the animal is smaller and fully inside the left 65% of the frame: the head about 28% from the left edge, the body upright and compact, the head lowered, the amber eye looking at the ground off-frame to the left, never at the camera."}
- FEET: all four feet fully inside the frame with a thin strip of ground below them (about 6% of the frame height), toes separated. The camera is low, at about the height of the animal's belly.
- TAIL: ONE tail, thick at the rump (around 55% of the width, 60% of the height), then it falls and sweeps to the RIGHT low along the ground, thinning out, ending with its feather tuft fully inside the frame at about 85% of the width, with a clear margin to the right edge. It passes behind the rear leg and never crosses a foot.
- FOREGROUND AND BACKGROUND: a large out-of-focus dark leaf in the lower left corner, ferns and small rocks along the bottom edge, all blurred. Background: dark tree trunks, deep shadow, and a bright out-of-focus clearing with lit rocks in the upper right, a locked-off camera, a smooth telephoto bokeh.
` : cinema ? `Re-frame this exact photo as a WIDE HORIZONTAL 16:9 cinema frame (wider than tall, the output image must be landscape, never portrait). Keep the creature, its design, its iridescent violet-blue scales, the neck feather ruff, the head with the amber eye and the tusks, the soft dim light, the cold desaturated grade, the telephoto look with the smooth dark background and the blurred foreground leaf IDENTICAL. Change ONLY the framing:
- The creature is BIG in the frame: its body from the chest to the hindquarters spans about 55-60% of the frame width and its height fills about 70% of the frame height. It stays in clean PROFILE, facing left, seen from a low camera at the height of its knees, the head lowered and turned slightly aside, the amber eye looking at the ground off-frame to the left, never at the camera.
- All four legs stand straight, all four feet fully inside the frame with a strip of bare ground below them, the toes separated. The creature sits slightly left of the centre, leaving room on the right for the tail.
- ONE tail only: it leaves the hindquarters thick, passes BEHIND the rear leg (the leg in front, a soft shadow between them, never crossing the foot) and runs horizontally to the right along the ground, thinning out, ending in its feather tuft fully INSIDE the frame with a clear margin of at least 6% of the frame width to the right edge.
- Keep the dark smooth blurred background with the vignette, the blurred foreground leaf at the left edge, a cinematic wide composition with the camera locked off.
` : lens3 ? `Edit this exact photo. Keep the creature, its design, its iridescent violet-blue scales, the neck feather ruff, the head with the amber eye and the tusks, the soft dim light, the cold desaturated grade, the telephoto look with the soft smooth dark background and the blurred foreground leaf IDENTICAL. Change ONLY the camera angle:
- The camera is low, at the height of the animal's knees, looking at it from the SIDE. The creature is seen in clean PROFILE, its whole body side-on, NOT from behind and NOT three-quarters from behind. It faces left, the head lowered and turned slightly aside, the amber eye looking at the ground off-frame to the left, never at the camera.
- The legs stand straight and vertical, all four feet fully inside the frame with a strip of bare ground below them, the toes separated.
- The tail does NOT come toward the camera. It leaves the hindquarters and lies stretched out HORIZONTALLY along the ground toward the right, a long low tail running across the frame, tapering and getting a little softer with distance, ending in the feathered tip near the right edge but fully inside the frame. It passes BEHIND the rear leg, the leg clearly in front, and never crosses or touches a foot. Exactly ONE tail and one feathered tip.
- The creature fills about 60% of the frame width and sits in the lower half of the tall vertical 9:16 frame.
Do not make the picture darker or lighter than the original. No sun rays, no HDR, no glow, photographic, fine film grain.

` :
lens2 ? `Edit this exact photo. Keep the creature, its pose, the head and the amber eye direction, the feet, the scale colours, the low camera angle, the telephoto look and the framing IDENTICAL. Change ONLY these two things:
1. THE TAIL. Right now it comes toward the camera. Make it run BACKWARD, away from the camera: thick and large where it leaves the hindquarters, then lying on the ground along a diagonal toward the right and into the depth of the scene, strongly foreshortened, tapering and getting smaller, softer and more out of focus the farther it goes. It ends in the feathered tip far away in the background, small and blurred. It passes BEHIND the hind leg, the leg clearly in front with a soft shadow, and never goes through a foot or a leg. There is exactly ONE tail and exactly one feathered tip.
2. THE BACKGROUND. Make it much darker and smoother: the trunks sink into near-black shadow with no readable bark detail, the lit opening on the right is a soft hazy blur, strong vignetting, everything except the creature and a thin strip of ground under its feet is soft and out of focus. Keep the foreground leaf blurred in the lower left.
Do not change anything else. No sun rays, no HDR, no glow, photographic, fine film grain.

` :
lens ? `Re-shoot this exact creature as a TALL VERTICAL 9:16 frame (taller than wide, never landscape), with the photographic look of a real wildlife documentary filmed on a cinema camera with a fast telephoto lens from a distance:
- LENS AND DEPTH OF FIELD: an 85-135mm lens wide open at f/1.8-f/2.8, subject far from the camera. The creature is the ONLY sharp thing in the frame. Everything else, trunks, ferns, ground and the gap in the trees, is smooth, soft and creamy out of focus with round bokeh. No crisp fern or bark detail anywhere except on the creature and a thin strip of ground right under its feet. Background compressed like a long lens.
- CAMERA POSITION: low, at the height of the creature's knees, seen in three-quarter REAR view from slightly behind and to the side, locked off. The ground is NOT seen from above. The body is turned toward the left, the long neck in an S curve, the head bent down toward the left with the amber eye looking at the ground ahead, never at the camera.
- THE TAIL CREATES PERSPECTIVE (very important): the tail is thick and large where it leaves the hindquarters, close to the camera, then runs BACKWARD away from the camera along the ground in a diagonal toward the right and into the depth of the scene. It is strongly foreshortened: big and wide near the body, tapering and getting smaller and softer the farther it goes, ending in the feathered tip far in the background, out of focus. The tail passes BEHIND the hind leg: the leg is clearly in front, the tail clearly behind it with a soft shadow between them. It never goes through a leg or a foot and is never fused with them.
- FRAMING: the whole creature from head to far tail tip is visible, about 60% of the frame width, with the feet fully inside the frame and a bit of dark ground below them. Nothing is cropped. Each foot has separate toes with rounded pads and no claws.
- LIGHT AND GRADE: low, dim, diffuse light in a dark forest, one soft key light from the upper left that makes the creature readable without any sun rays, no god rays, no lens flare, no HDR look, no glossy micro-contrast. Desaturated, slightly cool and teal-green, deep but not crushed blacks, soft contrast like a slightly compressed video frame. The violet and blue of the scales stay but are muted and natural, not neon, not shiny. Gentle fine film grain.
- SCENE: a large dark out-of-focus leaf and ferns in the lower left foreground, nearly black blurred trunks behind, a dim hazy opening between the trees on the right, strong vignetting.
- Keep exactly the same animal as the first image: scales, cream feather ruff, ivory tusks, amber eye, same head and body design.

` :
vert ? `Re-shoot this photo as a TALL VERTICAL 9:16 portrait frame (the output image must be taller than wide, never landscape), like a locked-off frame from a wildlife documentary shot on a phone held upright:
- FULL BODY FROM A DISTANCE: the whole creature from head to tail tip is visible with dark space around it. It occupies the upper-middle of the tall frame, about 60% of the frame width, with its head at roughly one third of the frame height. Below it there is a mossy bank and dark forest floor. Camera at about its eye level, locked off.
- POSE: the creature stands still on all four legs, body turned in three-quarter view toward the left. The long neck rises in an S curve, the head held high then bent slightly down toward the left, the amber eye looking at the ground ahead of it, never at the camera. The tail trails behind the body to the right and lies on the ground in a long relaxed curve.
- The tail keeps a clear gap of bare ground from every leg and foot. It never touches, crosses or overlaps a leg or a foot. Each foot has clean, separate toes with rounded pads and no claws.
- SCENE: a quiet primeval forest, very dark and cold. Deep near-black shadow behind with faint dark trunks, a large broad out-of-focus leaf and ferns on the left edge in the foreground, a lit hazy gap between the trees at the upper right, glowing softly and out of focus, with a few faint light shafts. Strong vignetting toward all four corners.
- LIGHT: one soft directional key light from the upper left on the creature's back, neck and head with crisp specular highlights on the wet iridescent scales and the cream feather ruff, a cool rim light on its back edge. The creature is the brightest, clearly readable thing in the frame, not a silhouette. Shallow depth of field: everything except the creature is soft.
- GRADE: deep blacks, cool teal-green shadows, a touch of warm light only where the key light hits the creature, fine film grain. Photographic, no CGI look, no glow halo around the creature.
- Keep exactly the same animal as the first image: the iridescent violet and teal scales, the cream feather ruff, the two ivory tusks, the amber eye, the same head and body design. Do not recolour it.

` : cine ? `Re-light this exact photo like a cinematic wildlife frame. Change ONLY the lighting, the contrast, the depth of field and the colour grade. Do NOT change the composition, the pose, the creature, its anatomy, its colours' hue, the head, the tusks, the feet, the tail or any object position. The creature must stay a pixel-faithful copy in shape.
- LIGHT: one soft directional key light from the upper left, like a gap in the canopy, falling on the creature's back, neck and head, with crisp specular highlights on the wet iridescent scales and the cream feather ruff. Gentle cool rim light on the edge of the back and the tail. The creature is clearly the brightest and most readable thing in the frame.
- BACKGROUND: the forest behind falls into deep, cold, near-black shadow with strong vignetting toward all four corners. The tree trunks lose their detail and sink into the dark. Much shallower depth of field: the whole background is soft and out of focus with a gentle bokeh.
- The lit gap between the trees on the right glows as a soft, overexposed, hazy backlit opening with a slight bloom, out of focus, with a few faint light shafts.
- FOREGROUND: the large leaf and the ferns in the lower left stay in the frame but are dark, soft and out of focus, with a faint sheen on the leaf surface.
- GRADE: deep blacks, cool teal-green shadows, a touch of warm light only where the key light hits the creature. Fine natural film grain. Photographic, not an illustration, no CGI look, no glow halo around the creature, no sun rays on the creature.

` : wide ? `Re-shoot this photo as a wide full-body shot of the same creature, like a locked-off frame from a wildlife documentary:
- FULL BODY FROM A DISTANCE: the whole creature from head to tail tip is visible with space around it. It fills about 70% of the frame height and sits left of centre. Camera at about its eye level, locked off.
- POSE (copy the reference pose exactly): the creature stands still on all four legs, body turned in three-quarter view toward the left of the frame. The long neck rises in an S curve and the head is held high, then bent forward and slightly down toward the left, the amber eye looking at the ground ahead of it, never at the camera. The back is gently humped. The tail trails away behind the body to the right and lies on the ground in a long relaxed curve.
- The tail keeps a clear gap of bare ground from every leg and foot. It never touches, crosses or overlaps a leg or a foot. Each foot has clean, separate toes with rounded pads and no claws.
- SCENE (as in the reference): a quiet forest clearing at dusk. Dark tree trunks behind, a faint lit gap between the trees on the right, a large broad out-of-focus leaf and ferns in the lower left foreground, mossy stones and small rocks on the ground. Dim cool diffuse light, moody but clearly readable: the creature is evenly exposed, not a silhouette, no strong rim light, no sun rays.
- Keep exactly the same animal as the first image: the iridescent violet and teal scales, the cream feather ruff on the chest, the two ivory tusks, the amber eye, the same head and body design. Do not recolour it.

` : close ? `Re-frame this photo as a tight close-up, like the real hidden-camera clip of a wildlife documentary:
- CLOSE-UP: crop in hard so the head, the neck with its feather ruff and the front shoulder fill most of the frame. The head is large, about one third of the frame height. The legs, feet and tail are mostly outside the frame or only a small part of the body is visible at the bottom. This is NOT a full-body shot.
- Strict profile, the head lowered and turned aside, the amber eye looking at something off-frame on the ground to the right. The eye never points at the lens and the creature does not look at the camera.
- The creature is WELL LIT and clearly readable: a strong soft key light from the upper right makes the iridescent teal, blue and violet scales glint, the feather ruff catches bright cream and white highlights, wet specular highlights on the head and neck. It is NOT a dark silhouette.
- The surroundings are dark: deep shadow behind, faint hints of foliage. One big out-of-focus dark leaf and the edge of a mossy trunk fill the left side of the frame in the foreground and are blurred, the creature stays sharp.
- Keep exactly the same animal: the same head, the amber eye, the two ivory tusks, the iridescent scales, the neck feather ruff, the dorsal ridge. Same colours as the input.

` : key ? `Relight this photo like a still from a moody wildlife film. IMPORTANT: the creature must be WELL LIT and clearly readable, it is the bright subject of the frame:
- A strong soft key light from the upper right falls on the creature: its skin and scales are clearly exposed, the iridescent teal, blue and violet scales glint, the feather ruff and neck feathers catch the light with bright cream and white highlights, wet specular highlights on the back and head. The creature is NOT a dark silhouette and NOT underexposed.
- Only the surroundings stay dark: the forest background falls into deep shadow with faint hints of trunks and foliage, the ground is dark and damp. Overall mood is dark and cold but with a bright, well exposed subject, like cinema frames with a lit animal against a dark forest.
- Keep EXACTLY the same composition, pose, creature and framing as the input: strict profile, large, head lowered and turned aside, the amber eye looking at something off-frame on the ground, never at the camera. Keep the big out-of-focus dark leaf and mossy trunk on the left.
- The tail lies on the ground far from the feet, with a clear gap of bare ground between tail and legs. Do not change the toes, feet or tail shape.

` : rim ? `Re-shoot the photo as a cinematic still from a locked-off tripod camera in a nearly black forest:
- Very dark scene: the background is almost black with only faint hints of trunks and foliage. ONE cold bluish rim light grazes the creature from the side and from behind, outlining its back, neck feathers and head and making the iridescent violet and teal scales glint. The rest of the body falls into soft shadow but stays readable, never pure black. No sun rays, no warm glow, no fog glow.
- The creature is in strict profile, large and close: its body spans about two thirds of the frame width and sits in the middle of the frame, head to the right, standing still.
- The head is lowered and turned slightly aside, the amber eye looks at something off-frame on the ground to the right. It is NOT looking at the camera at all and the eye never points at the lens.
- One huge out-of-focus dark leaf and the edge of a mossy trunk fill the left side of the frame in the foreground. Nothing else covers the creature.
- The tail lies on the ground far from the feet: a clear gap of bare ground between the tail and every leg and foot. The tail must never touch, cross or overlap a foot or a leg.

` : soft ? `Re-shoot the photo as if it were a stolen telephoto frame from a hidden camera in the forest:
- Cold but READABLE light: soft diffuse overcast daylight filtering through the canopy, a gentle fill so the creature is clearly exposed, the iridescent violet and teal scales visibly shimmer, open midtones, shadows not crushed. NOT a night scene and NOT a dark mood: the animal must read at a glance. No sun rays, no warm glow, no rim light, natural film grain.
${
  fuori
    ? "- The creature is in profile or three-quarter profile and is NOT looking at the camera at all: the head is turned to the side and slightly lowered, the amber eye looks at something off-frame on the ground to one side, as if it had not noticed it is being filmed. The eye must never point at the lens. Natural, alert but unaware.\n"
    : "- The creature stands three-quarters TOWARD the camera: chest and shoulder facing us, the head looking straight into the lens. Not a back view, not walking away, not turned over the shoulder.\n"
}- It is smaller in the frame (about 45% of the frame height), seen from some distance, standing still.
- Big out-of-focus dark leaves and a mossy trunk in the foreground frame the lower and the side edges, like it was filmed from behind cover; the creature itself stays clear and unobstructed.
- The tail lies on the ground far from the feet: a clear gap of bare ground between the tail and every leg and foot. The tail must never touch, cross or overlap a foot or a leg.

` : `Re-shoot the photo as if it were a stolen telephoto frame from a hidden camera in the forest:
- MUCH darker and colder: dim overcast forest dusk, desaturated cold greens and browns, no sun rays, no warm glow, no rim light. Deep shadows, natural film grain.
- The creature is clearly smaller in the frame (about 40% of the frame height), seen from farther away, standing still, head turned over the shoulder toward the camera.
- Big out-of-focus dark leaves and a mossy trunk in the foreground, partly covering the lower and the side edges of the frame, like it was filmed from behind cover.
- The tail lies on the ground far from the feet: a clear gap of bare ground between the tail and every leg and foot. The tail must never touch, cross or overlap a foot or a leg.

`}Keep the creature itself the same animal: the same head with the amber eye and the two ivory tusks, the same iridescent violet scales, the neck feather ruff, the dorsal ridge, the feathered tail tip. Photographic, not an illustration, no glow, no CGI look. ${wide || cine ? "Horizontal 16:9 frame." : "Vertical 9:16 frame."}
`.trim();

const res = await runWorkerOpenBrowser({ image: src, refs: conRif ? [ref] : [], prompt: PROMPT, output: out });
console.log(res.status === "ok" ? `ok → ${out}` : `FALLITA: ${res.error}`);
if (res.status !== "ok") process.exit(1);
