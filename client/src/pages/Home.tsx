import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  lastProject,
  type ToolArea,
  type Start,
  type StartField,
  type Catalogue,
  type Tool,
  type StudioProject,
} from "../api";
import { Area, Bott, Field, Search, Filter, NumberField, Choose, Badge, Header } from "../ui";
import { useViewState } from "../viewState";
import { ICONS } from "../iconNames";
import { Wrench } from "lucide-react";

/**
 * La home: cosa sa fare Darkroom.
 *
 * Due piani, e questa pagina è solo il primo: **Strumenti** («cosa so fare»)
 * qui, **Progetti** («su cosa lo faccio») in `/studio`. La divisione la fanno
 * le due schede nella testata in alto, che ci sono sempre — quindi qui non se
 * ne rimettono altre due uguali sotto: due navigazioni identiche una sull'altra
 * si leggono come due cose diverse e non lo sono.
 *
 * Prima le due metà erano schiacciate insieme: ventun schede tutte uguali e,
 * in mezzo, quattro riquadri di progetti. Il risultato era che nessuna delle
 * due si leggeva, e il montaggio video — che esiste ed è completo — era la
 * sedicesima scheda di un muro, cioè invisibile.
 *
 * Tre regole che questa pagina si tiene:
 *
 * 1. **Il progetto si sceglie una volta.** Prima ogni scheda aveva il suo menu
 *    «in quale progetto»: ventun tendine che chiedevano ventun volte la stessa
 *    cosa, e che allargavano le schede a caso. Ora la scelta sta in cima, una
 *    sola, e tutte le schede parlano di quel progetto.
 * 2. **Gli strumenti stanno nei loro mestieri.** Le aree sono titoli, non solo
 *    filtri: si vede che esiste un reparto Montaggio anche senza cercarlo.
 * 3. **Le schede finiscono tutte alla stessa altezza.** I comandi sono
 *    ancorati in fondo, così una riga di schede è una riga e non una scalinata.
 *
 * L'elenco non è scritto qui: arriva dal catalogo del server, lo stesso che
 * risponde all'MCP. Una capacità nuova compare qui il giorno in cui esiste.
 */

