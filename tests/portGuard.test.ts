import { describe, expect, test } from "bun:test";
import {
  realListeners,
  busyMessage,
  parseLsof,
  checkPort,
  type Occupant,
} from "../server/portGuard.ts";

const deps = (found: Occupant[] | null, ourPid = 999) => ({
  listeners: () => found,
  ourPid,
});

describe("non partire su una porta gia' servita da un altro progetto", () => {
  test("nessuno in ascolto: si parte", () => {
    expect(checkPort(3535, deps([]))).toEqual({ state: "free" });
  });

  test("il caso reale: Topics su *:3333 e noi che stiamo per legarci a 127.0.0.1", () => {
    // Il bind IPv6 jolly di Topics non da' EADDRINUSE a un bind IPv4: e'
    // esattamente per questo che serve guardare i socket invece di fidarsi
    // dell'errore di listen, che non arriva.
    const topics: Occupant = { pid: 52898, command: "bun", address: "*:3333" };
    const outcome = checkPort(3333, deps([topics]));
    expect(outcome).toEqual({ state: "busy", occupants: [topics] });
  });

  test("un hot-reload di noi stessi non e' un intruso", () => {
    const noi: Occupant = { pid: 999, command: "bun", address: "127.0.0.1:3535" };
    expect(checkPort(3535, deps([noi], 999))).toEqual({ state: "free" });
  });

  test("lsof assente non blocca il boot: un controllo che non sa non decide", () => {
    const outcome = checkPort(3535, deps(null));
    expect(outcome.state).toBe("ignoto");
  });

  test("il messaggio dice il pid, il bind e come uscirne", () => {
    const msg = busyMessage(3333, [
      { pid: 52898, command: "bun run server.ts", address: "*:3333" },
    ]);
    expect(msg).toContain("52898");
    expect(msg).toContain("*:3333");
    expect(msg).toContain("bun run server.ts");
    expect(msg).toContain("kill 52898");
    expect(msg).toContain("PORT=");
  });
});

describe("lettura dell'output -F di lsof", () => {
  test("processo, comando e i suoi binding", () => {
    const text = ["p52898", "cbun", "n*:3333", "n127.0.0.1:3334", ""].join("\n");
    // Solo il binding sulla porta chiesta: 3334 e' un altro servizio dello
    // stesso processo e non ci riguarda.
    expect(parseLsof(text, 3333)).toEqual([
      { pid: 52898, command: "bun", address: "*:3333" },
    ]);
  });

  test("due processi distinti, entrambi riportati", () => {
    const text = ["p1", "ca", "n*:3333", "p2", "cb", "n127.0.0.1:3333", ""].join("\n");
    expect(parseLsof(text, 3333)).toEqual([
      { pid: 1, command: "a", address: "*:3333" },
      { pid: 2, command: "b", address: "127.0.0.1:3333" },
    ]);
  });

  test("IPv4 e IPv6 dello stesso processo sono due binding, non uno", () => {
    const text = ["p7", "cnode", "n127.0.0.1:3333", "n[::1]:3333", ""].join("\n");
    expect(parseLsof(text, 3333)).toHaveLength(2);
  });

  test("un pid senza comando leggibile vale comunque: il pid basta per il kill", () => {
    const text = ["p42", "n*:3333", ""].join("\n");
    expect(parseLsof(text, 3333)).toEqual([
      { pid: 42, command: null, address: "*:3333" },
    ]);
  });
});

describe("lsof vero, sulla macchina che esegue il test", () => {
  test("una porta a caso e' libera, e la risposta e' [] non null", () => {
    // Se `lsof` mancasse o l'output cambiasse forma tornerebbe `null`, e il
    // guardiano diventerebbe muto senza che nessuno se ne accorga.
    const port = 40000 + Math.floor(Math.random() * 20000);
    expect(realListeners(port)).toEqual([]);
  });

  test("un socket vero viene visto, col nostro pid", () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    const port = server.port!;
    try {
      const found = realListeners(port);
      expect(found).not.toBeNull();
      expect(found!.map((o) => o.pid)).toContain(process.pid);
      // …e proprio per questo non ci accusiamo da soli.
      expect(checkPort(port, {
        listeners: realListeners,
        ourPid: process.pid,
      })).toEqual({ state: "free" });
    } finally {
      server.stop(true);
    }
  });
});
