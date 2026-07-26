import { describe, expect, test } from "bun:test";
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
