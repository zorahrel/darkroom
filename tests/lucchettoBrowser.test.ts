import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proprietarioMorto } from "../server/worker.ts";

/**
 * Il lucchetto del browser si libera quando chi lo tiene e' morto, non solo
 * quando il file invecchia. Il 24/09 un `generate` di kaumat e' morto tenendolo
 * (pid 23150) e il lavoro successivo e' rimasto fermo su «Invio a ChatGPT…»
 * senza nessun processo vivo, fino alla scadenza per eta' (oltre 12 minuti).
 */
describe("lucchetto del browser", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucchetto-"));
  const scrivi = (contenuto: string) => {
    const p = join(dir, `l-${Math.random()}`);
    writeFileSync(p, contenuto);
    return p;
  };

  test("un pid che non esiste e' un proprietario morto", () => {
    expect(proprietarioMorto(scrivi(`999999 ${Date.now()}`))).toBe(true);
  });

  test("un pid vivo no", () => {
    // il processo padre del test runner e' certamente vivo
    expect(proprietarioMorto(scrivi(`${process.ppid} ${Date.now()}`))).toBe(false);
  });

  test("il proprio pid non si considera morto", () => {
    expect(proprietarioMorto(scrivi(`${process.pid} ${Date.now()}`))).toBe(false);
  });

  test("un file senza pid lascia decidere l'eta'", () => {
    expect(proprietarioMorto(scrivi("spazzatura"))).toBe(false);
    expect(proprietarioMorto(join(dir, "non-esiste"))).toBe(false);
  });
});
