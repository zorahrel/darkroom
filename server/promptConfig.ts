// Prompt configuration: discrete enum knobs that get assembled into a
// 3-block prompt (change / preserve / exclude). Based on the gpt-image-1
// prompting research: short, segmented, photographic terms, no filler.

export const PRESET = {
  cinematic:
    "cinematic color grade, modern editorial cinema look, minimal premium editorial style, authentic mood",
  editorial: "refined, clean editorial style — polished but true to the scene",
  documentary: "documentary photojournalism, naturalistic",
  "fine-art": "fine-art print, museum-grade tonal range",
} as const;
export type Preset = keyof typeof PRESET;

export const FILM_STOCK = {
  none: "",
  "portra-400": "Kodak Portra 400 color science",
  "portra-800": "Kodak Portra 800 color science, warmer skin tones",
  "cinestill-800t": "Cinestill 800T tungsten balance with subtle red halation",
  "ektar-100": "Kodak Ektar 100, high saturation, fine grain",
  "fuji-400h": "Fuji Pro 400H, pastel greens and cool tones",
} as const;
export type FilmStock = keyof typeof FILM_STOCK;

export const TIME_OF_DAY = {
  preserve: "",
  golden: "shift toward golden hour warmth",
  blue: "shift toward blue hour cool tones",
  overcast: "soften toward overcast diffused light",
  noon: "preserve harsh midday light without softening",
  tungsten: "shift interior light toward tungsten warmth",
} as const;
export type TimeOfDay = keyof typeof TIME_OF_DAY;

// Light *mood* — distinct from TIME_OF_DAY (which shifts color temperature). This
// shapes the quality and drama of the existing light: soft/hard, directional,
// romantic. Amplifies real light; never invents artificial sources or flares.
export const LIGHTING = {
  preserve: "",
  "dramatic-romantic":
    "build natural, dramatic and romantic light: soft directional sources, gentle falloff and atmosphere; sculpt the scene with believable existing light, no artificial flares",
  "soft-directional":
    "shape soft, directional natural light with gentle falloff and quiet atmosphere",
  "hard-directional":
    "strong directional light with defined shadows and high drama",
  "flat-even": "even, soft, flat lighting with minimal shadow contrast",
} as const;
export type Lighting = keyof typeof LIGHTING;

export const PALETTE = {
  preserve: "",
  "warm-earth": "warm earth palette, terracotta and ochre",
  "teal-orange": "cool teal shadows + orange highlights",
  desaturated: "desaturated muted tones, low chroma",
  "high-saturation": "high-saturation editorial color",
} as const;
export type Palette = keyof typeof PALETTE;

export const WHITE_BALANCE = {
  preserve: "",
  neutral:
    "neutral, accurate white balance; remove any color cast; keep a consistent color temperature across the whole set",
  // Gli interni giapponesi sono quasi tutti tungsteno su legno: chiedere
  // genericamente "neutral" non basta, il modello lascia l'ambra perché la
  // legge come atmosfera invece che come dominante. Qui si nomina il caso
  // (legno, lampade calde, banconi) e si dà un riferimento verificabile —
  // il bianco deve uscire bianco — senza chiedere una foto fredda.
  "neutral-strict":
    "remove the warm cast completely: neutral, accurate white balance as if shot on a color-checked camera. Indoor tungsten and warm LED lighting must NOT leave an amber or yellow cast on wood, walls, counters, tables, food or skin. Anything white or grey in the scene (paper, plates, walls, signage) must render truly white or neutral grey, not cream or yellow. Keep the light sources themselves warm and the mood intact — neutralize the cast, not the lamps",
  warm: "warm white balance",
  cool: "cool white balance",
} as const;
export type WhiteBalance = keyof typeof WHITE_BALANCE;

