import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,

  type ProjectKind,
  type StudioOverview,
  type StudioProject,
} from "../api";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Altro, Bott, Field, Search, Confirm, Filter, Badge, Header, useCloseMenu } from "../ui";
import { VIEWS, view } from "../views";

/**
 * The project list: the workbench you enter from.
 *
 * Each card answers three questions in the order you ask them: what kind of
 * thing is it, how far along is it, do I go in. The actions follow the same
 * order of weight — «Open» is filled because it is why the page exists; the
 * generator is a switch because it is a state, not a command; removing a
 * project is quiet and asks for confirmation, because it is the only thing here
 * that does not undo itself.
 */
/** How the list is viewed: by what a project can do, or by how it is. */
type State = "tutti" | "in_corso" | "falliti" | "pausa" | "rotti";
type SortOrder = "recenti" | "nome" | "grandi";

export default function StudioPage() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ProjectKind | "all">("all");
  const [state, setState] = useState<State>("tutti");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recenti");
  const navigate = useNavigate();

  async function refresh() {
    try { setData(await api.studioProjects()); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const pausa = data?.worker.runner;
  const tutti = data?.projects ?? [];

  /** How many projects would fall into each filter. A filter with no number
   *  does not say whether it is worth opening, and at zero it switches itself
   *  off. */
  const count = useMemo(() => {
    const q = (f: (p: StudioProject) => boolean) => tutti.filter(f).length;
    return {
      tutte: tutti.length,
      photo: q((p) => p.views.includes("photo")),
      storyboard: q((p) => p.views.includes("storyboard")),
      video: q((p) => p.views.includes("video")),
      tutti: tutti.length,
      in_corso: q((p) => ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) > 0),
      falliti: q((p) => (p.stats?.queue?.failed ?? 0) > 0),
      pausa: q((p) => !p.active),
      rotti: q((p) => !p.root_exists || !!p.error),
    };
  }, [tutti]);

  const visibili = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inside = tutti.filter((p) => {
      if (view !== "all" && !p.views.includes(view)) return false;
      if (state === "in_corso" && ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) === 0) return false;
      if (state === "falliti" && (p.stats?.queue?.failed ?? 0) === 0) return false;
      if (state === "pausa" && p.active) return false;
      if (state === "rotti" && p.root_exists && !p.error) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q) || p.id.includes(q);
    });
    const weight = (p: StudioProject) => p.stats?.photos ?? p.video?.cuts ?? 0;
    return inside.sort((a, b) =>
      sortOrder === "nome"
        ? a.name.localeCompare(b.name)
        : sortOrder === "grandi"
          ? weight(b) - weight(a)
          // "Recent" is the last version generated, not the creation date: the
          // project being worked on is the one that produced something last,
          // not the one opened last.
          : (b.stats?.last_version_at ?? b.created_at) - (a.stats?.last_version_at ?? a.created_at),
    );
  }, [tutti, search, view, state, sortOrder]);

  return (
    <div className="space-y-4">
      <Header title="Progetti"
               below="Tutti i progetti su questa macchina. Le viste accese dicono cosa sa fare ognuno: si accendono e si spengono da qui." />

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          {err}
        </div>
      )}

      {pausa?.paused && pausa.paused_until && (
        <div className="rounded border border-amber-900 bg-amber-950/30 text-amber-200 text-[12px] px-2.5 py-1.5">
          La coda è ferma fino alle{" "}
          {new Date(pausa.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          : fino a quell'ora nessun progetto genera niente.
        </div>
      )}

      {/* The filter bar: first WHAT a project can do, then HOW it is. Two
          different questions, so two groups, not one single list in which
          «video» and «paused» exclude each other for no reason. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-neutral-800 py-2">
        <Search value={search} onChange={setSearch} placeholder="cerca un progetto…" />
        <div className="flex items-center gap-1">
          <Filter active={view === "all"} onClick={() => setView("all")} n={count.tutte}>tutti</Filter>
          {VIEWS.map((v) => (
            <Filter key={v.id} active={view === v.id} onClick={() => setView(v.id)}
                    n={count[v.id]} title={v.explains}>
              {v.name}
            </Filter>
          ))}
        </div>
        <span className="w-px h-4 bg-neutral-800" aria-hidden />
        <div className="flex items-center gap-1">
          <Filter active={state === "in_corso"} onClick={() => setState(state === "in_corso" ? "tutti" : "in_corso")}
                  n={count.in_corso} title="Hanno lavori in coda o in corso">in corso</Filter>
          <Filter active={state === "falliti"} onClick={() => setState(state === "falliti" ? "tutti" : "falliti")}
                  n={count.falliti} title="Hanno generazioni fallite da guardare">falliti</Filter>
          <Filter active={state === "pausa"} onClick={() => setState(state === "pausa" ? "tutti" : "pausa")}
                  n={count.pausa} title="Il generatore li salta">in pausa</Filter>
          <Filter active={state === "rotti"} onClick={() => setState(state === "rotti" ? "tutti" : "rotti")}
                  n={count.rotti} title="Cartella sparita o database che non si apre">da sistemare</Filter>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-neutral-400">
          ordina
          {([["recenti", "recenti"], ["nome", "nome"], ["grandi", "più grandi"]] as const).map(([id, text]) => (
            <button key={id} type="button" onClick={() => setSortOrder(id)} aria-pressed={sortOrder === id}
                    className={"px-1.5 py-0.5 rounded-sm border transition-colors " +
                      (sortOrder === id ? "border-neutral-300 text-neutral-100" : "border-transparent hover:text-neutral-200")}>
              {text}
            </button>
          ))}
        </div>
      </div>

      {data && visibili.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          {tutti.length === 0
            ? "Nessun progetto ancora: cominciane uno qui sotto, o dagli strumenti."
            : "Niente con questi filtri. "}
          {tutti.length > 0 && (
            <button className="underline hover:text-neutral-100"
                    onClick={() => { setSearch(""); setView("all"); setState("tutti"); }}>
              Rimettili a posto
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
        {visibili.map((p) => (
          <Card
            key={p.id}
            p={p}
            onOpen={() => navigate(`/p/${p.id}`)}
            onGenerate={async (v) => { await api.studioPatchProject(p.id, { active: v }); refresh(); }}
            onViews={async (v) => { await api.studioPatchProject(p.id, { views: v }); refresh(); }}
            onRemove={async () => { await api.studioRemoveProject(p.id); refresh(); }}
          />
        ))}
      </div>

      <NewProject onDone={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const shortDuration = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)}s`;

function Card({
  p, onOpen, onGenerate, onViews, onRemove,
}: {
  p: StudioProject;
  onOpen: () => void;
  onGenerate: (v: boolean) => void;
  onViews: (v: ProjectKind[]) => void;
  onRemove: () => void;
}) {
  const s = p.stats;
  const q = s?.queue ?? {};
  const principale = view(p.kind);
  const Icon = principale.icon;

  const numbers = p.video
    ? [["tagli", p.video.cuts], ["riprese", p.video.shots], ["durata", shortDuration(p.video.duration)]] as const
    : s
      ? [["foto", s.photos], ["preferite", s.favorites], ["versioni", s.versions]] as const
      : null;

  /** Switching a view on and off. The main one cannot be switched off: it
   *  would be a project that opens on a page that is not there. */
  const changeView = (id: ProjectKind) => {
    if (id === p.kind) return;
    const inside = new Set(p.views);
    if (inside.has(id)) inside.delete(id); else inside.add(id);
    onViews([...inside]);
  };

  return (
    // The whole card is the button to go in: the white rectangle on every box
    // shouted louder than the project's name, and the thing you want to click
    // is the project, not a button inside the project.
    <div className="group relative rounded-lg border border-neutral-800 bg-neutral-950/60 p-3
                    flex flex-col gap-2.5 transition-colors hover:border-neutral-600">
      <button type="button" onClick={onOpen} aria-label={`Apri ${p.name}`}
              className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-1
                         focus-visible:outline-offset-2 focus-visible:outline-neutral-300" />

      <div className="relative z-20 flex items-start gap-2 min-w-0 pointer-events-none">
        <Icon className="w-4 h-4 mt-[3px] shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[14px] font-medium truncate group-hover:text-white">{p.name}</span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate" title={p.root}>{p.root}</div>
        </div>
        {/* It appears on hover, and stays if you arrive with the tab key: hidden
            does not mean unreachable. */}
        <Altro discreto className="pointer-events-auto">
          <MenuItem onClick={onOpen}>Apri il progetto</MenuItem>
          <MenuItem onClick={() => navigator.clipboard?.writeText(p.root)}>Copia il percorso</MenuItem>
          <MenuItem onClick={() => onGenerate(!p.active)}
                    note="Il generatore è uno solo per tutti i progetti. Mettendo in pausa questo, i suoi lavori restano in coda e passano avanti gli altri.">
            {p.active ? "Metti in pausa" : "Rimetti in lavorazione"}
          </MenuItem>
          <div className="border-t border-neutral-800 my-1" />
          <Confirm size="s" className="w-full justify-start"
                    question={`Tolgo «${p.name}»? I file restano dove sono.`}
                    confirm="togli" onConfirm={onRemove}>
            Togli dall'elenco
          </Confirm>
        </Altro>
      </div>

      {!p.root_exists && (
        <div className="relative z-10 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/60
                        rounded px-2 py-1 pointer-events-none">
          La cartella non c'è più: {p.root}
        </div>
      )}
      {p.error && (
        <div className="relative z-10 text-[11px] text-rose-200 bg-rose-950/30 border border-rose-900/60
                        rounded px-2 py-1 truncate pointer-events-none" title={p.error}>
          {p.error}
        </div>
      )}

      {numbers && (
        <div className="relative z-10 grid grid-cols-3 gap-1.5 text-center pointer-events-none">
          {numbers.map(([label, v]) => (
            <div key={label} className="rounded bg-neutral-900/60 border border-neutral-800 py-1">
              <div className="text-[15px] font-semibold tabular-nums leading-tight">{v}</div>
              <div className="text-[10px] text-neutral-400">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* What this project can do. They are switched on and off from here: a job
          starts with photos and ends in an edit, and it must not become two
          projects on the same folder. */}
      <div className="relative z-10 flex flex-wrap items-center gap-1"
           title="Le viste di questo progetto: accendile e spegnile da qui.">
        {VIEWS.map((v) => {
          const accesa = p.views.includes(v.id);
          const fissa = v.id === p.kind;
          const I = v.icon;
          return (
            <button key={v.id} type="button" disabled={fissa}
                    onClick={(e) => { e.stopPropagation(); changeView(v.id); }}
                    title={fissa
                      ? `${v.explains} È la vista principale: si apre qui, quindi non si spegne.`
                      : accesa ? `${v.explains} Clicca per spegnerla.` : `${v.explains} Clicca per accenderla.`}
                    className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-[2px] text-[10.5px]
                                transition-colors ${
                      !accesa ? "border-dashed border-neutral-700 text-neutral-400 hover:border-solid hover:border-neutral-500 hover:text-neutral-200"
                      : fissa ? "border-neutral-500 bg-neutral-800 text-neutral-100 cursor-default"
                      : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500"}`}>
              <I className="w-3 h-3" aria-hidden />
              {v.name}
            </button>
          );
        })}
      </div>

      {/* Fixed height: this row is only on some cards, and without it the feet of
          the cards in the same row ended up three pixels apart. */}
      <div className="relative z-10 flex items-center gap-1.5 h-[20px] overflow-hidden text-[11px]
                      pointer-events-none">
        {(q.running ?? 0) > 0 && <Badge tone="info">{q.running} in corso</Badge>}
        {(q.pending ?? 0) > 0 && <Badge>{q.pending} in coda</Badge>}
        {(q.failed ?? 0) > 0 && (
          <Badge tone="bad" title="Generazioni non riuscite. Si guardano e si nascondono dal pannello Lavori.">
            {q.failed} falliti
          </Badge>
        )}
        {/* The normal state is not written out: you can see there is nothing
            strange. Paused is instead an exception — the jobs are there and
            nobody is touching them — and that has to be said. */}
        {!p.active && (
          <Badge tone="waiting" title="Il generatore salta questo progetto: i suoi lavori restano in coda finché non lo rimetti in lavorazione (menu ⋯).">
            in pausa
          </Badge>
        )}
        <span className="ml-auto text-neutral-400 shrink-0" title="ultima versione generata">
          {when(s?.last_version_at ?? null)}
        </span>
        <span className="text-neutral-400 group-hover:text-neutral-100 transition-colors
                         inline-flex items-center gap-1 shrink-0">
          apri <ArrowRight className="w-3 h-3" aria-hidden />
        </span>
      </div>

    </div>
  );
}

function MenuItem({ children, onClick, note }: {
  children: React.ReactNode; onClick: () => void; note?: string;
}) {
  const close = useCloseMenu();
  return (
    <button type="button" role="menuitem" title={note}
            onClick={(e) => { e.stopPropagation(); onClick(); close(); }}
            className="w-full text-left px-2 py-1 rounded-sm text-[11px] text-neutral-300
                       hover:bg-neutral-800 hover:text-neutral-100">
      {children}
      {note && <span className="block text-[10.5px] text-neutral-400 leading-snug mt-0.5">{note}</span>}
    </button>
  );
}

function NewProject({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>("photo");
  const [photos, setPhotos] = useState("");
  const [linkMode, setLinkMode] = useState<"link" | "copy">("link");
  const [root, setRoot] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const res = await api.studioAddProject({
        name: name.trim(),
        kind: kind,
        root: root.trim() || undefined,
        photos: photos.trim() ? { path: photos.trim(), mode: linkMode } : undefined,
      });
      if (res.summary && res.summary.added === 0 && res.summary.scanned === 0) {
        setErr("Progetto creato, ma in quella cartella non ho trovato foto.");
      }
      setName(""); setPhotos(""); setRoot(""); setAdvanced(false); setOpen(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!open) return <Bott size="m" onClick={() => setOpen(true)}>+ Nuovo progetto</Bott>;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 space-y-3 max-w-lg">
      <div className="text-[13px] font-medium">Nuovo progetto</div>

      <Row label="Come si chiama">
        <Field value={name} onChange={setName} placeholder="es. Kyoto 2026" autoFocus
               size="m" className="w-full" onEnter={() => { if (name.trim()) void create(); }} />
      </Row>

      <Row label="Che cosa ci fai">
        <div className="grid grid-cols-3 gap-1.5">
          {VIEWS.map((v) => (
            <BigPick key={v.id} picked={kind === v.id} onClick={() => setKind(v.id)}
                      icon={v.icon} title={v.name} note={v.explains} />
          ))}
        </div>
      </Row>

      {kind === "photo" && (
        <Row label="Le foto — puoi aggiungerle anche dopo">
          <Field value={photos} onChange={setPhotos} placeholder="/Users/…/Foto/Kyoto"
                 size="m" className="w-full font-mono" />
          {photos.trim() && (
            <div className="grid grid-cols-2 gap-1.5 pt-1.5">
              <BigPick picked={linkMode === "link"} onClick={() => setLinkMode("link")}
                        title="Lasciale dove sono" note="Le indicizzo sul posto: non copio niente." />
              <BigPick picked={linkMode === "copy"} onClick={() => setLinkMode("copy")}
                        title="Copiale nel progetto" note="Utile se la cartella è temporanea." />
            </div>
          )}
        </Row>
      )}

      <div>
        <Bott weight="quieto" size="s" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "▾" : "▸"} Dove salvare il progetto
        </Bott>
        {advanced && (
          <div className="pt-1.5">
            <Row label="Cartella del progetto — vuoto: la crea Darkroom">
              <Field value={root} onChange={setRoot} size="m"
                     placeholder="~/Darkroom/projects/<nome>" className="w-full font-mono" />
            </Row>
          </div>
        )}
      </div>

      {err && <div className="text-[11px] text-amber-300">{err}</div>}

      <div className="flex items-center gap-1.5">
        <Bott weight="primario" size="m" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creo…" : "Crea"}
        </Bott>
        <Bott weight="quieto" size="m" onClick={() => setOpen(false)}>Annulla</Bott>
      </div>
    </div>
  );
}

function BigPick({ picked, onClick, title, note, icon: I }: {
  picked: boolean; onClick: () => void; title: string; note: string; icon?: LucideIcon;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={picked}
            className={`text-left p-2 rounded border transition-colors ${
              picked ? "border-emerald-700 bg-emerald-950/30" : "border-neutral-800 hover:border-neutral-600"}`}>
      <div className="text-[12px] text-neutral-100 flex items-center gap-1.5">
        {I && <I className="w-3.5 h-3.5 text-neutral-400" aria-hidden />}
        {title}
      </div>
      <div className="text-[11px] text-neutral-400 leading-snug mt-0.5">{note}</div>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function when(ms: number | null): string {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "adesso";
  if (min < 60) return `${min}m fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h fa`;
  return `${Math.round(h / 24)}g fa`;
}
