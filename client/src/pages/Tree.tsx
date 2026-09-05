import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonFetch, thumbGenUrl, thumbRawUrl, thumbRefUrl, genUrl, refUrl } from "../api";
import { useViewState, readBool, readOneOf, readNumber } from "../viewState";
import { Pills } from "../ui";
import { VERDICTS, type Verdict, filterTree, countVerdicts } from "../treeFilter";

// Pick view (LIN-02): each shot and its branches, grouped by configuration.
//
// Why not a filter on the grid: the grid sorts by photo and answers "which
// photos do I have". Here the question is "which variant do I keep, and what
// was it born from", which is a relation. With 162 variants across six
// configurations, the grid could not answer it without querying the database by
// hand.

type Variant = {
  id: number;
  version_number: number;
  verdict: string | null;
  note: string | null;
  favorite: boolean;
  /** The exact prompt it was born from. It used to live only in the database:
   *  understanding why two variants differ meant opening sqlite. */
  prompt?: string;
  /** The real names of the input files, not the ids translated for thumbnails. */
  source_files?: string[];
  file_refs?: string[];
  /** The photo ids of the sources, parallel to `source_files`. Needed for the
   *  thumbnail: the client cannot derive them from the name, "1.PNG" -> "1"
   *  works by accident and on an unexpected extension would give a broken
   *  image. */
  source_ids?: (string | null)[];
  /** The engine that produced it: cdp, codex-http, openai. */
  backend?: string | null;
  /** Model and quality: the same model at `low` and at `high` are two
   *  different experiments, and without this field they look like one. */
  model?: string | null;
  quality?: string | null;
  /** Costo stimato in dollari. */
  cost_usd?: number | null;
  /** When it was born, in milliseconds. */
  created_at?: number;
  /** The file is not on disk. A variant like this showed an empty rectangle
   *  with no explanation: it looked like a thumbnail still loading. */
  missing?: boolean;
};
type Group = {
  recipe: string;
  refset: string;
  preamble: string | null;
  sources: string[];
  /** Style files attached to this generation, if any. */
  refs?: string[];
  variants: Variant[];
};
type Node = {
  /** First photo of the set: cover and link. */
  photo: string;
  /** The whole input set. A single photo = a set of 1. */
  photos?: string[];
  variants: number;
  recipes: number;
  groups: Group[];
};

const CYCLE = [null, "keep", "maybe", "discard"] as const;

/**
 * A row of the details panel: the input images, not their names.
 *
 * A list of names does not say WHICH photo it is: "1.PNG" and "ChatGPT Image
 * Aug 15..." are labels, and to know what went into a generation you had to go
 * hunting through the folder by hand.
 *
 * It also exists to state EMPTINESS: a section that does not appear reads as a
 * fault, one that says "none" reads as a fact — and those are two different
 * things when you are trying to work out why two variants came out different.
 */
