import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  PRESERVE_OPTIONS,
  EXCLUDE_OPTIONS,
  PRESET,
  FILM_STOCK,
  WHITE_BALANCE,
  SKY,
  CAMERA,
  ASPECT_RATIO,
  assemblePrompt,
  mergeConfig,
  parseConfig,
  parsePartialConfig,
  type PromptConfig,
} from "../server/promptConfig.ts";

/** The "Apply:" bullet list of an assembled prompt. */
function applyLines(prompt: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf("Apply:");
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.startsWith("- ")) break;
    out.push(l.slice(2));
  }
  return out;
}

function section(prompt: string, header: string): string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(header);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.startsWith("- ")) break;
    out.push(l.slice(2));
  }
  return out;
}

describe("assemblePrompt", () => {
  test("emits the three blocks with no empty bullets", () => {
    const p = assemblePrompt(DEFAULT_CONFIG);
    expect(p).toContain("Apply:");
    expect(p).toContain("Preserve:");
    expect(p).toContain("Do not:");
    // An "off"/"none"/"preserve" knob must contribute nothing, never a bare "- ".
    expect(p.split("\n").some((l) => l.trim() === "-")).toBe(false);
    for (const line of applyLines(p)) expect(line.trim().length).toBeGreaterThan(0);
  });

  test("a knob set to off contributes no clause", () => {
    const withSky = assemblePrompt({ ...DEFAULT_CONFIG, sky: "deep-blue" });
    const withoutSky = assemblePrompt({ ...DEFAULT_CONFIG, sky: "off" });
    expect(applyLines(withSky)).toContain(SKY["deep-blue"]);
    expect(applyLines(withoutSky)).not.toContain(SKY["deep-blue"]);
    expect(applyLines(withSky).length).toBe(applyLines(withoutSky).length + 1);
  });

  test("art_direction is opt-in", () => {
    const on = assemblePrompt({ ...DEFAULT_CONFIG, art_direction: true });
    const off = assemblePrompt({ ...DEFAULT_CONFIG, art_direction: false });
    expect(on.length).toBeGreaterThan(off.length);
    expect(applyLines(on).length).toBe(applyLines(off).length + 1);
  });

  test("freeform text lands verbatim in the Apply block", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, freeform: "  make the lanterns glow  " });
    expect(applyLines(p)).toContain("make the lanterns glow");
  });

  test("empty preserve/exclude drop their sections entirely", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, preserve: [], exclude: [] });
    expect(p).not.toContain("Preserve:");
    expect(p).not.toContain("Do not:");
  });

  test("preserve/exclude keys are rendered as their text, unknown keys ignored", () => {
    const p = assemblePrompt({
      ...DEFAULT_CONFIG,
      preserve: ["faces_exact", "nope" as never],
      exclude: [],
    });
    expect(section(p, "Preserve:")).toEqual([PRESERVE_OPTIONS.faces_exact]);
  });
});

describe("DEFAULT_CONFIG integrity", () => {
  // Guards against a typo'd default silently emitting an empty clause: a value
  // that is not a key of its dictionary would just vanish from the prompt.
  const dictionaries: Array<[keyof PromptConfig, Record<string, string>]> = [
    ["preset", PRESET],
    ["film_stock", FILM_STOCK],
    ["white_balance", WHITE_BALANCE],
    ["sky", SKY],
    ["camera", CAMERA],
    ["aspect_ratio", ASPECT_RATIO],
  ];

  for (const [key, dict] of dictionaries) {
    test(`${String(key)} default is a known option`, () => {
      expect(Object.keys(dict)).toContain(String(DEFAULT_CONFIG[key]));
    });
  }

  test("preserve/exclude defaults are known keys", () => {
    for (const k of DEFAULT_CONFIG.preserve ?? []) {
      expect(Object.keys(PRESERVE_OPTIONS)).toContain(k);
    }
    for (const k of DEFAULT_CONFIG.exclude ?? []) {
      expect(Object.keys(EXCLUDE_OPTIONS)).toContain(k);
    }
  });
});

