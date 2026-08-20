import { describe, expect, test } from "bun:test";
import {
  chiAscoltaReale,
  messaggioOccupata,
  parseLsof,
  verificaPorta,
  type Occupante,
} from "../server/portGuard.ts";

const deps = (trovati: Occupante[] | null, pidNostro = 999) => ({
  chiAscolta: () => trovati,
  pidNostro,
});

describe("non partire su una porta gia' servita da un altro progetto", () => {
  test("nessuno in ascolto: si parte", () => {
    expect(verificaPorta(3535, deps([]))).toEqual({ stato: "libera" });
  });

  test("il caso reale: Topics su *:3333 e noi che stiamo per legarci a 127.0.0.1", () => {
    // Il bind IPv6 jolly di Topics non da' EADDRINUSE a un bind IPv4: e'
    // esattamente per questo che serve guardare i socket invece di fidarsi
    // dell'errore di listen, che non arriva.
    const topics: Occupante = { pid: 52898, comando: "bun", indirizzo: "*:3333" };
    const esito = verificaPorta(3333, deps([topics]));
    expect(esito).toEqual({ stato: "occupata", occupanti: [topics] });
  });

  test("un hot-reload di noi stessi non e' un intruso", () => {
    const noi: Occupante = { pid: 999, comando: "bun", indirizzo: "127.0.0.1:3535" };
    expect(verificaPorta(3535, deps([noi], 999))).toEqual({ stato: "libera" });
  });

  test("lsof assente non blocca il boot: un controllo che non sa non decide", () => {
    const esito = verificaPorta(3535, deps(null));
    expect(esito.stato).toBe("ignoto");
  });

  test("il messaggio dice il pid, il bind e come uscirne", () => {
    const msg = messaggioOccupata(3333, [
      { pid: 52898, comando: "bun run server.ts", indirizzo: "*:3333" },
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
    const testo = ["p52898", "cbun", "n*:3333", "n127.0.0.1:3334", ""].join("\n");
    // Solo il binding sulla porta chiesta: 3334 e' un altro servizio dello
    // stesso processo e non ci riguarda.
    expect(parseLsof(testo, 3333)).toEqual([
      { pid: 52898, comando: "bun", indirizzo: "*:3333" },
    ]);
  });

  test("due processi distinti, entrambi riportati", () => {
    const testo = ["p1", "ca", "n*:3333", "p2", "cb", "n127.0.0.1:3333", ""].join("\n");
    expect(parseLsof(testo, 3333)).toEqual([
      { pid: 1, comando: "a", indirizzo: "*:3333" },
      { pid: 2, comando: "b", indirizzo: "127.0.0.1:3333" },
    ]);
  });

  test("IPv4 e IPv6 dello stesso processo sono due binding, non uno", () => {
    const testo = ["p7", "cnode", "n127.0.0.1:3333", "n[::1]:3333", ""].join("\n");
    expect(parseLsof(testo, 3333)).toHaveLength(2);
  });

  test("un pid senza comando leggibile vale comunque: il pid basta per il kill", () => {
    const testo = ["p42", "n*:3333", ""].join("\n");
    expect(parseLsof(testo, 3333)).toEqual([
      { pid: 42, comando: null, indirizzo: "*:3333" },
    ]);
  });
});

describe("lsof vero, sulla macchina che esegue il test", () => {
  test("una porta a caso e' libera, e la risposta e' [] non null", () => {
    // Se `lsof` mancasse o l'output cambiasse forma tornerebbe `null`, e il
    // guardiano diventerebbe muto senza che nessuno se ne accorga.
    const porta = 40000 + Math.floor(Math.random() * 20000);
    expect(chiAscoltaReale(porta)).toEqual([]);
  });

  test("un socket vero viene visto, col nostro pid", () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    try {
      const trovati = chiAscoltaReale(server.port);
      expect(trovati).not.toBeNull();
      expect(trovati!.map((o) => o.pid)).toContain(process.pid);
      // …e proprio per questo non ci accusiamo da soli.
      expect(verificaPorta(server.port, {
        chiAscolta: chiAscoltaReale,
        pidNostro: process.pid,
      })).toEqual({ stato: "libera" });
    } finally {
      server.stop(true);
    }
  });
});
