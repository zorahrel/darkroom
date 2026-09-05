import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finalizeFile, workingFile } from "../server/jobs.ts";
import { versionFileName } from "../server/db.ts";
import { TEST_ROOT } from "./setup.ts";

/**
 * THE FAULT, measured on 05/09 on the sunglasses ablation of the `profilo`
 * project.
 *
 * Three jobs of the same photo (235, 236, 237) were worked at once — the
 * watchdog had restarted the loop without the old one being dead, and the loops
 * had added up. Each one, on entry, computed the next version number and
 * derived its output file from it: all three `v71.png`. Then each rewrote the
 * number at insert time, and versions 71, 72 and 73 were born — three rows, one
 * file, two renders lost. Nothing failed: the queue said "done" three times.
 *
 * The invariant these tests defend: while generating, a job writes to a file of
 * ITS OWN; the final name is given to it at the end, when the version number is
 * finally known.
 */
function dirDiProva(nome: string): string {
  const d = join(TEST_ROOT, "collisione", nome);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("the file a job writes to while generating", () => {
  test("two jobs of the same photo do not share the working file", () => {
    const d = dirDiProva("a");
    expect(workingFile(d, 235)).not.toBe(workingFile(d, 236));
  });

  test("it does not carry a version's name: nobody can mistake it for a finished render", () => {
    const d = dirDiProva("b");
    expect(workingFile(d, 71)).not.toBe(join(d, versionFileName(71)));
    expect(workingFile(d, 71).endsWith("v71.png")).toBe(false);
  });
});

describe("handing the file over to the version number", () => {
  test("the returned path exists and is the one that ends up in the row", () => {
    const d = dirDiProva("c");
    const work = workingFile(d, 900);
    writeFileSync(work, "render");
    const finale = finalizeFile(work, d, 71);
    expect(finale).toBe(join(d, "v71.png"));
    expect(existsSync(finale)).toBe(true);
    // The working file is not left behind: two copies of the same image would
    // make a folder of discards look full.
    expect(existsSync(work)).toBe(false);
  });

  test("three parallel jobs produce three distinct files, each with its own content", () => {
    // It is the exact scenario of 05/09, with the difference that here the three
    // jobs really write their own result before handing it over.
    const d = dirDiProva("d");
    const jobs = [235, 236, 237];
    const contenuti = ["controllo", "ref+parole", "solo-ref"];
    for (const [i, id] of jobs.entries()) writeFileSync(workingFile(d, id), contenuti[i]!);

    // Le consegne avvengono in ordine di arrivo, ognuna col numero calcolato
    // in quel momento — come fa `processJob`.
    const finals = jobs.map((id, i) => finalizeFile(workingFile(d, id), d, 71 + i));

    expect(new Set(finals).size).toBe(3);
    for (const [i, f] of finals.entries()) {
      expect(existsSync(f)).toBe(true);
      expect(readFileSync(f, "utf8")).toBe(contenuti[i]!);
    }
  });
});
