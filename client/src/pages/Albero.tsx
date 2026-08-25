import { useCallback, useEffect, useState } from "react";
import { jsonFetch, thumbGenUrl, thumbRawUrl, genUrl } from "../api";

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
type Group = { recipe: string; refset: string; preamble: string | null; variants: Variant[] };
type Node = { photo: string; variants: number; recipes: number; groups: Group[] };

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

  if (loading) return <div className="py-20 text-center text-neutral-500">Carico l'albero…</div>;
  if (nodes.length === 0)
    return <div className="py-20 text-center text-neutral-500">Nessuna variante generata.</div>;

  return (
    <div className="space-y-6 pb-24">
      {nodes.map((n, i) => (
        <section
          key={n.photo}
          className="grid grid-cols-[168px_1fr] gap-5 py-5 border-b border-neutral-800 items-start"
        >
          <div className="sticky top-20 flex flex-col gap-1.5">
            <span className="font-mono text-[10px] tracking-widest uppercase text-amber-500">
              sorgente {String(i + 1).padStart(2, "0")}
            </span>
            <img
              src={thumbRawUrl(n.photo, 600)}
              alt={`Scatto di partenza ${n.photo}`}
              className="w-full aspect-[4/5] object-cover bg-neutral-900 border border-neutral-700"
            />
            <span className="text-xs truncate text-neutral-300" title={n.photo}>
              {n.photo}
            </span>
            <span className="font-mono text-[11px] text-neutral-500">
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
                    <span className="font-mono text-[10px] text-neutral-500">{g.preamble}</span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-neutral-500">
                    {g.variants.length}
                  </span>
                </div>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                  {g.variants.map((v) => (
                    <Leaf
                      key={v.id}
                      photo={n.photo}
                      v={v}
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
        <span className="font-mono text-xs text-neutral-500 truncate">
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
  onVote,
  onNote,
  onZoom,
}: {
  photo: string;
  v: Variant;
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
        <span className="text-neutral-500">v{String(v.version_number).padStart(2, "0")}</span>
        {v.favorite && <span className="text-amber-500" title="preferita">★</span>}
        <button
          className={"ml-auto px-1 " + (v.note ? "text-amber-500" : "text-neutral-500 hover:text-amber-500")}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="nota"
        >
          ✎
        </button>
        <button
          className={"px-1 " + (v.verdict ? "text-amber-500" : "text-neutral-500 hover:text-amber-500")}
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