// Sky treatment. Pushes a visible sky toward the deep, luminous blue the set
// wants — bright yet richly saturated (never washed-out/milky), kept
// photographically plausible. Only bites when there is actually sky in frame.
export const SKY = {
  off: "",
  "deep-blue":
    "if the sky is visible, brighten it strongly into a luminous, deep, clean blue — bright yet richly saturated, with smooth even gradation and no milky haze or blown-out whites; keep it photographically natural for the scene and invent nothing",
  // "deep + saturated" spinge il modello verso un cielo cupo, che su una
  // giornata limpida legge come un temporale in arrivo. Questa variante chiede
  // l'opposto — chiaro e arioso — dando un riferimento verificabile (più chiaro
  // dell'edificio, non più scuro) invece dell'ennesimo aggettivo.
  // Il cielo è la superficie più grande e più liscia di una foto: qualsiasi
  // irregolarità dell'edit AI si vede lì per prima. Su questo set usciva a
  // chiazze — zone più sature accanto a zone slavate — e cambiava tono da una
  // foto all'altra dello stesso pomeriggio. Qui si chiede una cosa sola e
  // verificabile: UNA superficie continua, e sempre lo stesso azzurro.
  "even-blue":
    "if the sky is visible it must read as ONE single continuous surface: a uniform, even blue that changes only in a smooth gradient from horizon to zenith, with no patches, no blotches, no banding, no areas that are noticeably more saturated or more washed-out than their neighbours, and no halo around buildings, trees or roof lines. Keep it a natural mid-blue of a clear day — neither a dark navy nor a pale washed grey — and keep faint clouds soft and believable if they are already there. Never invent clouds, gradients or colour shifts that were not in the scene",
  // Cielo notturno di riferimento per tutto il set. Nominare le stelle serve a
  // due cose opposte: chiederne POCHE (un cielo urbano ne mostra una manciata,
  // non una via lattea) e impedire al modello di riempire il vuoto con un
  // firmamento inventato, che è quello che fa quando gli si dice solo "notte".
  // Le nuvole erano vietate insieme alle stelle inventate, ma sono cose
  // diverse: un firmamento finto si nota, una nuvola no. Vietarle "dove il
  // cielo era sereno" lasciava un cielo vuoto proprio negli scatti che ne
  // avevano più bisogno — e questo strumento reinterpreta la scena, non fa
  // ritocco fedele. Ora le nuvole si possono aggiungere, purché siano il
  // meteo credibile di quella città a quell'ora: illuminate da sotto dal
  // riverbero urbano, mai dipinte o drammatiche.
  "deep-night":
    "if the night sky is visible it must read as one deep, rich blue-black surface with a dramatic gradient — darkest at the top, warming slightly toward the horizon where the city light spills up — smooth and continuous, with no patches, no banding and no halo around buildings. Give the sky atmosphere with clouds: soft, drifting masses lit from below by the city glow, warm and luminous on their undersides, darker against the deep sky, breaking up the emptiness and adding depth. Add them even if the original sky was clear, but keep them the believable weather of a real night over this city — never painted, illustrated, stormy or theatrical. Stars must be clearly VISIBLE yet sparse: a scattering of small, distinct points across the darkest part of the sky, the handful you would actually see above a lit city; never a dense starfield and never a milky way. The whole frame must NOT drown in one amber or yellow bath: keep the warm light strictly where the lamps actually fall, and let everything they do not reach — the sky, shaded stone, distant roofs, foliage — stay cool and blue. That warm-against-cool contrast is what makes the night read real and interesting instead of flat and yellow. The lit subject itself must NOT turn amber or golden: floodlit stone, plaster, wood and paint keep their own true colour — pale stone stays pale, white stays white — lit brightly rather than dyed yellow. Warm means the light, never a colour wash over the building. The sky stays clearly darker than every lit surface in the frame",
  "bright-airy":
    "if the sky is visible, keep it light, clean and airy: a pale, luminous blue that reads like open daylight, never dark, heavy, navy or stormy. The sky must stay clearly BRIGHTER than the buildings and subjects below it, with smooth gradation, no milky haze and no blown-out white patches. Do not deepen or over-saturate it",
} as const;
export type Sky = keyof typeof SKY;

export const GEOMETRY = {
  off: "",
  straighten: "level the horizon and straighten vertical and keystone lines",
  correct:
    "correct perspective distortion and lens geometry: fix converging verticals, level the frame, normalize the viewpoint",
} as const;
export type Geometry = keyof typeof GEOMETRY;

// Il permesso di ricomporre, scritto una volta sola.
//
// Prima distinzione, giusta ma non sufficiente: cambiare INQUADRATURA non e'
// cambiare CONTENUTO. Muovere la camera si', inventare no.
//
// Seconda lezione, quella che e' costata otto render su IMG_2906: finche'
// esiste il permesso di ESTENDERE i bordi, il modello inventa comunque —
// perche' il bordo nuovo e' spazio vuoto che qualcosa deve pur riempire, e
// nessun divieto ("continua solo cio' che c'e'", "non aggiungere oggetti",
// "mantieni l'architettura reale") ha retto: sono comparsi un tetto in primo
// piano e dettagli del tempio che non esistono. Il divieto arriva sempre dopo
// il permesso, e perde.
//
// Quindi il reframe vive DENTRO l'immagine esistente. Non e' una rinuncia:
// l'inquadratura si sceglie ancora — piu' stretta, spostata, ruotata, con la
// prospettiva corretta — e resta l'edit editoriale. Ma il rettangolo finale e'
// fatto di pixel che erano nella foto, e la scena originale era gia' una
// scelta di chi ha scattato: allargarla non e' un miglioramento, e' un'altra
// foto.
const REFRAME_FREEDOM =
  "recompose the frame decisively, but only from what the photograph already contains: the final image must be a crop of the source, never wider than it. Do not extend, expand, out-paint or fill beyond the original edges, and do not add any object, structure, roof, railing, branch, figure or silhouette that is not already in the shot. Choose the strongest rectangle inside the frame — tighter, shifted, or rotated — and correct perspective and level as needed, but every pixel of the result comes from the scene as photographed. Buildings and monuments keep their real architecture exactly: the same number of tiers, roofs, windows, columns and ornaments, in the same proportions — a tighter crop shows them differently, it never redesigns them. If the photograph shows only part of something — a temple whose foundations, lower storeys or surrounding ground were never in the shot — leave it partial: an incomplete subject is a fact of this photograph, not a flaw to repair. Never invent the missing base, steps, plinth, ground or lower structure, and never continue a building beyond what the frame captured. Equally, never TAKE AWAY what the photograph did capture: if the whole width of a building is in the shot, the crop must not cut a side off it. ";

