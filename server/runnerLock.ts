import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One runner per DB.
 *
 * Darkroom ended up with TWO launchd services running the same
 * `server/index.ts` over the same folder (ports 3535 and 3737): two job runners
 * on the same `photos.db` and on the same ChatGPT account. The atomic job claim
 * and the browser lock avoided the worst damage, but the rest remained: two
 * processes knocking on the same account sped up the silent cap, and write
 * contention on the DB produced SQLITE_BUSY (which in turn surfaced as an
 * HTTP 500).
 *
 * Nobody had noticed for weeks, because both answered correctly: the duplicate
 * breaks nothing, it just wastes — the kind of failure you only notice once it
 * has already done harm.
 *
 * Here a file is written holding the active runner's PID. Whoever starts later
 * sees it, says WHO the other one is and does not start its own runner: the
 * HTTP side is wanted (useful for a second read-only window), a second queue is
 * not.
 */
export type RunnerLock =
  | { ok: true; release: () => void }
  | { ok: false; holderPid: number };

/** Does the process still exist? (kill 0 sends no signal, it only checks.) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = the process EXISTS but belongs to another user (or is privileged,
    // like launchd): treating it as dead would mean stealing its lock. Only
    // ESRCH ("no such process") really says it is gone.
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * Try to become the active runner for this DB.
 *
 * A stale lock (a process that died without releasing) is detected and taken
 * over: a lockfile surviving a crash would block the queue forever, which is
 * worse than the problem it solves.
 */
export function acquireRunnerLock(lockPath: string): RunnerLock {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const prev = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(prev) && prev > 0 && prev !== process.pid && alive(prev)) {
      return { ok: false, holderPid: prev };
    }
    // Stale: the owner is no longer there.
    try {
      unlinkSync(lockPath);
    } catch {
      /* se sparisce sotto di noi va bene lo stesso */
    }
  }
  writeFileSync(lockPath, String(process.pid));
  const release = () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* best effort */
    }
  };
  return { ok: true, release };
}
