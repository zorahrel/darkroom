import { describe, expect, test } from "bun:test";
import { app } from "../server/app.ts";
import { TOOLS, AREAS, tool } from "../server/tools.ts";
import { STARTABLE } from "../server/routes/tools.ts";
import { tools as MCP } from "../mcp/server.ts";

/**
 * The tool catalogue must stay true.
 *
 * A hand-written list of capabilities is a brochure the next day: it says
 * «Darkroom develops the colour from MCP too» when that MCP tool no longer
 * exists, and whoever reads it believes it. These tests anchor it to two things
 * the program really owns — the routes registered on Hono and the names of the
 * MCP tools — in BOTH directions: no false promises, and no new capability the
 * catalogue does not tell about.
 */

/** The routes really mounted, in the form "METHOD /path". */
const ROUTES = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
const MCP_NAMES = new Set(MCP.map((t) => t.name));

/**
 * The two tools that talk ABOUT the catalogue rather than living in it. They
 * are the only allowed exception to the coverage, and it is written here
 * instead of deduced by a rule: two names are read, a rule is worked around.
 */
const META = new Set(["list_tools", "start_tool"]);

describe("the tool catalogue does not promise things that are not there", () => {
  test("every declared route is mounted on the server", () => {
    const ghosts: string[] = [];
    for (const s of TOOLS) {
      for (const route of s.api) {
        // The storyboard routes are mounted on a prefix: the catalogue writes
        // them in full because that is what they are called from outside.
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

  test("every declared MCP tool really exists", () => {
    const ghosts: string[] = [];
    for (const s of TOOLS) {
      for (const name of s.mcp) if (!MCP_NAMES.has(name)) ghosts.push(`${s.id} → ${name}`);
    }
    expect(ghosts).toEqual([]);
  });

  test("every MCP tool is told about by some entry in the catalogue", () => {
    const covered = new Set(TOOLS.flatMap((s) => s.mcp));
    const orphans = [...MCP_NAMES].filter((n) => !covered.has(n) && !META.has(n));
    expect(orphans).toEqual([]);
  });

  test("areas, ids and starts are well formed", () => {
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
  test("it lists everything, with what is ready and what is missing", async () => {
    const r = await app.request("/api/tools");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.tools).toHaveLength(TOOLS.length);
    expect(j.areas.length).toBe(AREAS.length);
    // Every tool that is not ready says WHY, not just that it is not: a grey
    // tool with no reason is a closed door with no sign.
    for (const s of j.tools) {
      expect(typeof s.ready).toBe("boolean");
      if (!s.ready) {
        expect(s.missing.length).toBeGreaterThan(0);
        for (const m of s.missing) expect(m.how.length).toBeGreaterThan(10);
      }
    }
  });

  test("a tool's projects are the ones with the right view", async () => {
    const r = await app.request("/api/tools/edit/projects");
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    for (const p of j.projects) expect(p.views).toContain("video");
  });
});

describe("POST /api/tools/:id/start", () => {
  test("an unknown tool is a 404, not a crash", async () => {
    const r = await app.request("/api/tools/inesistente/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(404);
  });

  test("a tool that only opens says so, instead of pretending to start", async () => {
    const r = await app.request("/api/tools/tree/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("progetto");
  });

  test("a missing required field returns the reason, not a 500", async () => {
    const r = await app.request("/api/tools/projects/start", {
      method: "POST",
      body: JSON.stringify({ values: {} }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toContain("nome");
  });

  test("«empty project» really creates the project and says where to land", async () => {
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

  test("a beat sheet becomes a storyboard with its panels", async () => {
    const r = await app.request("/api/tools/storyboard/start", {
      method: "POST",
      body: JSON.stringify({
        values: { name: `board-${Date.now()}`, beats: "lei entra\nprimo piano\nla strada vuota" },
      }),
    });
    // With no live generator the start stops earlier, and says so: it is the
    // intended behaviour (409), not a failure of the catalogue.
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

  test("every tool with a quick start has something that runs it", () => {
    // Against the engine, not against the route: really calling the starts
    // would mean launching Chrome and creating real projects inside the
    // suite.
    const withoutEngine = TOOLS.filter(
      (s) => s.starters.some((a) => a.mode !== "open") && !STARTABLE.has(s.id),
    ).map((s) => s.id);
    expect(withoutEngine).toEqual([]);
  });

  test("and no engine advances without its tool in the catalogue", () => {
    const orphans = [...STARTABLE].filter((id) => !TOOLS.some((s) => s.id === id));
    expect(orphans).toEqual([]);
  });
});

test("strumento() trova per id", () => {
  expect(tool("color")?.name).toBe("Sviluppo colore");
  expect(tool("boh")).toBeUndefined();
});