export const COMPOSITION = {
  off: "",
  rebalance:
    "subtly improve composition for balance: gentle crop and leveling toward rule-of-thirds and a balanced frame, without inventing or adding new content",
  // Attenzione al rimedio opposto: chiedere il soggetto "intero e centrato"
  // ha prodotto un ritaglio piatto, cioe' esattamente lo snapshot che il
  // prompt base vieta. Le due cose vanno tenute insieme: taglio DECISO, ma il
  // soggetto non amputato dal bordo.
  recompose:
    REFRAME_FREEDOM +
    "This must be a photograph someone composed, not a rectangle cut out of a snapshot: choose a decisive point of view, work the diagonal, let the subject loom or sit off to one side against open space, and build depth with a real foreground, middle ground and background. Use the whole frame deliberately: the subject placed with intent, generous negative space where it earns tension, leading lines that carry the eye. Never a flat, dead-centre crop with the subject simply parked in the middle. Keep the subject unobstructed, and keep it as complete as the photograph made it: whatever of the subject WAS captured — its full width, both sides, every storey that appears in the shot — stays inside the new frame. Do not slice through the subject to tighten the composition; if a crop would cut off one side of a building or statue that the original showed whole, choose a different rectangle. The one thing you must never do is the opposite: if the original never captured the base of a building, the foot of a statue or the ground it stands on, that part is simply not in this picture and must NOT be drawn in. Missing is left missing; present is kept present",
  // Grandangolo ravvicinato: il soggetto grande e vicino, lo spazio dietro che
  // si apre. È il taglio che fa "posare" un'auto o un monumento invece di
  // fotografarli e basta. Si nomina la prospettiva (le linee che convergono),
  // perché senza il modello si limita ad allargare il campo.
  // Ogni ottica include la libertà di ricomporre: sceglierne una NON deve
  // significare rinunciare al reframe, che è il cuore dell'edit editoriale.
  // Prima l'ottica sostituiva "recompose" e le foto restavano incastrate
  // nell'inquadratura originale.
  "wide-hero":
    REFRAME_FREEDOM +
    "Within that crop, go for the wide-angle hero reading: pick the rectangle where the subject sits large and low in the frame, looming and imposing, with the surrounding space already in the shot opening up behind it and its lines leading into the scene. Favour a low, close feel over a distant one — but find it in the existing pixels, do not simulate a lens change by inventing more scene. Keep the geometry honest: no fisheye bulge, no stretching, no deformed edges",
  // Il grandangolo su un OGGETTO (un'auto, una moto) è un'altra cosa dal
  // grandangolo su un luogo: qui si scende all'altezza del parafango e si
  // lascia che la prospettiva allunghi il muso. È l'inquadratura da rivista di
  // automobili, e "wide-hero" generico non ci arriva.
  "hero-object":
    REFRAME_FREEDOM +
    "Within that crop, make the object the hero: tighten onto it so it is clearly the largest thing in the frame, keep the horizon low and let its near edge dominate the foreground, using the perspective the photograph already has. Do not invent a lower viewpoint or extra bodywork. Keep every line of the object true — no bowing, no fisheye, no melted panels or warped wheels — and its proportions honest",
  // Corridoi, filari, sentieri: la prospettiva converge in fondo e crea un
  // tunnel. Chiedere "grandangolo" e basta non produce il punto di fuga.
  "tunnel":
    REFRAME_FREEDOM +
    "Within that crop, find the tunnel the photograph already contains: centre the path so the lines on both sides converge toward the vanishing point deep in the frame and the scene draws the eye in. Straighten and balance it into symmetry with the verticals dead straight — by cropping and correcting perspective, never by extending the path or inventing what lies further down it",
  // Teleobiettivo: il contrario, comprime e isola.
  "tele-isolate":
    REFRAME_FREEDOM +
    "Within that crop, go telephoto: tighten hard onto the subject so it fills the frame and the background reads flat and stacked behind it, isolating it cleanly from a busy scene. This one is naturally a crop — take it as far in as the resolution allows, and never widen out to fake the distance",
} as const;
export type Composition = keyof typeof COMPOSITION;

// Target output framing. "preserve" keeps the original ratio; the others ask for
// a real reframe (only meaningful when composition allows recompose/rebalance).
export const ASPECT_RATIO = {
  preserve: "",
  "1:1": "reframe to a square 1:1 crop",
  "4:5": "reframe to a vertical 4:5 crop (portrait), iconic and cinematic framing",
  "5:4": "reframe to a horizontal 5:4 crop",
  "3:2": "reframe to a classic 3:2 crop",
  "2:3": "reframe to a vertical 2:3 crop",
  "16:9": "reframe to a wide 16:9 cinematic crop",
  "9:16": "reframe to a tall 9:16 vertical crop",
} as const;
export type AspectRatio = keyof typeof ASPECT_RATIO;

