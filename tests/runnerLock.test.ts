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

describe("one runner per installation", () => {
  test("the first takes the lock, the second is refused with the holder's pid", () => {
    // The real case: two launchd services (3535 and 3737) on the same DB and the
    // same ChatGPT account. Neither was wrong on its own, but together they
    // sped through the cap and fought over the writes.
    const p = lockPath("dup");
    const a = acquireRunnerLock(p);
    expect(a.ok).toBe(true);

    // Simulates ANOTHER live process: the pid of a process that really exists
    // but is not this one. Pid 1 (launchd) is always there on macOS.
    writeFileSync(p, "1");
    const b = acquireRunnerLock(p);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.holderPid).toBe(1);
  });

  test("a lock left by a dead process is taken over", () => {
    // A lockfile surviving a crash would block the queue for ever: it would be
    // worse than the problem it solves.
    const p = lockPath("stale");
    writeFileSync(p, "999999"); // a pid that does not exist
    const r = acquireRunnerLock(p);
    expect(r.ok).toBe(true);
  });

  test("releasing the lock removes it, and another process can take it", () => {
    const p = lockPath("release");
    const a = acquireRunnerLock(p);
    expect(a.ok).toBe(true);
    if (a.ok) a.release();
    expect(existsSync(p)).toBe(false);
    expect(acquireRunnerLock(p).ok).toBe(true);
  });

  test("the same process taking over its own lock does not block itself", () => {
    // Un riavvio a caldo (bun --hot) rientra qui: il pid è lo stesso.
    const p = lockPath("self");
    expect(acquireRunnerLock(p).ok).toBe(true);
    expect(acquireRunnerLock(p).ok).toBe(true);
  });
});
