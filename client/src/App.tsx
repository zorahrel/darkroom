import { nelGuscioDesktop } from "./guscio";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate, Link } from "react-router-dom";
import { ALTEZZA_BARRA } from "./barra";
import { Trascina } from "./components/Trascina";
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
import {
  FolderOutput,
  LayoutGrid,
  ListOrdered,
  Logs,
  ScanSearch,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
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
  // Il guscio non cambia durante la sessione: si legge una volta.
  const desktop = nelGuscioDesktop();
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
      {/* Nell'applicazione la barra del titolo del sistema non c'è: i semafori
          stanno sopra il contenuto. Due conseguenze, entrambe qui.

          Il margine a sinistra è lo spazio dei tre bottoni: senza, il nome
          "Darkroom" ci finirebbe sotto e non si potrebbe cliccare.

          `data-tauri-drag-region` rende la barra la maniglia della finestra. Senza,
          una finestra senza barra del titolo non si sposta più — e i bottoni dentro
          continuano a funzionare, perché il trascinamento parte solo dal vuoto.

          Il valore è `deep` e non l'attributo nudo: nudo vuol dire «solo se il clic
          cade proprio su QUESTO elemento», e la barra è fatta di riquadri dentro
          riquadri — la nav, il gruppo di sinistra, quello di destra — che coprono
          quasi tutto. Il vuoto apparteneva a loro, non all'elemento con l'attributo,
          e la finestra si spostava solo da poche fessure. Con `deep` vale tutto il
          sottoalbero, e i cliccabili (bottoni, collegamenti, campi) si fermano da
          soli perché bloccano il trascinamento prima di arrivare qui. */}
      <header
        ref={header}
        data-tauri-drag-region={desktop ? "deep" : undefined}
        className="sticky top-0 z-30 backdrop-blur bg-neutral-950/80 border-b border-neutral-800"
      >
        <div
          /* Il margine dei semafori è in linea e non una classe, e non per pigrizia:
             `sm:px-4` compare più avanti nel foglio di stile e sopra i 640 px lo
             scavalcava — misurato, la classe c'era e il nome restava sotto i bottoni.
             Non è comunque un token di stile: è una misura del guscio. */
          /* L'altezza è fissata solo dentro l'applicazione, ed è la stessa misura su
             cui il guscio centra i semafori: se la barra cambiasse altezza da sola, i
             semafori resterebbero dove sono e nessuno se ne accorgerebbe. */
          /* Lo spazio per i semafori sta su un SEGNAPOSTO, non sul padding.
             Il padding sinistro rientra ogni riga: da quando la barra va a capo
             costava 92 px anche alla seconda e alla terza, dove i semafori non
             ci sono. Misurato a 780 px: larghezza utile 672 invece di 748, e le
             prime due strisce (381 + 356) non stavano insieme per 65 px.
             Un segnaposto e' un figlio del flex: occupa la prima riga e basta. */
          style={desktop ? { minHeight: ALTEZZA_BARRA } : undefined}
          /* La barra VA A CAPO quando le sue strisce non ci stanno in fila.

             Il 20/09, a 780 px, la scelta opposta (una riga sola, ogni striscia
             che scorre da se') e' stata misurata e non regge: le tre strisce
             mostravano meno di meta' di quello che contengono

                 striscia 1   servono 381 px, ne aveva 195
                 striscia 2   servono 354 px, ne aveva 183
                 striscia 3   servono 510 px, ne aveva 261

             e le voci «Profilo», «Albero», «Riferimenti», «Esporta preferite»
             erano FUORI dalla vista — non piccole: invisibili, raggiungibili
             solo scorrendo tre nastri diversi a mano. Una barra di navigazione
             che nasconde la navigazione non e' compatta, e' rotta.

             Andando a capo, a 780 px le prime due strisce stanno insieme
             (381 + 354 = 735) e la terza scende: due righe, tutto leggibile.
             `fila-scorre-sempre` resta sulle strisce come ultima difesa sotto i
             ~400 px, dove nemmeno una striscia intera ci sta. */
          className="mx-auto max-w-none px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4"
        >
          {/* Navigation has two floors, and they are visible.

              TOOLS is what Darkroom can do; PROJECTS is what you are doing it
              to. Before, only the second existed — the app opened on the last
              project — and the capabilities (edit, storyboard, quality checks)
              were discovered only if you already knew they were there. The two
              areas are always in the bar: from inside a project you go back to
              the tools with one click, not by going back. */}
          {/* Il posto dei semafori del guscio: 76 px + i 16 del gap = i 92 che
              prima erano padding. Sta nel flusso, quindi lo occupa solo la
              riga dove i semafori stanno davvero. */}
          {desktop && <div aria-hidden className="shrink-0" style={{ width: 76 }} />}
          <div className="fila-scorre-sempre flex flex-nowrap items-center gap-2 min-w-0 max-w-full shrink">
            <Link
              to="/"
              className="inline-flex items-center min-h-11 sm:min-h-0 font-semibold tracking-tight shrink-0"
              title="Darkroom"
            >
              Darkroom
            </Link>
            {/* Sotto i 768 px questi due piani stanno in fondo, in `BarraSotto`:
                in cima rubavano la prima riga al titolo e mettevano la navigazione
                piu' lontana dal pollice di qualunque altra cosa. */}
            <nav className="hidden md:flex items-center gap-0.5 text-sm rounded-md bg-neutral-900 border border-neutral-800 p-0.5 shrink-0">
              <ViewTab to="/" icon={ScanSearch} current={location.pathname === "/" || location.pathname === "/tools"}>
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
              something that is there.

              `fila-scorre`: era l'unica delle tre file dell'intestazione
              rimasta senza, e a 438 px sforava di 10 px — il pezzo di pagina
              che si trascinava di lato quando si scorreva. */}
          {pid && activeProject && (
            <nav className="fila-scorre-sempre flex items-center gap-0.5 text-sm rounded-md bg-neutral-900 border border-neutral-800 p-0.5 min-w-0">
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
                             location.pathname === `/p/${pid}` ||
                             location.pathname.startsWith(`/p/${pid}/photo/`)
                           }>
                    Griglia
                  </ViewTab>,
                ];
              })}
              {activeProject.views.includes("photo") && (
                <>
                  {/* Il culling sta prima dell'albero perche' viene prima nel
                      lavoro: si sceglie cosa lavorare, poi si guarda cosa e' nato
                      da cosa. */}
                  <ViewTab to={`/p/${pid}/culling`} current={location.pathname.includes("/culling")}>
                    Culling
                  </ViewTab>
                  <ViewTab to={`/p/${pid}/girato`} current={location.pathname.includes("/girato")}>
                    Girato
                  </ViewTab>
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
          {/* Sul telefono questo gruppo e' quasi vuoto -- i lavori e il registro sono
              scesi in fondo -- e prendersi una riga intera per la sola spesa voleva
              dire sessanta pixel di niente sopra il contenuto. Li' sta in linea col
              titolo; la riga sua se la prende da `md` in su, dove ha roba dentro. */}
          <div className="fila-scorre-sempre flex items-center gap-2 flex-nowrap min-w-0 ml-auto">
            {/* The bar's hierarchy: the alarms first because they change what
                you can do, then the window's switches, then the jobs, and last
                the only filled action — which exists only where it makes sense.
                "Export favourites" on a video project meant nothing, and
                despite that it was the most conspicuous thing on screen. */}
            {/* Chrome NON installato: non c'e' niente da avviare, e il bottone
                rosso da 221 px prometteva il contrario. Qui si dice solo com'e'
                — con il backend che sta davvero lavorando — in un badge che
                costa un quarto dello spazio. */}
            {health && !health.browser && health.chrome_installed === false && (
              <Badge tone="neutral" title={health.hint ?? ""}>
                backend {health.backend ?? "?"}
              </Badge>
            )}
            {health && !health.browser && health.chrome_installed !== false && (
              <Bott weight="danger" size="m" disabled={launching}
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
                <TriangleAlert  aria-hidden />
                {launching ? "avvio Chrome…" : "Chrome non collegato — avvialo"}
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
              <Bott weight="quiet" size="m" active={railOpen} onClick={() => setRailOpen(!railOpen)}
                    title={railOpen ? "Nascondi il pannello colore" : "Mostra il pannello colore"}
                    className="hidden lg:inline-flex">
                <SlidersHorizontal  aria-hidden />
              </Bott>
            )}

            {/* Il registro non è un terzo piano della navigazione: non è né una
                cosa che Darkroom sa fare né una cosa su cui la stai facendo. È
                il diario di quello che è già successo, e sta con gli altri
                indicatori — i lavori, la spesa, la salute del browser. */}
            {/* Nascosto dal contenitore e non dalla classe sul bottone: `hidden` e
                `inline-flex` sono tutte e due utilita' di display, e nella stessa
                classe vince quella che il foglio scrive dopo -- che non e'
                `hidden`. Sul telefono questi due stanno nella barra in fondo.

                `md:flex`, NON `md:contents`: un wrapper `display: contents` non
                genera box, quindi lo `flex-shrink: 0` che `.fila-scorre-sempre > *`
                gli mette addosso non arriva a nessuno, e il bottone dentro resta
                a shrink 1. Misurato il 20/09 a 1037 px: il bottone «Lavori» era
                schiacciato a 18 px e il suo testo finiva SOPRA il badge della
                spesa (28 px di sovrapposizione). Con un box vero lo shrink lo
                riceve il wrapper e il bottone sta intero. */}
            <span className="hidden md:flex shrink-0">
            <Bott size="m" weight="quiet" active={location.pathname === "/activity"}
                  onClick={() => navigate("/activity")}
                  title="Il registro delle chiamate MCP: cosa è stato fatto, quando, e com'è andata">
              <Logs  aria-hidden />
              <span className="hidden xl:inline">Registro</span>
            </Bott>
            </span>

            <span className="hidden md:flex shrink-0">
            <Bott size="m" onClick={() => setShowJobs((v) => !v)}
                  title="Le generazioni in corso, quelle fatte e quelle fallite">
              <ListOrdered  aria-hidden />
              Lavori
              <span className={activeJobs > 0 ? "text-sky-300" : "text-neutral-400"}>
                {activeJobs > 0 ? `${activeJobs} in corso` : "fermi"}
              </span>
            </Bott>
            </span>

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
                <FolderOutput  aria-hidden />
                <span className="hidden sm:inline">Esporta preferite</span>
                <span className="sm:hidden">Esporta</span>
              </Bott>
            )}
          </div>
        </div>
      </header>

      <Trascina />

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
      {/* Lo spazio in fondo e' quello della barra piu' quello che il telefono si
          tiene sotto (la tacca inferiore): senza, l'ultima riga finisce coperta e
          non c'e' modo di scorrerla piu' in su. */}
      <main
        className={`flex-1 w-full max-w-none px-4 pb-4 ${flush ? "pt-0" : "pt-4"}`}
        style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
      >
        <Outlet context={{ jobs, activeJobs, flush, setFlush, railOpen, setRailOpen }} />
      </main>

      <BarraSotto
        progetti={projects.length}
        inCorso={activeJobs}
        lavoriAperti={showJobs}
        apriLavori={() => setShowJobs((v) => !v)}
      />

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
    <div className="relative min-w-0 max-w-[12rem]" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Progetto attivo"
        className="flex items-center gap-1 max-w-full px-2 py-1 rounded text-sm text-white hover:bg-neutral-900 transition-colors"
      >
        <span className="truncate">{label}</span>
        <span className="text-neutral-400 text-xs">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 sm:left-auto sm:right-0 mt-1 z-40 min-w-[12rem] max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
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
/**
 * La navigazione, in fondo, sul telefono.
 *
 * I due piani -- cio' che Darkroom sa fare e cio' su cui lo stai facendo -- in
 * cima rubavano la prima riga al titolo e stavano nel punto piu' lontano dal
 * pollice. Qui sotto sono raggiungibili senza cambiare presa, e la riga in cima
 * torna a dire solo dove sei.
 *
 * Tre voci e non di piu': con quattro ognuna scende sotto i 90 px e si preme
 * quella accanto. Il registro e la spesa restano in cima, dove si leggono e non
 * si premono.
 */