export const HARMONY = {
  off: "",
  subtle:
    "harmonious, coherent color palette; balanced tonal transitions and pleasing overall visual harmony",
  strong:
    "strong color harmony with balanced complementary tones and deliberate, cohesive palette",
} as const;
export type Harmony = keyof typeof HARMONY;

export const FOOD = {
  off: "",
  enhance:
    "if the image contains food or drinks, make them look fresh, appetizing and nicely plated — without changing the dish, the ingredients, the portions, or adding anything",
  // Il cibo è il soggetto che il modello sbaglia più spesso: carne che vira sul
  // grigio o sul verde, uova che sembrano marce, brodi che sembrano avanzi.
  // Qui si nomina cosa deve andare storto, perché "rendilo appetitoso" è un
  // aggettivo e un aggettivo non si può verificare.
  strict:
    "if the image contains food or drinks, it must look freshly served and appetizing: raw fish and meat keep their true fresh color (bright, clean red or pink — never grey, brown, dull or iridescent), egg yolks stay bright and intact (never grey, green-rimmed or rotten-looking), broths and sauces stay clean and glossy (never murky, split or scummy), and greens stay crisp. Do NOT change the dish, the ingredients, the portions, the plating or the number of pieces, and do not make it look already eaten, picked at or leftover",
} as const;
export type Food = keyof typeof FOOD;

export const CONTRAST = {
  flat: "flat low-contrast tonal range",
  natural: "natural mid-contrast",
  punchy: "punchy high-contrast",
} as const;
export type Contrast = keyof typeof CONTRAST;

export const GRAIN = {
  none: "",
  fine: "fine 35mm grain, barely visible",
  visible: "visible ISO 800 film grain",
} as const;
export type Grain = keyof typeof GRAIN;

export const SHADOWS = {
  natural: "natural shadow density",
  lifted: "lifted filmic shadows",
  crushed: "deep moody shadows without clipping detail",
} as const;
export type Shadows = keyof typeof SHADOWS;

export const BLOOM = {
  off: "",
  subtle:
    "soft cinematic bloom and gentle glow around existing bright light sources (lamps, signs, neon, windows); haloed, luminous highlights that feel filmic without washing out the scene",
  glow:
    "pronounced dreamy bloom radiating from every bright light source; soft luminous halos and lifted glowing highlights, cinematic night-glow, while keeping shadows and midtones clean",
  halation: "Cinestill-style red halation blooming around bright lights, soft red-orange glow on highlights",
} as const;
export type Bloom = keyof typeof BLOOM;

export const DOF = {
  preserve: "preserve original depth of field",
  shallow: "emphasize subject with shallow depth-of-field falloff",
  // "Sfocato" è un aggettivo; un diaframma è un numero e una conseguenza
  // fisica. Nominare f/1.4 e il piano di messa a fuoco dà al modello un
  // riferimento verificabile, e la clausola sui bordi evita il ritaglio
  // finto-bokeh che si vede quando lo sfocato viene applicato come maschera.
  "wide-open":
    "shoot it wide open, around f/1.4: the subject snaps into focus and everything in front of and behind it falls away into smooth, creamy, optically correct bokeh with round out-of-focus highlights. The blur must grow gradually with distance the way a real fast lens behaves — never a flat cut-out mask around the subject, never a uniformly blurred background, and the subject's own edges (fur, hair, whiskers, chrome) stay crisp",
  // Il contrario: si tiene tutto a fuoco ma il soggetto emerge lo stesso,
  // per luce e posizione. Serve alle scene urbane dove sfocare butta via metà
  // dell'informazione (insegne, folla, architettura).
  "deep-focus":
    "keep the whole frame in sharp focus, front to back, and separate the subject with light and placement instead of blur",
} as const;
export type Dof = keyof typeof DOF;

