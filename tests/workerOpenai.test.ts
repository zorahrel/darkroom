import { describe, expect, test } from "bun:test";
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

  test("gpt-image-1-mini è la via economica", () => {
    expect(costUsd("gpt-image-1-mini", 7024)).toBeLessThan(costUsd("gpt-image-2", 7024));
  });
});