describe("mergeConfig", () => {
  test("override wins, untouched keys fall back to base", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { camera: "leica-m" });
    expect(merged.camera).toBe("leica-m");
    expect(merged.preset).toBe(DEFAULT_CONFIG.preset);
  });

  test("undefined override keeps the base value", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { camera: undefined });
    expect(merged.camera).toBe(DEFAULT_CONFIG.camera);
  });

  test("arrays are replaced wholesale, not merged", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { preserve: ["faces_exact"] });
    expect(merged.preserve).toEqual(["faces_exact"]);
  });

  test("a non-array preserve is ignored in favour of the base", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { preserve: "faces_exact" as never });
    expect(merged.preserve).toEqual(DEFAULT_CONFIG.preserve);
  });

  test("blank freeform collapses to undefined", () => {
    expect(mergeConfig(DEFAULT_CONFIG, { freeform: "   " }).freeform).toBeUndefined();
  });
});

describe("parseConfig", () => {
  test("returns null on absent or malformed JSON", () => {
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig("")).toBeNull();
    expect(parseConfig("{ not json")).toBeNull();
    expect(parseConfig("[]")).not.toBeNull(); // arrays are objects; merge still yields defaults
    expect(parseConfig('"a string"')).toBeNull();
  });

  test("merges a partial stored config over the defaults", () => {
    const c = parseConfig(JSON.stringify({ camera: "hasselblad" }))!;
    expect(c.camera).toBe("hasselblad");
    expect(c.preset).toBe(DEFAULT_CONFIG.preset);
  });

  test("parsePartialConfig does NOT merge defaults", () => {
    const p = parsePartialConfig(JSON.stringify({ camera: "hasselblad" }))!;
    expect(p.camera).toBe("hasselblad");
    expect(p.preset).toBeUndefined();
  });
});

describe("clauses added for the Japan set", () => {
  test("neutral-strict names the amber of interiors, not just 'neutral'", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, white_balance: "neutral-strict" });
    // Un aggettivo ("neutro") non è verificabile; un riferimento sì.
    expect(p).toContain("must render truly white or neutral grey");
    expect(p).toContain("wood");
    // It neutralises the cast without switching the lamps off: it is the
    // difference between a corrected photo and a cold photo.
    expect(p).toContain("Keep the light sources themselves warm");
  });

  test("food strict lists the ways food comes out badly", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, food: "strict" });
    expect(p).toContain("never grey, brown, dull or iridescent");
    expect(p).toContain("egg yolks");
    // And it must not authorise changing the dish to make it look better.
    expect(p).toContain("Do NOT change the dish");
  });

  test("the historical options do not change", () => {
    expect(assemblePrompt({ ...DEFAULT_CONFIG, white_balance: "neutral" })).toContain(
      "neutral, accurate white balance",
    );
    expect(assemblePrompt({ ...DEFAULT_CONFIG, food: "off" })).not.toContain("appetizing");
  });
});

describe("optics and sky: options that name the result", () => {
  test("f/1.4 asks for optical blur, not a mask around the subject", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, dof: "wide-open" });
    expect(p).toContain("f/1.4");
    // È la differenza fra un vero diaframma e il finto-bokeh a ritaglio.
    expect(p).toContain("never a flat cut-out mask");
    expect(p).toContain("grow gradually with distance");
  });

  test("a heroic wide angle asks for the perspective, not just more field", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: "wide-hero" });
    expect(p).toContain("wide-angle hero reading");
    expect(p).toContain("its lines leading into the scene");
    // A wide angle that deforms the subject is the typical way of getting it
    // wrong.
    expect(p).toContain("no fisheye bulge");
  });

  test("a telephoto isolates by compressing the background", () => {
    expect(assemblePrompt({ ...DEFAULT_CONFIG, composition: "tele-isolate" })).toContain(
      "go telephoto",
    );
  });

  test("a clear sky gives a verifiable reference, not an adjective", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, sky: "bright-airy" });
    // "più chiaro degli edifici" si può guardare; "arioso" no.
    expect(p).toContain("BRIGHTER than the buildings");
    expect(p).toContain("never dark, heavy, navy or stormy");
  });

  test("the historical options stay as they were", () => {
    expect(assemblePrompt({ ...DEFAULT_CONFIG, dof: "preserve" })).toContain(
      "preserve original depth of field",
    );
    expect(assemblePrompt({ ...DEFAULT_CONFIG, sky: "deep-blue" })).toContain("deep, clean blue");
    expect(assemblePrompt({ ...DEFAULT_CONFIG, composition: "recompose" })).toContain(
      "recompose the frame decisively",
    );
  });
});

