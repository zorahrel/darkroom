import { describe, expect, test } from "bun:test";
import { app } from "../server/app.ts";
import { TOOLS, AREAS, tool } from "../server/tools.ts";
import { STARTABLE } from "../server/routes/tools.ts";
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
const ROUTES = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
const MCP_NAMES = new Set(MCP.map((t) => t.name));

/**
 * I due strumenti che parlano DEL catalogo, non che ci stanno dentro. Sono
 * l'unica eccezione ammessa alla copertura, ed è scritta qui invece che
 * dedotta con una regola: due nomi si leggono, una regola si aggira.
 */
const META = new Set(["list_tools", "start_tool"]);

describe("il catalogo degli strumenti non promette roba che non c'è", () => {
  test("ogni rotta dichiarata è montata sul server", () => {
    const ghosts: string[] = [];
    for (const s of TOOLS) {
      for (const route of s.api) {
        // Le rotte dello storyboard sono montate su un prefisso: il catalogo
        // le scrive per intero perché è così che si chiamano da fuori.
        const [method, path] = route.split(" ") as [string, string];
        const variants = [
          `${method} ${path}`,
          `${method} ${path.replace("/api/storyboard", "")}`,
          `${method} ${path.replace("/api/verify", "")}`,
        ];
        if (!variants.some((v) => ROUTES.has(v))) ghosts.push(`${s.id} → ${route}`);
      }
    }
    expect(ghosts).toEqual([]);
  });

  test("ogni strumento MCP dichiarato esiste davvero", () => {
    const ghosts: string[] = [];
    for (const s of TOOLS) {
      for (const name of s.mcp) if (!MCP_NAMES.has(name)) ghosts.push(`${s.id} → ${name}`);
    }
    expect(ghosts).toEqual([]);
  });

  test("ogni strumento MCP è raccontato da qualche voce del catalogo", () => {
    const covered = new Set(TOOLS.flatMap((s) => s.mcp));
    const orphans = [...MCP_NAMES].filter((n) => !covered.has(n) && !META.has(n));
    expect(orphans).toEqual([]);
  });

  test("aree, id e avvii sono ben formati", () => {
    const areas = new Set(AREAS.map((a) => a.id));
    const visti = new Set<string>();
    for (const s of TOOLS) {
      expect(visti.has(s.id), `id doppio: ${s.id}`).toBe(false);
      visti.add(s.id);
      expect(areas.has(s.area), `area sconosciuta in ${s.id}: ${s.area}`).toBe(true);
      expect(s.what.length, `${s.id} non dice cosa fa`).toBeGreaterThan(20);
      for (const a of s.starters) {
        if (a.mode === "open") expect(a.route.includes(":pid")).toBe(true);
        else expect(Array.isArray(a.fields)).toBe(true);
      }
    }
  });
});

describe("GET /api/tools", () => {
  test("elenca tutto, con cosa è pronto e cosa manca", async () => {
    const r = await app.request("/api/tools");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.tools).toHaveLength(TOOLS.length);
    expect(j.areas.length).toBe(AREAS.length);
    // Ogni strumento non pronto dice PERCHÉ, non solo che non lo è: uno
    // strumento grigio senza motivo è una porta chiusa senza cartello.
    for (const s of j.tools) {
      expect(typeof s.ready).toBe("boolean");
      if (!s.ready) {
        expect(s.missing.length).toBeGreaterThan(0);
        for (const m of s.missing) expect(m.how.length).toBeGreaterThan(10);
      }
    }
  });

  test("i progetti di uno strumento sono quelli con la vista giusta", async () => {
    const r = await app.request("/api/tools/edit/projects");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    for (const p of j.projects) expect(p.views).toContain("video");
  });
});

describe("POST /api/tools/:id/start", () => {
  test("uno strumento sconosciuto è un 404, non un crash", async () => {
    const r = await app.request("/api/tools/inesistente/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });

  test("uno strumento che si apre e basta lo dice, invece di fingere di partire", async () => {
    const r = await app.request("/api/tools/tree/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("progetto");
  });

  test("un campo obbligatorio mancante torna il motivo, non un 500", async () => {
    const r = await app.request("/api/tools/projects/start", {
      method: "POST",
      body: JSON.stringify({ values: {} }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("nome");
  });

  test("«progetto vuoto» crea davvero il progetto e dice dove atterrare", async () => {
    const name = `catalogo-${Date.now()}`;
    const r = await app.request("/api/tools/projects/start", {
      method: "POST",
      body: JSON.stringify({ values: { name } }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.route).toBe(`/p/${j.project}`);
    expect(j.done).toContain(name);

    const list = (await (await app.request("/api/studio/projects")).json()) as any;
    expect(list.projects.some((p: any) => p.id === j.project)).toBe(true);
  });

  test("una scaletta diventa uno storyboard con i suoi pannelli", async () => {
    const r = await app.request("/api/tools/storyboard/start", {
      method: "POST",
      body: JSON.stringify({
        values: { name: `board-${Date.now()}`, beats: "lei entra\nprimo piano\nla strada vuota" },
      }),
    });
    // Senza generatore vivo l'avvio si ferma prima, e lo dice: è il
    // comportamento voluto (409), non un fallimento del catalogo.
    if (r.status === 409) {
      expect(((await r.json()) as any).missing).toContain("generator");
      return;
    }
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.route).toBe(`/p/${j.project}/storyboard`);
    const board = (await (
      await app.request("/api/storyboard", { headers: { "x-darkroom-project": j.project } })
    ).json()) as any;
    expect(board.panels).toHaveLength(3);
  });

  test("ogni strumento con un avvio rapido ha chi lo esegue", () => {
    // Contro il motore, non contro la rotta: chiamare gli avvii per davvero
    // vorrebbe dire far partire Chrome e creare progetti veri dentro la suite.
    const withoutEngine = TOOLS.filter(
      (s) => s.starters.some((a) => a.mode !== "open") && !STARTABLE.has(s.id),
    ).map((s) => s.id);
    expect(withoutEngine).toEqual([]);
  });

  test("e nessun motore avanza senza il suo strumento nel catalogo", () => {
    const orphans = [...STARTABLE].filter((id) => !TOOLS.some((s) => s.id === id));
    expect(orphans).toEqual([]);
  });
});

test("strumento() trova per id", () => {
  expect(tool("color")?.name).toBe("Sviluppo colore");
  expect(tool("boh")).toBeUndefined();
});
