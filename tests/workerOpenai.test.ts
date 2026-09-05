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

describe("quanto si e' speso si vede prima, non dopo", () => {
  // Con un backend a pagamento l'unico modo di sapere quanto costa un progetto
  // era guardare la fattura a fine mese. Il saldo residuo non si puo' leggere:
  // /organization/costs e /dashboard/billing rispondono 403 "Missing scopes:
  // api.usage.read" a una chiave di progetto. Quindi si somma cio' che l'API ha
  // riportato a ogni generazione.
  test("il worker restituisce il costo dai token della risposta", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-costo";
    // 1x1 PNG valido: saveResult rilegge il file da disco.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 7024 } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?costo=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({
        prompt: "x",
        output: "/tmp/darkroom-costo-test.png",
      });
      expect(r.status).toBe("ok");
      // 7024 token a $30/M = $0.2107, il costo vero misurato il 26/08.
      expect(r.cost_usd).toBeCloseTo(0.2107, 4);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);

  test("senza usage il costo resta assente, non zero", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-costo";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?nousage=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-costo2.png" });
      expect(r.status).toBe("ok");
      // Zero direbbe "gratis", che e' una risposta diversa da "non misurabile".
      expect(r.cost_usd).toBeUndefined();
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);
});

describe("si paga la chiamata, non la versione salvata", () => {
  // Contare `versions` dava $1.26 su 6 immagini dove le chiamate erano 21 per
  // ~$2.79: le prove di calibrazione finiscono in /tmp, gli scarti non si
  // salvano, e i fallimenti dopo la generazione si pagano lo stesso. Nessuno di
  // questi lasciava una versione da contare, quindi il numero in barra non era
  // impreciso: era strutturalmente incompleto.
  test("una generazione riuscita lascia una riga in api_calls", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-chiamate";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 7024 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      const before = db().query<{ n: number }, []>("SELECT COUNT(*) AS n FROM api_calls").get()?.n ?? 0;
      const mod = await import(`../server/worker-openai.ts?call=${Date.now()}${Math.random()}`);
      await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-call-test.png" });
      const after = db().query<{ n: number; tot: number }, []>(
        "SELECT COUNT(*) AS n, SUM(cost_usd) AS tot FROM api_calls",
      ).get();
      expect(after!.n).toBe(before + 1);
      // Il costo registrato e' quello vero, non una stima da tabella.
      const last = db().query<{ cost_usd: number; output_tokens: number }, []>(
        "SELECT cost_usd, output_tokens FROM api_calls ORDER BY id DESC LIMIT 1",
      ).get();
      expect(last!.output_tokens).toBe(7024);
      expect(last!.cost_usd).toBeCloseTo(0.2107, 4);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);
});

describe("il tetto giornaliero morde prima di spendere", () => {
  // Il limite vero sta sull'account OpenAI ma non e' impostabile da qui (403) e
  // arriva come alert DOPO. Questo si applica prima della chiamata: e' l'unico
  // freno che Darkroom puo' azionare da solo.
  test("oltre il tetto non parte nessuna richiesta", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    process.env.OPENAI_API_KEY = "sk-test-tetto";
    process.env.OPENAI_DAILY_CAP_USD = "0.01"; // gia' superato dalle righe sotto
    // Si spegne la soglia sincrona: qui si misura il TETTO, e con entrambi
    // attivi scatterebbe l'altro e il test direbbe di un freno diverso.
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?cap=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-cap.png" });
      expect(r.status).toBe("error");
      expect(r.error).toContain("tetto giornaliero");
      // Il punto: bloccare DOPO la fetch non risparmierebbe niente.
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
    }
  }, 30_000);

  test("sotto il tetto la generazione procede", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    process.env.OPENAI_API_KEY = "sk-test-tetto2";
    process.env.OPENAI_DAILY_CAP_USD = "999";
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?cap2=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-cap2.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
    }
  }, 30_000);
});

describe("il batch non e' una porta di servizio", () => {
  // Il tetto e il conteggio vivevano nel worker, ma scripts/openai_batch.ts
  // chiama l'API da solo: cinquanta prompt in high sono ~$5 che non
  // comparivano da nessuna parte e che nessun limite fermava.
  test("submit rifiuta quando il batch supererebbe il tetto", async () => {
    const prevFetch = globalThis.fetch;
    const prevArgv = process.argv;
    const prevCap = process.env.OPENAI_DAILY_CAP_USD;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevExit = process.exit;
    process.env.OPENAI_API_KEY = "sk-test-batchcap";
    process.env.OPENAI_DAILY_CAP_USD = "0.01";
    let chiamate = 0;
    let exited = false;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    // process.exit(1) qui e' il comportamento voluto: si intercetta per poterlo
    // osservare senza far morire il runner dei test.
    process.exit = ((code?: number) => {
      exited = code === 1;
      throw new Error("__exit__");
    }) as never;
    const file = "/tmp/darkroom-batch-cap.txt";
    await Bun.write(file, "un prompt\naltro prompt\n");
    process.argv = [prevArgv[0] as string, "x", "submit", file];
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test',?)`,
        [Date.now()],
      );
      await import(`../scripts/openai_batch.ts?bcap=${Date.now()}${Math.random()}`).catch((e) => {
        if (!String(e?.message).includes("__exit__")) throw e;
      });
      expect(exited).toBe(true);
      // Il punto: niente upload, niente batch creato, niente speso.
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      process.argv = prevArgv;
      process.exit = prevExit;
      if (prevCap === undefined) delete process.env.OPENAI_DAILY_CAP_USD;
      else process.env.OPENAI_DAILY_CAP_USD = prevCap;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
    }
  }, 30_000);

  test("lo sconto batch dimezza il costo senza falsare i token", async () => {
    const { db } = await import("../server/db.ts");
    const mod = await import(`../server/worker-openai.ts?sconto=${Date.now()}${Math.random()}`);
    mod.recordCall("gpt-image-2", 7024, true, "test-sconto", 0.5);
    const r = db()
      .query<{ output_tokens: number; cost_usd: number }, []>(
        "SELECT output_tokens, cost_usd FROM api_calls WHERE origin='test-sconto' ORDER BY id DESC LIMIT 1",
      )
      .get();
    // I token restano quelli veri: sono cio' che il modello ha prodotto.
    expect(r!.output_tokens).toBe(7024);
    // Il costo e' meta': quella e' la tariffa.
    expect(r!.cost_usd).toBeCloseTo(0.1054, 4);
  });
});

