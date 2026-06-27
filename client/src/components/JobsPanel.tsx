import { useMemo } from "react";
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

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[420px] max-h-[70vh] flex flex-col bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl">
      <div className="flex items-center px-4 py-2 border-b border-neutral-800">
        <h3 className="font-semibold text-sm">Jobs</h3>
        <div className="flex-1" />
        <span className="text-xs text-neutral-400">
          {summary.pending ?? 0} pending · {summary.running ?? 0} running ·{" "}
          {summary.done ?? 0} done · {summary.failed ?? 0} failed
        </span>
        <button
          onClick={onClose}
          className="ml-3 text-neutral-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto flex-1 divide-y divide-neutral-800/60">
        {items.length === 0 && (
          <div className="p-6 text-center text-sm text-neutral-500">
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
                <span className="text-xs text-neutral-500">
                  {(j.attempts ?? 0) > 1 && (
                    <span className="text-amber-400/70 mr-1" title="tentativi (retry su rate-limit)">
                      ×{j.attempts}
                    </span>
                  )}
                  {j.status === "running"
                    ? secondsAgo(j.first_started_at ?? j.started_at) + "s"
                    : j.status === "done"
                      ? "✓"
                      : j.status === "failed"
                        ? "✗"
                        : j.status === "pending"
                          ? "in coda"
                          : ""}
                </span>
                {j.status === "pending" && (
                  <button
                    onClick={async () => {
                      await api.cancelJob(j.id);
                    }}
                    className="text-xs text-neutral-500 hover:text-red-400"
                  >
                    cancel
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
                className="shrink-0 text-[11px] text-neutral-500 hover:text-emerald-400"
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
  if (!model && !showProgress) return null;
  return (
    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-500 truncate">
      {model && <span className="truncate">{model}</span>}
      {model && showProgress && <span className="text-neutral-700">·</span>}
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

function secondsAgo(ts: number | null): number {
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}
