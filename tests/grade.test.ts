import { describe, expect, test } from "bun:test";
import { gradeWarnings } from "../server/grade.ts";
import {
  DEFAULT_LUT,
  defaultSteps,
  normalizeGrade,
  sanitizeSteps,
} from "../server/db.ts";

describe("sanitizeSteps", () => {
  test("falls back to the default chain on junk input", () => {
    for (const junk of [null, undefined, 42, "steps", {}]) {
      expect(sanitizeSteps(junk).map((s) => s.type)).toEqual(
        defaultSteps().map((s) => s.type),
      );
    }
  });

  test("an empty list yields the default chain, not an empty pipeline", () => {
    expect(sanitizeSteps([]).length).toBe(defaultSteps().length);
  });

  test("keeps order and params of valid steps", () => {
    const steps = sanitizeSteps([
      { id: "a", type: "levels", enabled: true, params: { black: 1, white: 98 } },
      { id: "b", type: "lut", enabled: false, params: { lut: "x.cube", dose: 50 } },
    ]);
    expect(steps.map((s) => s.type)).toEqual(["levels", "lut"]);
    expect(steps[0]!.params).toEqual({ black: 1, white: 98 });
    expect(steps[1]!.enabled).toBe(false);
  });

  test("drops steps of an unknown type instead of trusting the client", () => {
    const steps = sanitizeSteps([
      { id: "a", type: "levels", enabled: true, params: {} },
      { id: "evil", type: "shell_exec", enabled: true, params: { cmd: "rm -rf /" } },
    ]);
    expect(steps.map((s) => s.type)).toEqual(["levels"]);
  });

  test("skips non-objects inside the list", () => {
    const steps = sanitizeSteps(["nope", null, 7, { id: "a", type: "sakura", enabled: true, params: {} }]);
    expect(steps.map((s) => s.type)).toEqual(["sakura"]);
  });

  test("defaults enabled to true and mints an id when missing", () => {
    const [step] = sanitizeSteps([{ type: "bloom", params: {} }]);
    expect(step!.enabled).toBe(true);
    expect(step!.id).toBeTruthy();
  });

  test("a missing params object becomes an empty one", () => {
    const [step] = sanitizeSteps([{ id: "a", type: "hsl", enabled: true }]);
    expect(step!.params).toEqual({});
  });
});

describe("normalizeGrade", () => {
  test("null/garbage yields a disabled default grade", () => {
    for (const junk of [null, undefined, "x", 3]) {
      const g = normalizeGrade(junk);
      expect(g.enabled).toBe(false);
      expect(g.steps.map((s) => s.type)).toEqual(defaultSteps().map((s) => s.type));
    }
  });

  test("keeps a step-based grade as-is", () => {
    const g = normalizeGrade({
      enabled: true,
      steps: [{ id: "l", type: "levels", enabled: true, params: { black: 2 } }],
    });
    expect(g.enabled).toBe(true);
    expect(g.steps.map((s) => s.type)).toEqual(["levels"]);
  });

  test("enabled is strictly boolean true — truthy values do not turn the grade on", () => {
    expect(normalizeGrade({ enabled: 1, steps: [] }).enabled).toBe(false);
  });

  test("migrates the old flat format into the step chain", () => {
    const g = normalizeGrade({
      enabled: true,
      awb: false,
      scene_match: false,
      pop: false,
      lut: "MyLook.cube",
      dose: 42,
      auto_dose: false,
      dose_night: 10,
    });
    const byId = Object.fromEntries(g.steps.map((s) => [s.id, s]));
    expect(byId.wb!.enabled).toBe(false); // awb + scene_match both off
    expect(byId.sakura!.enabled).toBe(false); // pop: false
    expect(byId.lut!.params).toMatchObject({ lut: "MyLook.cube", dose: 42, auto_dose: false, dose_night: 10 });
  });

  test("a legacy grade without lut fields keeps the default LUT", () => {
    const g = normalizeGrade({ enabled: true, awb: true });
    const lut = g.steps.find((s) => s.id === "lut")!;
    expect(lut.params.lut).toBe(DEFAULT_LUT);
    expect(lut.params.dose).toBe(80);
  });
});

