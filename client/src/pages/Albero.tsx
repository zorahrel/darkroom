import { useCallback, useEffect, useState } from "react";
import { jsonFetch, thumbGenUrl, thumbRawUrl, genUrl, refUrl } from "../api";

// Vista di scelta (LIN-02): ogni scatto e i suoi rami, raggruppati per
// configurazione.
//
// Perche' non un filtro sulla griglia: la griglia ordina per foto e risponde a
// "quali foto ho". Qui la domanda e' "quale variante tengo, e da cosa e' nata",
// che e' una relazione. Con 162 varianti in sei configurazioni, sulla griglia
// non si rispondeva senza interrogare il database a mano.

type Variant = {
  id: number;
  version_number: number;
  verdict: string | null;
  note: string | null;
  favorite: boolean;
};
type Group = {
  recipe: string;
  refset: string;
  preamble: string | null;
  sources: string[];
  /** File di stile allegati a questa generazione, se ce ne sono. */
  refs?: string[];
  variants: Variant[];
};
type Node = {
  /** Prima foto dell'insieme: copertina e link. */
  photo: string;
  /** L'insieme di ingresso per intero. Una sola foto = insieme di 1. */
  photos?: string[];
  variants: number;
  recipes: number;
  groups: Group[];
};

const CYCLE = [null, "tieni", "forse", "scarta"] as const;
const GLYPH: Record<string, string> = { "": "○", tieni: "●", forse: "?", scarta: "✕" };

/** Le ricette hanno una chiave tecnica e un nome leggibile. La chiave resta nel
 *  dato (e' quella che si passa al generatore); qui si mostra il nome, e una
 *  ricetta sconosciuta mostra la propria chiave invece di sparire. */
const RECIPE_LABEL: Record<string, string> = {
  "bw-hard": "B/N luce dura",
  "bw-soft": "B/N luce morbida",
  "color-editorial": "Colore editoriale",
  "square-profile": "Quadrata 1:1",
  "bw-grain": "B/N grana 35mm",
};

