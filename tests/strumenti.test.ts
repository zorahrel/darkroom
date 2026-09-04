import { describe, expect, test } from "bun:test";
import { app } from "../server/app.ts";
import { STRUMENTI, AREE, strumento } from "../server/strumenti.ts";
import { AVVIABILI } from "../server/routes/strumenti.ts";
import { tools as MCP } from "../mcp/server.ts";

/**
 * Il catalogo degli strumenti deve restare vero.
 *
 * Un elenco di capacità scritto a mano è una brochure il giorno dopo: dice
 * «Darkroom sviluppa il colore anche da MCP» quando quello strumento MCP non
 * esiste più, e chi legge ci crede. Questi test lo tengono ancorato a due
 * cose che il programma possiede davvero — le rotte registrate su Hono e i
 * nomi degli strumenti MCP — nelle DUE direzioni: niente promesse false, e
 * niente capacità nuove che il catalogo non racconta.
 */

/** Le rotte davvero montate, nella forma "METODO /percorso". */
const ROTTE = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
const NOMI_MCP = new Set(MCP.map((t) => t.name));

/**
 * I due strumenti che parlano DEL catalogo, non che ci stanno dentro. Sono
 * l'unica eccezione ammessa alla copertura, ed è scritta qui invece che
 * dedotta con una regola: due nomi si leggono, una regola si aggira.
 */
const META = new Set(["list_tools", "start_tool"]);

describe("il catalogo degli strumenti non promette roba che non c'è", () => {
  test("ogni rotta dichiarata è montata sul server", () => {
    const fantasma: string[] = [];
    for (const s of STRUMENTI) {
      for (const rotta of s.api) {
        // Le rotte dello storyboard sono montate su un prefisso: il catalogo
        // le scrive per intero perché è così che si chiamano da fuori.
        const [metodo, percorso] = rotta.split(" ") as [string, string];
        const varianti = [
          `${metodo} ${percorso}`,
          `${metodo} ${percorso.replace("/api/storyboard", "")}`,
          `${metodo} ${percorso.replace("/api/verify", "")}`,
        ];
        if (!varianti.some((v) => ROTTE.has(v))) fantasma.push(`${s.id} → ${rotta}`);
      }
    }
    expect(fantasma).toEqual([]);
  });

  test("ogni strumento MCP dichiarato esiste davvero", () => {
    const fantasma: string[] = [];
    for (const s of STRUMENTI) {
      for (const nome of s.mcp) if (!NOMI_MCP.has(nome)) fantasma.push(`${s.id} → ${nome}`);
    }
    expect(fantasma).toEqual([]);
  });

  test("ogni strumento MCP è raccontato da qualche voce del catalogo", () => {
    const coperti = new Set(STRUMENTI.flatMap((s) => s.mcp));
    const orfani = [...NOMI_MCP].filter((n) => !coperti.has(n) && !META.has(n));
    expect(orfani).toEqual([]);
  });

  test("aree, id e avvii sono ben formati", () => {
    const aree = new Set(AREE.map((a) => a.id));
    const visti = new Set<string>();
    for (const s of STRUMENTI) {
      expect(visti.has(s.id), `id doppio: ${s.id}`).toBe(false);
      visti.add(s.id);
      expect(aree.has(s.area), `area sconosciuta in ${s.id}: ${s.area}`).toBe(true);
      expect(s.cosa.length, `${s.id} non dice cosa fa`).toBeGreaterThan(20);
      for (const a of s.avvii) {
        if (a.modo === "apri") expect(a.rotta.includes(":pid")).toBe(true);
        else expect(Array.isArray(a.campi)).toBe(true);
      }
    }
  });
});

describe("GET /api/strumenti", () => {
  test("elenca tutto, con cosa è pronto e cosa manca", async () => {
    const r = await app.request("/api/strumenti");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.strumenti).toHaveLength(STRUMENTI.length);
    expect(j.aree.length).toBe(AREE.length);
    // Ogni strumento non pronto dice PERCHÉ, non solo che non lo è: uno
    // strumento grigio senza motivo è una porta chiusa senza cartello.
    for (const s of j.strumenti) {
      expect(typeof s.pronto).toBe("boolean");
      if (!s.pronto) {
        expect(s.manca.length).toBeGreaterThan(0);
        for (const m of s.manca) expect(m.come.length).toBeGreaterThan(10);
      }
    }
  });

  test("i progetti di uno strumento sono quelli con la vista giusta", async () => {
    const r = await app.request("/api/strumenti/montaggio/progetti");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    for (const p of j.progetti) expect(p.views).toContain("video");
  });
});

describe("POST /api/strumenti/:id/avvia", () => {
  test("uno strumento sconosciuto è un 404, non un crash", async () => {
    const r = await app.request("/api/strumenti/inesistente/avvia", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });

  test("uno strumento che si apre e basta lo dice, invece di fingere di partire", async () => {
    const r = await app.request("/api/strumenti/albero/avvia", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("progetto");
  });

  test("un campo obbligatorio mancante torna il motivo, non un 500", async () => {
    const r = await app.request("/api/strumenti/progetti/avvia", {
      method: "POST",
      body: JSON.stringify({ valori: {} }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("nome");
  });

  test("«progetto vuoto» crea davvero il progetto e dice dove atterrare", async () => {
    const nome = `catalogo-${Date.now()}`;
    const r = await app.request("/api/strumenti/progetti/avvia", {
      method: "POST",
      body: JSON.stringify({ valori: { nome } }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.rotta).toBe(`/p/${j.progetto}`);
    expect(j.fatto).toContain(nome);

    const elenco = (await (await app.request("/api/studio/projects")).json()) as any;
    expect(elenco.projects.some((p: any) => p.id === j.progetto)).toBe(true);
  });

  test("una scaletta diventa uno storyboard con i suoi pannelli", async () => {
    const r = await app.request("/api/strumenti/storyboard/avvia", {
      method: "POST",
      body: JSON.stringify({
        valori: { nome: `board-${Date.now()}`, scaletta: "lei entra\nprimo piano\nla strada vuota" },
      }),
    });
    // Senza generatore vivo l'avvio si ferma prima, e lo dice: è il
    // comportamento voluto (409), non un fallimento del catalogo.
    if (r.status === 409) {
      expect(((await r.json()) as any).manca).toContain("generatore");
      return;
    }
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.rotta).toBe(`/p/${j.progetto}/storyboard`);
    const board = (await (
      await app.request("/api/storyboard", { headers: { "x-darkroom-project": j.progetto } })
    ).json()) as any;
    expect(board.panels).toHaveLength(3);
  });

  test("ogni strumento con un avvio rapido ha chi lo esegue", () => {
    // Contro il motore, non contro la rotta: chiamare gli avvii per davvero
    // vorrebbe dire far partire Chrome e creare progetti veri dentro la suite.
    const senzaMotore = STRUMENTI.filter(
      (s) => s.avvii.some((a) => a.modo !== "apri") && !AVVIABILI.has(s.id),
    ).map((s) => s.id);
    expect(senzaMotore).toEqual([]);
  });

  test("e nessun motore avanza senza il suo strumento nel catalogo", () => {
    const orfani = [...AVVIABILI].filter((id) => !STRUMENTI.some((s) => s.id === id));
    expect(orfani).toEqual([]);
  });
});

test("strumento() trova per id", () => {
  expect(strumento("colore")?.nome).toBe("Sviluppo colore");
  expect(strumento("boh")).toBeUndefined();
});
