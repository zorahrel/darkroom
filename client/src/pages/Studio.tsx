import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  fotogrammaUrl,
  thumbRawUrlDi,
  type ProjectKind,
  type StudioOverview,
  type StudioProject,
} from "../api";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Other, Bott, Field, Search, Confirm, Filter, Badge, Header, Page, Panel, SectionHeader, Toolbar, useCloseMenu } from "../ui";
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
/** Filter ids are English because they are code; the words on the chips are
 *  Italian because they are read. Both come out of STATES, so they cannot
 *  drift apart the way an id and its `<option>` label once did. */
const STATES = [
  ["running", "in corso", "Hanno lavori in coda o in corso"],
  ["failed", "falliti", "Hanno generazioni fallite da guardare"],
  ["paused", "in pausa", "Il generatore li salta"],
  ["broken", "da sistemare", "Cartella sparita o database che non si apre"],
] as const;
type State = "all" | (typeof STATES)[number][0];
type SortOrder = "recent" | "name" | "largest";

export default function StudioPage() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ProjectKind | "all">("all");
  const [state, setState] = useState<State>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
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

  const paused = data?.worker.runner;
  const projects = data?.projects ?? [];

  /** How many projects would fall into each filter. A filter with no number
   *  does not say whether it is worth opening, and at zero it switches itself
   *  off. */
  const count = useMemo(() => {
    const q = (f: (p: StudioProject) => boolean) => projects.filter(f).length;
    return {
      all: projects.length,
      photo: q((p) => p.views.includes("photo")),
      storyboard: q((p) => p.views.includes("storyboard")),
      video: q((p) => p.views.includes("video")),
      running: q((p) => ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) > 0),
      failed: q((p) => (p.stats?.queue?.failed ?? 0) > 0),
      paused: q((p) => !p.active),
      broken: q((p) => !p.root_exists || !!p.error),
    };
  }, [projects]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inside = projects.filter((p) => {
      if (view !== "all" && !p.views.includes(view)) return false;
      if (state === "running" && ((p.stats?.queue?.running ?? 0) + (p.stats?.queue?.pending ?? 0)) === 0) return false;
      if (state === "failed" && (p.stats?.queue?.failed ?? 0) === 0) return false;
      if (state === "paused" && p.active) return false;
      if (state === "broken" && p.root_exists && !p.error) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q) || p.id.includes(q);
    });
    const weight = (p: StudioProject) => p.stats?.photos ?? p.video?.cuts ?? 0;
    return inside.sort((a, b) =>
      sortOrder === "name"
        ? a.name.localeCompare(b.name)
        : sortOrder === "largest"
          ? weight(b) - weight(a)
          // "Recent" is the last version generated, not the creation date: the
          // project being worked on is the one that produced something last,
          // not the one opened last.
          : (b.stats?.last_version_at ?? b.created_at) - (a.stats?.last_version_at ?? a.created_at),
    );
  }, [projects, search, view, state, sortOrder]);

  return (
    <Page>
      <Header title="Progetti"
               below="Tutti i progetti su questa macchina. Le viste accese dicono cosa sa fare ognuno: si accendono e si spengono da qui." />

      {err && (
        <div className="rounded border border-rose-900 bg-rose-950/40 text-rose-200 text-[12px] px-2.5 py-1.5">
          {err}
        </div>
      )}

      {paused?.paused && paused.paused_until && (
        <div className="rounded border border-amber-900 bg-amber-950/30 text-amber-200 text-[12px] px-2.5 py-1.5">
          La coda è ferma fino alle{" "}
          {new Date(paused.paused_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          : fino a quell'ora nessun progetto genera niente.
        </div>
      )}

      {/* The filter bar: first WHAT a project can do, then HOW it is. Two
          different questions, so two groups, not one single list in which
          «video» and «paused» exclude each other for no reason. */}
      <Toolbar>
        <Search value={search} onChange={setSearch} placeholder="cerca un progetto…" />
        <div className="flex items-center gap-1">
          <Filter active={view === "all"} onClick={() => setView("all")} n={count.all}>tutti</Filter>
          {VIEWS.map((v) => (
            <Filter key={v.id} active={view === v.id} onClick={() => setView(v.id)}
                    n={count[v.id]} title={v.explains}>
              {v.name}
            </Filter>
          ))}
        </div>
        <span className="w-px h-4 bg-neutral-800" aria-hidden />
        <div className="flex items-center gap-1">
          {STATES.map(([id, label, title]) => (
            <Filter key={id} active={state === id} title={title}
                    onClick={() => setState(state === id ? "all" : id)}
                    n={count[id]}>{label}</Filter>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-neutral-400">
          ordina
          {([["recent", "recenti"], ["name", "nome"], ["largest", "più grandi"]] as const).map(([id, text]) => (
            <Bott key={id} size="s" weight="quiet" onClick={() => setSortOrder(id)} active={sortOrder === id}>
              {text}
            </Bott>
          ))}
        </div>
      </Toolbar>

      {data && visible.length === 0 && (
        <div className="text-[12px] text-neutral-400">
          {projects.length === 0
            ? "Nessun progetto ancora: cominciane uno qui sotto, o dagli strumenti."
            : "Niente con questi filtri. "}
          {projects.length > 0 && (
            <button className="underline hover:text-neutral-100"
                    onClick={() => { setSearch(""); setView("all"); setState("all"); }}>
              Rimettili a posto
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
        {visible.map((p) => (
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
    </Page>
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
  const primary = view(p.kind);
  const Icon = primary.icon;

  /**
   * Le cifre della scheda, in una riga sola.
   *
   * Erano tre riquadri centrati, sempre tre: un progetto che è insieme foto e
   * montaggio ne aveva da mostrare cinque e ne mostrava tre, e uno vuoto
   * disegnava tre cornici attorno a tre zeri. Scritte in fila occupano metà
   * dello spazio e non hanno più un numero fisso, quindi dicono quello che c'è.
   */
  const cifre: Array<[string | number, string]> = [];
  if (s) {
    cifre.push([s.photos, s.photos === 1 ? "foto" : "foto"]);
    if (s.favorites > 0) cifre.push([s.favorites, "preferite"]);
    if (s.versions > 0) cifre.push([s.versions, "versioni"]);
    if (s.panels > 0) cifre.push([s.panels, s.panels === 1 ? "quadro" : "quadri"]);
  }
  if (p.video && p.video.cuts > 0) cifre.push([p.video.cuts, p.video.cuts === 1 ? "taglio" : "tagli"]);
  if (p.video && p.video.shots > 0) cifre.push([p.video.shots, "riprese"]);
  if (p.video && p.video.duration > 0) cifre.push([shortDuration(p.video.duration), "durata"]);

  /** Switching a view on and off. The main one cannot be switched off: it
   *  would be a project that opens on a page that is not there. */
  const changeView = (id: ProjectKind) => {
    if (id === p.kind) return;
    const inside = new Set(p.views);
    if (inside.has(id)) inside.delete(id); else inside.add(id);
    onViews([...inside]);
  };

  // Un progetto di montaggio non ha fotografie: la sua copertina sono i primi
  // fotogrammi delle clip. Senza, restava l'unica scheda muta della pagina.
  const copertine = (p.anteprime ?? []).length > 0
    ? (p.anteprime ?? []).slice(0, 3).map((id) => ({ chiave: id, src: thumbRawUrlDi(p.id, id, 384) }))
    : (p.video?.clip ?? []).slice(0, 3).map((clip, i) => ({
        // Secondi scaglionati: in una cartella di montaggio le clip sono spesso
        // esportazioni dello stesso taglio, e allo stesso istante darebbero quattro
        // riquadri identici — che si leggono come un errore, non come una copertina.
        chiave: clip,
        src: fotogrammaUrl(p.root, clip, 384, 1 + i * 4),
      }));

  return (
    // The whole card is the button to go in: the white rectangle on every box
    // shouted louder than the project's name, and the thing you want to click
    // is the project, not a button inside the project.
    //
    // `h-full` piu' la riga che si stira: senza, due schede accanto avevano i
    // piedi a altezze diverse a seconda di quanti avvisi mostravano, e la
    // pagina sembrava storta invece che varia.
    <div className="group relative h-full flex flex-col overflow-hidden rounded-lg border border-neutral-800
                    bg-neutral-950/60 transition-colors hover:border-neutral-600">
      <button type="button" onClick={onOpen} aria-label={`Apri ${p.name}`}
              className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-1
                         focus-visible:outline-offset-2 focus-visible:outline-neutral-300" />

      {/* La copertina prima del nome: un progetto si riconosce dalle sue fotografie
          molto prima che dalla parola con cui è stato chiamato. È decorativa nel
          senso stretto — l'informazione utile è tutta sotto — quindi resta fuori
          dall'albero di accessibilità e non intercetta il clic, che appartiene
          alla scheda intera.

          Una sola grande piu' due piccole invece di quattro francobolli in fila:
          a sedici pixel di altezza non si riconosceva niente, che è l'unica cosa
          che una copertina deve fare. Chi non ne ha tiene comunque la sua fascia,
          altrimenti le schede senza fotografie si accorciavano e la griglia
          diventava un dente di sega. */}
      <div className="relative z-0 h-32 shrink-0 bg-neutral-900 pointer-events-none">
        {copertine.length > 0 ? (
          <div className={`grid h-full gap-px ${
            copertine.length === 1 ? "grid-cols-1"
            : copertine.length === 2 ? "grid-cols-2"
            : "grid-cols-3 grid-rows-2"}`}>
            {copertine.map(({ chiave, src }, i) => (
              <img
                key={chiave}
                src={src}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover bg-neutral-900 opacity-85
                            transition-opacity group-hover:opacity-100
                            ${copertine.length > 2 && i === 0 ? "col-span-2 row-span-2" : ""}`}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Icon className="w-7 h-7 text-neutral-700" aria-hidden />
          </div>
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col gap-2 p-3 pointer-events-none">
        <div className="flex items-start gap-2 min-w-0">
          <Icon className="w-4 h-4 mt-[2px] shrink-0 text-neutral-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium leading-tight truncate group-hover:text-white">{p.name}</div>
            <div className="text-[11px] leading-tight text-neutral-500 truncate" title={p.root}>{p.root}</div>
          </div>
          {/* It appears on hover, and stays if you arrive with the tab key: hidden
              does not mean unreachable. */}
          <Other subtle className="pointer-events-auto -mt-1 -mr-1">
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
          </Other>
        </div>

        {!p.root_exists && (
          <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/60
                          rounded px-2 py-1 truncate" title={p.root}>
            La cartella non c'è più
          </div>
        )}
        {p.error && (
          <div className="text-[11px] text-rose-200 bg-rose-950/30 border border-rose-900/60
                          rounded px-2 py-1 truncate" title={p.error}>
            {p.error}
          </div>
        )}

        {cifre.length > 0 && (
          <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            {cifre.map(([valore, nome]) => (
              <div key={nome} className="flex items-baseline gap-1">
                <dd className="text-[13px] font-semibold leading-none tabular-nums text-neutral-100">{valore}</dd>
                <dt>{nome}</dt>
              </div>
            ))}
          </dl>
        )}

        {/* Il piede sta in fondo — `mt-auto` — e non subito sotto il contenuto:
            è così che i tasti delle schede accanto stanno sulla stessa riga
            anche quando una ha un avviso in più dell'altra.

            What this project can do: le viste si accendono e si spengono da qui,
            perché un lavoro comincia con le fotografie e finisce in un montaggio,
            e non deve diventare due progetti sulla stessa cartella. */}
        <div className="mt-auto flex items-end gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1 min-w-0"
               title="Le viste di questo progetto: accendile e spegnile da qui.">
            {VIEWS.map((v) => {
              const on = p.views.includes(v.id);
              const fixed = v.id === p.kind;
              const I = v.icon;
              return (
                <Bott key={v.id} size="s" active={on} disabled={fixed}
                        className="pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); changeView(v.id); }}
                        title={fixed
                          ? `${v.explains} È la vista principale: si apre qui, quindi non si spegne.`
                          : on ? `${v.explains} Clicca per spegnerla.` : `${v.explains} Clicca per accenderla.`}>
                  <I className="w-3 h-3" aria-hidden />
                  {v.name}
                </Bott>
              );
            })}
          </div>
          <span className="ml-auto shrink-0 text-[11px] text-neutral-400 group-hover:text-neutral-100
                           transition-colors inline-flex items-center gap-1">
            apri <ArrowRight className="w-3 h-3" aria-hidden />
          </span>
        </div>

        {/* Altezza fissa: questa riga c'è solo su alcune schede, e senza di essa
            i piedi delle schede della stessa riga finivano a tre pixel di
            distanza. */}
        <div className="flex items-center gap-1.5 h-[18px] overflow-hidden text-[11px]">
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
          <span className="ml-auto text-neutral-500 shrink-0" title="ultima versione generata">
            {when(s?.last_version_at ?? null)}
          </span>
        </div>
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

  if (!open) return <Bott weight="primary" size="m" onClick={() => setOpen(true)}>+ Nuovo progetto</Bott>;

  return (
    <Panel className="max-w-lg">
      <SectionHeader title="Nuovo progetto" />

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
        <Bott weight="quiet" size="s" onClick={() => setAdvanced((v) => !v)}>
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
        <Bott weight="primary" size="m" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creo…" : "Crea"}
        </Bott>
        <Bott weight="quiet" size="m" onClick={() => setOpen(false)}>Annulla</Bott>
      </div>
    </Panel>
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