function BarraSotto({
  progetti, inCorso, lavoriAperti, apriLavori,
}: {
  progetti: number;
  inCorso: number;
  lavoriAperti: boolean;
  apriLavori: () => void;
}) {
  const location = useLocation();
  const suStrumenti = location.pathname === "/" || location.pathname === "/tools";
  const suProgetti = location.pathname.startsWith("/studio") || location.pathname.startsWith("/p/");

  return (
    <nav
      // `env(safe-area-inset-bottom)` e' la fascia che il telefono si tiene per la
      // barra di sistema: senza, l'ultima voce ci finisce sotto e si preme lei.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800
                 bg-neutral-950/95 backdrop-blur"
      aria-label="Navigazione principale"
    >
      <div className="flex items-stretch">
        <VoceSotto to="/" icon={ScanSearch} attiva={suStrumenti}>Strumenti</VoceSotto>
        <VoceSotto to="/studio" icon={LayoutGrid} attiva={suProgetti} conta={progetti}>Progetti</VoceSotto>
        <VoceSotto onClick={apriLavori} icon={ListOrdered} attiva={lavoriAperti}
                   conta={inCorso > 0 ? inCorso : undefined} acceso={inCorso > 0}>
          Lavori
        </VoceSotto>
      </div>
    </nav>
  );
}