// Camera *body/lens signature* — imparts a coherent optical rendering ("shot on
// X") so the whole set reads like one camera. Deliberately describes OPTICS
// (micro-contrast, sharpness, bokeh, falloff), NOT color: color stays owned by
// the local LUT, so the camera clause must not fight the grade.
export const CAMERA = {
  off: "",
  // Hands the lens choice to the model per-scene (resolves the fixed-focal-length
  // vs free-recompose conflict): it picks the optic that fits the crop it made,
  // and we keep only the "real fine lens" rendering bias — no pinned focal length,
  // no vignette. This is the set default; the named bodies below stay for per-photo pinning.
  adaptive:
    "render it through top-tier cinema optics — you choose the glass that serves THIS scene: fast cinema primes with a Cooke or Zeiss Master-Prime character for streets and portraits, a longer prime to isolate a single subject, or medium-format clarity (Hasselblad-grade) for a still or fine detail; give it the expensive, filmic rendering of high-end glass — creamy dimensional micro-contrast, gentle highlight roll-off, smooth organic bokeh where the depth allows and a subtle three-dimensional pop — always a real lens capturing a real scene, never a fixed focal length forced onto the crop, never a flat digital, HDR or CGI look",
  "leica-m":
    "shot on a Leica M rangefinder with a 35mm Summilux: crisp micro-contrast, natural three-dimensional optical rendering, smooth organic bokeh and a subtle corner vignette",
  "fuji-x100":
    "shot on a Fujifilm X100-series compact with its fixed 35mm-equivalent lens: clean modern rendering, sharp yet gentle, smooth highlight roll-off",
  "sony-a7-prime":
    "shot on a Sony A7 full-frame with a fast prime lens: high-resolution clarity, clean edge-to-edge sharpness and shallow depth-of-field falloff",
  hasselblad:
    "shot on a Hasselblad medium-format: large-format clarity, exceptional micro-detail and smooth tonal gradation with gentle depth falloff",
  "ricoh-gr":
    "shot on a Ricoh GR with its 28mm lens: crisp high-micro-contrast street rendering, deep clean tones and snapshot immediacy",
  "contax-t2":
    "shot on a Contax T2 with its Zeiss Sonnar 38mm: characterful sharp-centre rendering, gentle edge falloff, classic point-and-shoot look",
} as const;
export type Camera = keyof typeof CAMERA;

// Drama, defined as a single knob. "clean" = strong, dimensional contrast that
// stays crisp and readable (no haze/murk/crushed blacks) — the look the set
// wants. Coexists with contrast/shadows/lighting: it qualifies their intensity
// as CLEAN rather than muddy.
export const DRAMA = {
  off: "",
  clean:
    "clean, controlled cinematic drama: strong directional light and deep, confident contrast, but shadows stay crisp and readable and highlights stay controlled — punchy and dimensional without haze, murk or crushed blacks",
  bold: "bold, heavy cinematic drama: intense contrast, deep shadows and hard directional light for a striking, high-impact frame",
} as const;
export type Drama = keyof typeof DRAMA;

export const HIGHLIGHTS = {
  preserve: "",
  "warm-lift": "gently lift and warm natural highlights without clipping",
  "cool-lift": "lift highlights with a slightly cool tint",
  muted: "tame bright highlights, recover detail in whites",
  neutral: "push highlights bright and luminous, glowing whites, without color shift or clipping detail",
} as const;
export type Highlights = keyof typeof HIGHLIGHTS;

export const SKIN_TONES = {
  preserve: "",
  "airy-lift": "skin and pink tones: brighter, lighter, airy, slightly desaturated",
  desaturate: "reduce skin and pink chroma for a muted look",
  saturate: "warmer, richer skin and pink tones",
  porcelain: "smooth porcelain skin tone with cool undertones",
} as const;
export type SkinTones = keyof typeof SKIN_TONES;

export const ATMOSPHERE = {
  preserve: "",
  clean: "remove haze and atmospheric muddiness, increase clarity",
  enhance: "enhance mist, haze and atmospheric depth",
  dreamy: "soft atmospheric glow, gentle diffusion",
} as const;
export type Atmosphere = keyof typeof ATMOSPHERE;

export const CLEANUP = {
  off: "",
  minor: "remove only minor distractions; subtle perspective correction",
  aggressive: "remove background distractions and clean up edges",
  "aggressive-keep":
    "remove passersby, background distractions and clutter, but keep the subjects and people that give the scene meaning and impact; clean up edges",
} as const;
export type Cleanup = keyof typeof CLEANUP;

// Authentic-detail recovery — brings back and strengthens the real textures and
// atmospheric details of the scene, without inventing anything new.
export const DETAIL = {
  off: "",
  "restore-authentic":
    "restore and enhance the authentic details of the scene — materials, reflections, smoke, surface texture — so they read true and vivid, without inventing anything",
  enhance:
    "enhance micro-detail and texture sharpness without over-processing or haloing",
} as const;
export type Detail = keyof typeof DETAIL;

// High-level "art director" mode. Hands the model editorial agency to make the
// single strongest edit — decisive cleanup of distracting bystanders/clutter and
// a bolder recompose toward an iconic, impactful frame — while keeping any
// retained face exactly as shot. Exposed in the UI as the "Direzione AI" switch;
// previously this lived hidden inside `freeform`.
export const ART_DIRECTION =
  "act as the art director of this frame and commit to the single strongest edit: turn it into an iconic, impactful editorial photograph, using your own judgment on what serves the image and what to leave out";

// ---- Preserve & Exclude blocks (multi-select) -----------------------------

