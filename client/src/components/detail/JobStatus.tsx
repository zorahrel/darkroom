import {
  type Job,
} from "../../api";

export const JOB_STATUS_META: Record<
  Job["status"],
  { label: string; dot: string; chip: string }
> = {
  pending: {
    label: "In coda",
    dot: "bg-amber-400",
    chip: "bg-amber-900/40 text-amber-200 border-amber-800/60",
  },
  running: {
    label: "In corso",
    dot: "bg-blue-400 animate-pulse",
    chip: "bg-blue-900/40 text-blue-200 border-blue-800/60",
  },
  done: {
    label: "Completato",
    dot: "bg-emerald-400",
    chip: "bg-emerald-900/40 text-emerald-200 border-emerald-800/60",
  },
  failed: {
    label: "Fallito",
    dot: "bg-red-400",
    chip: "bg-red-900/40 text-red-200 border-red-800/60",
  },
  cancelled: {
    label: "Annullato",
    dot: "bg-neutral-500",
    chip: "bg-neutral-800 text-neutral-400 border-neutral-700",
  },
};

export function JobStatusBadge({ job }: { job: Job | null }) {
  if (!job) return null;
  // Failures/cancellations are surfaced only in the Jobs log, never on the photo.
  if (job.status === "failed" || job.status === "cancelled") return null;
  const meta = JOB_STATUS_META[job.status];
  const running = job.status === "running" || job.status === "pending";
  // While active, show the granular step the worker reported.
  const label = running && job.progress ? job.progress : meta.label;
  const provider = job.provider === "higgsfield" ? "Higgsfield" : "ChatGPT";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border " +
        meta.chip
      }
    >
      <span className={"w-1.5 h-1.5 rounded-full " + meta.dot} />
      <span className="opacity-60">{provider}</span>
      {label}
    </span>
  );
}

export function JobStatusBanner({
  pausedUntil,
}: {
  pausedUntil: number | null;
}) {
  // Errors are intentionally NOT shown here — they live only in the Jobs log.
  // This banner is reserved for queue-wide info (rate-limit pause).
  const showPaused = pausedUntil && pausedUntil > Date.now();
  if (!showPaused) return null;

  return (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      Coda in pausa (rate-limit ChatGPT) — riprende{" "}
      {new Date(pausedUntil!).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </div>
  );
}