describe("bloom and sakura: the added parameters stay backwards-compatible", () => {
  test("the defaults of the new parameters are neutral", () => {
    // knee 2 (the historical behaviour) haloes only the speculars: on a scene
    // without blinding reflections the bloom disappears entirely, and that was
    // the case with the castle's gold. knee/gain and hue_shift/sat are opt-in:
    // absent from the JSON, the script uses the historical values and photos
    // already graded do not change.
    const chain = defaultSteps();
    const bloom = chain.find((s) => s.type === "bloom");
    const sakura = chain.find((s) => s.type === "sakura");
    // Neither of them brings the new parameters into the default chain: the
    // base behaviour is exactly what it was before.
    expect(bloom?.params.knee).toBeUndefined();
    expect(sakura?.params.hue_shift).toBeUndefined();
  });

  test("i parametri nuovi sopravvivono a sanitizeSteps", () => {
    // If the sanitizer discarded them, the saved grade would silently go back
    // to the wrong look on the first server restart.
    const steps = sanitizeSteps([
      { id: "sakura", type: "sakura", enabled: true, params: { sat: 85, hue_shift: 14 } },
      {
        id: "bloomfix",
        type: "bloom",
        enabled: true,
        params: { amount: 50, threshold: 52, radius: 18, knee: 1, gain: 2.5 },
      },
    ]);
    const sakura = steps.find((s) => s.type === "sakura");
    const bloom = steps.find((s) => s.type === "bloom");
    expect(sakura?.params.hue_shift).toBe(14);
    expect(sakura?.params.sat).toBe(85);
    expect(bloom?.params.knee).toBe(1);
    expect(bloom?.params.gain).toBe(2.5);
  });
});

describe("bloom: one only, not two", () => {
  test("the default chain does not carry a bloom step", () => {
    // The AI prompt already asks for "soft cinematic bloom and gentle glow
    // around existing bright light sources": adding a second one locally sums
    // them. Measured over 5 photos: blown whites from 3.9% to 6.7%, and the
    // temples' gold turning into a white blob.
    expect(defaultSteps().some((s) => s.type === "bloom")).toBe(false);
  });

  test("the bloom step stays available for whoever wants it by hand", () => {
    // Taking it out of the default does not mean deleting it: on a set without
    // AI (local grade only) it is needed, and sanitizeSteps has to keep
    // accepting it.
    const kept = sanitizeSteps([
      { id: "b", type: "bloom", enabled: true, params: { amount: 30 } },
    ]);
    expect(kept.some((s) => s.type === "bloom")).toBe(true);
  });
});

describe("per-post harmonisation", () => {
  test("the match step receives the group's parameters, not the saved ones", async () => {
    const { resolveStepsForScript } = await import("../server/grade.ts");
    const steps = [
      { id: "m", type: "match" as const, enabled: true, params: {} },
    ];
    const match = { a_shift: 2.5, b_shift: -3.1, a_scale: 1.05, b_scale: 0.95 };
    const out = resolveStepsForScript(steps, match);
    expect(out).toHaveLength(1);
    // Chrominance only: the scene's luminance does not enter the correction.
    expect(out[0]!.params.a_shift).toBe(2.5);
    expect(out[0]!.params.b_scale).toBe(0.95);
    expect(out[0]!.params).not.toHaveProperty("exposure");
  });

  test("without a group the step disappears instead of applying to nothing", async () => {
    const { resolveStepsForScript } = await import("../server/grade.ts");
    // A photo not assigned to a post, or a post with a single photo: there is
    // nothing to harmonise with, and a step without parameters would apply the
    // identity (harmless but useless) or worse, some wrong defaults.
    const out = resolveStepsForScript(
      [{ id: "m", type: "match" as const, enabled: true, params: {} }],
      null,
    );
    expect(out).toHaveLength(0);
  });

  test("the other steps are untouched by resolving the match", async () => {
    const { resolveStepsForScript } = await import("../server/grade.ts");
    const out = resolveStepsForScript(
      [
        { id: "c", type: "color" as const, enabled: true, params: { temp: -18 } },
        { id: "m", type: "match" as const, enabled: true, params: {} },
      ],
      { a_shift: 0, b_shift: 0, a_scale: 1, b_scale: 1 },
    );
    expect(out.map((s) => s.type)).toEqual(["color", "match"]);
    expect(out[0]!.params.temp).toBe(-18);
  });
});

