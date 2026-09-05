#!/usr/bin/env bun
/**
 * watch-jobs — follows the queue until it drains and says what changed.
 *
 * Born of a practical problem: queueing 26 regenerations and then re-checking
 * by hand every two minutes. Here the process stays attached, prints one line
 * per job that finishes (with how long it took) and closes with a summary. It
 * exits non-zero if anything failed, so it can be chained to another command.
 *
 *   bun run scripts/watch-jobs.ts            # follows until the queue is empty
 *   bun run scripts/watch-jobs.ts --once     # prints the state and stops
 *   bun run scripts/watch-jobs.ts --timeout 3600
 */

const BASE = process.env.DARKROOM_URL ?? "http://localhost:3535";
const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const TIMEOUT_S = Number(args[args.indexOf("--timeout") + 1]) || 7200;
const EVERY_MS = 5000;

type Job = {
  id: number;
  photo_id: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  progress: string | null;
  created_at: number;
  first_started_at: number | null;
  finished_at: number | null;
};

type Payload = {
  items: Job[];
  summary: Record<string, number>;
  runner?: { paused?: boolean; paused_until?: number | null };
};

async function poll(): Promise<Payload> {
  const r = await fetch(`${BASE}/api/jobs`);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as Payload;
}

function secs(from: number | null, to: number | null): string {
  if (!from || !to) return "?";
  return `${Math.round((to - from) / 1000)}s`;
}

const t0 = Date.now();
// Per-job state, so a line is printed ONLY when something really changes: a
// poll every 5s reprinting everything is noise, not monitoring.
const seen = new Map<number, string>();
let finished = 0;
let failed = 0;

for (;;) {
  let p: Payload;
  try {
    p = await poll();
  } catch (e) {
    console.log(`… server non raggiungibile (${e instanceof Error ? e.message : e})`);
    if (ONCE) process.exit(2);
    await Bun.sleep(EVERY_MS);
    continue;
  }

  const active = p.items.filter((j) => j.status === "pending" || j.status === "running");
  for (const j of p.items) {
    const key = `${j.status}|${j.progress ?? ""}`;
    if (seen.get(j.id) === key) continue;
    const was = seen.get(j.id);
    seen.set(j.id, key);
    if (was === undefined) continue; // primo giro: è lo stato di partenza, non un evento
    if (j.status === "done") {
      finished++;
      console.log(`✓ ${j.photo_id}  (${secs(j.first_started_at, j.finished_at)})`);
    } else if (j.status === "failed") {
      failed++;
      console.log(`✗ ${j.photo_id}  ${j.error ?? "errore ignoto"}`);
    } else if (j.status === "running" && was.startsWith("pending")) {
      console.log(`▸ ${j.photo_id}  in lavorazione`);
    }
  }

  if (p.runner?.paused && p.runner.paused_until) {
    console.log(`⏸ coda in pausa fino alle ${new Date(p.runner.paused_until).toLocaleTimeString()}`);
  }

  if (ONCE || active.length === 0) {
    const running = active.filter((j) => j.status === "running").length;
    console.log(
      `\ncoda: ${active.length} attivi (${running} in corso) · ` +
        `finiti ora ${finished}, falliti ora ${failed} · ` +
        `totali done ${p.summary.done ?? 0} / failed ${p.summary.failed ?? 0}`,
    );
    process.exit(failed > 0 ? 1 : 0);
  }

  if ((Date.now() - t0) / 1000 > TIMEOUT_S) {
    console.log(`\n⏱ timeout dopo ${TIMEOUT_S}s con ${active.length} job ancora in coda`);
    process.exit(3);
  }
  await Bun.sleep(EVERY_MS);
}