export default function Home() {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.tools().then(setCat).catch((e) => setErr(String(e?.message ?? e)));
    api.studioProjects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);

  return (
    <div className="space-y-4 pb-10">
      <Header
        title="Strumenti"
        below="Tutto quello che Darkroom sa fare, diviso per mestiere. Lo stesso elenco che vede Claude via MCP."
      />

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          Il catalogo non risponde: {err}
        </div>
      )}

      <Tools cat={cat} projects={projects} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Tools({ cat, projects }: { cat: Catalogue | null; projects: StudioProject[] }) {
  const [search, setSearch] = useState("");
  const [area, setArea] = useState<ToolArea | "all">("all");
  const [onlyReady, setOnlyReady] = useState(false);
  const navigate = useNavigate();

  /**
   * Il progetto su cui lavorano tutte le schede. Vive nell'URL, così una home
   * mandata a qualcuno apre lo stesso lavoro e non «l'ultimo che avevi tu».
   */
  const [pickedPid, setPid] = useViewState<string>("progetto", "", {
    read: (s) => s.trim() || null,
    memory: "darkroom.home.progetto",
  });
  const pid = useMemo(() => {
    if (pickedPid && projects.some((p) => p.id === pickedPid)) return pickedPid;
    const last = lastProject();
    if (last && projects.some((p) => p.id === last)) return last;
    return projects[0]?.id ?? "";
  }, [pickedPid, projects]);
  const active = projects.find((p) => p.id === pid) ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = { tutte: cat?.tools.length ?? 0 };
    for (const s of cat?.tools ?? []) c[s.area] = (c[s.area] ?? 0) + 1;
    return c;
  }, [cat]);

  const visibili = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (cat?.tools ?? []).filter((s) => {
      if (area !== "all" && s.area !== area) return false;
      if (onlyReady && !s.ready) return false;
      if (!q) return true;
      // Si cerca anche fra i nomi MCP: chi arriva dalla chat conosce quelli,
      // non i nomi che abbiamo dato ai mestieri.
      return (
        s.name.toLowerCase().includes(q) ||
        s.what.toLowerCase().includes(q) ||
        s.id.includes(q) ||
        s.mcp.some((m) => m.includes(q))
      );
    });
  }, [cat, search, area, onlyReady]);

  /** Gli strumenti raggruppati nei loro mestieri, nell'ordine del catalogo. */
  const reparti = useMemo(() => {
    return (cat?.areas ?? [])
      .map((a) => ({ area: a, tools: visibili.filter((s) => s.area === a.id) }))
      .filter((r) => r.tools.length > 0);
  }, [cat, visibili]);

  const off = (cat?.tools ?? []).filter((s) => !s.ready).length;

  return (
    <>
      {/* La barra: cerca, mestieri, e — una volta sola — su quale progetto.
          I numeri non sono decorazione: un filtro senza conteggio non dice se
          vale la pena aprirlo. */}
      <div className="sticky top-[var(--h-testata,57px)] z-20 -mx-4 px-4 py-2 bg-neutral-950/90 backdrop-blur
                      border-y border-neutral-800 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Search value={search} onChange={setSearch} placeholder="cerca uno strumento…" />
          <div className="flex items-center gap-1 flex-wrap">
            <Filter active={area === "all"} onClick={() => setArea("all")} n={counts.tutte ?? 0}>
              tutti
            </Filter>
            {cat?.areas.map((a) => (
              <Filter
                key={a.id}
                active={area === a.id}
                onClick={() => setArea(a.id)}
                n={counts[a.id] ?? 0}
                title={a.what}
              >
                {a.name}
              </Filter>
            ))}
          </div>
          <Bott
            size="m"
            weight="quieto"
            active={onlyReady}
            onClick={() => setOnlyReady((v) => !v)}
            title={
              off
                ? `${off} strumenti non sono usabili adesso: manca qualcosa sulla macchina.`
                : "Tutti gli strumenti sono usabili adesso."
            }
          >
            solo pronti
            {off > 0 && <span className="ml-1 text-amber-400 tabular-nums">{(cat?.tools.length ?? 0) - off}</span>}
          </Bott>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-neutral-400">Lavoro su</span>
          {projects.length > 0 ? (
            <Choose
              value={pid}
              items={projects.map((p) => ({
                v: p.id,
                text: p.name,
                note: p.views.join(" · "),
              }))}
              onChange={setPid}
              width={210}
              size="m"
              title="Il progetto su cui agiscono tutti gli strumenti qui sotto"
            />
          ) : (
            <span className="text-[11px] text-neutral-500">
              nessun progetto: comincia da uno strumento che ne crea uno.
            </span>
          )}
          {active && (
            <span className="text-[11px] text-neutral-500 truncate">
              {active.video
                ? `${active.video.cuts} tagli`
                : active.stats
                  ? `${active.stats.photos} foto · ${active.stats.favorites} preferite`
                  : ""}
            </span>
          )}
          {cat && (
            <div className="ml-auto flex items-center gap-1.5">
              {Object.entries(cat.requirements).map(([name, r]) => (
                <Badge key={name} tone={r.ok ? "good" : "waiting"} title={r.how}>
                  {r.ok ? "●" : "○"} {name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {!cat && <div className="text-[12px] text-neutral-400">Carico il catalogo…</div>}

      {cat && visibili.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          Niente con questi filtri.{" "}
          <button
            className="underline hover:text-neutral-100"
            onClick={() => { setSearch(""); setArea("all"); setOnlyReady(false); }}
          >
            Rimettili a posto
          </button>
          .
        </div>
      )}

      <div className="space-y-6">
        {reparti.map(({ area: a, tools }) => (
          <section key={a.id} className="space-y-2">
            <div className="flex items-baseline gap-2 border-b border-neutral-800 pb-1.5">
              <h2 className="text-[12px] uppercase tracking-wide text-neutral-300">{a.name}</h2>
              <span className="text-[11px] text-neutral-500 tabular-nums">{tools.length}</span>
              <span className="text-[11px] text-neutral-500 truncate">{a.what}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {tools.map((s) => (
                <ToolCard
                  key={s.id}
                  s={s}
                  project={active}
                  projects={projects}
                  onDone={(route) => navigate(route)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Uno strumento e le sue vie d'ingresso.
 *
 * La scheda è alta quanto le sue sorelle: intestazione in cima, comandi
 * ancorati in fondo (`mt-auto`). Prima ogni scheda finiva dove finiva il suo
 * testo e una riga di schede era una scalinata.
 */
function ToolCard({
  s, project, projects, onDone,
}: {
  s: Tool;
  project: StudioProject | null;
  projects: StudioProject[];
  onDone: (route: string) => void;
}) {
  const [open, setOpen] = useState<Start | null>(null);
  const I = ICONS[s.icon] ?? Wrench;

  return (
    <div
      className={
        "flex h-full flex-col rounded-lg border bg-neutral-950/60 p-3 transition-colors " +
        (s.ready ? "border-neutral-800 hover:border-neutral-600" : "border-neutral-800/60")
      }
    >
      <div className="flex items-start gap-2.5">
        <I
          className={"w-4 h-4 mt-[2px] shrink-0 " + (s.ready ? "text-neutral-300" : "text-neutral-500")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className={"text-[13.5px] font-medium leading-tight " + (s.ready ? "" : "text-neutral-400")}>
            {s.name}
          </div>
          <p className="mt-1 text-[12px] text-neutral-400 leading-snug">{s.what}</p>
        </div>
      </div>

      {/* Non pronto non è «rotto»: è una cosa che manca, con il gesto che la
          sistema. Uno strumento grigio senza spiegazione è una porta chiusa. */}
      {!s.ready && (
        <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 space-y-0.5">
          {s.missing.map((m) => (
            <div key={m.requirement} className="text-[11px] text-amber-200/90 leading-snug">
              {m.how}
            </div>
          ))}
        </div>
      )}

      {/* Il piede: comandi e riferimenti, sempre nello stesso posto su ogni
          scheda. I nomi MCP erano una pastiglia «mcp ×3» il cui contenuto si
          leggeva solo col mouse fermo sopra: un riferimento che non si legge
          non è un riferimento. */}
      <div className="mt-auto pt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {s.starters.map((a, i) =>
            a.mode === "open" ? (
              <Open key={i} start={a} tool={s} project={project} projects={projects} onVai={onDone} />
            ) : (
              <Bott
                key={i}
                size="m"
                weight={i === 0 ? "primario" : "normale"}
                disabled={!s.ready}
                title={s.ready ? a.note : s.missing[0]?.how}
                onClick={() => setOpen(open === a ? null : a)}
              >
                {a.label}
              </Bott>
            ),
          )}
          {s.starters.length === 0 && (
            <span className="text-[11px] text-neutral-500">Si guarda dal pannello Lavori, in alto.</span>
          )}
        </div>

        {/* I nomi MCP, per chi guida Darkroom dalla chat. Erano una riga sola
            tagliata a metà da `truncate`: «check_photo · verification_summ…»
            non è un riferimento, è un indovinello. Vanno a capo, uno per
            pastiglia, e si leggono tutti. */}
        {s.mcp.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" title="I nomi con cui Claude chiama questo strumento via MCP">
            <span className="text-[10.5px] text-neutral-600 shrink-0">da Claude</span>
            {s.mcp.map((m) => (
              <code
                key={m}
                className="rounded-sm border border-neutral-800 bg-neutral-900/60 px-1 py-[1px]
                           font-mono text-[10px] leading-[14px] text-neutral-400"
              >
                {m}
              </code>
            ))}
          </div>
        )}
      </div>

      {open && open.mode !== "open" && (
        <Form
          tool={s}
          start={open}
          project={project}
          onCancel={() => setOpen(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

/**
 * «Apri»: sul progetto scelto in cima, senza chiedere di nuovo.
 *
 * Se quel progetto non ha la vista che serve, il tasto NON si spegne: cerca il
 * primo progetto che ce l'ha e lo dice nell'etichetta. È il motivo per cui il
 * montaggio video sembrava non esistere — chi apriva la home con una galleria
 * di foto selezionata trovava quattro tasti grigi e nessun indizio che
 * «Lungomare» fosse lì, pronto, a un clic.
 *
 * Si spegne solo quando davvero non c'è nessun progetto con quella vista, e
 * allora lo dice con il gesto che lo sistema.
 */
function Open({
  start, tool, project, projects, onVai,
}: {
  start: Extract<Start, { mode: "open" }>;
  tool: Tool;
  project: StudioProject | null;
  projects: StudioProject[];
  onVai: (route: string) => void;
}) {
  const fits = (p: StudioProject) => tool.views.length === 0 || p.views.includes(start.view);
  const onPicked = !!project && fits(project);
  const fallback = onPicked ? null : projects.find(fits) ?? null;
  const bersaglio = onPicked ? project : fallback;

  return (
    <Bott
      size="m"
      disabled={!bersaglio}
      title={
        bersaglio
          ? onPicked
            ? `Apre «${bersaglio.name}»`
            : `«${project?.name ?? "il progetto scelto"}» non ha la vista «${start.view}»: questo apre «${bersaglio.name}», che ce l'ha.`
          : `Nessun progetto ha la vista «${start.view}»: creane uno dallo strumento che lo fa, o accendile la vista dallo Studio.`
      }
      onClick={() => bersaglio && onVai(start.route.replace(":pid", encodeURIComponent(bersaglio.id)))}
    >
      {start.label}
      {bersaglio && !onPicked && (
        <span className="ml-1 text-neutral-400">in {bersaglio.name}</span>
      )}
    </Bott>
  );
}

/**
 * Il modulo d'avvio, costruito dai campi che il catalogo dichiara.
 *
 * Un modulo scritto a mano per strumento sarebbe stato ventun moduli da
 * tenere allineati a ventuno handler: il primo campo aggiunto lato server
 * sarebbe rimasto invisibile qui, e nessuno se ne sarebbe accorto.
 */
function Form({
  tool, start, project, onCancel, onDone,
}: {
  tool: Tool;
  start: Extract<Start, { mode: "new" | "now" }>;
  project: StudioProject | null;
  onCancel: () => void;
  onDone: (route: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(start.fields.map((c) => [c.name, c.fallback ?? ""])),
  );
  const [inCorso, setInCorso] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; route: string } | null>(null);

  const missing = start.fields.find((c) => c.required && !String(values[c.name] ?? "").trim());

  async function vai() {
    setInCorso(true);
    setErr(null);
    try {
      const r = await api.startTool(tool.id, {
        // Un avvio che CREA il progetto non ne riceve uno: mandarglielo
        // sarebbe un'istruzione che non guarda nessuno.
        project: start.mode === "now" ? project?.id : undefined,
        values,
      });
      setDone({ text: r.done, route: r.route });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  }

  if (done) {
    return (
      <div className="mt-2 rounded border border-emerald-900/70 bg-emerald-950/20 p-2.5 space-y-2">
        <div className="text-[12px] text-emerald-200 leading-snug">{done.text}</div>
        <div className="flex items-center gap-1.5">
          <Bott size="m" weight="primario" onClick={() => onDone(done.route)}>
            Vai a vedere
          </Bott>
          <Bott size="m" weight="quieto" onClick={onCancel}>Resta qui</Bott>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded border border-neutral-800 bg-neutral-900/40 p-2.5 space-y-2">
      {start.note && <p className="text-[11px] text-neutral-400 leading-snug">{start.note}</p>}

      {/* Su quale progetto non si chiede più: è quello scelto in cima. Detto,
          non taciuto — altrimenti «Genera adesso» è un tasto che non dice dove
          finisce la roba. */}
      {start.mode === "now" && (
        <p className="text-[11px] text-neutral-500">
          {project ? <>Va in coda su <span className="text-neutral-300">{project.name}</span>.</> : "Nessun progetto scelto: ne apro uno nuovo."}
        </p>
      )}

      {start.fields.map((c) => (
        <StartField
          key={c.name}
          field={c}
          value={values[c.name] ?? ""}
          onChange={(v) => setValues((x) => ({ ...x, [c.name]: v }))}
          onInvia={() => { if (!missing) void vai(); }}
        />
      ))}

      {err && <div className="text-[11px] text-amber-300 leading-snug">{err}</div>}

      <div className="flex items-center gap-1.5">
        <Bott
          size="m"
          weight="primario"
          disabled={inCorso || !!missing}
          title={missing ? `Manca: ${missing.label}` : undefined}
          onClick={vai}
        >
          {inCorso ? "Vado…" : start.label}
        </Bott>
        <Bott size="m" weight="quieto" onClick={onCancel}>Annulla</Bott>
      </div>
    </div>
  );
}

function StartField({
  field, value, onChange, onInvia,
}: {
  field: StartField;
  value: string | number;
  onChange: (v: string | number) => void;
  onInvia: () => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-neutral-400">
        {field.label}
        {field.required && <span className="text-neutral-600"> *</span>}
      </span>
      {field.kind === "long" ? (
        <Area
          value={String(value)}
          onChange={onChange}
          placeholder={field.placeholder}
          onInvia={onInvia}
          className="text-[12px] h-20"
        />
      ) : field.kind === "number" ? (
        <NumberField value={Number(value) || 1} onChange={onChange} min={1} max={50} />
      ) : (
        <Field
          value={String(value)}
          onChange={onChange}
          placeholder={field.placeholder}
          onInvio={onInvia}
          size="m"
          className={"w-full " + (field.kind === "folder" ? "font-mono" : "")}
        />
      )}
      {field.note && <span className="block text-[10.5px] text-neutral-500">{field.note}</span>}
    </label>
  );
}