describe("skies and optics chosen for the scene", () => {
  test("the night sky asks for FEW stars, not a firmament", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, sky: "deep-night" });
    // Saying only "night" makes the model fill the void with a milky way:
    // the number has to be named, and so does what NOT to do.
    expect(p).toContain("Stars must be clearly VISIBLE yet sparse");
    expect(p).toContain("never a milky way");
    expect(p).toContain("dramatic gradient");
    // The clouds had fallen under the same ban as the fake stars, and the sky
    // stayed empty: at night they are the only atmosphere available, but only
    // the ones already there, lit from below by the city.
    expect(p).toContain("lit from below by the city glow");
    // the ban "only if they were already there" left clear skies empty, and
    // those are the ones that most need atmosphere: clouds are added.
    expect(p).toContain("Add them even if the original sky was clear");
    // the night shots came out as one amber bath: the warmth must sit where
    // the lamps reach, the rest stays cold. It is the contrast that makes
    // the night.
    expect(p).toContain("must NOT drown in one amber or yellow bath");
    // the yellow stayed on the lit SUBJECT even when the frame's average was
    // cold: stone under floodlights must not take on amber.
    expect(p).toContain("The lit subject itself must NOT turn amber or golden");
    expect(p).not.toContain("invented where the sky was clear");
  });

  test("extending the edges does not authorise inventing an object in front", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: "recompose" });
    // Su IMG_2906 il reframe ha piazzato un tetto inesistente davanti alla
    // pagoda: "extend the edges" veniva letto come "riempi il bordo nuovo".
    expect(p).toContain("every pixel of the result comes from the scene as photographed");
    expect(p).toContain("do not add any object, structure, roof");
    expect(p).toContain("Keep the subject unobstructed");
    // The remedy for the crop ("base and top inside the frame") ORDERED
    // invention: if the foundations were not in the shot, the model has to
    // draw them to obey. An incomplete subject is a fact of the photo.
    expect(p).toContain("Missing is left missing; present is kept present");
    expect(p).not.toContain("its base and top clearly INSIDE the picture");
    // The remedy ("whole and centred") had produced the opposite defect: a
    // flat crop, which is exactly the snapshot the base prompt forbids.
    expect(p).toContain("not a rectangle cut out of a snapshot");
    expect(p).toContain("Never a flat, dead-centre crop");
    expect(p).not.toContain("either centred or on a thirds line");
  });

  test("the daytime sky asks for a single surface, without patches", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, sky: "even-blue" });
    // It is the defect measured on the set: more saturated areas next to
    // washed-out ones.
    expect(p).toContain("ONE single continuous surface");
    expect(p).toContain("no patches");
    expect(p).toContain("no halo around buildings");
  });

  test("the heroic object is not the generic wide angle", () => {
    const obj = assemblePrompt({ ...DEFAULT_CONFIG, composition: "hero-object" });
    const wide = assemblePrompt({ ...DEFAULT_CONFIG, composition: "wide-hero" });
    expect(obj).toContain("make the object the hero");
    expect(obj).toContain("no melted panels or warped wheels");
    expect(obj).not.toBe(wide);
  });

  test("the tunnel asks for the vanishing point, not just a wide field", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: "tunnel" });
    expect(p).toContain("converge toward the vanishing point");
    expect(p).toContain("verticals dead straight");
  });

  test("the pre-existing options do not change", () => {
    expect(assemblePrompt({ ...DEFAULT_CONFIG, sky: "deep-blue" })).toContain("deep, clean blue");
    expect(assemblePrompt({ ...DEFAULT_CONFIG, composition: "recompose" })).toContain(
      "recompose the frame decisively",
    );
  });
});

