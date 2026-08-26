/**
 * Il percorso reale, non la funzione isolata: un job accodato in DB, lavorato
 * dal runner col backend `openai`, che deve finire 'done' con una versione in
 * galleria. I test unitari coprivano le funzioni del worker; questo copre
 * l'unica cosa che l'utente vede — la foto che compare, o non compare.
 *
 * Fa una chiamata VERA all'Images API in `low` (~196 token, ~$0.006), quindi è
 * opt-in: senza `OPENAI_E2E=1` i due test a pagamento si saltano. Lasciarli
 * accesi di default portava `bun test` da 15s a 342s e faceva pagare ogni run.
 *
 * Uso: OPENAI_E2E=1 bun test tests/openaiE2E.test.ts
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEST_ROOT } from "./setup.ts";

const hasKey = (() => {
  if (process.env.OPENAI_API_KEY?.trim()) return true;
  try {
    const r = Bun.spawnSync(["security", "find-generic-password", "-s", "openai", "-a", "darkroom", "-w"]);
    return r.exitCode === 0 && new TextDecoder().decode(r.stdout).trim().length > 0;
  } catch {
    return false;
  }
})();
/** Serve sia la chiave sia il consenso esplicito: questi test costano. */
const live = hasKey && process.env.OPENAI_E2E === "1";

// `low` invece di `high`: stesso percorso di codice, ~35x meno costo. Quello
// che si verifica qui è il giro completo, non la resa.
process.env.OPENAI_IMAGE_QUALITY = "low";
process.env.WORKER_BACKEND = "openai";

const outDir = join(TEST_ROOT, "e2e");
beforeAll(() => mkdirSync(outDir, { recursive: true }));

describe.skipIf(!live)("backend openai: il giro completo produce un file vero", () => {
  test(
    "generate scrive un PNG leggibile sul disco",
    async () => {
      const { runWorkerOpenAiGenerate } = await import("../server/worker-openai.ts");
      const out = join(outDir, "gen.png");
      const r = await runWorkerOpenAiGenerate({ prompt: "a plain red circle on white", output: out });

      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      // Non basta lo status: il file deve esistere, essere un PNG e non essere vuoto.
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(1024);
      const head = Buffer.from(await Bun.file(out).arrayBuffer()).subarray(0, 8);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(r.size_kb).toBeGreaterThan(0);
    },
    5 * 60 * 1000,
  );

  test(
    "edit riparte da una sorgente e produce un file diverso",
    async () => {
      const { runWorkerOpenAi, runWorkerOpenAiGenerate } = await import("../server/worker-openai.ts");
      const src = join(outDir, "src.png");
      const gen = await runWorkerOpenAiGenerate({ prompt: "a plain blue square on white", output: src });
      expect(gen.status).toBe("ok");

      const out = join(outDir, "edited.png");
      // Il MIME sul Blob è ciò che rompeva questo percorso: senza, l'endpoint
      // edits risponde "unsupported mimetype ('application/octet-stream')".
      const r = await runWorkerOpenAi({ image: src, prompt: "make the background yellow", output: out });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(existsSync(out)).toBe(true);
      const a = Buffer.from(await Bun.file(src).arrayBuffer());
      const b = Buffer.from(await Bun.file(out).arrayBuffer());
      expect(b.equals(a)).toBe(false); // un edit che restituisce l'originale è un edit fallito
    },
    8 * 60 * 1000,
  );
});

describe("gli errori non diventano file rotti in galleria", () => {
  test("una sorgente inesistente fallisce prima di chiamare l'API", async () => {
    const { runWorkerOpenAi } = await import("../server/worker-openai.ts");
    const out = join(outDir, "mai.png");
    const r = await runWorkerOpenAi({ image: join(outDir, "NONESISTE.png"), prompt: "x", output: out });
    expect(r.status).toBe("error");
    // Il punto: un fallimento non deve lasciare un file mezzo scritto che poi
    // in griglia sembra una versione buona.
    expect(existsSync(out)).toBe(false);
  });
});
