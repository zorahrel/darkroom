import { useCallback, useEffect, useMemo, useState } from "react";
import { jsonFetch, thumbGenUrl, thumbRawUrl, genUrl, refUrl } from "../api";
import { useStatoVista, leggiBool, leggiUnoDi, leggiNumero } from "../statoVista";
import { Pastiglie } from "../ui";
import { VERDETTI, type Verdetto, filtraAlbero, conteggiaVerdetti } from "../alberoFiltro";

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
  /** Il prompt esatto con cui e' nata. Prima stava solo nel database: per
   *  capire perche' due varianti differiscono bisognava aprire sqlite. */
  prompt?: string;
  /** I nomi veri dei file di ingresso, non gli id tradotti per le miniature. */
  file_sorgenti?: string[];
  file_refs?: string[];
  /** Il file non c'e' sul disco. Una variante cosi' mostrava un rettangolo
   *  vuoto senza spiegazione: sembrava una miniatura ancora da caricare. */
  manca?: boolean;
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

/** Come si chiamano i filtri qui dentro. La logica sta in `alberoFiltro`. */
const VERDETTO_LABEL: Record<Verdetto, string> = {
  tutte: "tutte",
  tieni: "tenute",
  forse: "forse",
  scarta: "scartate",
  "da-vedere": "da vedere",
};

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
  const [overlay, setOverlay] = useStatoVista("rif", false, {
    leggi: leggiBool,
    memoria: "darkroom.albero.rif",
  });
  const [opacita, setOpacita] = useStatoVista("op", 0.5, {
    leggi: leggiNumero(0, 1),
    memoria: "darkroom.albero.op",
  });
  const [modo, setModo] = useStatoVista<"sopra" | "differenza">("modo", "sopra", {
    leggi: leggiUnoDi(["sopra", "differenza"] as const),
    memoria: "darkroom.albero.modo",
  });
  /**
   * Il filtro per giudizio. Nell'URL e non solo in memoria: dopo aver segnato
   * trenta varianti, "mostrami solo le tenute" e' cio' che si stava guardando,
   * e ricaricare la pagina non deve riportare tutto in mezzo.
   */
  const [verdetto, setVerdetto] = useStatoVista<Verdetto>("giudizio", "tutte", {
    leggi: leggiUnoDi(VERDETTI),
    memoria: "darkroom.albero.giudizio",
  });
  /**
   * Distanza dalla reference, per id di variante. Calcolata a richiesta e non
   * al caricamento: e' una misura che apre un processo per immagine, e su una
   * pagina con centinaia di varianti la si pagherebbe tutta per guardarne tre.
   */
  const [scarti, setScarti] = useState<Record<number, number | null>>({});
  const [misurando, setMisurando] = useState(false);
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
  /** Quante varianti per giudizio: un filtro che porta a una pagina vuota va
   *  saputo PRIMA di cliccarlo, non dopo. */
  const conteggi = useMemo(() => conteggiaVerdetti(all), [all]);

  /**
   * L'albero filtrato. Si potano i gruppi rimasti vuoti e poi le radici rimaste
   * senza gruppi: una sorgente con l'intestazione e nessuna variante sotto
   * sembra un caricamento a meta', non un filtro che ha funzionato.
   */
  const visibili = useMemo(() => filtraAlbero(nodes, verdetto), [nodes, verdetto]);
  // I controlli compaiono solo se c'e' qualcosa da sovrapporre: su un progetto
  // senza riferimenti sarebbero un interruttore che non accende niente.
  const haRiferimenti = nodes.some((n) => n.groups.some((g) => (g.refs?.length ?? 0) > 0));

  /** Misura le varianti che hanno una reference. In sequenza: sono processi
   *  python, e lanciarne trenta insieme mette in ginocchio la macchina su cui
   *  sta girando anche la generazione. */
  async function misura() {
    setMisurando(true);
    const daFare = nodes.flatMap((n) =>
      n.groups.flatMap((g) => ((g.refs?.length ?? 0) > 0 ? g.variants.map((v) => v.id) : [])),
    );
    for (const id of daFare) {
      try {
        const r = await jsonFetch<{ scarto: { distanza: number; saturo?: boolean } | null }>(
          `/api/versions/${id}/scarto`,
        );
        // Oltre la saturazione la distanza e' un limite inferiore: si mostra
        // col "≥" invece di far credere che sia il valore esatto.
        setScarti((s) => ({
          ...s,
          [id]: r.scarto ? (r.scarto.saturo ? -r.scarto.distanza : r.scarto.distanza) : null,
        }));
      } catch {
        setScarti((s) => ({ ...s, [id]: null }));
      }
    }
    setMisurando(false);
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
        <Pastiglie
          voci={VERDETTI.map((k) => ({ id: k, nome: VERDETTO_LABEL[k] }))}
          scelta={verdetto}
          onScegli={setVerdetto}
          conteggi={conteggi}
          neutra="tutte"
        />

        {haRiferimenti && (
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
                  value={modo}
                  onChange={(e) => setModo(e.target.value as "sopra" | "differenza")}
                  title={
                    modo === "differenza"
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
              onClick={misura}
              disabled={misurando}
              title="Quanto ogni variante si discosta dalla sua reference: fondo, area del soggetto, rapporto fra luce verticale e orizzontale. Piu' basso e' piu' somiglia."
              className="ml-auto px-1.5 py-0.5 border border-neutral-800 text-neutral-400 hover:border-amber-500 hover:text-amber-500 disabled:opacity-40"
            >
              {misurando ? "misuro…" : "misura scarto"}
            </button>
          </>
        )}
      </div>

      {visibili.length === 0 && (
        <div className="py-16 text-center text-neutral-500 text-sm">
          Nessuna variante {VERDETTO_LABEL[verdetto]}.{" "}
          <button onClick={() => setVerdetto("tutte")} className="text-amber-500 hover:underline">
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
                      scarto={scarti[v.id]}
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
  scarto,
  rif,
  opacita,
  modo,
  onVote,
  onNote,
  onZoom,
}: {
  photo: string;
  v: Variant;
  /** Distanza dalla reference: undefined = non misurata, null = non misurabile. */
  scarto?: number | null;
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
  /** Il pannello con prompt e file di ingresso. Chiuso di default: e' testo
   *  lungo, e in una griglia di miniature sposterebbe tutto il resto. */
  const [dettagli, setDettagli] = useState(false);
  const [text, setText] = useState(v.note ?? "");
  useEffect(() => setText(v.note ?? ""), [v.note]);

  const ring = v.verdict === "tieni" || v.verdict === "forse";
  const cross = v.verdict === "scarta";
  const [hover, setHover] = useState(false);

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
            // A scomparsa: il riferimento serve per il confronto, non per
            // guardarlo. Fisso sopra copriva la variante proprio mentre la si
            // sfogliava, e per vedere cosa c'era sotto bisognava spegnere
            // l'interruttore e riaccenderlo. Ora basta togliere il mouse.
            //
            // L'opacita' e' inline e non una classe: Tailwind genera le utility
            // a build time leggendo il sorgente, quindi `opacity-[var(--op)]`
            // compilava senza errori e non produceva nessuna regola -- la
            // classe c'era nel DOM e non faceva niente.
            style={{ opacity: hover ? (opacita ?? 0.5) : 0, transition: "opacity 150ms" }}
            className={
              "absolute inset-0 w-full h-full object-cover pointer-events-none " +
              (modo === "differenza" ? "mix-blend-difference" : "")
            }
          />
        )}
        {/* Un file che non c'e' va DETTO. Senza etichetta la cella restava un
            rettangolo grigio identico a una miniatura ancora da caricare: si
            aspetta, si ricarica la pagina, e solo dopo un po' viene il dubbio
            che il problema non sia la rete. Con due cover su ventitre e'
            costato mezz'ora prima che qualcuno andasse a guardare il DB. */}
        {v.manca && (
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
        {scarto !== undefined && (
          <span
            title={
              scarto === null
                ? "questa variante non ha una reference con cui confrontarsi"
                : scarto < 0
                  ? `distanza dalla reference: almeno ${(-scarto).toFixed(2)}. La sagoma non si distingue dal fondo, quindi la misura non separa piu' i casi peggiori.`
                  : `distanza dalla reference: ${scarto.toFixed(2)} (0 = identica)`
            }
            className={
              "absolute top-1 right-1 px-1.5 py-0.5 font-mono text-[10px] border bg-neutral-950/85 " +
              (scarto === null
                ? "border-neutral-700 text-neutral-500"
                : scarto < 0
                  ? "border-rose-800 text-rose-300"
                  : scarto < 0.5
                  ? "border-emerald-700 text-emerald-300"
                  : scarto < 1.5
                    ? "border-amber-700 text-amber-300"
                    : "border-rose-800 text-rose-300")
            }
          >
            {scarto === null ? "—" : scarto < 0 ? `≥${(-scarto).toFixed(2)}` : scarto.toFixed(2)}
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
          className={"ml-auto px-1 " + (dettagli ? "text-amber-500" : "text-neutral-400 hover:text-amber-500")}
          onClick={() => setDettagli((d) => !d)}
          aria-expanded={dettagli}
          title="Prompt esatto e file di ingresso: cosa e' stato chiesto davvero"
        >
          ⓘ
        </button>
        <button
          className={"px-1 " + (v.note ? "text-amber-500" : "text-neutral-400 hover:text-amber-500")}
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
      {/* Il prompt ESATTO e i file veri.
          Stavano solo nel database: per sapere perche' due varianti
          differiscono bisognava aprire sqlite, ed e' il motivo per cui si
          ri-generava alla cieca invece di leggere cosa era gia' stato chiesto.
          Il testo e' selezionabile perche' il gesto utile e' copiarlo e
          cambiarne un pezzo. */}
      {dettagli && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-neutral-800 pt-1.5">
          {(v.file_sorgenti?.length ?? 0) > 0 && (
            <div>
              <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">
                sorgenti
              </span>
              <ul className="mt-0.5 space-y-px">
                {v.file_sorgenti!.map((f) => (
                  <li key={f} className="font-mono text-[10px] text-neutral-300 break-all">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(v.file_refs?.length ?? 0) > 0 && (
            <div>
              <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">
                riferimenti
              </span>
              <ul className="mt-0.5 space-y-px">
                {v.file_refs!.map((f) => (
                  <li key={f} className="font-mono text-[10px] text-neutral-300 break-all">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.prompt && (
            <div>
              <span className="font-mono text-[9px] uppercase tracking-wide text-amber-500">
                prompt
              </span>
              <p className="mt-0.5 text-[11px] leading-snug text-neutral-300 whitespace-pre-wrap select-text max-h-40 overflow-y-auto">
                {v.prompt}
              </p>
            </div>
          )}
        </div>
      )}
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
