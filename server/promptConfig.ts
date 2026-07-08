// Prompt configuration: discrete enum knobs that get assembled into a
// 3-block prompt (change / preserve / exclude). Based on the gpt-image-1
// prompting research: short, segmented, photographic terms, no filler.

export const PRESET = {
  cinematic:
    "cinematic color grade, modern editorial cinema look, minimal premium editorial style, authentic mood",
  editorial: "editorial magazine grade, refined and clean",
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
  warm: "warm white balance",
  cool: "cool white balance",
} as const;
export type WhiteBalance = keyof typeof WHITE_BALANCE;

export const GEOMETRY = {
  off: "",
  straighten: "level the horizon and straighten vertical and keystone lines",
  correct:
    "correct perspective distortion and lens geometry: fix converging verticals, level the frame, normalize the viewpoint",
} as const;
export type Geometry = keyof typeof GEOMETRY;

export const COMPOSITION = {
  off: "",
  rebalance:
    "subtly improve composition for balance: gentle crop and leveling toward rule-of-thirds and a balanced frame, without inventing or adding new content",
  recompose:
    "recompose the frame more freely for stronger balance and a cleaner layout; reframing may extend or alter the edges",
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
  off: "no bloom",
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
} as const;
export type Dof = keyof typeof DOF;

export const HIGHLIGHTS = {
  preserve: "",
  "warm-lift": "gently lift and warm natural highlights without clipping",
  "cool-lift": "lift highlights with a slightly cool tint",
  muted: "tame bright highlights, recover detail in whites",
  neutral: "boost highlights subtly without color shift",
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
  "act as the art director of this frame and commit to the single strongest edit: turn it into an iconic, impactful editorial photograph; use your own judgment on what serves the image — decisively remove bystanders, tourists and background clutter that weaken it, keep and elevate only the subject and elements that carry its meaning and emotion, and reframe to the most powerful composition, cropping in tight or shifting the vantage point radically when it makes the image stronger; keep any retained face exactly as in the original";

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
  white_balance: "preserve", // keep native color/WB (LUT owns the grade)
  geometry: "correct",       // fix converging verticals + level: real lens correction
  composition: "recompose",  // bold recompose toward the iconic crop
  aspect_ratio: "4:5",       // editorial vertical framing
  harmony: "off",            // shifts color per-image and breaks set consistency — keep off
  food: "enhance",
  time_of_day: "preserve",
  lighting: "hard-directional", // strong directional drama
  palette: "preserve",
  contrast: "punchy",        // amplify light/shadow contrast — drama
  grain: "fine",             // barely-visible 35mm grain: the strongest "real photo" tell, hides AI smoothness
  shadows: "crushed",        // deep moody shadows without clipping — drama
  highlights: "neutral",     // boost highlights without color shift (LUT owns color)
  bloom: "glow",             // pronounced cinematic night-glow — drama
  dof: "preserve",           // NO fake depth-of-field — believable optics across any lens
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
    "color_balance",
    // NB: "lighting_direction" + "cast_shadows" intentionally dropped — they
    // leashed the model to "amplify existing light only", which flattened the
    // temples. The opener now lets it reinterpret the light (plausibly).
    "textures",
  ],
  // Anti-"AI look" guardrails that don't soften the drama: no dreamy Orton haze,
  // no painterly/illustrative rendering — on top of the usual face/HDR guards.
  exclude: [
    "no_smoothing",
    "no_oversaturation",
    "no_neon_flare",
    "no_chromatic_vignette",
    "no_face_morph",
    "no_new_objects",
    "no_orton",
    "no_painterly",
  ],
  art_direction: true, // let the AI art-direct each frame toward an iconic result
  freeform: "",
};

/** Merge: override fields fall back to base. */
export function mergeConfig(base: PromptConfig, override: Partial<PromptConfig> | null | undefined): PromptConfig {
  if (!override) return base;
  return {
    preset: override.preset ?? base.preset,
    film_stock: override.film_stock ?? base.film_stock,
    white_balance: override.white_balance ?? base.white_balance,
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

/** Build the 3-block prompt from a config. */
export function assemblePrompt(c: PromptConfig): string {
  const changes: string[] = [];
  if (PRESET[c.preset]) changes.push(PRESET[c.preset]);
  if (FILM_STOCK[c.film_stock]) changes.push(FILM_STOCK[c.film_stock]);
  if (WHITE_BALANCE[c.white_balance]) changes.push(WHITE_BALANCE[c.white_balance]);
  if (TIME_OF_DAY[c.time_of_day]) changes.push(TIME_OF_DAY[c.time_of_day]);
  if (LIGHTING[c.lighting]) changes.push(LIGHTING[c.lighting]);
  if (PALETTE[c.palette]) changes.push(PALETTE[c.palette]);
  if (HARMONY[c.harmony]) changes.push(HARMONY[c.harmony]);
  changes.push(CONTRAST[c.contrast]);
  if (GRAIN[c.grain]) changes.push(GRAIN[c.grain]);
  changes.push(SHADOWS[c.shadows]);
  if (HIGHLIGHTS[c.highlights]) changes.push(HIGHLIGHTS[c.highlights]);
  if (BLOOM[c.bloom]) changes.push(BLOOM[c.bloom]);
  if (DOF[c.dof]) changes.push(DOF[c.dof]);
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
  const excludeText = (c.exclude ?? DEFAULT_EXCLUDE)
    .map((k) => EXCLUDE_OPTIONS[k])
    .filter(Boolean);

  const parts: string[] = [
    "Reinterpret this scene as a single iconic editorial photograph, not a faithful retouch of the snapshot. You have full creative agency over framing: recompose boldly — change the vantage point and perspective decisively, and crop as hard as the image needs, even in tight to isolate one powerful detail or subject. Declutter with a photographer's eye: strip out passersby, tourists and incidental background clutter that merely crowd or unbalance the frame — but in EVERY frame first find the one element that carries the image and build around it. Recognise and KEEP any person who is iconic to the scene (someone praying, a decisive or deeply human gesture, a figure that gives the image its meaning or emotion) and elevate them as the subject. Treat authentic cultural and characterful details — Japanese signage and writing, kanji, lanterns and banners bearing text, shrine and street detail — as meaningful content to preserve exactly, never as clutter to erase. Cut only the incidental; keep and strengthen the meaningful. Relight it decisively and creatively — strong, directional, sculpted light with deep, dimensional shadows. Do not just amplify what is there: reinterpret the illumination to make the frame compelling — introduce believable practical light sources (lanterns, candles, windows, shafts of light through trees, a low raking key light), reposition the key light, and deepen the mood — as long as it stays physically plausible for this place and time of day and never looks artificial, staged or CGI. Keep the same place and its identity, the original colors and white balance, and keep any retained face EXACTLY as in the original. Above all it must look like a genuine photograph captured on a real camera and lens — believable optics and perspective, true surface texture and a faint natural film grain — never a digital render, a 3D or CGI look, an illustration or an over-processed HDR image. Edit the real scene; do not fabricate a different place or invent new objects or signage. Output the edited image.",
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
