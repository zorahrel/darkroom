import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  lastProject,
  type StudioOverview,
  type StudioProject,
} from "../api";

// Top-level supervisor: every local project's pipeline at a glance, plus the
// shared worker's health. Opening a project sets it as active (persisted) and
// jumps into the normal dashboard scoped to it.
export default function StudioPage() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh() {
    try {
      setData(await api.studioProjects());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  function open(pid: string) {
    navigate(`/p/${pid}`);
  }

  async function toggleActive(p: StudioProject) {
    await api.studioPatchProject(p.id, { active: !p.active });
    refresh();
  }

  const active = lastProject();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
        {data && <WorkerPill worker={data.worker} />}
        <div className="flex-1" />
      </div>

      {err && (
        <div className="rounded border border-red-900 bg-red-950/40 text-red-200 text-sm px-3 py-2">
          {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.projects.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            isActive={p.id === active || (!active && p === data.projects[0])}
            onOpen={() => open(p.id)}
            onToggleActive={() => toggleActive(p)}
          />
        ))}
      </div>

      <AddProject onAdded={refresh} />
    </div>
  );
}

function WorkerPill({ worker }: { worker: StudioOverview["worker"] }) {
  const alive = worker.browser_alive;
  const dot =
    alive === null ? "bg-neutral-500" : alive ? "bg-emerald-500" : "bg-red-500";
  const label =
    alive === null ? "codex" : alive ? "browser attivo" : "browser offline";
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-900 border border-neutral-800">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        {worker.backend} · {label}
      </span>
      {worker.runner.paused && worker.runner.paused_until && (
        <span className="px-2 py-1 rounded bg-amber-900/40 text-amber-200 border border-amber-900">
          ⏸ coda in pausa fino alle{" "}
          {new Date(worker.runner.paused_until).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}

function ProjectCard({
  p,
  isActive,
  onOpen,
  onToggleActive,
}: {
  p: StudioProject;
  isActive: boolean;
  onOpen: () => void;
  onToggleActive: () => void;
}) {
  const s = p.stats;
  const q = s?.queue ?? {};
  return (
    <div
      className={
        "rounded-xl border bg-neutral-950/60 p-4 flex flex-col gap-3 " +
        (isActive ? "border-emerald-700/70" : "border-neutral-800")
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate flex items-center gap-2">
            {p.name}
            {isActive && (
              <span className="text-[10px] uppercase tracking-wide text-emerald-400">
                attivo
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 truncate" title={p.root}>
            {p.id} · {p.root}
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={onToggleActive}
          title={p.active ? "In coda: sì (click per mettere in pausa)" : "In pausa (click per attivare)"}
          className={
            "text-[10px] px-2 py-1 rounded border whitespace-nowrap " +
            (p.active
              ? "border-emerald-800 text-emerald-300 bg-emerald-900/20"
              : "border-neutral-700 text-neutral-400")
          }
        >
          {p.active ? "in coda" : "in pausa"}
        </button>
      </div>

      {!p.root_exists && (
        <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/60 rounded px-2 py-1">
          ⚠ cartella progetto non trovata
        </div>
      )}
      {p.error && (
        <div className="text-xs text-red-300 bg-red-950/30 border border-red-900/60 rounded px-2 py-1 truncate" title={p.error}>
          errore: {p.error}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="foto" value={s.photos} />
          <Stat label="preferite" value={s.favorites} />
          <Stat label="versioni" value={s.versions} />
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] min-h-[1.25rem] flex-wrap">
        {(q.running ?? 0) > 0 && (
          <Badge className="bg-sky-900/40 text-sky-200 border-sky-900">
            {q.running} in corso
          </Badge>
        )}
        {(q.pending ?? 0) > 0 && (
          <Badge className="bg-neutral-800 text-neutral-300 border-neutral-700">
            {q.pending} in coda
          </Badge>
        )}
        {(q.failed ?? 0) > 0 && (
          <Badge className="bg-red-900/40 text-red-200 border-red-900">
            {q.failed} falliti
          </Badge>
        )}
        <div className="flex-1" />
        <span className="text-neutral-600">{relTime(s?.last_version_at ?? null)}</span>
      </div>

      <button
        onClick={onOpen}
        className="mt-1 text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
      >
        Apri →
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-neutral-900/60 border border-neutral-800 py-1.5">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`px-1.5 py-0.5 rounded border ${className}`}>{children}</span>;
}

function AddProject({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.studioAddProject({ id: id.trim(), name: name.trim() || undefined, root: root.trim() });
      setId("");
      setName("");
      setRoot("");
      setOpen(false);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 rounded border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white"
      >
        + Aggiungi progetto
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-3 max-w-lg">
      <div className="text-sm font-medium">Nuovo progetto</div>
      <Field label="id (slug: a-z 0-9 _ -)">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="es. kyoto-2026"
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="nome (opzionale)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="es. Kyoto 2026"
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="cartella progetto (path assoluto, deve esistere)">
        <input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          placeholder="/Users/.../Projects/kyoto"
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm font-mono"
        />
      </Field>
      {err && <div className="text-xs text-red-300">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !id.trim() || !root.trim()}
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 border border-emerald-700"
        >
          {busy ? "Aggiungo…" : "Aggiungi"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-sm px-3 py-1.5 rounded border border-neutral-700 text-neutral-400"
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function relTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min}m fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h fa`;
  const d = Math.round(h / 24);
  return `${d}g fa`;
}