describe("la strada cara non deve essere quella comoda", () => {
  // Il batch costa meta' ed esisteva da giorni, ma 25 chiamate su 25 sono state
  // fatte in sincrono: $2.81 dove bastavano $1.40. Non mancava un'opzione,
  // mancava un attrito sulla strada sbagliata.
  test("oltre la soglia il sincrono rimanda al batch senza chiamare l'API", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    process.env.OPENAI_API_KEY = "sk-test-budget";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.01";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',7024,0.2107,1,'test-budget',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?bud=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-budget.png" });
      expect(r.status).toBe("error");
      // Il messaggio deve dire COSA fare, non solo che è vietato.
      expect(r.error).toContain("openai_batch.ts");
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
    }
  }, 30_000);

  test("una prova in low passa anche dopo una giornata di high", async () => {
    // IL BUG: il freno confrontava il TOTALE DEL GIORNO con la soglia, quindi
    // dopo $2.81 di generazioni rifiutava anche una prova da mezzo centesimo —
    // che e' esattamente il modo giusto di lavorare. Ora pesa il costo della
    // chiamata che sta per partire.
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    const prevQ = process.env.OPENAI_IMAGE_QUALITY;
    process.env.OPENAI_API_KEY = "sk-test-low";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.5";
    process.env.OPENAI_IMAGE_QUALITY = "low";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const { db } = await import("../server/db.ts");
      // Una giornata gia' spesa, ben oltre la soglia del sincrono.
      db().run(
        `INSERT INTO api_calls (provider,model,quality,output_tokens,cost_usd,ok,origin,created_at)
         VALUES ('openai','gpt-image-2','high',93000,2.81,1,'test-low',?)`,
        [Date.now()],
      );
      const mod = await import(`../server/worker-openai.ts?low=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-low.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
      if (prevQ === undefined) delete process.env.OPENAI_IMAGE_QUALITY;
      else process.env.OPENAI_IMAGE_QUALITY = prevQ;
    }
  }, 30_000);

  test("con delle reference non manda al batch, che non le accetta", async () => {
    // Il batch non supporta /edits: consigliarlo a chi sta usando una
    // reference e' mandarlo in un vicolo cieco. Deve suggerire `low`.
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    const prevQ = process.env.OPENAI_IMAGE_QUALITY;
    process.env.OPENAI_API_KEY = "sk-test-refs";
    process.env.OPENAI_SYNC_BUDGET_USD = "0.01";
    process.env.OPENAI_IMAGE_QUALITY = "high";
    let chiamate = 0;
    globalThis.fetch = (async () => {
      chiamate++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const { writeFileSync } = await import("node:fs");
    writeFileSync("/tmp/darkroom-src-test.png", Buffer.from("x"));
    try {
      const mod = await import(`../server/worker-openai.ts?refs=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAi({
        image: "/tmp/darkroom-src-test.png",
        prompt: "x",
        output: "/tmp/darkroom-refs.png",
      });
      expect(r.status).toBe("error");
      expect(r.error).not.toContain("openai_batch.ts");
      expect(r.error).toContain("low");
      expect(chiamate).toBe(0);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
      if (prevQ === undefined) delete process.env.OPENAI_IMAGE_QUALITY;
      else process.env.OPENAI_IMAGE_QUALITY = prevQ;
    }
  }, 30_000);

  test("a soglia zero il freno non c'e'", async () => {
    const prevFetch = globalThis.fetch;
    const prevKey = process.env.OPENAI_API_KEY;
    const prevBudget = process.env.OPENAI_SYNC_BUDGET_USD;
    process.env.OPENAI_API_KEY = "sk-test-budget0";
    process.env.OPENAI_SYNC_BUDGET_USD = "0";
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ b64_json: png }], usage: { output_tokens: 196 } }), {
        status: 200,
      })) as unknown as typeof fetch;
    try {
      const mod = await import(`../server/worker-openai.ts?bud0=${Date.now()}${Math.random()}`);
      const r = await mod.runWorkerOpenAiGenerate({ prompt: "x", output: "/tmp/darkroom-budget0.png" });
      expect(r.status).toBe("ok");
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevBudget === undefined) delete process.env.OPENAI_SYNC_BUDGET_USD;
      else process.env.OPENAI_SYNC_BUDGET_USD = prevBudget;
    }
  }, 30_000);
});
