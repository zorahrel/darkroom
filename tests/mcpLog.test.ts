import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { TEST_ROOT } from "./setup.ts";
import { initSchemaOn } from "../server/db.ts";
import { LOG_ARGUMENT_BYTES, LOG_MAX_ROWS, LOG_MESSAGE_BYTES, logDatabase, readLog, recordCall, type LogEntry } from "../server/mcpLog.ts";
import { loggedCall } from "../mcp/loggedCall.ts";
import { executeTool, tools } from "../mcp/server.ts";
import { app } from "../server/app.ts";
import { addProject, currentProjectId, withProject } from "../server/project.ts";

const entry = (values: Partial<LogEntry> = {}): LogEntry => ({ tool: "list_photos", arguments: { filter: "all" },
  outcome: "ok", message: "Completato", duration_ms: 42, project: "progetto-a", created_at: Date.now(), ...values });
let d: Database;
beforeEach(() => { d?.close(); d = new Database(":memory:"); initSchemaOn(d); });

describe("registro MCP", () => {
  test("la migrazione additiva conserva galleria e registro dopo la riapertura", () => {
    d.run("INSERT INTO photos(id, original_path, original_ext, created_at, updated_at) VALUES('presente','/raw/a.jpg','jpg',1,1)");
    recordCall(entry(), d);
    initSchemaOn(d);
    expect(d.query("SELECT id FROM photos").get()).toEqual({ id: "presente" });
    expect(readLog({}, d).entries[0]).toMatchObject({ tool: "list_photos", arguments: { filter: "all" }, duration_ms: 42 });
  });

  test("ogni strumento passa dal decoratore e conserva l'esito originale", async () => {
    logDatabase().run("DELETE FROM mcp_log");
    for (const tool of tools) {
      const original = tool.handler;
      try {
        tool.handler = async () => ({ risposta: tool.name });
        const response = await executeTool(tool.name, { n: 2 });
        expect(response.isError).toBeUndefined();
        expect(JSON.parse((response.content[0] as { text: string }).text)).toEqual({ risposta: tool.name });
      } finally { tool.handler = original; }
    }
    const rows = readLog({ limit: 100 }).entries;
    expect(rows.length).toBe(tools.length);
    expect(new Set(rows.map((r) => r.tool)).size).toBe(tools.length);
    expect(rows.every((r) => r.duration_ms >= 0 && r.created_at > 0)).toBe(true);
    expect(rows.find((r) => r.tool === "list_projects")!.project).toBeNull();
    expect(rows.find((r) => r.tool === "list_photos")!.project).toBe(currentProjectId());
  });

  test("errori lanciati, applicativi e nomi sconosciuti restano nel registro", async () => {
    const write = (e: LogEntry) => recordCall(e, d);
    const thrown = await loggedCall("rete", {}, "a", async () => { throw new Error("Connessione rifiutata"); }, write);
    const failed = await loggedCall("applicativo", {}, "a", async () => ({ ok: false, error: "Non riuscito" }), write);
    expect(thrown.isError).toBe(true);
    expect(failed.isError).toBe(true);
    expect(readLog({}, d).entries.map((r) => [r.tool, r.outcome, r.message])).toEqual([
      ["applicativo", "errore", "Non riuscito"], ["rete", "errore", "Connessione rifiutata"],
    ]);
    expect((await executeTool("non_esiste")).isError).toBe(true);
    expect(readLog({ tool: "non_esiste" }).entries[0]!.outcome).toBe("errore");
  });

  test("chiavi annidate, percorsi e credenziali nel testo non arrivano a SQLite", () => {
    const secrets = ["chiave-nascosta", "parola-segreta", "codice-riservato", "/Users/altrui/segreto/file.jpg", "C:\\Privato\\chiave.pem", "sk-finta-123456789", "accesso-riservato"];
    recordCall(entry({ arguments: { filter: "with_favorite", nested: { apiKey: secrets[0], password: secrets[1], auth: { token: secrets[2] } },
      path: secrets[3], files: [secrets[4]], prompt: `colori freddi ${secrets[5]} https://esempio.it/?token=${secrets[6]}` },
      message: `Errore ${secrets.join(" ")} Bearer abcd-riservato`,
    }), d);
    const raw = JSON.stringify(d.query("SELECT * FROM mcp_log").all());
    for (const secret of [...secrets, "abcd-riservato"]) expect(raw).not.toContain(secret);
    expect(readLog({}, d).entries[0]!.arguments).toMatchObject({ filter: "with_favorite", path: "[oscurato]" });
  });

  test("JSON incollato e JSON serializzato negli errori oscurano anche le chiavi quoted", () => {
    const payload = JSON.stringify({ api_key: "chiave-payload-json" });
    recordCall(entry({ arguments: { prompt: payload }, message: JSON.stringify({ error: payload }) }), d);
    expect(JSON.stringify(d.query("SELECT * FROM mcp_log").all())).not.toContain("chiave-payload-json");
  });

  test("un errore HTTP con JSON annidato oscura anche credenziali assenti dagli argomenti", () => {
    recordCall(entry({ arguments: {}, message: `GET /api/provider → 502 ${JSON.stringify({ error: JSON.stringify({ api_key: "segreto-del-provider" }) })}` }), d);
    expect(JSON.stringify(d.query("SELECT * FROM mcp_log").all())).not.toContain("segreto-del-provider");
  });

  test("gli argomenti smisurati restano JSON e rispettano il tetto in byte", () => {
    recordCall(entry({ arguments: { prompt: "色".repeat(30_000) }, message: "色".repeat(8_000) }), d);
    const row = d.query<{ arguments: string; message: string }, []>("SELECT arguments, message FROM mcp_log").get()!;
    expect(Buffer.byteLength(row.arguments)).toBeLessThanOrEqual(LOG_ARGUMENT_BYTES);
    expect(Buffer.byteLength(row.message)).toBeLessThanOrEqual(LOG_MESSAGE_BYTES);
    expect(() => JSON.parse(row.arguments)).not.toThrow();
  });

  test("pota per età e per numero mantenendo gli ultimi anche a timestamp uguale", () => {
    const now = Date.now();
    const insert = d.prepare("INSERT INTO mcp_log(tool, arguments, outcome, message, duration_ms, project, created_at) VALUES(?, '{}', 'ok', '', 0, 'a', ?)");
    d.transaction(() => { for (let i = 0; i < LOG_MAX_ROWS + 3; i++) insert.run(`t${i}`, now); })();
    recordCall(entry({ tool: "ultimo" }), d);
    expect(d.query<{ n: number }, []>("SELECT count(*) n FROM mcp_log").get()!.n).toBe(LOG_MAX_ROWS);
    expect(readLog({}, d).entries[0]!.tool).toBe("ultimo");
    expect(d.query("SELECT id FROM mcp_log WHERE tool='t0'").get()).toBeNull();
    d.run("UPDATE mcp_log SET created_at = ?", [now - 31 * 86_400_000]);
    expect(readLog({}, d).entries).toEqual([]);
  });

  test("filtri combinati e cursore non duplicano righe all'arrivo di chiamate nuove", () => {
    for (let i = 0; i < 5; i++) recordCall(entry({ tool: i === 0 ? "altro" : "rete", outcome: i === 1 ? "ok" : "errore", message: String(i) }), d);
    const first = readLog({ tool: "rete", outcome: "errore", limit: 2 }, d);
    expect(first.entries.map((r) => r.message)).toEqual(["4", "3"]);
    recordCall(entry({ tool: "rete", outcome: "errore", message: "nuovo" }), d);
    expect(readLog({ tool: "rete", outcome: "errore", limit: 2, before: first.next_before! }, d).entries.map((r) => r.message)).toEqual(["2"]);
  });

  test("l'endpoint legge un solo registro anche da un altro progetto e valida i filtri", async () => {
    const p = addProject({ name: `Registro ${Date.now()}` });
    withProject(p.id, () => recordCall(entry({ tool: "isolamento", project: p.id, outcome: "errore" })));
    const response = await app.request(`/api/mcp-log?tool=isolamento&outcome=errore&project=${p.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).entries).toHaveLength(1);
    for (const query of ["outcome=forse", "before=-1", "limit=NaN", "limit=0"]) {
      expect((await app.request(`/api/mcp-log?${query}`)).status).toBe(400);
    }
  });

  test("il progetto segue la risposta HTTP anche se la cache MCP non lo conosce", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify({ photos: [] }), {
        headers: { "x-darkroom-project": "creato-dopo-avvio-mcp" },
      })) as unknown as typeof fetch;
      await executeTool("list_photos", { project: "appena-creato" });
      expect(readLog({ tool: "list_photos" }).entries[0]!.project).toBe("creato-dopo-avvio-mcp");
    } finally { globalThis.fetch = original; }
  });

  test("creazione, avvio strumento e aggiornamento annotano il progetto coinvolto", async () => {
    const original = globalThis.fetch;
    try {
      for (const [name, result, args, expected] of [
        ["add_project", { project: { id: "nuovo" } }, { name: "Nuovo" }, "nuovo"],
        ["start_tool", { project: "avviato", done: "Pronto" }, { tool: "export" }, "avviato"],
        ["update_project", { ok: true }, { id: "rinominato" }, "rinominato"],
      ] as const) {
        globalThis.fetch = (async () => new Response(JSON.stringify(result))) as unknown as typeof fetch;
        await executeTool(name, args);
        expect(readLog({ tool: name }).entries[0]!.project).toBe(expected);
      }
    } finally { globalThis.fetch = original; }
  });

  test("il registro resta nello stesso database dopo rimozione del primo progetto e riavvio", () => {
    const root = mkdtempSync(join(TEST_ROOT, "registro-riavvio-"));
    const env = { ...process.env, GALLERY_ROOT: root, DARKROOM_DB: join(root, "photos.db"),
      DARKROOM_REGISTRY: join(root, "projects.json"), DARKROOM_PROJECTS_DIR: join(root, "projects") };
    const setup = Bun.spawnSync([process.execPath, "--eval", `
      import { recordCall } from "./server/mcpLog.ts";
      import { addProject, removeProject, currentProjectId } from "./server/project.ts";
      recordCall(${JSON.stringify(entry({ tool: "prima-del-riavvio" }))});
      const first = currentProjectId();
      addProject({ name: "Resta" });
      removeProject(first);
    `], { env, stdout: "pipe", stderr: "pipe" });
    expect(setup.exitCode).toBe(0);
    const reopened = Bun.spawnSync([process.execPath, "--eval", `
      import { readLog } from "./server/mcpLog.ts";
      console.log(readLog({tool:"prima-del-riavvio"}).entries.length);
    `], { env, stdout: "pipe", stderr: "pipe" });
    expect(reopened.exitCode).toBe(0);
    expect(new TextDecoder().decode(reopened.stdout).trim()).toBe("1");
  });

  test("un guasto del registro avvisa senza rendere ritentabile un'operazione riuscita", async () => {
    const result = await loggedCall("scrittura", {}, "a", async () => ({ ok: true }), () => { throw new Error("disco pieno"); });
    expect(result.isError).toBeUndefined();
    expect((result.content[1] as { text: string }).text).toContain("non è stata registrata");
  });
});
