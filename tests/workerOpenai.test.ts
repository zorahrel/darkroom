import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { costUsd } from "../server/worker-openai.ts";

/**
 * Il backend OpenAI è l'unico che costa soldi veri a ogni generazione, quindi
 * quello che si controlla qui è ciò che una svista fa pagare: che il default
 * non diventi il backend a pagamento, che chi non guida un browser non lo
 * faccia partire, e che il costo si legga dai token riportati dall'API invece
 * che da una tabella (misurato il 26/08: una `high` 1024² ha consumato 7024
 * token dove i docs ne davano 4160 — stimarlo avrebbe sbagliato del 70%).
 */

/** config.ts legge l'env all'import: per provare più backend serve un modulo
 *  fresco ogni volta, altrimenti si testerebbe sempre la prima lettura. */
async function loadConfig(backend?: string) {
  const prev = process.env.WORKER_BACKEND;
  if (backend === undefined) delete process.env.WORKER_BACKEND;
  else process.env.WORKER_BACKEND = backend;
  const mod = await import(`../server/config.ts?t=${Date.now()}${Math.random()}`);
  if (prev === undefined) delete process.env.WORKER_BACKEND;
  else process.env.WORKER_BACKEND = prev;
  return mod;
}

describe("il backend a pagamento non si sceglie da solo", () => {
  test("senza WORKER_BACKEND resta cdp, che è gratis", async () => {
    const c = await loadConfig(undefined);
    expect(c.WORKER_BACKEND).toBe("cdp");
  });

  test("openai si attiva solo se richiesto esplicitamente", async () => {
    const c = await loadConfig("openai");
    expect(c.WORKER_BACKEND).toBe("openai");
  });
});

describe("solo il backend cdp guida un browser", () => {
  // Il guard escludeva per nome il solo "codex": con codex-http e openai
  // Darkroom lanciava Chrome per sorvegliare una finestra che non usa.
  test("cdp sì, gli altri no", async () => {
    expect((await loadConfig(undefined)).BACKEND_USES_BROWSER).toBe(true);
    expect((await loadConfig("codex")).BACKEND_USES_BROWSER).toBe(false);
    expect((await loadConfig("codex-http")).BACKEND_USES_BROWSER).toBe(false);
    expect((await loadConfig("openai")).BACKEND_USES_BROWSER).toBe(false);
  });
});

describe("il costo si calcola sui token veri", () => {
  test("una high misurata costa quanto è stata pagata", () => {
    // 7024 token osservati sul batch del 26/08 → $0.2107 al prezzo sincrono.
    expect(costUsd("gpt-image-2", 7024)).toBeCloseTo(0.2107, 4);
  });

  test("una low costa due ordini di grandezza meno", () => {
    expect(costUsd("gpt-image-2", 196)).toBeCloseTo(0.00588, 5);
  });

  test("un modello sconosciuto non azzera il conto", () => {
    // Tornare 0 farebbe sembrare gratis una passata che invece si paga.
    expect(costUsd("gpt-image-9-inesistente", 7024)).toBeGreaterThan(0);
  });
});

describe("gpt-image-1-mini è la via economica", () => {
  test("costa meno di gpt-image-2 a parità di token", () => {
    expect(costUsd("gpt-image-1-mini", 7024)).toBeLessThan(costUsd("gpt-image-2", 7024));
  });
});

