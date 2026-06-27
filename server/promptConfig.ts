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
} as const;
export type Cleanup = keyof typeof CLEANUP;

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
  harmony: Harmony;
  food: Food;
  time_of_day: TimeOfDay;
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
  /** Which "Preserve" clauses to include (multi-select). */
  preserve: PreserveKey[];
  /** Which "Do not" clauses to include (multi-select). */
  exclude: ExcludeKey[];
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
  preset: "cinematic",
  film_stock: "none",
  white_balance: "preserve", // keep the warm cinematic grade
  geometry: "correct",       // full "perfect photo": fix converging verticals, level the frame
  composition: "rebalance",  // gentle rebalance toward rule-of-thirds, without inventing content
  harmony: "off",            // shifts color per-image and breaks set consistency — keep off
  food: "enhance",
  time_of_day: "preserve",
  palette: "preserve",
  contrast: "punchy",        // amplify light/shadow contrast — drama
  grain: "none",
  shadows: "crushed",        // deep moody shadows without clipping — drama
  highlights: "warm-lift",   // gently lift + warm natural highlights
  bloom: "subtle",           // was "glow" (too aggressive) — controlled glow on existing sources only
  dof: "preserve",
  skin_tones: "airy-lift",
  atmosphere: "enhance",     // atmospheric haze/depth for cinematic mood
  cleanup: "minor",          // remove minor distractions + subtle perspective cleanup
  // composition is now actively rebalanced, so it is NOT in preserve.
  // identity stays preserved and no_face_morph is excluded → faces untouched.
  preserve: [
    "identity",
    "faces_exact",
    "time_of_day",
    "textures",
    "cast_shadows",
    "lighting_direction",
    "nature_colors",
    "natural_grain",
  ],
  // no_added_elements removed (it would block cleanup/recompose); face protection added.
  exclude: [
    "no_smoothing",
    "no_oversaturation",
    "no_neon_flare",
    "no_chromatic_vignette",
    "no_face_morph",
    "no_new_objects",
  ],
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
    harmony: override.harmony ?? base.harmony,
    food: override.food ?? base.food,
    time_of_day: override.time_of_day ?? base.time_of_day,
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
    preserve: Array.isArray(override.preserve) ? override.preserve : base.preserve,
    exclude: Array.isArray(override.exclude) ? override.exclude : base.exclude,
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
  if (CLEANUP[c.cleanup]) changes.push(CLEANUP[c.cleanup]);
  if (GEOMETRY[c.geometry]) changes.push(GEOMETRY[c.geometry]);
  if (COMPOSITION[c.composition]) changes.push(COMPOSITION[c.composition]);
  if (c.freeform?.trim()) changes.push(c.freeform.trim());

  const preserveText = (c.preserve ?? DEFAULT_PRESERVE)
    .map((k) => PRESERVE_OPTIONS[k])
    .filter(Boolean);
  const excludeText = (c.exclude ?? DEFAULT_EXCLUDE)
    .map((k) => EXCLUDE_OPTIONS[k])
    .filter(Boolean);

  const parts: string[] = [
    "Edit this photo using the original as the strict base — modify it, do not regenerate the content from scratch. Output the edited image.",
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
