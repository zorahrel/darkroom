import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { origine, setPick } from "../server/video.ts";
import { addProject, rootDir, withProject } from "../server/project.ts";
import { workflow } from "../server/comfy.ts";

/**
 * `origine()` dice quali riprese vengono dalla stessa generazione, e la stessa
 * definizione vive in `pianifica.py`. Duplicarla e' accettabile — e' una
 * definizione, non una politica — a patto che qualcosa si accorga se le due
 * divergono. Questo file e' quel qualcosa.
 */

/** Casi decisi guardando i descrittori misurati, non a occhio.
 *  Chi si unisce sta fra 0.75 e 0.99 di somiglianza; chi non si unisce sta
 *  sotto (la famiglia "k" tutta insieme misurava 0.705, la "x" 0.761). */
const CASI: [string, string][] = [
  // due meta' della stessa presa: stesso seme, stessa inquadratura
  ["z43_0", "z43"],
  ["z43_1", "z43"],
  ["z109_1", "z109"],
  // varianti della stessa impostazione
  ["g_camm0", "g_camm"],
  ["g_camm3", "g_camm"],
  ["f_spruz0", "f_spruz"],
  ["w_lato2", "w_lato"],
  ["mare8", "mare"],
  // generazioni DIVERSE che una regola troppo larga univa: k00 e k15 erano
  // finiti entrambi in "k", cioe' sedici riprese di mare trattate come una
  ["k00", "k00"],
  ["k15", "k15"],
  ["c21", "c21"],
  ["x34", "x34"],
  ["d07", "d07"],
  // nomi senza cifre: restano se stessi
  ["decollo", "decollo"],
  ["volo", "volo"],
  ["frangiflutti", "frangiflutti"],
];

describe("origine", () => {
  for (const [inside, outside] of CASI) {
    test(`${inside} -> ${outside}`, () => {
      expect(origine(inside)).toBe(outside);
    });
  }

  test("non tocca mai la parte che non e' una cifra finale", () => {
    expect(origine("w_rasa")).toBe("w_rasa");
    expect(origine("f_lonta0")).toBe("f_lonta");
  });
});

/**
 * L'accordo con il Python. Si salta quando il progetto video non e' su questa
 * macchina — un test che non puo' misurare non deve fingere di aver misurato —
 * ma quando c'e', deve tornare identico su ogni caso.
 */
/** Where the video project's Python lives. One person's folder used to be
 *  hardcoded here, which meant these tests could only ever run for them. */
const VIDEO_PY_DIR = process.env.VIDEO_PY_DIR ?? "";
const PIANIFICA = VIDEO_PY_DIR ? `${VIDEO_PY_DIR}/pianifica.py` : "";

/** Leggibile, non solo esistente.
 *
 *  Il guardiano diceva `existsSync`, e il 27/08/2026 e' capitato il caso che
 *  separa le due cose: il file c'era ma il processo aveva perso il permesso di
 *  aprirlo (EPERM su tutta la cartella del progetto). Il test partiva e moriva
 *  dentro Python su un errore che non c'entra niente con cio' che verifica.
 *  Per quello che questi test vogliono sapere — "il progetto video e' a
 *  disposizione su questa macchina?" — un file che non si puo' leggere e un
 *  file che non c'e' sono la stessa cosa. */
const leggibile = (p: string) => {
  if (!p) return false;
  try { accessSync(p, constants.R_OK); return true; } catch { return false; }
};

describe.if(leggibile(PIANIFICA))("origine, la stessa in Python", () => {
  test("le due implementazioni concordano su tutti i casi", () => {
    const names = CASI.map(([k]) => k);
    // Il modulo si importa senza eseguire main() (che sta sotto __main__), e
    // si chiama la sua origine() sugli stessi nomi.
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
    // Se le due divergono, questo dice SU QUALE nome — non solo che divergono.
    expect(fromPython).toEqual(names.map((n) => origine(n)));
  });
});

/**
 * Il grafo di ComfyUI vive in due posti: `gen.py` (272 riprese generate da li')
 * e `server/comfy.ts` (quelle che si generano dalla UI). Se divergono, due
 * riprese dello stesso progetto smettono di essere confrontabili e la
 * differenza fra loro non dice piu' niente sul prompt — che e' l'unica cosa che
 * si sta cercando di leggere quando si rigenera una scena bocciata.
 *
 * Non e' un test di forma: confronta il JSON nodo per nodo, con gli stessi
 * parametri passati a entrambi.
 */
const GEN = VIDEO_PY_DIR ? `${VIDEO_PY_DIR}/gen.py` : "";

describe.if(leggibile(GEN))("il grafo ComfyUI e' lo stesso in Python e in TypeScript", () => {
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
 * L'annulla deve riportare la ripresa a "mai giudicata", non a "tenuta".
 *
 * `kept` e' un booleano, e una ripresa mai vista ce l'ha vero — nessuno l'ha
 * scartata. Finche' l'annulla ripristinava quello, disfare uno scarto scriveva
 * la ripresa fra i TENUTI: premevi «annulla» su una scena mai giudicata e le
 * davi un si'. Un annulla che lascia il verdetto opposto e' peggio del verdetto
 * sbagliato, perche' sembra di essere tornati indietro. Misurato su `g_corr`.
 */
describe("togliere un verdetto e' un terzo stato, non un si'", () => {
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

  test("scarto, poi annullo: la ripresa non risulta ne' scartata ne' tenuta", () => {
    inTempProject(() => {
      setPick("g_corr0", false, "prova");
      expect(letto().scartati["g_corr0"]).toBe("prova");

      setPick("g_corr0", null); // l'annulla
      const s = letto();
      expect(s.scartati["g_corr0"]).toBeUndefined();
      expect(s.tenuti["g_corr0"]).toBeUndefined();
    });
  });

  test("annullare un si' non lo trasforma in uno scarto", () => {
    inTempProject(() => {
      setPick("w_alto", true);
      expect(letto().tenuti["w_alto"]).toBeGreaterThan(0);

      setPick("w_alto", null);
      const s = letto();
      expect(s.tenuti["w_alto"]).toBeUndefined();
      expect(s.scartati["w_alto"]).toBeUndefined();
    });
  });

  test("i due verdetti veri restano quelli di prima", () => {
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
