#!/usr/bin/env bun
/**
 * watch-jobs — segue la coda fino a quando si svuota e dice cosa è cambiato.
 *
 * Nasce da un problema pratico: mettere in coda 26 rigenerazioni e poi
 * ricontrollare a mano ogni due minuti. Qui il processo resta attaccato,
 * stampa una riga per ogni job che finisce (con il tempo che ci ha messo) e
 * chiude con un riepilogo. Esce non-zero se qualcosa è fallito, così si può
 * incatenare a un altro comando.
 *
 *   bun run scripts/watch-jobs.ts            # segue finché la coda è vuota
 *   bun run scripts/watch-jobs.ts --once     # stampa lo stato e basta
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
// Stato per job, così si stampa una riga SOLO quando qualcosa cambia davvero:
// un poll ogni 5s che ristampa tutto è rumore, non monitoraggio.
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