export const PRESERVE_OPTIONS = {
  composition: "composition, framing, geometry, perspective",
  identity: "subject identity, faces, poses",
  faces_exact:
    "if the photo contains people, keep every face EXACTLY as in the original — identical features, proportions, expression, age and gaze; do not beautify, smooth, slim, restructure or swap faces",
  time_of_day: "time of day and overall scene logic",
  textures: "original surface textures and material realism",
  // optional/off by default
  signs_text: "all signs, text, and writing exactly as captured",
  color_balance: "original white balance and overall color cast",
  weather: "weather and atmospheric conditions (mist, rain, haze)",
  cast_shadows: "existing natural cast shadows, their shape and direction",
  lighting_direction:
    "original lighting direction and sources; amplify existing light only, add no new or artificial light",
  nature_colors: "natural greens and blues (foliage, sky, water) without hue shift",
  natural_grain: "the natural grain and noise of the original",
} as const;
export type PreserveKey = keyof typeof PRESERVE_OPTIONS;

export const EXCLUDE_OPTIONS = {
  no_added_elements: "no added or removed elements",
  no_smoothing: "no smoothing or plastic skin",
  no_oversaturation: "no oversaturation or HDR look",
  no_neon_flare: "no neon glow, no fake lens flare",
  no_chromatic_vignette: "no chromatic aberration, no excessive vignette",
  // optional/off by default
  no_motion_blur: "no motion blur on static elements",
  no_orton: "no Orton glow / hazy dreamy filter",
  no_painterly: "no painterly / illustrative rendering",
  no_face_morph: "no face restructuring or beautification",
  no_new_objects: "no inventing new objects or signage text",
} as const;
export type ExcludeKey = keyof typeof EXCLUDE_OPTIONS;

// NOTE: "composition" is intentionally NOT preserved by default because the
// default composition knob is set to "recompose" (aggressive). Re-add it (and
// set composition: "off") if you want strict framing fidelity.
// "composition" is preserved by default: the default composition knob is "off"
// (strict framing fidelity — "Do NOT alter composition or structure").
export const DEFAULT_PRESERVE: PreserveKey[] = [
  "composition",
  "identity",
  "time_of_day",
  "textures",
  "cast_shadows",
  "lighting_direction",
  "nature_colors",
  "natural_grain",
];

// "no_added_elements" is included: with composition "off" we want strict
// editing-only fidelity (no outpainting, no invented content).
export const DEFAULT_EXCLUDE: ExcludeKey[] = [
  "no_added_elements",
  "no_smoothing",
  "no_oversaturation",
  "no_neon_flare",
  "no_chromatic_vignette",
];

export type PromptConfig = {
  preset: Preset;
  film_stock: FilmStock;
  white_balance: WhiteBalance;
  /** Sky treatment — push a visible sky toward a deep, luminous blue. */
  sky: Sky;
  geometry: Geometry;
  composition: Composition;
  /** Target output framing (4:5, 16:9, …). Only bites when composition reframes. */
  aspect_ratio: AspectRatio;
  harmony: Harmony;
  food: Food;
  time_of_day: TimeOfDay;
  /** Light *mood* (drama/direction/softness) — separate from time_of_day color. */
  lighting: Lighting;
  palette: Palette;
  contrast: Contrast;
  grain: Grain;
  shadows: Shadows;
  highlights: Highlights;
  bloom: Bloom;
  dof: Dof;
  /** Camera body/lens signature — coherent optical rendering across the set. */
  camera: Camera;
  /** Drama as one knob (clean/bold) — qualifies the contrast/light intensity. */
  drama: Drama;
  skin_tones: SkinTones;
  atmosphere: Atmosphere;
  cleanup: Cleanup;
  /** Authentic-detail recovery (materials, reflections, smoke, texture). */
  detail: Detail;
  /** Which "Preserve" clauses to include (multi-select). */
  preserve: PreserveKey[];
  /** Which "Do not" clauses to include (multi-select). */
  exclude: ExcludeKey[];
  /** "Direzione AI": give the model art-director agency (decisive cleanup +
   *  bolder recompose toward an iconic frame). Appends ART_DIRECTION. */
  art_direction?: boolean;
  /** Optional free-form additions appended to the change block. */
  freeform?: string;
};