describe("senza chiave non si tenta la rete", () => {
  // OAI-03: il messaggio deve contenere il comando esatto, altrimenti chi lo
  // legge deve andarselo a cercare — ed e' il primo errore che vedra' chiunque
  // provi questo backend su una macchina nuova.
  //
  // Il caso "Keychain assente" non si simula con PATH: Bun.spawnSync non
  // rispetta un PATH cambiato a runtime e trovava la chiave vera, facendo
  // partire una chiamata a pagamento dentro la suite. Si verifica invece sul
  // sorgente, che e' l'unica cosa deterministica qui.
  test("l'errore dice come registrare la chiave", async () => {
    const src = await Bun.file(new URL("../server/worker-openai.ts", import.meta.url)).text();
    expect(src).toContain("add-generic-password");
    expect(src).toContain("-s");
    expect(src).toContain("openai");
    // Ogni entry point pubblico deve controllare la chiave come prima cosa:
    // se la guardia stesse dopo, chi non ce l'ha vedrebbe un errore di rete
    // invece dell'istruzione per risolverlo. Si guarda dentro ciascuna
    // funzione, non nel file: le helper con i fetch sono dichiarate sopra.
    for (const fn of ["runWorkerOpenAiGenerate", "runWorkerOpenAi"]) {
      const start = src.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf("\nexport ", start + 1) >>> 0 || undefined);
      const guard = body.indexOf("openaiKey()");
      const call = body.indexOf("runEdits");
      const gen = body.indexOf("callImages");
      const firstCall = Math.min(...[call, gen].filter((i) => i > 0));
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(firstCall);
    }
  });

  test("la chiave non compare in nessun file versionato", async () => {
    // La convenzione del progetto e' Keychain, non .env (che qui e' world-readable).
    const example = await Bun.file(new URL("../.env.example", import.meta.url)).text();
    expect(example).not.toMatch(/sk-(proj-)?[A-Za-z0-9_-]{20,}/);
    expect(example).toContain("add-generic-password");
  });
});

describe("il backend parla davvero con OpenAI", () => {
  // I test sopra guardano il sorgente; questo guarda il traffico. Con una
  // chiave fittizia si arriva fino alla richiesta senza spendere: se il
  // routing fosse sbagliato, la URL non sarebbe quella di OpenAI.
  test("generate colpisce /v1/images/generations e un errore non lascia file", async () => {
    const prev = process.env.OPENAI_API_KEY;
    const prevFetch = globalThis.fetch;
    const urls: string[] = [];
    process.env.OPENAI_API_KEY = "sk-test-non-valida-per-il-routing";
    // Si intercetta e NON si inoltra: cosi' il test dice la stessa cosa su una
    // macchina senza rete, e non spende nemmeno la richiesta rifiutata.
    globalThis.fetch = ((u: unknown) => {
      urls.push(String(u));
      return Promise.resolve(
        new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), {
          status: 401,
        }),
      );
    }) as typeof fetch;
    const out = "/tmp/darkroom-routing-test.png";
    try {
      const mod = await import(`../server/worker-openai.ts?routing=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: out });
      expect(urls[0]).toBe("https://api.openai.com/v1/images/generations");
      // Chiave invalida = errore pulito, non un crash e non un file vuoto in
      // galleria (che sarebbe indistinguibile da una versione buona).
      expect(r.status).toBe("error");
      expect(existsSync(out)).toBe(false);
    } finally {
      globalThis.fetch = prevFetch;
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  }, 60_000);
});

describe("il batch chiede davvero quello che dice di chiedere", () => {
  // "ovviamente batch high" e' una direttiva sulla configurazione, e il posto
  // dove puo' rompersi in silenzio e' il JSONL: un default sbagliato li' dentro
  // produce cinquanta immagini in low senza che nessuno se ne accorga finche'
  // non le guarda.
  test("submit scrive model e quality nel JSONL", async () => {
    const prevFetch = globalThis.fetch;
    const prevArgv = process.argv;
    let jsonl = "";
    globalThis.fetch = (async (u: unknown, o: { body?: unknown }) => {
      const url = String(u);
      if (url.endsWith("/files")) {
        jsonl = await ((o.body as FormData).get("file") as File).text();
        return new Response(JSON.stringify({ id: "file-fake" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "batch-fake" }), { status: 200 });
    }) as unknown as typeof fetch;
    const promptFile = "/tmp/darkroom-batch-spec.txt";
    await Bun.write(promptFile, "# commento\nuna insegna\n\nun gatto\n");
    process.argv = [prevArgv[0] as string, "x", "submit", promptFile];
    try {
      await import(`../scripts/openai_batch.ts?spec=${Date.now()}${Math.random()}`);
      const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
      // Commento e riga vuota non diventano immagini pagate.
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        expect(l.url).toBe("/v1/images/generations");
        expect(l.body.model).toBe("gpt-image-2");
        expect(l.body.quality).toBe("high");
      }
    } finally {
      globalThis.fetch = prevFetch;
      process.argv = prevArgv;
    }
  }, 30_000);
});
