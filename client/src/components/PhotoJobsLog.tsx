import { useCallback, useEffect, useState } from "react";
import { api, type Job } from "../api";

const STATUS_META: Record<Job["status"], { label: string; dot: string }> = {
  pending: { label: "in coda", dot: "bg-amber-400" },
  running: { label: "in corso", dot: "bg-blue-400 animate-pulse" },
  done: { label: "ok", dot: "bg-emerald-500" },
  failed: { label: "fallito", dot: "bg-red-500" },
  cancelled: { label: "annullato", dot: "bg-neutral-500" },
};

function modelLabel(job: Job): string | null {
  if (job.provider !== "higgsfield" || !job.provider_params) return null;
  try {
    const pp = JSON.parse(job.provider_params) as {
      model: string;
      params?: Record<string, string>;
    };
    const extras = Object.values(pp.params ?? {}).filter(Boolean).join(", ");
    return `${pp.model}${extras ? ` · ${extras}` : ""}`;
  } catch {
    return null;
  }
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function JobTiming({ job }: { job: Job }) {
  const attempts = job.attempts ?? 0;
  const start = job.first_started_at ?? job.started_at;
  if (!start && attempts <= 1) return null;
  const end =
    job.status === "running" || job.status === "pending"
      ? Date.now()
      : (job.finished_at ?? Date.now());
  const total = start ? fmtDur(end - start) : null;
  const bits: string[] = [];
  if (total) bits.push(`durata ${total}`);
  if (attempts > 1) bits.push(`${attempts} tentativi`);
  if (bits.length === 0) return null;
  return (
    <div className="text-[11px] text-neutral-500">
      {bits.join(" · ")}
      {attempts > 1 && (
        <span className="text-amber-400/70"> (rate-limit/retry)</span>
      )}
    </div>
  );
}

export default function PhotoJobsLog({ photoId }: { photoId: string }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = useCallback(() => {
    api
      .photoJobs(photoId)
      .then((r) => setJobs(r.jobs))
      .catch(() => {});
  }, [photoId]);

  // Poll while open so running jobs and new generations stay fresh.
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [open, load]);

  const hasUnseenError = jobs.some((j) => j.status === "failed" && !j.seen);

  return (
    <details
      className="border border-neutral-800 rounded-lg"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-2">
        <span>Log generazioni</span>
        {hasUnseenError && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        )}
        {jobs.length > 0 && (
          <span className="text-neutral-600">({jobs.length})</span>
        )}
      </summary>
      <div className="px-3 pb-3">
        {jobs.length === 0 ? (
          <div className="text-[11px] text-neutral-600 py-2">
            Nessuna generazione registrata.
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/60">
            {jobs.map((j) => {
              const meta = STATUS_META[j.status];
              const model = modelLabel(j);
              return (
                <div key={j.id} className="py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={"w-1.5 h-1.5 rounded-full " + meta.dot} />
                    <span className="text-neutral-300">
                      {j.provider === "higgsfield" ? "Higgsfield" : "ChatGPT"}
                    </span>
                    {model && (
                      <span className="text-neutral-500 truncate">{model}</span>
                    )}
                    <div className="flex-1" />
                    <span className="text-neutral-500">{meta.label}</span>
                    <span className="text-neutral-600">
                      {new Date(j.created_at).toLocaleString("it-IT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <JobTiming job={j} />
                  {j.status !== "failed" && j.progress && j.status === "running" && (
                    <div className="text-[11px] text-blue-300">{j.progress}</div>
                  )}
                  {j.status === "failed" && j.error && (
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-[11px] text-red-300/80 break-all flex-1">
                        {j.error}
                      </span>
                      {!j.seen && (
                        <button
                          onClick={async () => {
                            await api.markJobSeen(j.id);
                            load();
                          }}
                          className="shrink-0 text-[11px] text-neutral-500 hover:text-emerald-400"
                          title="Segna come visto"
                        >
                          ✓ visto
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
