import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import {
  api,
  currentProject,
  rememberProject,
  type Health,
  type JobsPayload,
  type StudioProject,
} from "./api";

export type OutletCtx = { jobs: JobsPayload | null; activeJobs: number };
import JobsPanel from "./components/JobsPanel";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobs, setJobs] = useState<JobsPayload | null>(null);
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [showJobs, setShowJobs] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const pid = currentProject();

  // Remember the last-opened project so `/` lands back on it.
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);

  // Project list for the switcher (also tells us if we're multi-project).
  useEffect(() => {
    api
      .studioProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => {});
  }, []);

  // Health check + periodic re-poll (so the offline badge clears once the
  // browser comes up, without a manual page reload).
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .health()
        .then((h) => alive && setHealth(h))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Live jobs polling (1.5s)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const j = await api.jobs();
        if (alive) setJobs(j);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Orphan count refresh on navigation
  useEffect(() => {
    api
      .orphans()
      .then((r) => setOrphanCount(r.orphans.length))
      .catch(() => {});
  }, [location.pathname]);

  const summary = jobs?.summary ?? {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
  };
  const activeJobs = (summary.pending ?? 0) + (summary.running ?? 0);
  const activeProject = projects.find((p) => p.id === pid);

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur bg-neutral-950/80 border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
          {/* Breadcrumb: the app, then which project you are in. Studio is not
              a view of a project — it's the floor above — so it lives inside
              the project menu instead of sitting next to Griglia/Storyboard. */}
          <div className="flex items-center gap-1.5 min-w-0">
            {/* A project named like the app would read "Darkroom / Darkroom":
                in that case the project chip stands on its own. */}
            {projects.find((p) => p.id === pid)?.name.trim().toLowerCase() !== "darkroom" && (
              <>
                <Link to="/studio" className="font-semibold tracking-tight shrink-0">
                  Darkroom
                </Link>
                <span className="text-neutral-600 shrink-0">/</span>
              </>
            )}
            <ProjectMenu
              projects={projects}
              activeId={pid}
              standalone={
                projects.find((p) => p.id === pid)?.name.trim().toLowerCase() === "darkroom"
              }
            />
          </div>

          {/* Views of the active project. Storyboard shows for a storyboard
              project — or for any project that already has panels, because a
              view is never hidden from data that exists. */}
          {pid && (
            <nav className="flex items-center gap-0.5 text-sm rounded-lg bg-neutral-900 border border-neutral-800 p-0.5">
              <ViewTab
                to={`/p/${pid}`}
                current={
                  location.pathname.startsWith("/p/") &&
                  !location.pathname.includes("/orphans") &&
                  !location.pathname.includes("/storyboard")
                }
              >
                Griglia
              </ViewTab>
              {(activeProject?.kind === "storyboard" ||
                (activeProject?.stats?.panels ?? 0) > 0) && (
                <ViewTab
                  to={`/p/${pid}/storyboard`}
                  current={location.pathname.includes("/storyboard")}
                >
                  Storyboard
                </ViewTab>
              )}
              {orphanCount > 0 && (
                <ViewTab
                  to={`/p/${pid}/orphans`}
                  current={location.pathname.includes("/orphans")}
                >
                  Orphan <span className="ml-1 text-amber-400">{orphanCount}</span>
                </ViewTab>
              )}
            </nav>
          )}
          <div className="flex-1" />
          {health && !health.browser && (
            <button
              disabled={launching}
              onClick={async () => {
                setLaunching(true);
                try {
                  const r = await fetch("/api/browser/launch", { method: "POST" });
                  const j = await r.json();
                  if (!j.ok) {
                    alert(`Errore avvio: ${j.error ?? "?"}`);
                  } else {
                    // launch confirmed alive server-side — clear the badge now
                    setHealth((h) => (h ? { ...h, browser: true } : h));
                  }
                } catch (e) {
                  alert(`Errore avvio: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setLaunching(false);
                }
              }}
              className="text-xs px-2 py-1 rounded bg-red-900/40 hover:bg-red-900/60 disabled:opacity-60 disabled:cursor-wait text-red-200 border border-red-900 whitespace-nowrap"
              title={health.hint ?? ""}
            >
              {launching ? (
                <>⏳ <span className="hidden sm:inline">Avvio browser ChatGPT…</span><span className="sm:hidden">Avvio…</span></>
              ) : (
                <>⚠ <span className="hidden sm:inline">Browser ChatGPT offline — click per avviare</span><span className="sm:hidden">Browser offline</span></>
              )}
            </button>
          )}
          {jobs?.runner?.paused && jobs.runner.paused_until && (
            <span
              className="text-xs px-2 py-1 rounded bg-amber-900/40 text-amber-200 border border-amber-900"
              title={`Cap ChatGPT raggiunto. Auto-resume alle ${new Date(jobs.runner.paused_until).toLocaleTimeString()}.`}
            >
              ⏸ Coda in pausa fino alle {new Date(jobs.runner.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => setShowJobs((v) => !v)}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
          >
            Jobs{" "}
            <span className="ml-1 text-neutral-400">
              {activeJobs > 0 ? `${activeJobs} attivi` : "idle"}
            </span>
          </button>
          <button
            onClick={async () => {
              const r = await api.exportFavorites();
              alert(
                `Esportate ${r.copied}/${r.total} preferite in:\n${r.dir}`,
              );
            }}
            className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 border border-emerald-700"
          >
            Esporta favorite
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4">
        <Outlet context={{ jobs, activeJobs }} />
      </main>

      {showJobs && jobs && (
        <JobsPanel
          jobs={jobs}
          onClose={() => setShowJobs(false)}
          onJumpTo={(photoId) => {
            setShowJobs(false);
            navigate(pid ? `/p/${pid}/photo/${photoId}` : `/photo/${photoId}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * Which project you are in, and the way out of it. The project lives in the
 * URL (`/p/:pid`), so switching is a normal SPA navigation and Back/Forward
 * move between projects. Shown even with a single project: with no marker at
 * all there is nothing on screen saying where you are.
 */
function ProjectMenu({
  projects,
  activeId,
  standalone = false,
}: {
  projects: StudioProject[];
  activeId: string;
  /** True when the chip IS the breadcrumb (no wordmark before it). */
  standalone?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a menu that traps you is worse than none.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = projects.find((p) => p.id === activeId);
  const label = active?.name ?? (activeId || "Tutti i progetti");

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Progetto attivo"
        className={
          "flex items-center gap-1 max-w-[12rem] px-2 py-1 rounded text-sm text-white hover:bg-neutral-900 transition-colors " +
          (standalone ? "font-semibold tracking-tight" : "")
        }
      >
        <span className="truncate">{label}</span>
        <span className="text-neutral-500 text-xs">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 mt-1 z-40 min-w-[12rem] rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
        >
          {projects.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(`/p/${encodeURIComponent(p.id)}`);
              }}
              className={
                "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-neutral-800 " +
                (p.id === activeId ? "text-white" : "text-neutral-300")
              }
            >
              <span className="w-3 text-emerald-400">{p.id === activeId ? "✓" : ""}</span>
              <span className="truncate">{p.name}</span>
            </button>
          ))}
          <div className="my-1 border-t border-neutral-800" />
          {activeId && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(`/p/${encodeURIComponent(activeId)}/sources`);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              <span className="pl-5">Foto del progetto…</span>
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/studio");
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            <span className="pl-5">Tutti i progetti…</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** One view of the active project, inside the segmented group. */
function ViewTab({
  to,
  current,
  children,
}: {
  to: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className={
        "px-3 py-1 rounded-md text-sm transition-colors " +
        (current
          ? "bg-neutral-800 text-white"
          : "text-neutral-400 hover:text-white")
      }
    >
      {children}
    </Link>
  );
}
