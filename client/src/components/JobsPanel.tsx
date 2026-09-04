import { useEffect, useMemo, useState } from "react";
import type { JobsPayload } from "../api";
import { api } from "../api";

export default function JobsPanel({
  jobs,
  onClose,
  onJumpTo,
}: {
  jobs: JobsPayload;
  onClose: () => void;
  onJumpTo: (photoId: string) => void;
}) {
  const { summary, items } = jobs;

  const recentFailed = useMemo(
    () => items.filter((j) => j.status === "failed" && !j.seen).slice(0, 5),
    [items],
  );

  // Failed/cancelled jobs still showing in the panel — dismissable in bulk.
  /** Il generatore e' globale, non del progetto: si chiede una volta sola e si
   *  aggiorna con il resto del pannello. */
  const [gen, setGen] = useState<{ backend: string; browser: boolean | null }>(
    { backend: "…", browser: null });
  useEffect(() => {
    let alive = true;
    api.studioProjects()
      .then((r) => { if (alive) setGen({ backend: r.worker.backend, browser: r.worker.browser_alive }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const dismissable = useMemo(
    () => items.filter((j) => j.status === "failed" || j.status === "cancelled"),
    [items],
  );

  return (
    <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:right-4 z-50 w-auto sm:w-[420px] max-h-[70vh] flex flex-col bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl">
      {/* Tre righe invece di una: titolo, conto, generatore.
          Su 420 pixel il titolo, quattro numeri, "scarta falliti" e la chiusura
          non ci stavano su una riga sola, e "Jobs" finiva scritto sopra il
          conto. */}
      <div className="px-3.5 pt-2.5 pb-2 border-b border-neutral-800 space-y-1.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Lavori</h3>
          <div className="flex-1" />
          {dismissable.length > 0 && (
            <button
              onClick={async () => { await api.markAllFailedSeen(); }}
              className="text-[11px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400
                         hover:text-neutral-100 hover:border-neutral-500"
              title="Toglie dall'elenco i lavori falliti e annullati. Non li rilancia."
            >
              nascondi i {dismissable.length} falliti
            </button>
          )}
          <button onClick={onClose} title="chiudi"
                  className="text-neutral-400 hover:text-white leading-none px-1">✕</button>
        </div>

        <div className="flex items-center gap-2.5 text-[11px] tabular-nums">
          {(summary.running ?? 0) > 0 && <span className="text-sky-300">{summary.running} in corso</span>}
          {(summary.pending ?? 0) > 0 && <span className="text-neutral-200">{summary.pending} in coda</span>}
          <span className="text-neutral-400">{summary.done ?? 0} fatti</span>
          {(summary.failed ?? 0) > 0 && <span className="text-red-300">{summary.failed} falliti</span>}
          {!(summary.running ?? 0) && !(summary.pending ?? 0) && (
            <span className="text-neutral-400">· niente in corso</span>
          )}
        </div>

        {/* Chi genera le immagini, e se e' in piedi. Stava sull'elenco dei
            progetti, dove non serviva a nessuna decisione; qui e' la prima cosa
            da guardare quando un lavoro fallisce. */}
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
            gen.browser === null ? "bg-neutral-500" : gen.browser ? "bg-emerald-500" : "bg-red-500"}`} />
          <span className="text-neutral-400">genera con</span>
          <span className="text-neutral-200">{gen.backend}</span>
          {gen.browser !== null && (
            <span className={gen.browser ? "text-neutral-400" : "text-red-300"}>
              · {gen.browser ? "Chrome collegato" : "Chrome non collegato: i lavori falliranno"}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-neutral-800/60">
        {items.length === 0 && (
          <div className="p-6 text-center text-sm text-neutral-400">
            Nessun job. Apri una foto e clicca «Genera nuova versione».
          </div>
        )}
        {items.map((j) => (
          <div key={j.id} className="px-4 py-2 flex items-start gap-3 text-sm">
            <span className="pt-1.5">
              <StatusDot status={j.status} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onJumpTo(j.photo_id)}
                  className="font-mono text-xs text-blue-300 hover:underline truncate text-left"
                  title={j.photo_id}
                >
                  {j.photo_id}
                </button>
                <ProviderChip job={j} />
                <div className="flex-1" />
                <span
                  className="text-xs text-neutral-400 shrink-0 tabular-nums"
                  title={eventLabel(j)}
                >
                  {(j.attempts ?? 0) > 1 && (
                    <span className="text-amber-400/70 mr-1" title="tentativi (retry su rate-limit)">
                      ×{j.attempts}
                    </span>
                  )}
                  {clockFor(j) || (j.status === "pending" ? "in coda" : "")}
                </span>
                {j.status === "pending" && (
                  <button
                    onClick={async () => {
                      await api.cancelJob(j.id);
                    }}
                    className="text-xs text-neutral-400 hover:text-red-400"
                  >
                    cancel
                  </button>
                )}
                {(j.status === "failed" || j.status === "cancelled") && (
                  <button
                    onClick={async () => {
                      await api.markJobSeen(j.id);
                    }}
                    className="text-xs text-neutral-400 hover:text-emerald-400"
                    title="Scarta dal pannello"
                  >
                    scarta
                  </button>
                )}
              </div>
              <JobDetails job={j} />
            </div>
          </div>
        ))}
      </div>
      {recentFailed.length > 0 && (
        <div className="border-t border-neutral-800 p-3 text-xs">
          <div className="text-red-300 font-medium mb-1">
            Ultimi fallimenti
          </div>
          {recentFailed.map((j) => (
            <div key={j.id} className="flex items-start gap-2 py-0.5">
              <div className="text-neutral-400 truncate flex-1">
                <span className="font-mono">{j.photo_id}</span>:{" "}
                {j.error?.slice(0, 100) ?? "—"}
              </div>
              <button
                onClick={async () => {
                  await api.markJobSeen(j.id);
                }}
                className="shrink-0 text-[11px] text-neutral-400 hover:text-emerald-400"
                title="Segna come visto"
              >
                ✓ visto
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderChip({ job }: { job: JobsPayload["items"][number] }) {
  const hf = job.provider === "higgsfield";
  return (
    <span
      className={
        "text-[10px] px-1.5 py-0.5 rounded shrink-0 " +
        (hf
          ? "bg-fuchsia-900/40 text-fuchsia-200"
          : "bg-blue-900/40 text-blue-200")
      }
    >
      {hf ? "Higgsfield" : "ChatGPT"}
    </span>
  );
}

function parseModelLabel(job: JobsPayload["items"][number]): string | null {
  // provider_params is only present on higgsfield jobs.
  const pp = job.provider_params;
  if (!pp) return null;
  try {
    const parsed = JSON.parse(pp) as {
      model: string;
      params?: Record<string, string>;
    };
    const extras = Object.values(parsed.params ?? {}).filter(Boolean).join(", ");
    return `${parsed.model}${extras ? ` · ${extras}` : ""}`;
  } catch {
    return null;
  }
}

function JobDetails({ job }: { job: JobsPayload["items"][number] }) {
  const model = parseModelLabel(job);
  const running = job.status === "running";
  const showProgress = running && job.progress;
  const timing = timingLine(job);
  return (
    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400 truncate">
      {timing && <span className="shrink-0">{timing}</span>}
      {timing && model && <span className="text-neutral-400/60">·</span>}
      {model && <span className="truncate">{model}</span>}
      {(timing || model) && showProgress && (
        <span className="text-neutral-400/60">·</span>
      )}
      {showProgress && (
        <span className="text-blue-300 truncate">{job.progress}</span>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-blue-400 animate-pulse"
      : status === "pending"
        ? "bg-amber-400"
        : status === "done"
          ? "bg-emerald-500"
          : status === "failed"
            ? "bg-red-500"
            : "bg-neutral-500";
  return <span className={`w-2 h-2 rounded-full inline-block ${color}`} />;
}

// --- Timing helpers (orario + "quanto fa" in italiano + durata) ---
function fmtClock(ts: number | null | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function relIt(ts: number | null | undefined): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "adesso";
  if (s < 60) return `${s}s fa`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h fa`;
  const g = Math.floor(h / 24);
  return `${g} g fa`;
}

// Orario (HH:MM) dell'evento rilevante per stato: fine per done/failed/cancelled,
// avvio per running, ingresso in coda per pending.
function clockFor(job: JobsPayload["items"][number]): string {
  const start = job.first_started_at ?? job.started_at;
  switch (job.status) {
    case "done":
    case "failed":
      return fmtClock(job.finished_at ?? start);
    case "cancelled":
      return fmtClock(job.finished_at ?? job.created_at);
    case "running":
      return fmtClock(start);
    case "pending":
      return fmtClock(job.created_at);
    default:
      return "";
  }
}

// Sottoriga: verbo + "quanto fa" (o durata elapsed per i job in corso) + durata totale.
function timingLine(job: JobsPayload["items"][number]): string {
  const start = job.first_started_at ?? job.started_at;
  const dur =
    start && job.finished_at ? fmtDur(job.finished_at - start) : null;
  switch (job.status) {
    case "done": {
      const parts = [`fatto ${relIt(job.finished_at)}`];
      if (dur) parts.push(`durata ${dur}`);
      return parts.join(" · ");
    }
    case "failed": {
      const parts = [`fallito ${relIt(job.finished_at)}`];
      if (dur) parts.push(`durata ${dur}`);
      return parts.join(" · ");
    }
    case "cancelled":
      return `annullato ${relIt(job.finished_at ?? job.created_at)}`;
    case "running":
      return start ? `in corso da ${fmtDur(Date.now() - start)}` : "in corso";
    case "pending":
      return `in coda da ${relIt(job.created_at).replace(" fa", "")}`;
    default:
      return "";
  }
}

// Testo esteso per il tooltip sull'orario.
function eventLabel(job: JobsPayload["items"][number]): string {
  const clock = clockFor(job);
  const line = timingLine(job);
  return clock ? `${line} (ore ${clock})` : line;
}
