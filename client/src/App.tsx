import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import {
  api,
  currentProject,
  rememberProject,
  type Health,
  type JobsPayload,
  type StudioProject,
} from "./api";

export type OutletCtx = {
  jobs: JobsPayload | null;
  activeJobs: number;
  flush: boolean;
  setFlush: (v: boolean) => void;
  /** Colonna della pipeline aperta. Vive qui perché il comando sta nell'header. */
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
};
import JobsPanel from "./components/JobsPanel";
import { Bott, Targa } from "./ui";
import { SlidersHorizontal, type LucideIcon } from "lucide-react";
import { VISTE, vista } from "./viste";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [jobs, setJobs] = useState<JobsPayload | null>(null);
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [showJobs, setShowJobs] = useState(false);
  /** Le pagine che si prendono tutta l'altezza (editor video, banco colore)
   *  disegnano fino al bordo: lo spazio sopra glielo toglierebbe. */
  const [flush, setFlush] = useState(false);
  // Preferenza di layout: sopravvive al reload, perché è una scelta sulla
  // propria scrivania, non uno stato della sessione.
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem("darkroom.rail") !== "0",
  );
  useEffect(() => {
    localStorage.setItem("darkroom.rail", railOpen ? "1" : "0");
  }, [railOpen]);
  const [launching, setLaunching] = useState(false);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  // Avviso "stai guardando una dashboard vecchia". Nasce da un caso reale: per
  // nove giorni il dist servito era piu' vecchio del codice, e ogni modifica
  // alla UI sembrava non essere stata fatta.
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

  /**
   * La radice di un progetto video porta al montaggio.
   *
   * `/p/:pid` e' la griglia delle foto: su un progetto video mostrava un elenco
   * vuoto, il bottone "aggiungi una cartella di foto" e il pannello di sviluppo
   * — cioe' l'interfaccia di un altro mestiere. Un progetto sa di che tipo e',
   * quindi la sua pagina d'ingresso lo sa anche lei.
   */
  useEffect(() => {
    if (!pid || !activeProject || activeProject.kind === "photo") return;
    if (location.pathname.replace(/\/+$/, "") !== `/p/${pid}`) return;
    navigate(vista(activeProject.kind).rotta(pid), { replace: true });
  }, [pid, activeProject, location.pathname, navigate]);

  /**
   * L'altezza della testata, misurata e messa in una variabile CSS.
   *
   * Chi si appiccica sotto di lei — la barra dei filtri della griglia, la
   * colonna della pipeline — aveva ognuno il suo numero scritto a mano (57, 68,
   * 88): tre numeri che dicevano la stessa cosa e che al primo ritocco della
   * testata smettevano di coincidere. Con `--h-testata` c'e' una fonte sola, e
   * si aggiorna quando la testata va a capo su una finestra stretta.
   */
  const testata = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = testata.current;
    if (!el) return;
    const misura = () =>
      document.documentElement.style.setProperty("--h-testata", `${Math.round(el.getBoundingClientRect().height)}px`);
    misura();
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-full flex flex-col">
      <header ref={testata} className="sticky top-0 z-30 backdrop-blur bg-neutral-950/80 border-b border-neutral-800">
        <div
          className={
            "mx-auto max-w-none px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4"
          }
        >
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
                <span className="text-neutral-400 shrink-0">/</span>
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

          {/* Le viste del progetto.
              Prima discendevano dal tipo — un progetto "foto" non poteva
              mostrare il montaggio — mentre un lavoro vero comincia con le foto
              di un sopralluogo e finisce in un video. Adesso compaiono le viste
              accese, piu' quelle di cui esistono gia' i dati: una vista non si
              nasconde mai davanti a roba che c'e'. */}
          {pid && activeProject && (
            <nav className="flex items-center gap-0.5 text-sm rounded-md bg-neutral-900 border border-neutral-800 p-0.5">
              {VISTE.filter((v) =>
                activeProject.views.includes(v.id) ||
                (v.id === "storyboard" && (activeProject.stats?.panels ?? 0) > 0) ||
                (v.id === "video" && !!activeProject.video?.tagli),
              ).flatMap((v) => {
                const I = v.icona;
                if (v.id === "video") {
                  return [
                    <ViewTab key="video" to={`/p/${pid}/video`} icona={I}
                             current={location.pathname.endsWith("/video")}>
                      Montaggio
                    </ViewTab>,
                    <ViewTab key="scelta" to={`/p/${pid}/video/scelta`}
                             current={location.pathname.includes("/video/scelta")}>
                      Scelta
                    </ViewTab>,
                  ];
                }
                if (v.id === "storyboard") {
                  return [
                    <ViewTab key="sb" to={`/p/${pid}/storyboard`} icona={I}
                             current={location.pathname.includes("/storyboard")}>
                      Storyboard
                    </ViewTab>,
                  ];
                }
                return [
                  <ViewTab key="foto" to={`/p/${pid}`} icona={I}
                           current={
                             location.pathname.startsWith("/p/") &&
                             !location.pathname.includes("/orphans") &&
                             !location.pathname.includes("/storyboard") &&
                             !location.pathname.includes("/albero") &&
                             !location.pathname.includes("/riferimenti") &&
                             !location.pathname.includes("/video")
                           }>
                    Griglia
                  </ViewTab>,
                ];
              })}
              {activeProject.views.includes("photo") && (
                <>
                  <ViewTab to={`/p/${pid}/albero`} current={location.pathname.includes("/albero")}>
                    Albero
                  </ViewTab>
                  <ViewTab to={`/p/${pid}/riferimenti`} current={location.pathname.includes("/riferimenti")}>
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
          {/* Everything below breaks onto its own full-width row on mobile
              (rather than interleaving with the breadcrumb/nav row above) so a
              phone gets at most two header rows instead of three or four. */}
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:ml-auto">
            {/* La gerarchia della barra: gli allarmi per primi perché
                cambiano cosa puoi fare, poi gli interruttori della finestra,
                poi i lavori, e in fondo l'unica azione piena — che esiste solo
                dove ha senso. "Esporta favorite" su un progetto video non
                voleva dire niente, e nonostante questo era la cosa più
                appariscente dello schermo. */}
            {health && !health.browser && (
              <Bott peso="pericolo" taglia="m" disabilitato={launching}
                    titolo={health.hint ?? ""}
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
              <Targa tono="attesa"
                     titolo={`Limite ChatGPT raggiunto. Riparte da sola alle ${new Date(jobs.runner.paused_until).toLocaleTimeString()}.`}>
                ⏸ coda ferma fino alle{" "}
                {new Date(jobs.runner.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Targa>
            )}

            {activeProject?.views.includes("photo") && (
              <Bott peso="quieto" taglia="m" attivo={railOpen} onClick={() => setRailOpen(!railOpen)}
                    titolo={railOpen ? "Nascondi il pannello colore" : "Mostra il pannello colore"}
                    className="hidden lg:inline-flex">
                <SlidersHorizontal className="w-4 h-4" aria-hidden />
              </Bott>
            )}

            <Bott taglia="m" onClick={() => setShowJobs((v) => !v)}
                  titolo="Le generazioni in corso, quelle fatte e quelle fallite">
              Lavori
              <span className={activeJobs > 0 ? "text-sky-300" : "text-neutral-400"}>
                {activeJobs > 0 ? `${activeJobs} in corso` : "fermi"}
              </span>
            </Bott>

            {pid && activeProject?.kind !== "video" && activeProject?.kind !== "storyboard" && (
              <Bott taglia="m"
                    titolo="Copia le preferite, già gradate, in una cartella fuori dal progetto"
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

      {/* Niente limite di larghezza: incolonnare a 1280px e' giusto per una
          pagina di testo e sbagliato per tutto quello che si fa qui — una
          griglia di foto, una timeline — dove il risultato erano due bande
          vuote ai lati di un monitor largo. C'era un interruttore per
          toglierlo, e stava sempre su.

          Lo spazio sopra e' stato a zero per tutte le pagine perche' UNA ne
          aveva bisogno: nella griglia il padding scorreva sopra la barra dei
          filtri appiccicata. Il risultato e' che ogni altra pagina cominciava
          attaccata alla barra del titolo. Adesso lo spazio c'e', e chi non lo
          vuole — chi si prende tutta l'altezza — lo dichiara. */}
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
  icona: I,
}: {
  to: string;
  current: boolean;
  children: React.ReactNode;
  /** L'icona sta sulla prima scheda di una famiglia: "Montaggio" e "Scelta"
   *  sono la stessa vista in due momenti, e due icone uguali di fila non
   *  aiutano a distinguerle. */
  icona?: LucideIcon;
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