function Item({
  title,
  values,
  empty,
  ids,
  preview,
  onZoom,
}: {
  title: string;
  values?: string[];
  empty: string;
  /** Photo ids parallel to `values`, when the thumbnail is asked for by id. */
  ids?: (string | null)[];
  /** How to build the thumbnail, when it is asked for by file name. */
  preview?: (f: string) => string;
  /** Zoom: a 64px thumbnail is for recognising an image you already know, not
   *  for judging it. Without it, seeing what really went into the generation
   *  meant opening the file from the Finder. */
  onZoom?: (large: string, caption: string) => void;
}) {
  return (
    <div>
      <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">{title}</span>
      {(values?.length ?? 0) > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {values!.map((f, i) => {
            const src = ids?.[i] ? thumbRawUrl(ids[i]!, 120) : preview?.(f);
            // Full screen wants the original, not the thumbnail blown up.
            const large = ids?.[i] ? thumbRawUrl(ids[i]!, 1600) : refUrl(f);
            return (
              <figure key={f} className="m-0 w-16">
                {src && (
                  <img
                    src={src}
                    alt={f}
                    title={`${f} — clic per ingrandire`}
                    loading="lazy"
                    onClick={onZoom ? () => onZoom(large, f) : undefined}
                    className={
                      "w-16 h-16 object-cover border border-neutral-700 bg-neutral-950 " +
                      (onZoom ? "cursor-zoom-in hover:border-amber-500" : "")
                    }
                  />
                )}
                <figcaption
                  className="mt-0.5 font-mono text-[9px] leading-tight text-neutral-400 truncate"
                  title={f}
                >
                  {f}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="mt-0.5 font-mono text-[10px] text-neutral-500 italic">{empty}</p>
      )}
    </div>
  );
}

/** Model, quality and engine on one line. They are the difference between
 *  two variants that declare the same recipe and look nothing alike. */
function How({ v }: { v: Variant }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">motore</span>
      <span className="font-mono text-[10px] text-neutral-300">{v.backend ?? "non registrato"}</span>
      <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">modello</span>
      <span className="font-mono text-[10px] text-neutral-300">
        {v.model ? `${v.model}${v.quality ? ` · ${v.quality}` : ""}` : "non registrato"}
      </span>
      {typeof v.cost_usd === "number" && (
        <>
          <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">costo</span>
          <span
            className="font-mono text-[10px] text-neutral-300 tabular-nums"
            title="Stima: la chiamata pagata piu' vicina nel tempo a questa versione. Si paga la chiamata, non la versione, quindi l'aggancio e' per prossimita'."
          >
            ~${v.cost_usd.toFixed(3)}
          </span>
        </>
      )}
      {v.created_at ? (
        <span className="font-mono text-[10px] text-neutral-500">
          {new Date(v.created_at).toLocaleString("it-IT", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The group's recipe: inputs, engine and prompt, always on screen.
 *
 * The prompt is long and in a narrow column becomes a column of single words,
 * so here it takes the whole row. It stays height-limited all the same: a
 * thousand characters of prompt would push the variants below the fold, and the
 * variants are what you came to look at.
 */
function Recipe({
  v,
  onZoom,
}: {
  v?: Variant;
  onZoom?: (large: string, caption: string) => void;
}) {
  if (!v) return null;
  return (
    // Two columns with different jobs: on the left WITH WHAT (engine, model,
    // cost, and the input images), on the right WHAT WAS ASKED FOR.
    //
    // The left column has a width of its own: the thumbnails are 64px and the
    // technical data is short, so widening it adds nothing. The prompt is
    // instead the only long thing in here and takes all the rest.
    //
    // `items-stretch` plus `h-full` on the prompt is what makes it reach the
    // bottom of the row: without them its height was fixed (`max-h-28`) and a
    // hole was left underneath when the left column was taller. Now the text
    // fills the height available and only scrolls if it exceeds it, so the row
    // does not stretch for long prompts.
    <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2 border-l-2 border-neutral-800 pl-3">
      <div className="flex shrink-0 flex-col gap-2">
        <How v={v} />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Item
            title="sorgenti"
            values={v.source_files}
            ids={v.source_ids}
            empty="nessuna registrata"
            onZoom={onZoom}
          />
          <Item
            title="riferimenti"
            values={v.file_refs}
            preview={(f) => thumbRefUrl(f, 120)}
            empty="nessuno: generata senza reference"
            onZoom={onZoom}
          />
        </div>
      </div>
      {/* `min-w-[16rem]` e' la soglia sotto cui il prompt torna una colonna di
          parole singole: sotto quella, `flex-wrap` lo manda a capo da solo. */}
      <div className="flex min-w-[16rem] flex-1 flex-col">
        <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">prompt</span>
        {v.prompt ? (
          <p className="mt-0.5 min-h-0 flex-1 select-text overflow-y-auto whitespace-pre-wrap text-[11px] leading-snug text-neutral-300">
            {v.prompt}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] italic text-neutral-500">non registrato</p>
        )}
      </div>
    </div>
  );
}
const GLYPH: Record<string, string> = { "": "○", keep: "●", maybe: "?", discard: "✕" };

/** What the filters are called in here. The logic lives in `treeFilter`. */
const VERDICT_LABEL: Record<Verdict, string> = {
  all: "tutte",
  keep: "tenute",
  maybe: "forse",
  discard: "scartate",
  unseen: "da vedere",
};

/** Recipes have a technical key and a readable name. The key stays in the
 *  data (it is what gets passed to the generator); here the name is shown, and
 *  an unknown recipe shows its own key instead of disappearing. */
const RECIPE_LABEL: Record<string, string> = {
  "bw-hard": "B/N luce dura",
  "bw-soft": "B/N luce morbida",
  "color-editorial": "Colore editoriale",
  "square-profile": "Quadrata 1:1",
  "bw-grain": "B/N grana 35mm",
};

export default function TreePage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  /**
   * Reference overlay, off by default.
   *
   * It exists because distance from the reference can be measured (background,
   * area, light ratio) but "how much it resembles it" stays a judgement made
   * with the eyes, and alternating two images in two tabs is not looking at
   * them: the small differences are lost in the time between one tab and the
   * other.
   *
   * Always optional: on by default it would cover the variants exactly while
   * they are being browsed, which is this page's normal use.
   */
  const [overlay, setOverlay] = useViewState("rif", false, {
    read: readBool,
    memory: "darkroom.albero.rif",
  });
  const [opacita, setOpacita] = useViewState("op", 0.5, {
    read: readNumber(0, 1),
    memory: "darkroom.albero.op",
  });
  const [overlayMode, setOverlayMode] = useViewState<"over" | "difference">("modo", "over", {
    read: readOneOf(["over", "difference"] as const),
    memory: "darkroom.albero.modo",
  });
  /**
   * The filter by verdict. In the URL and not only in memory: after marking
   * thirty variants, "show me only the kept ones" is what you were looking at,
   * and reloading the page must not bring everything back into the middle.
   */
  const [verdict, setVerdict] = useViewState<Verdict>("giudizio", "all", {
    read: readOneOf(VERDICTS),
    memory: "darkroom.albero.giudizio",
  });
  /**
   * Distance from the reference, by variant id. Computed on demand and not at
   * load: it is a measurement that opens a process per image, and on a page
   * with hundreds of variants you would pay for all of it to look at three.
   */
  const [gaps, setScarti] = useState<Record<number, number | null>>({});
  const [measuring, setMeasuring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<{ src: string; cap: string } | null>(null);

  const load = useCallback(async () => {
    const r = await jsonFetch<{ photos: Node[] }>("/api/lineage");
    setNodes(r.photos);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Updates locally and then saves: the verdict must answer the click at
   *  once, otherwise you vote twice believing the first did not take. */
  async function patch(v: Variant, patchBody: { verdict?: string | null; note?: string }) {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        groups: n.groups.map((g) => ({
          ...g,
          variants: g.variants.map((x) => (x.id === v.id ? { ...x, ...patchBody } : x)),
        })),
      })),
    );
    await jsonFetch(`/api/versions/${v.id}/verdict`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    }).catch(() => load());
  }

  const all = nodes.flatMap((n) => n.groups.flatMap((g) => g.variants));
  const kept = all.filter((v) => v.verdict === "keep");
  /** How many variants per verdict: a filter leading to an empty page should
   *  be known BEFORE clicking it, not after. */
  const counts = useMemo(() => countVerdicts(all), [all]);

  /**
   * The filtered tree. Groups left empty are pruned, and then roots left
   * without groups: a source with its header and no variants underneath looks
   * like a half-finished load, not a filter that worked.
   */
  const visibili = useMemo(() => filterTree(nodes, verdict), [nodes, verdict]);
  // The controls appear only if there is something to overlay: on a project
  // without references they would be a switch that turns nothing on.
  const hasReferences = nodes.some((n) => n.groups.some((g) => (g.refs?.length ?? 0) > 0));

  /** Measures the variants that have a reference. In sequence: they are python
   *  processes, and launching thirty at once brings the machine that is also
   *  running the generation to its knees. */
  async function measure() {
    setMeasuring(true);
    const daFare = nodes.flatMap((n) =>
      n.groups.flatMap((g) => ((g.refs?.length ?? 0) > 0 ? g.variants.map((v) => v.id) : [])),
    );
    for (const id of daFare) {
      try {
        const r = await jsonFetch<{ gap: { distance: number; saturated?: boolean } | null }>(
          `/api/versions/${id}/gap`,
        );
        // Past saturation the distance is a lower bound: it is shown with "≥"
        // instead of letting it pass for the exact value.
        setScarti((s) => ({
          ...s,
          [id]: r.gap ? (r.gap.saturated ? -r.gap.distance : r.gap.distance) : null,
        }));
      } catch {
        setScarti((s) => ({ ...s, [id]: null }));
      }
    }
    setMeasuring(false);
  }

  if (loading) return <div className="py-20 text-center text-neutral-400">Carico l'albero…</div>;
  if (nodes.length === 0)
    return <div className="py-20 text-center text-neutral-400">Nessuna variante generata.</div>;

  return (
    <div className="space-y-6 pb-24">
      {/* Una barra sola, compatta. Prima i controlli del riferimento
          occupavano una riga alta con etichette per esteso e una frase di
          spiegazione sempre accesa: tanto spazio verticale rubato alle
          varianti, che sono il motivo per cui si apre questa pagina. Ora e'
          una striscia sottile, e le spiegazioni stanno nei `title`. */}
      <div className="sticky top-14 z-30 flex items-center gap-2 flex-wrap text-[11px] border border-neutral-800 bg-neutral-950/95 backdrop-blur px-2 py-1">
        {/* I filtri per giudizio: stessa forma dei filtri della griglia
            (pastiglie con il conteggio), perche' e' la stessa domanda. */}
        <Pills
          items={VERDICTS.map((k) => ({ id: k, name: VERDICT_LABEL[k] }))}
          pick={verdict}
          onChoose={setVerdict}
          counts={counts}
          neutral="all"
        />

        {hasReferences && (
          <>
            <span className="w-px h-4 bg-neutral-800" />
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              title="Passando il mouse su una variante, il riferimento le compare sopra in trasparenza"
            >
              <input
                type="checkbox"
                checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)}
                className="accent-amber-500 w-3 h-3"
              />
              <span className="font-mono uppercase tracking-wide text-[10px] text-amber-500">
                riferimento
              </span>
            </label>
            {overlay && (
              <span className="flex items-center gap-1.5 shrink-0">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacita}
                  onChange={(e) => setOpacita(Number(e.target.value))}
                  title={`Opacita' del riferimento: ${Math.round(opacita * 100)}%`}
                  className="w-20 shrink-0 accent-amber-500"
                />
                <span className="font-mono text-neutral-500 tabular-nums w-7">
                  {Math.round(opacita * 100)}%
                </span>
                <select
                  value={overlayMode}
                  onChange={(e) => setOverlayMode(e.target.value as "over" | "difference")}
                  title={
                    overlayMode === "difference"
                      ? "Le zone che combaciano restano nere"
                      : "Il riferimento in trasparenza sopra la variante"
                  }
                  className="bg-neutral-950 border border-neutral-800 px-1 py-0.5 text-[10px]"
                >
                  <option value="sopra">sopra</option>
                  <option value="differenza">differenza</option>
                </select>
              </span>
            )}
            <button
              onClick={measure}
              disabled={measuring}
              title="Quanto ogni variante si discosta dalla sua reference: fondo, area del soggetto, rapporto fra luce verticale e orizzontale. Piu' basso e' piu' somiglia."
              className="ml-auto px-1.5 py-0.5 border border-neutral-800 text-neutral-400 hover:border-amber-500 hover:text-amber-500 disabled:opacity-40"
            >
              {measuring ? "misuro…" : "misura scarto"}
            </button>
          </>
        )}
      </div>

      {visibili.length === 0 && (
        <div className="py-16 text-center text-neutral-500 text-sm">
          Nessuna variante {VERDICT_LABEL[verdict]}.{" "}
          <button onClick={() => setVerdict("all")} className="text-amber-500 hover:underline">
            mostra tutte
          </button>
        </div>
      )}
      {visibili.map((n, i) => (
        <section
          key={(n.photos ?? [n.photo]).join("|")}
          className="grid grid-cols-[168px_1fr] gap-5 py-5 border-b border-neutral-800 items-start"
        >
          <div className="sticky top-20 flex flex-col gap-1.5">
            {/* La radice e' l'INSIEME di ingresso. Quando le foto sono piu' di
                una si mostrano tutte: mostrarne una sola la spacciava per
                l'unico scatto usato, ed e' il motivo per cui le altre
                risultavano "0 varianti" pur avendo contribuito a tutte. */}
            <span className="font-mono text-[10px] tracking-widest uppercase text-amber-500">
              {(n.photos?.length ?? 1) > 1
                ? `sorgenti ${String(i + 1).padStart(2, "0")} · ${n.photos!.length} scatti`
                : `sorgente ${String(i + 1).padStart(2, "0")}`}
            </span>
            {(n.photos?.length ?? 1) > 1 ? (
              <div className="grid grid-cols-2 gap-1">
                {n.photos!.map((pid) => (
                  <img
                    key={pid}
                    src={thumbRawUrl(pid, 300)}
                    alt={`Scatto di partenza ${pid}`}
                    title={pid}
                    className="w-full aspect-[4/5] object-cover bg-neutral-900 border border-neutral-700"
                  />
                ))}
              </div>
            ) : (
              <img
                src={thumbRawUrl(n.photo, 600)}
                alt={`Scatto di partenza ${n.photo}`}
                className="w-full aspect-[4/5] object-cover bg-neutral-900 border border-neutral-700"
              />
            )}
            <span className="text-xs truncate text-neutral-300" title={(n.photos ?? [n.photo]).join(", ")}>
              {(n.photos?.length ?? 1) > 1 ? `${n.photos!.length} scatti insieme` : n.photo}
            </span>
            <span className="font-mono text-[11px] text-neutral-400">
              {n.variants} varianti · {n.recipes} ricette
            </span>
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            {n.groups.map((g, gi) => (
              <div key={gi} className="relative pl-6">
                <span className="absolute left-0 top-3 w-4 h-px bg-neutral-700" />
                <span
                  className={
                    "absolute left-0 top-0 w-px bg-neutral-800 " +
                    (gi === n.groups.length - 1 ? "h-3" : "bottom-0")
                  }
                />
                {/* Che cosa e' stato chiesto, SEMPRE a schermo.

                    Stava dentro un pannello a scomparsa sulla singola card:
                    una colonna da 160px dove il prompt usciva alto e strettissimo
                    e le miniature non ci stavano. Ma quei dati sono identici per
                    tutte le varianti del gruppo — sono cio' che DEFINISCE il
                    gruppo — quindi ripeterli per card era anche sbagliato oltre
                    che illeggibile.

                    Qui c'e' tutta la larghezza della riga, e non serve aprire
                    niente: la domanda "cosa ho chiesto" viene prima di guardare
                    i risultati, non dopo. */}
                <div className="mb-2">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="font-semibold text-sm">
                      {RECIPE_LABEL[g.recipe] ?? g.recipe}
                    </span>
                    <span
                      className="font-mono text-[10px] tracking-wide uppercase text-amber-500 border border-neutral-700 px-1.5"
                      title="set di riferimenti, come e' stato etichettato al lancio"
                    >
                      {g.refset}
                    </span>
                    {g.preamble && (
                      <span className="font-mono text-[10px] text-neutral-400">{g.preamble}</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-neutral-400">
                      {g.variants.length}
                    </span>
                  </div>
                </div>
                {/* La striscia serviva quando la colonna a sinistra mostrava una
                    foto sola: ora la radice e' gia' l'insieme, quindi si ripete
                    solo se questo gruppo usa un insieme DIVERSO da quello della
                    radice (caso che oggi non capita, ma il dato lo permette). */}
                {g.sources.length > 1 &&
                  g.sources.join("|") !== (n.photos ?? [n.photo]).join("|") && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-400">
                      da {g.sources.length} scatti
                    </span>
                    {g.sources.map((sid) => (
                      <img
                        key={sid}
                        src={thumbRawUrl(sid, 120)}
                        alt={`scatto in ingresso ${sid}`}
                        title={sid}
                        className="w-8 h-10 object-cover border border-neutral-700 bg-neutral-900"
                      />
                    ))}
                  </div>
                )}
                {/* I RISULTATI a sinistra, la ricetta a destra.

                    Sopra le varianti, la ricetta le spingeva sotto la piega: si
                    apriva l'albero per guardare cosa era uscito e si trovava un
                    muro di testo. Ma nasconderla dietro un pannello era peggio,
                    perche' dentro una card da 160px il prompt diventa una
                    colonna di parole singole.

                    Di fianco: le immagini restano il primo oggetto a sinistra,
                    dove l'occhio comincia, e il "perche' sono cosi'" e' li'
                    accanto senza aprire niente. La colonna della ricetta non si
                    restringe sotto le 18rem, altrimenti il prompt torna
                    illeggibile; sotto i 1024px vanno una sopra l'altra. */}
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {/* Le colonne sono LARGHE 160px, non "almeno 160px".

                      Con `minmax(160px,1fr)` e `flex-1` la griglia si allargava
                      a tutta la riga anche per UNA sola variante: la card
                      restava a sinistra, seguiva un buco, e la ricetta finiva
                      contro il bordo destro a 1200px dalla foto che descrive.
                      Accostare due cose che si spiegano a vicenda e' l'unico
                      motivo per cui stanno sulla stessa riga.

                      A larghezza fissa la griglia occupa quanto le serve e la
                      ricetta le sta subito accanto; `shrink` la lascia comunque
                      cedere spazio quando le varianti sono tante. */}
                  <div className="min-w-0 grid gap-3 [grid-template-columns:repeat(auto-fill,160px)]">
                    {g.variants.map((v) => (
                      <Leaf
                        key={v.id}
                        photo={n.photo}
                        v={v}
                        gap={gaps[v.id]}
                        rif={overlay ? (g.refs?.[0] ?? null) : null}
                        opacita={opacita}
                        overlayMode={overlayMode}
                        onVote={() => {
                          const cur = (v.verdict ?? null) as (typeof CYCLE)[number];
                          const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length] ?? null;
                          patch(v, { verdict: next });
                        }}
                        onNote={(text) => patch(v, { note: text })}
                        onZoom={() =>
                          setZoom({
                            src: genUrl(n.photo, v.version_number),
                            cap: `${n.photo} · v${String(v.version_number).padStart(2, "0")} · ${RECIPE_LABEL[g.recipe] ?? g.recipe} · ${g.refset}`,
                          })
                        }
                      />
                    ))}
                  </div>
                  {/* Prende lo spazio che avanza invece di fermarsi a 288px:
                      su uno schermo largo restava mezza riga bianca a destra
                      mentre il prompt si leggeva in una colonna stretta. */}
                  <div className="min-w-0 lg:flex-1">
                    <Recipe
                      v={g.variants[0]}
                      onZoom={(src, cap) => setZoom({ src, cap })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="fixed left-0 right-0 bottom-0 z-20 bg-neutral-900/95 backdrop-blur border-t border-neutral-700 px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <span className="font-mono text-sm text-neutral-400 tabular-nums">
          <b className="text-amber-500 text-base">{kept.length}</b> / {all.length} tenute
        </span>
        <button
          className="text-sm px-3 py-1.5 border border-neutral-700 hover:border-amber-500 hover:text-amber-500"
          onClick={() => {
            const txt = nodes
              .flatMap((n) =>
                n.groups.flatMap((g) =>
                  g.variants
                    .filter((v) => v.verdict || v.note)
                    .map(
                      (v) =>
                        `${n.photo}/v${String(v.version_number).padStart(2, "0")}  ${(v.verdict ?? "-").toUpperCase()}  [${RECIPE_LABEL[g.recipe] ?? g.recipe} · ${g.refset}]${v.note ? `  — ${v.note}` : ""}`,
                    ),
                ),
              )
              .join("\n");
            navigator.clipboard.writeText(txt || "(nessun giudizio)");
          }}
        >
          Copia scelte
        </button>
        <span className="font-mono text-xs text-neutral-400 truncate">
          {all.filter((v) => v.verdict === "maybe").length} forse ·{" "}
          {all.filter((v) => v.verdict === "discard").length} scartate ·{" "}
          {all.filter((v) => v.note).length} note
        </span>
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-4"
          onClick={() => setZoom(null)}
        >
          <img src={zoom.src} alt="" className="max-w-[96vw] max-h-[90vh] object-contain" />
          <div className="font-mono text-xs text-neutral-400 pt-2">{zoom.cap}</div>
        </div>
      )}
    </div>
  );
}

function Leaf({
  photo,
  v,
  gap,
  rif,
  opacita,
  overlayMode,
  onVote,
  onNote,
  onZoom,
}: {
  photo: string;
  v: Variant;
  /** Distance from the reference: undefined = not measured, null = not
 *  measurable. */
  gap?: number | null;
  /** Reference to overlay, or null when the overlay is off. */
  rif?: string | null;
  opacita?: number;
  /** "over" judges the resemblance, "difference" shows WHERE they differ:
   *  the areas that match stay black. */
  overlayMode?: "over" | "difference";
  onVote: () => void;
  onNote: (t: string) => void;
  onZoom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(v.note ?? "");
  useEffect(() => setText(v.note ?? ""), [v.note]);

  const ring = v.verdict === "keep" || v.verdict === "maybe";
  const cross = v.verdict === "discard";
  const [hover, setHover] = useState(false);

  return (
    <figure
      className={
        "m-0 bg-neutral-900 border " +
        (v.verdict === "keep"
          ? "border-amber-500"
          : v.verdict === "maybe"
            ? "border-amber-500/50 border-dashed"
            : "border-neutral-800") +
        (v.verdict === "discard" ? " opacity-50" : "")
      }
    >
      <div
        className="relative aspect-[4/5] bg-neutral-950 overflow-hidden"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <img
          src={thumbGenUrl(photo, v.version_number, 500)}
          alt={`variante ${v.version_number}`}
          loading="lazy"
          className="w-full h-full object-cover cursor-zoom-in"
          onClick={onZoom}
        />
        {/* Il riferimento sopra la variante, in trasparenza. `object-cover`
            come sotto: due inquadrature diverse renderebbero il confronto
            bugiardo prima ancora di guardarlo. Non intercetta i click, cosi'
            l'ingrandimento resta raggiungibile. */}
        {rif && (
          <img
            src={refUrl(rif)}
            alt=""
            aria-hidden="true"
            // Reveal on hover: the reference is for comparison, not for looking at.
            // Pinned on top it covered the variant exactly while it was being
            // browsed, and seeing what was underneath meant switching the
            // toggle off and on again. Now it is enough to move the mouse away.
            //
            // The opacity is inline and not a class: Tailwind generates the
            // utilities at build time by reading the source, so
            // `opacity-[var(--op)]` compiled without errors and produced no
            // rule at all -- the class was in the DOM and did nothing.
            style={{ opacity: hover ? (opacita ?? 0.5) : 0, transition: "opacity 150ms" }}
            className={
              "absolute inset-0 w-full h-full object-cover pointer-events-none " +
              (overlayMode === "difference" ? "mix-blend-difference" : "")
            }
          />
        )}
        {/* Un file che non c'e' va DETTO. Senza etichetta la cella restava un
            rettangolo grigio identico a una miniatura ancora da caricare: si
            aspetta, si ricarica la pagina, e solo dopo un po' viene il dubbio
            che il problema non sia la rete. Con due cover su ventitre e'
            costato mezz'ora prima che qualcuno andasse a guardare il DB. */}
        {v.missing && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-neutral-950/90 text-center px-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-red-400">
              file mancante
            </span>
            <span className="text-[9px] leading-tight text-neutral-500">
              registrata ma non sul disco
            </span>
          </div>
        )}
        {/* Lo scarto sta sull'immagine perche' e' di QUESTA variante: in una
            colonna a parte si perderebbe il collegamento fra il numero e cio'
            che descrive. Verde sotto 0.5 (praticamente uguale alla reference),
            ambra fino a 1.5, rosso sopra: sono le soglie che separano le
            calibrazioni riuscite da quelle andate a vuoto su profilo. */}
        {gap !== undefined && (
          <span
            title={
              gap === null
                ? "questa variante non ha una reference con cui confrontarsi"
                : gap < 0
                  ? `distanza dalla reference: almeno ${(-gap).toFixed(2)}. La sagoma non si distingue dal fondo, quindi la misura non separa piu' i casi peggiori.`
                  : `distanza dalla reference: ${gap.toFixed(2)} (0 = identica)`
            }
            className={
              "absolute top-1 right-1 px-1.5 py-0.5 font-mono text-[10px] border bg-neutral-950/85 " +
              (gap === null
                ? "border-neutral-700 text-neutral-500"
                : gap < 0
                  ? "border-rose-800 text-rose-300"
                  : gap < 0.5
                  ? "border-emerald-700 text-emerald-300"
                  : gap < 1.5
                    ? "border-amber-700 text-amber-300"
                    : "border-rose-800 text-rose-300")
            }
          >
            {gap === null ? "—" : gap < 0 ? `≥${(-gap).toFixed(2)}` : gap.toFixed(2)}
          </span>
        )}
        {/* Il glifo e' decorazione: se intercettasse il click, l'ingrandimento
            non si aprirebbe e si giudicherebbe senza aver guardato da vicino. */}
        <svg
          viewBox="0 0 120 120"
          aria-hidden="true"
          className="absolute left-[9%] top-[9%] w-[82%] h-[82%] pointer-events-none fill-none stroke-amber-500 [stroke-width:4] [stroke-linecap:round]"
        >
          {ring && (
            <ellipse
              cx="60"
              cy="60"
              rx="50"
              ry="44"
              transform="rotate(-7 60 60)"
              strokeDasharray={v.verdict === "maybe" ? "14 12" : undefined}
            />
          )}
          {cross && <path d="M18 20 L102 100 M102 22 L20 98" />}
        </svg>
      </div>
      {/* I comandi con la loro PAROLA, non solo il glifo.

          Erano tre simboli da 11px affiancati (ⓘ ✎ ○): per sapere cosa
          facessero bisognava passarci sopra e aspettare il tooltip, uno per
          uno. Un'icona che va spiegata ogni volta non risparmia spazio, sposta
          il costo su chi guarda — e qui il gesto piu' frequente e' proprio
          giudicare, che era il glifo piu' oscuro dei tre.

          La riga sopra dice cosa E' la variante (numero, resa, costo), quella
          sotto cosa ci si puo' FARE: due domande diverse, due righe. */}
      <figcaption className="border-t border-neutral-800 px-2 py-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">v{String(v.version_number).padStart(2, "0")}</span>
          {v.favorite && (
            <span className="text-amber-500" title="preferita">
              ★
            </span>
          )}
          {v.quality && (
            <span
              className="text-[9px] uppercase tracking-wide text-neutral-500"
              title={`${v.model ?? "modello non registrato"}, resa ${v.quality}`}
            >
              {v.quality}
            </span>
          )}
          {typeof v.cost_usd === "number" && (
            <span
              className="ml-auto text-[10px] tabular-nums text-neutral-500"
              title="Costo stimato: la chiamata pagata piu' vicina nel tempo. Si paga la chiamata, non la versione."
            >
              ~${v.cost_usd.toFixed(3)}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1">
          <button
            className={
              "flex-1 border px-1 py-1 text-[10px] " +
              (v.note
                ? "border-amber-500 text-amber-500"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
            }
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={v.note ? `nota: ${v.note}` : "aggiungi una nota"}
          >
            nota{v.note ? " •" : ""}
          </button>
          <button
            className={
              "flex-1 border px-1 py-1 text-[10px] " +
              (v.verdict
                ? "border-amber-500 text-amber-500"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
            }
            onClick={onVote}
            title="Clic per cambiare: da giudicare → tieni → forse → scarta"
          >
            {v.verdict === "keep"
              ? "● tieni"
              : v.verdict === "maybe"
                ? "? forse"
                : v.verdict === "discard"
                  ? "✕ scarta"
                  : "giudica"}
          </button>
        </div>
      </figcaption>
      {/* Il prompt ESATTO e i file veri.
          Stavano solo nel database: per sapere perche' due varianti
          differiscono bisognava aprire sqlite, ed e' il motivo per cui si
          ri-generava alla cieca invece di leggere cosa era gia' stato chiesto.
          Il testo e' selezionabile perche' il gesto utile e' copiarlo e
          cambiarne un pezzo. */}
      {open && (
        <div className="px-2 pb-2">
          <textarea
            rows={2}
            value={text}
            placeholder="perché…"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onNote(text.trim())}
            className="w-full text-[12px] bg-transparent text-neutral-200 border border-neutral-800 p-1.5 resize-y"
          />
        </div>
      )}
    </figure>
  );
}
