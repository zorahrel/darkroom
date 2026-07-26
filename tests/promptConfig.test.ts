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