// Cinematic editorial look (reverse-engineered from the hand-tuned prompt that
// produced the best results): amplify existing light into punchy contrast and
// deep-but-not-crushed shadows, lift highlights warm, keep a soft diffused bloom
// only on existing sources. Strict editing fidelity — composition/geometry are
// preserved, not recomposed ("Do NOT alter composition or structure").
//
// Trade-off: white_balance is "preserve" (not neutral). This keeps the warm
// cinematic grade the user wants, at the cost of slightly less color
// consistency across the set. Set white_balance: "neutral" per-set if a uniform
// temperature matters more than the warm mood.
//
// film_stock/harmony stay off: they shifted color per-image and broke set
// consistency without adding to the cinematic look.
export const DEFAULT_CONFIG: PromptConfig = {
  preset: "editorial",       // refined clean editorial grade
  film_stock: "none",        // color is native — comes from the local LUT, not GPT
  white_balance: "neutral",  // GPT neutralizes WB for a cast-free, set-consistent base; the warm look is still added by the local LUT
  sky: "off",                // opt-in; the set enables "deep-blue" via the DB default
  geometry: "correct",       // fix converging verticals + level: real lens correction
  composition: "recompose",  // bold recompose toward the iconic crop
  aspect_ratio: "4:5",       // editorial vertical framing
  harmony: "off",            // shifts color per-image and breaks set consistency — keep off
  food: "off",               // per-photo only; a global food clause was noise on every non-food frame
  time_of_day: "preserve",
  lighting: "hard-directional", // strong directional drama
  palette: "preserve",
  contrast: "punchy",        // amplify light/shadow contrast — drama
  grain: "fine",             // barely-visible 35mm grain: the strongest "real photo" tell, hides AI smoothness
  shadows: "crushed",        // deep moody shadows without clipping — drama
  highlights: "neutral",     // push highlights bright/luminous — the "boost" that helps the glow read
  bloom: "off",              // glow is the "fake look" and contradicted no_orton/no_neon_flare — cut it
  dof: "preserve",           // NO fake depth-of-field — believable optics across any lens
  camera: "off",             // opt-in "shot on X" optical signature (see DB default for the set)
  drama: "off",              // opt-in; the set enables "clean" via the DB default
  skin_tones: "preserve",
  atmosphere: "clean",       // remove haze / increase clarity (drama)
  cleanup: "aggressive-keep", // strip passersby/clutter, KEEP the iconic subject that carries the frame
  detail: "restore-authentic", // bring back REAL materials/texture/reflections → reads photographic
  // Drama stays, but grounded in the real scene: light DIRECTION, cast shadows and
  // surface textures are preserved so the bold relight still reads as a true photo.
  preserve: [
    // NB: "identity" (subject identity/faces/POSES) intentionally dropped — it
    // pinned every person's pose and blocked the declutter. Only the retained
    // subject's FACE is locked, via faces_exact.
    "faces_exact",
    "signs_text",   // keep Japanese signage/writing/kanji — characterful, not clutter
    "nature_colors",
    // NB: "color_balance" intentionally dropped — it locked "original white balance
    // and color cast", which fought white_balance:neutral. WB is now GPT's job.
    // NB: "lighting_direction" + "cast_shadows" intentionally dropped — they
    // leashed the model to "amplify existing light only", which flattened the
    // temples. The opener now lets it reinterpret the light (plausibly).
    "textures",
  ],
  // Anti-"AI look" guardrails that don't soften the drama: no dreamy Orton haze,
  // no painterly/illustrative rendering — on top of the usual face/HDR guards.
  // NB: no_neon_flare + no_orton intentionally DROPPED — they suppressed exactly
  // the neon/lantern glow and dreamy bloom the look wants (they fought the relight).
  exclude: [
    "no_smoothing",
    "no_oversaturation",
    "no_chromatic_vignette",
    "no_face_morph",
    "no_new_objects",
    "no_painterly",
  ],
  art_direction: false, // the opener already carries the art-direction; the extra paragraph was pure redundancy
  freeform: "",
};

/** Merge: override fields fall back to base. */
export function mergeConfig(base: PromptConfig, override: Partial<PromptConfig> | null | undefined): PromptConfig {
  if (!override) return base;
  return {
    preset: override.preset ?? base.preset,
    film_stock: override.film_stock ?? base.film_stock,
    white_balance: override.white_balance ?? base.white_balance,
    sky: override.sky ?? base.sky,
    geometry: override.geometry ?? base.geometry,
    composition: override.composition ?? base.composition,
    aspect_ratio: override.aspect_ratio ?? base.aspect_ratio,
    harmony: override.harmony ?? base.harmony,
    food: override.food ?? base.food,
    time_of_day: override.time_of_day ?? base.time_of_day,
    lighting: override.lighting ?? base.lighting,
    palette: override.palette ?? base.palette,
    contrast: override.contrast ?? base.contrast,
    grain: override.grain ?? base.grain,
    shadows: override.shadows ?? base.shadows,
    highlights: override.highlights ?? base.highlights,
    bloom: override.bloom ?? base.bloom,
    dof: override.dof ?? base.dof,
    camera: override.camera ?? base.camera,
    drama: override.drama ?? base.drama,
    skin_tones: override.skin_tones ?? base.skin_tones,
    atmosphere: override.atmosphere ?? base.atmosphere,
    cleanup: override.cleanup ?? base.cleanup,
    detail: override.detail ?? base.detail,
    preserve: Array.isArray(override.preserve) ? override.preserve : base.preserve,
    exclude: Array.isArray(override.exclude) ? override.exclude : base.exclude,
    art_direction: override.art_direction ?? base.art_direction,
    freeform: (override.freeform ?? base.freeform ?? "").trim() || undefined,
  };
}

/** Build the 3-block prompt from a config.
 *
 *  `learnedNegatives` are extra "Do not" clauses that don't come from the config
 *  at all — they come from the quality checks (server/verify.ts): what the
 *  gate keeps catching in the output becomes what the next render is told to
 *  avoid. Passed in rather than imported, so this module stays pure. */
