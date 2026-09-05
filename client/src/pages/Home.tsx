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
 * The home: what Darkroom can do.
 *
 * Two floors, and this page is only the first: **Tools** («what I can do»)
 * here, **Projects** («what I do it to») in `/studio`. The division is made by
 * the two tabs in the header, which are always there — so two more identical
 * ones are not put back underneath here: two identical navigations on top of
 * each other read as two different things, and they are not.
 *
 * The two halves used to be crushed together: twenty-one identical tabs and,
 * in the middle, four project boxes. The result was that neither of the two
 * could be read, and the video edit — which exists and is complete — was the
 * sixteenth tab of a wall, i.e. invisible.
 *
 * Three rules this page keeps:
 *
 * 1. **The project is chosen once.** Every card used to have its own «in which
 *    project» menu: twenty-one drop-downs asking the same thing twenty-one
 *    times, and widening the cards at random. Now the choice sits at the top,
 *    just one, and every card talks about that project.
 * 2. **The tools sit in their crafts.** The areas are titles, not just filters:
 *    you can see there is an Edit department without looking for it.
 * 3. **The cards all end at the same height.** The controls are anchored at the
 *    bottom, so a row of cards is a row and not a staircase.
 *
 * The list is not written here: it comes from the server's catalogue, the same
 * one that answers the MCP. A new capability appears here the day it exists.
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
   * The project every card works on. It lives in the URL, so a home sent to
   * somebody opens the same work and not «the last one you had».
   */
  const [pickedPid, setPid] = useViewState<string>("project", "", {
    read: (s) => s.trim() || null,
    memory: "darkroom.home.project",
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
      // The MCP names are searched too: whoever arrives from the chat knows
      // those, not the names we gave the crafts.
      return (
        s.name.toLowerCase().includes(q) ||
        s.what.toLowerCase().includes(q) ||
        s.id.includes(q) ||
        s.mcp.some((m) => m.includes(q))
      );
    });
  }, [cat, search, area, onlyReady]);

  /** The tools grouped into their crafts, in the catalogue's order. */
  const reparti = useMemo(() => {
    return (cat?.areas ?? [])
      .map((a) => ({ area: a, tools: visibili.filter((s) => s.area === a.id) }))
      .filter((r) => r.tools.length > 0);
  }, [cat, visibili]);

  const off = (cat?.tools ?? []).filter((s) => !s.ready).length;

  return (
    <>
      {/* The bar: search, crafts, and — once only — which project.
          The numbers are not decoration: a filter without a count does not say
          whether it is worth opening. */}
      <div className="sticky top-[var(--h-header,57px)] z-20 -mx-4 px-4 py-2 bg-neutral-950/90 backdrop-blur
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
 * A tool and its ways in.
 *
 * The card is as tall as its sisters: header at the top, controls anchored at
 * the bottom (`mt-auto`). Every card used to end where its text ended and a row
 * of cards was a staircase.
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

      {/* Not ready is not «broken»: it is something missing, with the gesture
          that fixes it. A grey tool with no explanation is a closed door. */}
      {!s.ready && (
        <div className="mt-2 rounded border border-amber-900/60 bg-amber-950/20 px-2 py-1.5 space-y-0.5">
          {s.missing.map((m) => (
            <div key={m.requirement} className="text-[11px] text-amber-200/90 leading-snug">
              {m.how}
            </div>
          ))}
        </div>
      )}

      {/* The foot: controls and references, always in the same place on every
          card. The MCP names used to be an «mcp ×3» pill whose contents could
          only be read by holding the mouse still over it: a reference that
          cannot be read is not a reference. */}
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

        {/* The MCP names, for whoever drives Darkroom from the chat. They were a
            single line cut in half by `truncate`: «check_photo ·
            verification_summ…» is not a reference, it is a riddle. They wrap,
            one per pill, and they can all be read. */}
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
 * «Open»: on the project chosen at the top, without asking again.
 *
 * If that project does not have the view needed, the button does NOT go dead:
 * it looks for the first project that has it and says so in the label. It is
 * why the video edit looked like it did not exist — whoever opened the home
 * with a photo gallery selected found four grey buttons and no clue that
 * «Lungomare» was there, ready, one click away.
 *
 * It goes dead only when there really is no project with that view, and then it
 * says so with the gesture that fixes it.
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
  const target = onPicked ? project : fallback;

  return (
    <Bott
      size="m"
      disabled={!target}
      title={
        target
          ? onPicked
            ? `Apre «${target.name}»`
            : `«${project?.name ?? "il progetto scelto"}» non ha la vista «${start.view}»: questo apre «${target.name}», che ce l'ha.`
          : `Nessun progetto ha la vista «${start.view}»: creane uno dallo strumento che lo fa, o accendile la vista dallo Studio.`
      }
      onClick={() => target && onVai(start.route.replace(":pid", encodeURIComponent(target.id)))}
    >
      {start.label}
      {target && !onPicked && (
        <span className="ml-1 text-neutral-400">in {target.name}</span>
      )}
    </Bott>
  );
}

/**
 * The start form, built from the fields the catalogue declares.
 *
 * A hand-written form per tool would have been twenty-one forms to keep aligned
 * with twenty-one handlers: the first field added on the server side would have
 * stayed invisible here, and nobody would have noticed.
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
        // A start that CREATES the project does not receive one: sending it
        // would be an instruction nobody is looking at.
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

      {/* Which project is no longer asked: it is the one chosen at the top.
          Stated, not left unsaid — otherwise «Generate now» is a button that
          does not say where the stuff ends up. */}
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
          onSubmit={() => { if (!missing) void vai(); }}
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
  field, value, onChange, onSubmit,
}: {
  field: StartField;
  value: string | number;
  onChange: (v: string | number) => void;
  onSubmit: () => void;
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
          onSubmit={onSubmit}
          className="text-[12px] h-20"
        />
      ) : field.kind === "number" ? (
        <NumberField value={Number(value) || 1} onChange={onChange} min={1} max={50} />
      ) : (
        <Field
          value={String(value)}
          onChange={onChange}
          placeholder={field.placeholder}
          onEnter={onSubmit}
          size="m"
          className={"w-full " + (field.kind === "folder" ? "font-mono" : "")}
        />
      )}
      {field.note && <span className="block text-[10.5px] text-neutral-500">{field.note}</span>}
    </label>
  );
}