describe("a gradual LUT dose, not a stepped one", () => {
  test("night_weight is a continuous ramp, not a boolean", async () => {
    const py = await Bun.file(new URL("../scripts/color_grade.py", import.meta.url)).text();
    // The hard threshold meant two renders of the same photo — one at luma 68,
    // one at 61 — got 70% and 14% of LUT: one golden, the other flat.
    expect(py).toContain("def night_weight");
    expect(py).not.toContain("def scene_is_warm_dark");
    expect(py).toContain("np.clip(max(w_luma, w_red), 0.0, 1.0)");
  });

  test("the dose is interpolated between full and night-time", async () => {
    const py = await Bun.file(new URL("../scripts/color_grade.py", import.meta.url)).text();
    expect(py).toContain('dose = dose * (1.0 - w) + float(p.get("dose_night")) * w');
  });

  test("a night step does not touch a daytime scene", () => {
    // The correction that saves a night shot (taking the amber off stone under
    // floodlights) would flatten food's colours by day: the step declares when
    // it lives and is dosed on night_weight's continuous ramp, not on a
    // threshold.
    const steps = sanitizeSteps([
      { id: "a", type: "hsl", enabled: true, only: "night", params: { sat_orange: -60 } },
      { id: "b", type: "color", enabled: true, only: "day", params: { temp: 5 } },
      { id: "c", type: "levels", enabled: true, params: {} },
    ]);
    expect(steps[0]!.only).toBe("night");
    expect(steps[1]!.only).toBe("day");
    expect(steps[2]!.only).toBeUndefined();
  });

  test("an invalid only value is discarded instead of being passed to the python", () => {
    const steps = sanitizeSteps([{ id: "a", type: "levels", enabled: true, only: "sometimes", params: {} }]);
    expect(steps[0]!.only).toBeUndefined();
  });


  test("the python doses only=night on the same continuous ramp as the LUT", async () => {
    const py = await Bun.file(new URL("../scripts/color_grade.py", import.meta.url)).text();
    // If it were a threshold, two nearly identical shots would get opposite
    // corrections: it is the same defect already fixed on the LUT's dose.
    expect(py).toContain('only = step.get("only")');
    expect(py).toContain('w = nw if only == "night" else (1.0 - nw)');
    expect(py).toContain("b = a * (1.0 - w) + b * w");
  });

});

describe("a personal LUT has to make it all the way through", () => {
  const lutStep = (dose = 100, dose_night = 45) => ({
    id: "lut", type: "lut" as const, enabled: true,
    params: { lut: "X.cube", dose, dose_night },
  });
  const colorStep = (saturation: number) => ({
    id: "color", type: "color" as const, enabled: true, params: { saturation },
  });

  test("a saturation raised AFTER the lut is flagged", () => {
    // A real case: CMG SUMMER desaturates (0.66 -> 0.38 at 100%), but a 'color'
    // step with saturation=+40 at the end cancelled it. The file was there, the
    // step ran, the result disappeared right afterwards: saturated photos and
    // "without my LUT", without a single signal.
    const w = gradeWarnings([lutStep(), colorStep(40)]);
    expect(w.join(" ")).toContain("DOPO la LUT");
  });

  test("a saturation BEFORE the lut is not a problem", () => {
    expect(gradeWarnings([colorStep(40), lutStep()])).toEqual([]);
  });

  test("a nearly zero night-time dose is flagged", () => {
    // dose_night=14 out of 100: at night the set's look disappeared, and half
    // the trip is at night.
    const w = gradeWarnings([lutStep(70, 14)]);
    expect(w.join(" ")).toContain("di notte");
  });

  test("a healthy grade produces no warnings", () => {
    expect(gradeWarnings([lutStep(100, 45), colorStep(0)])).toEqual([]);
  });
});

describe("hsl: la luminanza negativa scurisce davvero", () => {
  /**
   * Il guadagno morbido della luminanza HSL teneva v=1 a 1 anche scurendo:
   * lo slider «Luminanza −100» su un blu chiaro non faceva quasi nulla, e un
   * alone luminoso sul fondo (profilo, 26/09) non si abbassava mai.
   */
  test("lum_blue −100 dimezza un blu pieno, e lum +100 non lo brucia", () => {
    const { mkdtempSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "hsl-"));
    const run = (params: Record<string, number>) => {
      const steps = join(dir, "s.json");
      writeFileSync(steps, JSON.stringify([{ type: "hsl", params }]));
      const out = join(dir, "o.png");
      const py = `
import sys; sys.path.insert(0, "scripts")
from PIL import Image
Image.new("RGB", (8, 8), (40, 60, 255)).save("${join(dir, "i.png")}")
import subprocess
subprocess.run([sys.executable, "scripts/color_grade.py", "--input", "${join(dir, "i.png")}", "--output", "${out}", "--steps-file", "${steps}"], check=True, capture_output=True)
print(max(Image.open("${out}").convert("RGB").getpixel((4, 4))))`;
      const r = Bun.spawnSync(["python3", "-c", py], { cwd: process.cwd() });
      return Number(new TextDecoder().decode(r.stdout).trim());
    };
    const scurito = run({ lum_blue: -100 });
    expect(scurito).toBeGreaterThan(110);
    expect(scurito).toBeLessThan(145); // ~128: meta' di 255
    expect(run({ lum_blue: 100 })).toBe(255); // schiarire resta morbido e non supera il massimo
  });
});

