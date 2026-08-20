import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { acquireRunnerLock } from "../server/runnerLock.ts";
import { TEST_ROOT } from "./setup.ts";

function lockPath(name: string): string {
  const dir = join(TEST_ROOT, "runnerlock");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.lock`);
}

describe("un solo runner per installazione", () => {
  test("il primo prende il lock, il secondo viene respinto col pid del titolare", () => {
    // Il caso reale: due servizi launchd (3535 e 3737) sullo stesso DB e sullo
    // stesso account ChatGPT. Nessuno dei due sbagliava, ma insieme
    // acceleravano il cap e si contendevano le scritture.
    const p = lockPath("dup");
    const a = acquireRunnerLock(p);
    expect(a.ok).toBe(true);

    // Simula un ALTRO processo vivo: il pid di un processo che esiste davvero
    // ma non e' questo. Il pid 1 (launchd) c'e' sempre su macOS.
    writeFileSync(p, "1");
    const b = acquireRunnerLock(p);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.holderPid).toBe(1);
  });

  test("un lock lasciato da un processo morto viene ripreso", () => {
    // Un lockfile che sopravvive a un crash bloccherebbe la coda per sempre:
    // sarebbe peggio del problema che risolve.
    const p = lockPath("stale");
    writeFileSync(p, "999999"); // pid che non esiste
    const r = acquireRunnerLock(p);
    expect(r.ok).toBe(true);
  });

  test("rilasciare il lock lo rimuove, e un altro processo può prenderlo", () => {
    const p = lockPath("release");
    const a = acquireRunnerLock(p);
    expect(a.ok).toBe(true);
    if (a.ok) a.release();
    expect(existsSync(p)).toBe(false);
    expect(acquireRunnerLock(p).ok).toBe(true);
  });

  test("lo stesso processo che riprende il proprio lock non si auto-blocca", () => {
    // Un riavvio a caldo (bun --hot) rientra qui: il pid è lo stesso.
    const p = lockPath("self");
    expect(acquireRunnerLock(p).ok).toBe(true);
    expect(acquireRunnerLock(p).ok).toBe(true);
  });
});
