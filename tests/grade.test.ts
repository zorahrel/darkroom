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

describe("bloom e sakura: i parametri aggiunti restano retrocompatibili", () => {
  test("i default dei nuovi parametri sono neutri", () => {
    // knee 2 (comportamento storico) fa alonare solo le specularità: su una
    // scena senza riflessi accecanti il bloom sparisce del tutto, ed era il caso
    // dell'oro del castello. knee/gain e hue_shift/sat sono opt-in: assenti dal
    // JSON, lo script usa i valori storici e le foto già gradate non cambiano.
    const chain = defaultSteps();
    const bloom = chain.find((s) => s.type === "bloom");
    const sakura = chain.find((s) => s.type === "sakura");
    // Nessuno dei due porta i nuovi parametri nella catena di default: il
    // comportamento base è esattamente quello di prima.
    expect(bloom?.params.knee).toBeUndefined();
    expect(sakura?.params.hue_shift).toBeUndefined();
  });

  test("i parametri nuovi sopravvivono a sanitizeSteps", () => {
    // Se il sanitizer li scartasse, il grade salvato tornerebbe silenziosamente
    // al look sbagliato al primo riavvio del server.
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

describe("bloom: uno solo, non due", () => {
  test("la catena di default non porta un passo bloom", () => {
    // Il prompt AI chiede già "soft cinematic bloom and gentle glow around
    // existing bright light sources": aggiungerne un secondo in locale li somma.
    // Misurato su 5 foto: bianchi bruciati dal 3,9% al 6,7%, e l'oro dei templi
    // che diventava una macchia bianca.
    expect(defaultSteps().some((s) => s.type === "bloom")).toBe(false);
  });

  test("il passo bloom resta disponibile per chi lo vuole a mano", () => {
    // Toglierlo dal default non significa cancellarlo: su un set senza AI
    // (solo grade locale) serve, e sanitizeSteps deve continuare ad accettarlo.
    const kept = sanitizeSteps([
      { id: "b", type: "bloom", enabled: true, params: { amount: 30 } },
    ]);
    expect(kept.some((s) => s.type === "bloom")).toBe(true);
  });
});

describe("armonizzazione per post", () => {
  test("il passo match riceve i parametri del gruppo, non quelli salvati", async () => {
    const { resolveStepsForScript } = await import("../server/grade.ts");
    const steps = [
      { id: "m", type: "match" as const, enabled: true, params: {} },
    ];
    const match = { a_shift: 2.5, b_shift: -3.1, a_scale: 1.05, b_scale: 0.95 };
    const out = resolveStepsForScript(steps, match);
    expect(out).toHaveLength(1);
    // Solo crominanza: la luminanza della scena non entra nella correzione.
    expect(out[0]!.params.a_shift).toBe(2.5);
    expect(out[0]!.params.b_scale).toBe(0.95);
    expect(out[0]!.params).not.toHaveProperty("exposure");
  });

  test("senza gruppo il passo sparisce invece di applicarsi a vuoto", async () => {
    const { resolveStepsForScript } = await import("../server/grade.ts");
    // Foto non assegnata a un post, o post con una foto sola: non c'è nulla con
    // cui armonizzare, e un passo senza parametri applicherebbe l'identità
    // (innocua ma inutile) o peggio dei default sbagliati.
    const out = resolveStepsForScript(
      [{ id: "m", type: "match" as const, enabled: true, params: {} }],
      null,
    );
    expect(out).toHaveLength(0);
  });

  test("gli altri passi non sono toccati dalla risoluzione del match", async () => {
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

describe("dose LUT graduale, non a scalino", () => {
  test("night_weight è una rampa continua, non un booleano", async () => {
    const py = await Bun.file(new URL("../scripts/color_grade.py", import.meta.url)).text();
    // La soglia netta faceva sì che due render della stessa foto — uno a luma
    // 68, uno a 61 — ricevessero 70% e 14% di LUT: uno dorato, l'altro spento.
    expect(py).toContain("def night_weight");
    expect(py).not.toContain("def scene_is_warm_dark");
    expect(py).toContain("np.clip(max(w_luma, w_red), 0.0, 1.0)");
  });

  test("la dose si interpola fra piena e notturna", async () => {
    const py = await Bun.file(new URL("../scripts/color_grade.py", import.meta.url)).text();
    expect(py).toContain('dose = dose * (1.0 - w) + float(p.get("dose_night")) * w');
  });
});
