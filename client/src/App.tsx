import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { api, type Health, type JobsPayload } from "./api";

export type OutletCtx = { jobs: JobsPayload | null; activeJobs: number };
import JobsPanel from "./components/JobsPanel";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobs, setJobs] = useState<JobsPayload | null>(null);
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [showJobs, setShowJobs] = useState(false);
  const [launching, setLaunching] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 backdrop-blur bg-neutral-950/80 border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
          <Link to="/" className="font-semibold tracking-tight">
            Darkroom
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/" current={location.pathname === "/"}>
              Griglia
            </NavLink>
            {orphanCount > 0 && (
              <NavLink
                to="/orphans"
                current={location.pathname.startsWith("/orphans")}
              >
                Orphan{" "}
                <span className="ml-1 text-amber-400">{orphanCount}</span>
              </NavLink>
            )}
          </nav>
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
            navigate(`/photo/${photoId}`);
          }}
        />
      )}
    </div>
  );
}

function NavLink({
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
      className={
        "px-3 py-1.5 rounded text-sm transition-colors " +
        (current
          ? "bg-neutral-800 text-white"
          : "text-neutral-400 hover:bg-neutral-900 hover:text-white")
      }
    >
      {children}
    </Link>
  );
}
