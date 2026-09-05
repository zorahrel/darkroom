import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import {
  api,
  currentProject,
  rememberProject,
  type Health,
  type JobsPayload,
  type StudioProject,
  type StudioOverview,
} from "./api";

export type OutletCtx = {
  jobs: JobsPayload | null;
  activeJobs: number;
  flush: boolean;
  setFlush: (v: boolean) => void;
  /** Pipeline column open. It lives here because the control is in the
 *  header. */
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
};
import JobsPanel from "./components/JobsPanel";
import { Bott, Badge } from "./ui";
import { LayoutGrid, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react";
import { VIEWS, view } from "./views";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobs, setJobs] = useState<JobsPayload | null>(null);
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [showJobs, setShowJobs] = useState(false);
  /** The pages that take the full height (video editor, colour bench) draw to
   *  the edge: the space above would take it away from them. */
  const [flush, setFlush] = useState(false);
  // Layout preference: it survives a reload, because it is a choice about
  // one's own desk, not a state of the session.
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem("darkroom.rail") !== "0",
  );
  useEffect(() => {
    localStorage.setItem("darkroom.rail", railOpen ? "1" : "0");
  }, [railOpen]);
  const [launching, setLaunching] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  /** Spend on the paid backends: it sits beside the bar's other "connected"
   *  states, because it is the same question ("can I generate?") that the live
   *  browser and the job queue answer. */
  const [spend, setSpend] = useState<StudioOverview["worker"]["spend"]>(null);
  // A "you are looking at an old dashboard" warning. Born of a real case: for
  // nine days the dist being served was older than the code, and every UI
  // change looked like it had not been made.
  const [staleDist, setStaleDist] = useState<string | null>(null);
  const [gradeWarns, setGradeWarns] = useState<string[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const pid = currentProject();

  // Remember the last-opened project so `/` lands back on it.
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);

  useEffect(() => {
    api
      .pipelineStatus()
      .then((r) => {
        setStaleDist(r.stale_dist ?? null);
        setGradeWarns(r.grade_warnings ?? []);
      })
      .catch(() => {});
  }, []);

  // Project list for the switcher (also tells us if we're multi-project).
  useEffect(() => {
    const load = () =>
      api
        .studioProjects()
        .then((r) => {
          setProjects(r.projects);
          setSpend(r.worker.spend ?? null);
        })
        .catch(() => {});
    load();
    // The spend changes on every generation: without re-polling it would stay
    // stuck at the value from page load, i.e. wrong exactly while you are
    // spending.
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
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

  /**
   * The root of a video project leads to the cut.
   *
   * `/p/:pid` is the photo grid: on a video project it showed an empty list,
   * the "add a photo folder" button and the develop panel — i.e. the interface
   * of another craft. A project knows what type it is, so its entry page knows
   * it too.
   */
  useEffect(() => {
    if (!pid || !activeProject || activeProject.kind === "photo") return;
    if (location.pathname.replace(/\/+$/, "") !== `/p/${pid}`) return;
    navigate(view(activeProject.kind).route(pid), { replace: true });
  }, [pid, activeProject, location.pathname, navigate]);

  /**
   * The header's height, measured and put into a CSS variable.
   *
   * Whoever sticks underneath it — the grid's filter bar, the pipeline column —
   * each had their own hand-written number (57, 68, 88): three numbers saying
   * the same thing that stopped agreeing at the first tweak to the header. With
   * `--h-header` there is one source, and it updates when the header wraps on a
   * narrow window.
   */
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () =>
      document.documentElement.style.setProperty("--h-header", `${Math.round(el.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header ref={header} className="sticky top-0 z-30 backdrop-blur bg-neutral-950/80 border-b border-neutral-800">
        <div
          className={
            "mx-auto max-w-none px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4"
          }
        >
          {/* Navigation has two floors, and they are visible.

              TOOLS is what Darkroom can do; PROJECTS is what you are doing it
              to. Before, only the second existed — the app opened on the last
              project — and the capabilities (edit, storyboard, quality checks)
              were discovered only if you already knew they were there. The two
              areas are always in the bar: from inside a project you go back to
              the tools with one click, not by going back. */}
          <div className="flex items-center gap-2 min-w-0">
            <Link to="/" className="font-semibold tracking-tight shrink-0" title="Darkroom">
              Darkroom
            </Link>
            <nav className="flex items-center gap-0.5 text-sm rounded-md bg-neutral-900 border border-neutral-800 p-0.5 shrink-0">
              <ViewTab to="/" icon={Wrench} current={location.pathname === "/" || location.pathname === "/tools"}>
                Strumenti
              </ViewTab>
              <ViewTab to="/studio" icon={LayoutGrid} current={location.pathname.startsWith("/studio")}>
                Progetti
                {projects.length > 0 && (
                  <span className="ml-1 text-neutral-500 tabular-nums">{projects.length}</span>
                )}
              </ViewTab>
            </nav>
            {pid && (
              <>
                <span className="text-neutral-600 shrink-0">/</span>
                <ProjectMenu projects={projects} activeId={pid} />
              </>
            )}
          </div>

          {/* The project's views.
              They used to descend from the type — a "photo" project could not
              show the edit — while real work starts with the photos of a site
              visit and ends in a video. Now the enabled views appear, plus
              those whose data already exists: a view never hides in front of
              something that is there. */}
          {pid && activeProject && (
            <nav className="flex items-center gap-0.5 text-sm rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
              {VIEWS.filter((v) =>
                activeProject.views.includes(v.id) ||
                (v.id === "storyboard" && (activeProject.stats?.panels ?? 0) > 0) ||
                (v.id === "video" && !!activeProject.video?.cuts),
              ).flatMap((v) => {
                const I = v.icon;
                if (v.id === "video") {
                  return [
                    <ViewTab key="video" to={`/p/${pid}/video`} icon={I}
                             current={location.pathname.endsWith("/video")}>
                      Montaggio
                    </ViewTab>,
                    <ViewTab key="scelta" to={`/p/${pid}/video/pick`}
                             current={location.pathname.includes("/video/pick")}>
                      Scelta
                    </ViewTab>,
                  ];
                }
                if (v.id === "storyboard") {
                  return [
                    <ViewTab key="sb" to={`/p/${pid}/storyboard`} icon={I}
                             current={location.pathname.includes("/storyboard")}>
                      Storyboard
                    </ViewTab>,
                  ];
                }
                return [
                  <ViewTab key="foto" to={`/p/${pid}`} icon={I}
                           current={
                             location.pathname.startsWith("/p/") &&
                             !location.pathname.includes("/orphans") &&
                             !location.pathname.includes("/storyboard") &&
                             !location.pathname.includes("/tree") &&
                             !location.pathname.includes("/references") &&
                             !location.pathname.includes("/video")
                           }>
                    Griglia
                  </ViewTab>,
                ];
              })}
              {activeProject.views.includes("photo") && (
                <>
                  <ViewTab to={`/p/${pid}/tree`} current={location.pathname.includes("/tree")}>
                    Albero
                  </ViewTab>
                  <ViewTab to={`/p/${pid}/references`} current={location.pathname.includes("/references")}>
                    Riferimenti
                  </ViewTab>
                </>
              )}
              {orphanCount > 0 && (
                <ViewTab to={`/p/${pid}/orphans`} current={location.pathname.includes("/orphans")}>
                  Orfane <span className="ml-1 text-amber-400">{orphanCount}</span>
                </ViewTab>
              )}
            </nav>
          )}
          {/* This group takes a row of its own until there is REAL room. It was
              `sm:` (640px), i.e. from tablet up it went back onto the same row
              as the navigation: and it does not fit there, so it broke in half
              in a crooked way. At `lg:` (1024px) either you sit comfortably on
              one row, or you get two clean ones. */}
          <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto lg:ml-auto">
            {/* The bar's hierarchy: the alarms first because they change what
                you can do, then the window's switches, then the jobs, and last
                the only filled action — which exists only where it makes sense.
                "Export favourites" on a video project meant nothing, and
                despite that it was the most conspicuous thing on screen. */}
            {health && !health.browser && (
              <Bott weight="pericolo" size="m" disabled={launching}
                    title={health.hint ?? ""}
                    onClick={async () => {
                      setLaunching(true);
                      try {
                        const r = await fetch("/api/browser/launch", { method: "POST" });
                        const j = await r.json();
                        if (!j.ok) alert(`Errore avvio: ${j.error ?? "?"}`);
                        else setHealth((h) => (h ? { ...h, browser: true } : h));
                      } catch (e) {
                        alert(`Errore avvio: ${e instanceof Error ? e.message : String(e)}`);
                      } finally { setLaunching(false); }
                    }}>
                {launching ? "avvio Chrome…" : "⚠ Chrome non collegato — avvialo"}
              </Bott>
            )}
            {jobs?.runner?.paused && jobs.runner.paused_until && (
              <Badge tone="waiting"
                     title={`Limite ChatGPT raggiunto. Riparte da sola alle ${new Date(jobs.runner.paused_until).toLocaleTimeString()}.`}>
                ⏸ coda ferma fino alle{" "}
                {new Date(jobs.runner.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Badge>
            )}

            {activeProject?.views.includes("photo") && (
              <Bott weight="quieto" size="m" active={railOpen} onClick={() => setRailOpen(!railOpen)}
                    title={railOpen ? "Nascondi il pannello colore" : "Mostra il pannello colore"}
                    className="hidden lg:inline-flex">
                <SlidersHorizontal className="w-4 h-4" aria-hidden />
              </Bott>
            )}

            <Bott size="m" onClick={() => setShowJobs((v) => !v)}
                  title="Le generazioni in corso, quelle fatte e quelle fallite">
              Lavori
              <span className={activeJobs > 0 ? "text-sky-300" : "text-neutral-400"}>
                {activeJobs > 0 ? `${activeJobs} in corso` : "fermi"}
              </span>
            </Bott>

            {/* Spent, not "remaining": the balance is not readable with a project
                key (403, the api.usage.read scope is missing), and an invented
                number in the bar would be worse than no number. */}
            {spend && spend.images > 0 && (
              <Badge
                tone={spend.usd >= 5 ? "waiting" : "neutral"}
                title={
                  `${spend.images} chiamate a ${spend.model}, sommando i token che l'API riporta a ogni richiesta. ` +
                  `E' una STIMA DAL BASSO: conta le chiamate passate da Darkroom, non quelle fatte da script esterni ` +
                  `prima che venissero registrate, e non include tasse o cambio valuta. Il totale vero sta su ` +
                  `platform.openai.com/usage: OpenAI non lo espone a una chiave di progetto (403, manca lo scope api.usage.read).`
                }
              >
                ~${spend.usd.toFixed(2)} spesi
              </Badge>
            )}

            {pid && activeProject?.kind !== "video" && activeProject?.kind !== "storyboard" && (
              <Bott size="m"
                    title="Copia le preferite, già gradate, in una cartella fuori dal progetto"
                    onClick={async () => {
                      const r = await api.exportFavorites();
                      alert(`Esportate ${r.copied}/${r.total} preferite in:\n${r.dir}`);
                    }}>
                <span className="hidden sm:inline">Esporta preferite</span>
                <span className="sm:hidden">Esporta</span>
              </Bott>
            )}
          </div>
        </div>
      </header>

      {gradeWarns.map((w) => (
        <div key={w} className="bg-rose-900/80 text-rose-50 text-xs px-4 py-2 border-b border-rose-700">
          {w}
        </div>
      ))}

      {staleDist && (
        <div className="bg-amber-900/80 text-amber-50 text-xs px-4 py-2 border-b border-amber-700">
          {staleDist}
        </div>
      )}

      {/* No width limit: columnising at 1280px is right for a page of text
          and wrong for everything done here — a photo grid, a timeline — where
          the result was two empty bands at the sides of a wide monitor. There
          was a switch to remove it, and it was always on.

          The space above was at zero for every page because ONE needed it that
          way: in the grid the padding scrolled over the sticky filter bar. The
          result was that every other page began glued to the title bar. Now the
          space is there, and whoever does not want it — whoever takes the full
          height — declares so. */}
      <main className={`flex-1 w-full max-w-none px-4 pb-4 ${flush ? "pt-0" : "pt-4"}`}>
        <Outlet context={{ jobs, activeJobs, flush, setFlush, railOpen, setRailOpen }} />
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
}: {
  projects: StudioProject[];
  activeId: string;
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
        className="flex items-center gap-1 max-w-[12rem] px-2 py-1 rounded text-sm text-white hover:bg-neutral-900 transition-colors"
      >
        <span className="truncate">{label}</span>
        <span className="text-neutral-400 text-xs">▾</span>
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
  icon: I,
}: {
  to: string;
  current: boolean;
  children: React.ReactNode;
  /** The icon sits on the first tab of a family: "Cut" and "Pick" are the same
   *  view at two moments, and two identical icons in a row do not help tell
   *  them apart. */
  icon?: LucideIcon;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className={
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[13px] transition-colors " +
        (current
          ? "bg-neutral-800 text-neutral-100"
          : "text-neutral-400 hover:text-neutral-100")
      }
    >
      {I && <I className="w-3.5 h-3.5" aria-hidden />}
      {children}
    </Link>
  );
}