export default function AlberoPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  /**
   * Sovrapposizione del riferimento, spenta di default.
   *
   * Serve perche' la distanza dalla reference si puo' misurare (fondo, area,
   * rapporto di luce) ma "quanto ci somiglia" resta un giudizio che si fa con
   * gli occhi, e alternare due immagini in due schede non e' guardarle: le
   * differenze piccole si perdono nel tempo che passa fra un tab e l'altro.
   *
   * Sempre opzionale: acceso di default coprirebbe le varianti proprio mentre
   * le si sfoglia, che e' l'uso normale di questa pagina.
   */
  const [overlay, setOverlay] = useState(false);
  const [opacita, setOpacita] = useState(0.5);
  const [modo, setModo] = useState<"sopra" | "differenza">("sopra");
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

  /** Aggiorna in locale e poi salva: il giudizio deve rispondere subito al
   *  click, altrimenti si vota due volte credendo che il primo non abbia preso. */
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
  const tenute = all.filter((v) => v.verdict === "tieni");
  // I controlli compaiono solo se c'e' qualcosa da sovrapporre: su un progetto
  // senza riferimenti sarebbero un interruttore che non accende niente.
  const haRiferimenti = nodes.some((n) => n.groups.some((g) => (g.refs?.length ?? 0) > 0));

  if (loading) return <div className="py-20 text-center text-neutral-400">Carico l'albero…</div>;
  if (nodes.length === 0)
    return <div className="py-20 text-center text-neutral-400">Nessuna variante generata.</div>;

  return (
    <div className="space-y-6 pb-24">
      {haRiferimenti && (
        <div className="flex items-center gap-3 flex-wrap text-xs border border-neutral-800 bg-neutral-900/50 px-3 py-2">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.target.checked)}
              className="accent-amber-500"
            />
            <span className="font-mono uppercase tracking-wide text-[10px] text-amber-500">
              sovrapponi il riferimento
            </span>
          </label>
          {overlay && (
            <>
              <label className="flex items-center gap-2">
                <span className="text-neutral-400">opacità</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacita}
                  onChange={(e) => setOpacita(Number(e.target.value))}
                  className="w-28 accent-amber-500"
                />
                <span className="font-mono text-neutral-400 w-8">{Math.round(opacita * 100)}%</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-neutral-400">modo</span>
                <select
                  value={modo}
                  onChange={(e) => setModo(e.target.value as "sopra" | "differenza")}
                  className="bg-neutral-950 border border-neutral-700 px-1.5 py-0.5"
                >
                  <option value="sopra">sopra</option>
                  <option value="differenza">differenza</option>
                </select>
              </label>
              <span className="text-neutral-500">
                {modo === "differenza"
                  ? "le zone che combaciano restano nere"
                  : "il riferimento in trasparenza sopra la variante"}
              </span>
            </>
          )}
        </div>
      )}
      {nodes.map((n, i) => (
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
                <div className="flex items-baseline gap-2.5 flex-wrap mb-2">
                  <span className="font-semibold text-sm">{RECIPE_LABEL[g.recipe] ?? g.recipe}</span>
                  <span
                    className="font-mono text-[10px] tracking-wide uppercase text-amber-500 border border-neutral-700 px-1.5"
                    title="set di riferimenti"
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
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                  {g.variants.map((v) => (
                    <Leaf
                      key={v.id}
                      photo={n.photo}
                      v={v}
                      rif={overlay ? (g.refs?.[0] ?? null) : null}
                      opacita={opacita}
                      modo={modo}
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
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="fixed left-0 right-0 bottom-0 z-20 bg-neutral-900/95 backdrop-blur border-t border-neutral-700 px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <span className="font-mono text-sm text-neutral-400 tabular-nums">
          <b className="text-amber-500 text-base">{tenute.length}</b> / {all.length} tenute
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
          {all.filter((v) => v.verdict === "forse").length} forse ·{" "}
          {all.filter((v) => v.verdict === "scarta").length} scartate ·{" "}
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
  rif,
  opacita,
  modo,
  onVote,
  onNote,
  onZoom,
}: {
  photo: string;
  v: Variant;
  /** Riferimento da sovrapporre, o null quando la sovrapposizione e' spenta. */
  rif?: string | null;
  opacita?: number;
  /** "sopra" giudica la somiglianza, "differenza" mostra DOVE differiscono:
   *  le zone che combaciano restano nere. */
  modo?: "sopra" | "differenza";
  onVote: () => void;
  onNote: (t: string) => void;
  onZoom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(v.note ?? "");
  useEffect(() => setText(v.note ?? ""), [v.note]);

  const ring = v.verdict === "tieni" || v.verdict === "forse";
  const cross = v.verdict === "scarta";

  return (
    <figure
      className={
        "m-0 bg-neutral-900 border " +
        (v.verdict === "tieni"
          ? "border-amber-500"
          : v.verdict === "forse"
            ? "border-amber-500/50 border-dashed"
            : "border-neutral-800") +
        (v.verdict === "scarta" ? " opacity-50" : "")
      }
    >
      <div className="relative aspect-[4/5] bg-neutral-950 overflow-hidden">
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
            style={{ opacity: opacita ?? 0.5 }}
            className={
              "absolute inset-0 w-full h-full object-cover pointer-events-none" +
              (modo === "differenza" ? " mix-blend-difference" : "")
            }
          />
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
              strokeDasharray={v.verdict === "forse" ? "14 12" : undefined}
            />
          )}
          {cross && <path d="M18 20 L102 100 M102 22 L20 98" />}
        </svg>
      </div>
      <figcaption className="flex items-center gap-2 px-2 py-1.5 border-t border-neutral-800 font-mono text-[11px]">
        <span className="text-neutral-400">v{String(v.version_number).padStart(2, "0")}</span>
        {v.favorite && <span className="text-amber-500" title="preferita">★</span>}
        <button
          className={"ml-auto px-1 " + (v.note ? "text-amber-500" : "text-neutral-400 hover:text-amber-500")}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="nota"
        >
          ✎
        </button>
        <button
          className={"px-1 " + (v.verdict ? "text-amber-500" : "text-neutral-400 hover:text-amber-500")}
          onClick={onVote}
          title="tieni / forse / scarta"
        >
          {GLYPH[v.verdict ?? ""]}
        </button>
      </figcaption>
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