function VoceSotto({
  to, onClick, icon: I, attiva, conta, acceso, children,
}: {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  attiva: boolean;
  conta?: number;
  acceso?: boolean;
  children: ReactNode;
}) {
  // 56 px di altezza: sopra la soglia dei 44 con margine, e senza margine non si
  // prende col pollice in movimento.
  const classe =
    "flex-1 min-h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] " +
    "transition-colors " +
    (attiva ? "text-neutral-100" : "text-neutral-400 active:text-neutral-100");
  const dentro = (
    <>
      <span className="relative">
        <I className="w-5 h-5" aria-hidden />
        {conta !== undefined && conta > 0 && (
          <span className={"absolute -top-1 -right-2 rounded-full px-1 text-[9px] leading-[14px] tabular-nums " +
                           (acceso ? "bg-sky-500 text-neutral-950" : "bg-neutral-800 text-neutral-300")}>
            {conta}
          </span>
        )}
      </span>
      {children}
      {/* La linguetta attiva si vede da una barretta, non solo dal colore: il
          colore da solo non basta a chi non lo distingue. */}
      <span className={"h-0.5 w-6 rounded-full " + (attiva ? "bg-neutral-100" : "bg-transparent")} aria-hidden />
    </>
  );
  return to ? (
    <Link to={to} className={classe} aria-current={attiva ? "page" : undefined}>{dentro}</Link>
  ) : (
    <button type="button" onClick={onClick} className={classe} aria-pressed={attiva}>{dentro}</button>
  );
}

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
        // `min-h-11` sul telefono (44 px, la misura del polpastrello) e compatto
        // sopra i 640: col mouse la densità della barra vale più dello spazio, col
        // dito no. Misurato: queste schede erano 27 px di altezza.
        "inline-flex items-center gap-1.5 px-2.5 py-1 min-h-11 sm:min-h-0 rounded text-[13px] transition-colors " +
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
