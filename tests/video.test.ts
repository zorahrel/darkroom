import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { origin, setPick } from "../server/video.ts";
import { addProject, rootDir, withProject } from "../server/project.ts";
import { workflow } from "../server/comfy.ts";

/**
 * `origin()` says which shots come from the same generation, and the same
 * definition lives in `pianifica.py`. Duplicating it is acceptable — it is a
 * definition, not a policy — provided something notices if the two diverge.
 * This file is that something.
 */

/** Casi decisi guardando i descrittori misurati, non a occhio.
 *  Chi si unisce sta fra 0.75 e 0.99 di somiglianza; chi non si unisce sta
 *  sotto (la famiglia "k" tutta insieme misurava 0.705, la "x" 0.761). */
const CASI: [string, string][] = [
  // two halves of the same take: same seed, same framing
  ["z43_0", "z43"],
  ["z43_1", "z43"],
  ["z109_1", "z109"],
  // variants of the same setting
  ["g_camm0", "g_camm"],
  ["g_camm3", "g_camm"],
  ["f_spruz0", "f_spruz"],
  ["w_lato2", "w_lato"],
  ["mare8", "mare"],
  // DIFFERENT generations that a too-wide rule joined: k00 and k15 had both
  // ended up in "k", i.e. sixteen sea shots treated as one
  ["k00", "k00"],
  ["k15", "k15"],
  ["c21", "c21"],
  ["x34", "x34"],
  ["d07", "d07"],
  // names with no digits: they stay themselves
  ["decollo", "decollo"],
  ["volo", "volo"],
  ["frangiflutti", "frangiflutti"],
];

describe("origine", () => {
  for (const [inside, outside] of CASI) {
    test(`${inside} -> ${outside}`, () => {
      expect(origin(inside)).toBe(outside);
    });
  }

  test("it never touches the part that is not a trailing digit", () => {
    expect(origin("w_rasa")).toBe("w_rasa");
    expect(origin("f_lonta0")).toBe("f_lonta");
  });
});

/**
 * The agreement with the Python. It is skipped when the video project is not on
 * this machine — a test that cannot measure must not pretend it measured — but
 * when it is there, it must come out identical on every case.
 */
/** Where the video project's Python lives. One person's folder used to be
 *  hardcoded here, which meant these tests could only ever run for them. */
const VIDEO_PY_DIR = process.env.VIDEO_PY_DIR ?? "";
const PIANIFICA = VIDEO_PY_DIR ? `${VIDEO_PY_DIR}/pianifica.py` : "";

/** Readable, not merely existing.
 *
 *  The guard said `existsSync`, and on 27/08/2026 the case that separates the
 *  two came up: the file was there but the process had lost permission to open
 *  it (EPERM on the project's whole folder). The test started and died inside
 *  Python on an error that has nothing to do with what it verifies. For what
 *  these tests want to know — "is the video project available on this
 *  machine?" — a file that cannot be read and a file that is not there are the
 *  same thing. */
const readable = (p: string) => {
  if (!p) return false;
  try { accessSync(p, constants.R_OK); return true; } catch { return false; }
};

describe.if(readable(PIANIFICA))("origine, la stessa in Python", () => {
  test("the two implementations agree on every case", () => {
    const names = CASI.map(([k]) => k);
    // The module imports without running main() (which is under __main__), and
    // its origin() is called on the same names.
    const py = [
      "import importlib.util, json, sys",
      `spec = importlib.util.spec_from_file_location("p", ${JSON.stringify(PIANIFICA)})`,
      "m = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(m)",
      `nomi = json.loads(${JSON.stringify(JSON.stringify(names))})`,
      "print(json.dumps([m.origine(n) for n in nomi]))",
    ].join("\n");
    const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 30_000 });
    expect(r.status, `python: ${r.stderr}`).toBe(0);
    const fromPython = JSON.parse(r.stdout.trim().split("\n").pop() ?? "[]") as string[];
    // If the two diverge, this says ON WHICH name — not just that they do.
    expect(fromPython).toEqual(names.map((n) => origin(n)));
  });
});