export function assemblePrompt(c: PromptConfig, learnedNegatives: string[] = []): string {
  const changes: string[] = [];
  if (PRESET[c.preset]) changes.push(PRESET[c.preset]);
  if (FILM_STOCK[c.film_stock]) changes.push(FILM_STOCK[c.film_stock]);
  if (WHITE_BALANCE[c.white_balance]) changes.push(WHITE_BALANCE[c.white_balance]);
  if (SKY[c.sky]) changes.push(SKY[c.sky]);
  if (TIME_OF_DAY[c.time_of_day]) changes.push(TIME_OF_DAY[c.time_of_day]);
  if (LIGHTING[c.lighting]) changes.push(LIGHTING[c.lighting]);
  if (PALETTE[c.palette]) changes.push(PALETTE[c.palette]);
  if (HARMONY[c.harmony]) changes.push(HARMONY[c.harmony]);
  changes.push(CONTRAST[c.contrast]);
  if (DRAMA[c.drama]) changes.push(DRAMA[c.drama]);
  if (GRAIN[c.grain]) changes.push(GRAIN[c.grain]);
  changes.push(SHADOWS[c.shadows]);
  if (HIGHLIGHTS[c.highlights]) changes.push(HIGHLIGHTS[c.highlights]);
  if (BLOOM[c.bloom]) changes.push(BLOOM[c.bloom]);
  if (DOF[c.dof]) changes.push(DOF[c.dof]);
  if (CAMERA[c.camera]) changes.push(CAMERA[c.camera]);
  if (SKIN_TONES[c.skin_tones]) changes.push(SKIN_TONES[c.skin_tones]);
  if (FOOD[c.food]) changes.push(FOOD[c.food]);
  if (ATMOSPHERE[c.atmosphere]) changes.push(ATMOSPHERE[c.atmosphere]);
  if (DETAIL[c.detail]) changes.push(DETAIL[c.detail]);
  if (CLEANUP[c.cleanup]) changes.push(CLEANUP[c.cleanup]);
  if (GEOMETRY[c.geometry]) changes.push(GEOMETRY[c.geometry]);
  if (COMPOSITION[c.composition]) changes.push(COMPOSITION[c.composition]);
  if (ASPECT_RATIO[c.aspect_ratio]) changes.push(ASPECT_RATIO[c.aspect_ratio]);
  if (c.art_direction) changes.push(ART_DIRECTION);
  if (c.freeform?.trim()) changes.push(c.freeform.trim());

  const preserveText = (c.preserve ?? DEFAULT_PRESERVE)
    .map((k) => PRESERVE_OPTIONS[k])
    .filter(Boolean);
  const excludeText: string[] = (c.exclude ?? DEFAULT_EXCLUDE)
    .map((k) => EXCLUDE_OPTIONS[k] as string)
    .filter(Boolean);
  // Learned clauses join the same block, deduped against what's already there.
  for (const clause of learnedNegatives) {
    const text = clause.trim();
    if (text && !excludeText.includes(text)) excludeText.push(text);
  }

  const parts: string[] = [
    "Reinterpret this snapshot as one iconic editorial photograph — not a faithful retouch. Reframe decisively: hunt for the single strongest image hidden INSIDE this photograph and commit to it — a bold tight detail, a striking crop, or the one subject that carries the frame — and never settle for the flat, centered snapshot. Find it within the pixels you were given: crop, tighten and straighten, never widen, extend or invent scene that was not photographed. Give it drama with strong, directional light and deep shadows, kept physically plausible for this real place and time of day — never staged, CGI or HDR. Aggressively remove passersby and incidental background clutter, but keep the subject, any meaningful human gesture, and all Japanese signage and text exactly as shot. Keep every face exactly as in the original. Neutralize the white balance to a clean, cast-free, consistent color temperature across the set, but apply no stylistic color grade of your own — the final color look is added later. Finish it to a professional editorial standard — the way a master photographer shapes light and tone in post: precise exposure and tonal balance, deliberate dodge-and-burn, clean local corrections and crisp, controlled detail, restrained and believable, never over-processed. It must read as a genuine photograph on a real lens, with true texture and faint natural grain — never a digital render, illustration or 3D look. Edit the real scene; invent no new objects, people or signage. Output the edited image.",
    "",
    "Apply:",
    ...changes.map((c) => `- ${c}`),
  ];
  if (preserveText.length) {
    parts.push("", "Preserve:", ...preserveText.map((p) => `- ${p}`));
  }
  if (excludeText.length) {
    parts.push("", "Do not:", ...excludeText.map((e) => `- ${e}`));
  }
  return parts.join("\n");
}

/** Parse a stored JSON string into a partial config (raw — no DEFAULT merge).
 *  Returns null on bad data. Callers decide how to merge. */
export function parsePartialConfig(json: string | null | undefined): Partial<PromptConfig> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Partial<PromptConfig>;
  } catch {
    return null;
  }
}

/** Parse a stored config and merge with built-in DEFAULT_CONFIG to produce a full one. */
export function parseConfig(json: string | null | undefined): PromptConfig | null {
  const p = parsePartialConfig(json);
  if (!p) return null;
  return mergeConfig(DEFAULT_CONFIG, p);
}
