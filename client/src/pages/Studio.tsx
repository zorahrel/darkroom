import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  lastProject,
  type ProjectKind,
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
            onForget={async () => {
              await api.studioRemoveProject(p.id);
              refresh();
            }}
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
  onForget,
}: {
  p: StudioProject;
  isActive: boolean;
  onOpen: () => void;
  onToggleActive: () => void;
  onForget: () => void;
}) {
  const s = p.stats;
  const q = s?.queue ?? {};
  const [confirming, setConfirming] = useState(false);
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
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400"
              title={
                p.kind === "storyboard"
                  ? "Progetto storyboard: pannelli in sequenza"
                  : "Progetto foto: galleria da rifinire"
              }
            >
              {p.kind === "storyboard" ? "storyboard" : "foto"}
            </span>
            {isActive && (
              <span className="text-[10px] uppercase tracking-wide text-emerald-400">
                attivo
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 truncate" title={p.root}>
            {p.root}
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
        {confirming ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setConfirming(false);
                onForget();
              }}
              className="text-[10px] px-2 py-1 rounded border border-red-800 text-red-300 bg-red-950/30 whitespace-nowrap"
              title="Toglie il progetto dall'elenco. Cartella, database e render restano dove sono."
            >
              togli dall'elenco
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-[10px] px-1.5 py-1 text-neutral-500 hover:text-neutral-300"
            >
              no
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="Togli dall'elenco (i file restano)"
            className="text-[10px] px-1.5 py-1 text-neutral-600 hover:text-neutral-300"
          >
            ✕
          </button>
        )}
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
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>("photo");
  const [photos, setPhotos] = useState("");
  const [mode, setMode] = useState<"link" | "copy">("link");
  const [root, setRoot] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.studioAddProject({
        name: name.trim(),
        kind,
        root: root.trim() || undefined,
        photos: photos.trim() ? { path: photos.trim(), mode } : undefined,
      });
      if (res.summary && res.summary.added === 0 && res.summary.scanned === 0) {
        setErr("Progetto creato, ma in quella cartella non ho trovato foto.");
      }
      setName("");
      setPhotos("");
      setRoot("");
      setAdvanced(false);
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
        + Nuovo progetto
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4 space-y-4 max-w-lg">
      <div className="text-sm font-medium">Nuovo progetto</div>

      <Field label="Come si chiama">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="es. Kyoto 2026"
          autoFocus
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm"
        />
      </Field>

      <Field label="Che cosa ci fai">
        <div className="grid grid-cols-2 gap-2">
          <KindOption
            selected={kind === "photo"}
            onClick={() => setKind("photo")}
            title="Foto"
            hint="Una galleria da rifinire: griglia, versioni, colore, export."
          />
          <KindOption
            selected={kind === "storyboard"}
            onClick={() => setKind("storyboard")}
            title="Storyboard"
            hint="Pannelli in sequenza da una scaletta, con durate e personaggi."
          />
        </div>
      </Field>

      {kind === "photo" && (
        <Field label="Le foto (opzionale — puoi aggiungerle dopo)">
          <input
            value={photos}
            onChange={(e) => setPhotos(e.target.value)}
            placeholder="/Users/…/Foto/Kyoto"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm font-mono"
          />
          {photos.trim() && (
            <div className="flex gap-2 pt-1.5">
              <ModeOption
                selected={mode === "link"}
                onClick={() => setMode("link")}
                title="Lasciale dov'è"
                hint="Le indicizzo dove sono, non copio niente"
              />
              <ModeOption
                selected={mode === "copy"}
                onClick={() => setMode("copy")}
                title="Copiale nel progetto"
                hint="Utile se la cartella è temporanea"
              />
            </div>
          )}
        </Field>
      )}

      <div>
        <button
          onClick={() => setAdvanced((v) => !v)}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          {advanced ? "▾" : "▸"} Dove salvare il progetto
        </button>
        {advanced && (
          <div className="pt-2">
            <Field label="Cartella del progetto (vuoto = la crea Darkroom)">
              <input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="~/Darkroom/projects/<nome>"
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-sm font-mono"
              />
            </Field>
          </div>
        )}
      </div>

      {err && <div className="text-xs text-amber-300">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 border border-emerald-700"
        >
          {busy ? "Creo…" : "Crea"}
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

function KindOption({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "text-left p-2.5 rounded-lg border transition-colors " +
        (selected
          ? "border-emerald-600 bg-emerald-950/30"
          : "border-neutral-800 hover:border-neutral-600")
      }
    >
      <div className="text-sm">{title}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>
    </button>
  );
}

function ModeOption({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 text-left px-2.5 py-1.5 rounded border text-xs transition-colors " +
        (selected ? "border-sky-600 bg-sky-950/30" : "border-neutral-800 hover:border-neutral-600")
      }
    >
      <div className="text-neutral-200">{title}</div>
      <div className="text-neutral-500">{hint}</div>
    </button>
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