describe("the sky follows the time the photo was taken", () => {
  test("an evening photo takes the night sky, a daytime one the uniform sky", async () => {
    const { withSkyForTime } = await import("../server/photos.ts");
    const base = { ...DEFAULT_CONFIG };
    const at = (h: number) => new Date(2026, 2, 13, h, 0).getTime();
    const photo = (h: number) =>
      ({ taken_at: at(h), config_override: null }) as never;

    expect(withSkyForTime(base, photo(20)).sky).toBe("deep-night");
    expect(withSkyForTime(base, photo(3)).sky).toBe("deep-night");
    expect(withSkyForTime(base, photo(11)).sky).toBe("even-blue");
  });

  test("an explicit per-photo choice beats the time of day", async () => {
    const { withSkyForTime } = await import("../server/photos.ts");
    // Whoever chose the sky by hand knows what they are doing: the automatic
    // rule must not overwrite it.
    const photo = {
      taken_at: new Date(2026, 2, 13, 20, 0).getTime(),
      config_override: '{"sky":"deep-blue"}',
    } as never;
    expect(withSkyForTime({ ...DEFAULT_CONFIG, sky: "deep-blue" }, photo).sky).toBe("deep-blue");
  });

  test("with no date it assumes day instead of guessing", async () => {
    const { withSkyForTime } = await import("../server/photos.ts");
    const photo = { taken_at: null, config_override: null } as never;
    expect(withSkyForTime({ ...DEFAULT_CONFIG }, photo).sky).toBe("even-blue");
  });
});

describe("moving the camera is not inventing the scene", () => {
  // The distinction that was missing: changing WHERE you look from must stay
  // free (it is the heart of an editorial edit), changing WHAT is there must
  // not. Permission to extend the edges was read as a licence to fill, and on
  // IMG_2906 a non-existent roof and invented temple details appeared.
  const OTTICHE = ["recompose", "wide-hero", "hero-object", "tunnel", "tele-isolate"] as const;

  for (const c of OTTICHE) {
    test(`${c}: la macchina si muove, la scena resta quella`, () => {
      const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: c });
      // The crop stays free and decisive...
      expect(p).toContain("recompose the frame decisively");
      // ...but inside the image that exists: as long as the edge could be
      // extended, every ban was worked around — the void has to be filled
      // somehow.
      expect(p).toContain("must be a crop of the source, never wider than it");
      expect(p).toContain("Do not extend, expand, out-paint or fill beyond the original edges");
      expect(p).toContain("do not add any object, structure, roof");
      // and real architecture is not redrawn along with the point of view
      expect(p).toContain("keep their real architecture exactly");
      expect(p).toContain("it never redesigns them");
    });
  }

  test("the rule is written once, not copied into every optic", async () => {
    const src = await Bun.file(new URL("../server/promptConfig.ts", import.meta.url)).text();
    // Five copies of the same sentence diverge at the first tweak: it has
    // already happened with "reframing may extend or alter the edges".
    expect(src).toContain("const REFRAME_FREEDOM =");
    expect(src).not.toContain('"recompose the frame freely — reframing may extend or alter the edges — and "');
  });

  test("no optic asks to physically move", () => {
    // "get low and close", "move back": asking the camera to be where it was
    // not is asking it to invent what would be seen from there. The optics must
    // describe a CROP, not a move.
    for (const c of OTTICHE) {
      const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: c });
      expect(p).not.toContain("get low and close to the subject");
      expect(p).not.toContain("move back and tighten");
      expect(p).not.toContain("stand in the middle of the path");
      expect(p).not.toContain("get right up to it");
    }
  });

  test("the base prompt does not invite an angle that was not there", () => {
    const p = assemblePrompt({ ...DEFAULT_CONFIG });
    // "an unexpected angle" is an invitation to invent the point of view.
    expect(p).not.toContain("an unexpected angle");
    expect(p).toContain("hidden INSIDE this photograph");
    expect(p).toContain("never widen, extend or invent scene that was not photographed");
  });
});

describe("an incomplete subject stays incomplete", () => {
  test("no optic asks to complete what the photo did not capture", () => {
    // On IMG_2906 the pagoda is shot from below and the foundations are not
    // there: asking for "the whole subject" is an order to invent them, and
    // indeed every render redrew the temple.
    for (const c of ["recompose", "wide-hero", "hero-object", "tunnel", "tele-isolate"] as const) {
      const p = assemblePrompt({ ...DEFAULT_CONFIG, composition: c });
      expect(p).toContain("an incomplete subject is a fact of this photograph");
      expect(p).toContain("Never invent the missing base, steps, plinth, ground or lower structure");
      // ...but the opposite symmetry has to be stated, otherwise the remedy
      // becomes "I crop off the temple's side just to tighten": on v90 that
      // happened.
      expect(p).toContain("never TAKE AWAY what the photograph did capture");
      expect(p).toContain("the crop must not cut a side off it");
    }
  });
});