describe("hsl: min_sat risparmia i pixel quasi grigi", () => {
  /**
   * La frangia pallida tra pelle e fondo e' «blu» per tinta: desaturata e
   * scurita insieme al fondo diventava una linea grigia da ritaglio attorno al
   * viso (profilo, 26/09). Con min_sat i pixel poco saturi restano quasi
   * intatti; il default 0 lascia il comportamento di sempre.
   */
  test("un blu pallido resta com'e' con min_sat, un blu pieno si scurisce", () => {
    const { mkdtempSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "minsat-"));
    const run = (rgb: [number, number, number], params: Record<string, number>) => {
      const steps = join(dir, "s.json");
      writeFileSync(steps, JSON.stringify([{ type: "hsl", params }]));
      const inp = join(dir, "i.png"), out = join(dir, "o.png");
      const py = `
import sys, subprocess
from PIL import Image
Image.new("RGB", (8, 8), (${rgb.join(",")})).save("${inp}")
subprocess.run([sys.executable, "scripts/color_grade.py", "--input", "${inp}", "--output", "${out}", "--steps-file", "${steps}"], check=True, capture_output=True)
print(max(Image.open("${out}").convert("RGB").getpixel((4, 4))))`;
      const r = Bun.spawnSync(["python3", "-c", py], { cwd: process.cwd() });
      return Number(new TextDecoder().decode(r.stdout).trim());
    };
    const pallido: [number, number, number] = [215, 218, 235]; // saturazione ~0,09
    expect(run(pallido, { lum_blue: -100 })).toBeLessThan(140); // senza min_sat: scurito
    expect(run(pallido, { lum_blue: -100, min_sat: 0.4 })).toBeGreaterThan(200); // con min_sat: intatto
    expect(run([40, 60, 255], { lum_blue: -100, min_sat: 0.4 })).toBeLessThan(145); // il fondo pieno si scurisce comunque
  });
});

describe("skin: ritocco a frequenze solo sulla pelle", () => {
  /**
   * La foto sorgente (telefono) ha ombra di barba e una trama a ciottoli che
   * ChatGPT copia fedelmente: nessun prompt la toglie. Lo step la attenua come
   * un ritoccatore, senza toccare tono, fondo e bordi (profilo, 26/09).
   */
  test("il server tiene il tipo skin", () => {
    const [step] = sanitizeSteps([{ id: "s", type: "skin", enabled: true, params: { amount: 80 } }]);
    expect(step?.type).toBe("skin");
  });

  test("attenua la trama sulla pelle e lascia fondo e tono com'erano", () => {
    const { mkdtempSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const dir = mkdtempSync(join(tmpdir(), "skin-"));
    const inp = join(dir, "i.png"), out = join(dir, "o.png"), steps = join(dir, "s.json");
    writeFileSync(steps, JSON.stringify([{ type: "skin", params: { amount: 80, radius: 4, grain: 70 } }]));
    const py = `
import sys, subprocess, json, numpy as np
from PIL import Image
rng = np.random.default_rng(1)
H, W = 300, 1200                          # la scala del render vero (1254 px)
img = np.zeros((H, W, 3), np.float32)
img[:, :600] = (215, 160, 135)            # pelle
img[:, 600:] = (30, 60, 160)              # fondo blu
# trama a ciottoli sulla pelle: macchie di 3 px, come barba e trama del telefono
tex = rng.normal(0, 1, (H // 3 + 1, 600 // 3 + 1))
tex = np.kron(tex, np.ones((3, 3)))[:H, :600] * 14
img[:, :600] += tex[..., None]
Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save("${inp}")
subprocess.run([sys.executable, "scripts/color_grade.py", "--input", "${inp}", "--output", "${out}", "--steps-file", "${steps}"], check=True, capture_output=True)
a = np.asarray(Image.open("${inp}")).astype(np.float32); b = np.asarray(Image.open("${out}")).astype(np.float32)
core = (slice(60, 240), slice(60, 540))
print(json.dumps({
  "trama_prima": float(a[core].std(axis=(0, 1)).mean()), "trama_dopo": float(b[core].std(axis=(0, 1)).mean()),
  "tono_prima": float(a[core].mean()), "tono_dopo": float(b[core].mean()),
  "fondo_diff": float(np.abs(a[:, 700:] - b[:, 700:]).max()),
}))`;
    const r = Bun.spawnSync(["python3", "-c", py], { cwd: process.cwd() });
    const m = JSON.parse(new TextDecoder().decode(r.stdout).trim());
    expect(m.trama_dopo).toBeLessThan(m.trama_prima * 0.6);
    expect(Math.abs(m.tono_dopo - m.tono_prima)).toBeLessThan(2);
    expect(m.fondo_diff).toBeLessThanOrEqual(1);
  });
});