/**
 * ComfyUI's graph lives in two places: `gen.py` (272 shots generated from
 * there) and `server/comfy.ts` (the ones generated from the UI). If they
 * diverge, two shots of the same project stop being comparable and the
 * difference between them says nothing about the prompt any more — which is the
 * only thing you are trying to read when regenerating a rejected scene.
 *
 * It is not a test of shape: it compares the JSON node by node, with the same
 * parameters passed to both.
 */
const GEN = VIDEO_PY_DIR ? `${VIDEO_PY_DIR}/gen.py` : "";

describe.if(readable(GEN))("il grafo ComfyUI e' lo stesso in Python e in TypeScript", () => {
  const casi = [
    { name: "senza tasselli", p: { width: 704, height: 1280, length: 121, steps: 30, cfg: 5.0, shift: 8.0, seed: 1, tiled: 0, overlap: 64, neg_extra: "" } },
    { name: "a tasselli, i default di oggi", p: { width: 640, height: 1152, length: 61, steps: 20, cfg: 5.0, shift: 8.0, seed: 7, tiled: 256, overlap: 64, neg_extra: "niente gambe rotte" } },
  ];
  for (const { name, p } of casi) {
    test(name, () => {
      const py = [
        "import importlib.util, json",
        `spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GEN)})`,
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
        `a = json.loads(${JSON.stringify(JSON.stringify(p))})`,
        'print(json.dumps(m.workflow("pre", "un prompt", a["length"], a["seed"], a["steps"], a["cfg"],',
        '      a["width"], a["height"], a["shift"], None, a["neg_extra"], None, a["tiled"], a["overlap"]), sort_keys=True))',
      ].join("\n");
      const r = spawnSync("python3", ["-c", py], { encoding: "utf8", timeout: 30_000 });
      expect(r.status, `python: ${r.stderr}`).toBe(0);
      const fromPython = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}");
      expect(JSON.parse(JSON.stringify(workflow("pre", "un prompt", p as any)))).toEqual(fromPython);
    });
  }
});

/**
 * Undo must return the shot to "never judged", not to "kept".
 *
 * `kept` is a boolean, and a shot never seen has it true — nobody discarded it.
 * As long as undo restored that, undoing a discard wrote the shot among the
 * KEPT ones: you pressed «undo» on a never-judged shot and gave it a yes. An
 * undo that leaves the opposite verdict is worse than the wrong verdict,
 * because it feels like you went back. Measured on `g_corr`.
 */
describe("removing a verdict is a third state, not a yes", () => {
  /** A throwaway video project. Named apart from the imported `withProject`
   *  on purpose: when both were called that, the helper called itself. */
  const inTempProject = <T,>(fn: () => T): T => {
    const dir = mkdtempSync(join(tmpdir(), "video-scelte-"));
    // These keys are the on-disk contract shared with the Python pipeline, so
    // they stay in Italian here even though the code around them does not.
    writeFileSync(join(dir, "scelte.json"), JSON.stringify({ scartati: {}, tenuti: {} }));
    const p = addProject({ name: `scelte-${Date.now()}`, root: dir, kind: "video" });
    return withProject(p.id, fn);
  };
  const letto = () => JSON.parse(readFileSync(join(rootDir(), "scelte.json"), "utf8"));

  test("discard, then undo: the shot comes out neither discarded nor kept", () => {
    inTempProject(() => {
      setPick("g_corr0", false, "prova");
      expect(letto().scartati["g_corr0"]).toBe("prova");

      setPick("g_corr0", null); // l'annulla
      const s = letto();
      expect(s.scartati["g_corr0"]).toBeUndefined();
      expect(s.tenuti["g_corr0"]).toBeUndefined();
    });
  });

  test("undoing a yes does not turn it into a discard", () => {
    inTempProject(() => {
      setPick("w_alto", true);
      expect(letto().tenuti["w_alto"]).toBeGreaterThan(0);

      setPick("w_alto", null);
      const s = letto();
      expect(s.tenuti["w_alto"]).toBeUndefined();
      expect(s.scartati["w_alto"]).toBeUndefined();
    });
  });

  test("the two real verdicts stay as they were", () => {
    inTempProject(() => {
      setPick("mare6", true);
      expect(letto().tenuti["mare6"]).toBeGreaterThan(0);
      setPick("mare6", false, "si sfascia");
      const s = letto();
      expect(s.scartati["mare6"]).toBe("si sfascia");
      expect(s.tenuti["mare6"]).toBeUndefined();
    });
  });
});
