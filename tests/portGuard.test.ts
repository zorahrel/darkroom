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

describe("do not start on a port already served by another project", () => {
  test("nobody listening: it starts", () => {
    expect(checkPort(3535, deps([]))).toEqual({ state: "free" });
  });

  test("the real case: Topics on *:3333 and us about to bind to 127.0.0.1", () => {
    // Topics' IPv6 wildcard bind does not give EADDRINUSE to an IPv4 bind: it
    // is exactly why the sockets have to be looked at instead of trusting the
    // listen error, which never arrives.
    const topics: Occupant = { pid: 52898, command: "bun", address: "*:3333" };
    const outcome = checkPort(3333, deps([topics]));
    expect(outcome).toEqual({ state: "busy", occupants: [topics] });
  });

  test("a hot reload of ourselves is not an intruder", () => {
    const noi: Occupant = { pid: 999, command: "bun", address: "127.0.0.1:3535" };
    expect(checkPort(3535, deps([noi], 999))).toEqual({ state: "free" });
  });

  test("a missing lsof does not block the boot: a check that cannot know does not decide", () => {
    const outcome = checkPort(3535, deps(null));
    expect(outcome.state).toBe("ignoto");
  });

  test("the message says the pid, the bind and how to get out of it", () => {
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

describe("reading lsof's -F output", () => {
  test("processo, comando e i suoi binding", () => {
    const text = ["p52898", "cbun", "n*:3333", "n127.0.0.1:3334", ""].join("\n");
    // Only the binding on the port asked about: 3334 is another service of the
    // same process and is none of our business.
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

  test("IPv4 and IPv6 of the same process are two bindings, not one", () => {
    const text = ["p7", "cnode", "n127.0.0.1:3333", "n[::1]:3333", ""].join("\n");
    expect(parseLsof(text, 3333)).toHaveLength(2);
  });

  test("a pid with no readable command still counts: the pid is enough to kill", () => {
    const text = ["p42", "n*:3333", ""].join("\n");
    expect(parseLsof(text, 3333)).toEqual([
      { pid: 42, command: null, address: "*:3333" },
    ]);
  });
});

describe("the real lsof, on the machine running the test", () => {
  test("a random port is free, and the answer is [] not null", () => {
    // If `lsof` were missing or its output changed shape it would return
    // `null`, and the guard would go mute without anybody noticing.
    const port = 40000 + Math.floor(Math.random() * 20000);
    expect(realListeners(port)).toEqual([]);
  });

  test("a real socket is seen, with our pid", () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    const port = server.port!;
    try {
      const found = realListeners(port);
      expect(found).not.toBeNull();
      expect(found!.map((o) => o.pid)).toContain(process.pid);
      // …and precisely for that reason we do not accuse ourselves.
      expect(checkPort(port, {
        listeners: realListeners,
        ourPid: process.pid,
      })).toEqual({ state: "free" });
    } finally {
      server.stop(true);
    }
  });
});
