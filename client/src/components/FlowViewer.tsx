import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Branches, type Clip } from "../api";
import BranchView from "./flow/BranchView";
import LeafView from "./flow/LeafView";
import MapView from "./flow/MapView";
import NodeThumb from "./flow/NodeThumb";
import { ancestors, buildFlow, children, keyOf, nodeOf, refOfKey, sisters, stepSelection, type Ref } from "./flow/tree";

/**
 * Il flusso di una foto, a schermo intero, in tre viste che guardano la STESSA selezione:
 *
 *   Foglia  un nodo al centro: sopra da dove arriva, sotto cosa ne e' nato, accanto le sorelle
 *   Ramo    la strada dalla radice a lui, con le biforcazioni dichiarate
 *   Mappa   tutti i rami insieme
 *
 * Cambiare vista non cambia cosa e' selezionato, quindi non ci si perde: si sale e si scende
 * lungo l'albero, e da qualunque vista (doppio clic o «Vedi foglia») si torna al centro.
 * Da qui si decide cosa e' una FOGLIA FINALE (foto o video, anche piu' d'una) e cosa si mette da parte.
 */

type View = "foglia" | "ramo" | "mappa";
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "foglia", label: "Foglia", hint: "1 · il nodo, da dove arriva e cosa ne è nato" },
  { id: "ramo", label: "Ramo", hint: "2 · la strada fin qui, con le biforcazioni" },
  { id: "mappa", label: "Mappa", hint: "3 · tutti i rami insieme" },
];

export default function FlowViewer({
  photoId,
  clips,
  currentVersion,
  initialClipId,
  onClose,
  onClipsChanged,
  onPickVersion,
}: {
  photoId: string;
  clips: Clip[];
  currentVersion: number | null;
  initialClipId?: number | null;
  onClose: () => void;
  onClipsChanged: () => void | Promise<unknown>;
  /** Porta l'editor su una versione: il flusso e' una vista, il lavoro si fa nell'editor. */
  onPickVersion?: (versionNumber: number) => void;
}) {
  const [data, setData] = useState<Branches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("foglia");
  const [help, setHelp] = useState(false);
  const [sel, setSel] = useState<Ref | null>(() => {
    if (initialClipId != null && clips.some((c) => c.id === initialClipId)) return { kind: "clip", id: initialClipId };
    return currentVersion != null ? { kind: "version", id: currentVersion } : null;
  });

  const load = useCallback(async () => {
    try {
      setData(await api.branches(photoId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [photoId]);
  useEffect(() => {
    void load();
  }, [load, clips.length]);

  const flow = useMemo(() => (data ? buildFlow(data.nodes) : null), [data]);
  const node = flow && sel ? nodeOf(flow, sel) : undefined;

  // Tastiera, uguale in tutte e tre le viste: 1 2 3 cambiano vista, le frecce si muovono nell'albero
  // (su = genitore, giu' = figlio, sinistra/destra = sorelle), Invio porta al centro.
  // Se il fuoco e' nel player video o in un campo di testo le frecce sono sue.
  const markRef = useRef<(what: "final" | "discarded") => Promise<void>>(async () => {});
  const selRef = useRef(sel);
  selRef.current = sel;
  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const el = e.target instanceof Element ? (e.target as HTMLElement) : null;
      const t = el?.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") return setView("foglia");
      if (e.key === "2") return setView("ramo");
      if (e.key === "3") return setView("mappa");
      if (el?.closest?.('[data-testid="video-player"]')) return;
      if (e.key === "f" || e.key === "F") return void markRef.current("final");
      if (e.key === "d" || e.key === "D") return void markRef.current("discarded");
      if (e.key === "?") return setHelp((h) => !h);
      const f = flowRef.current;
      const cur = selRef.current;
      if (!f || !cur) return;
      const step = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "prev", ArrowRight: "next" } as const)[
        e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
      ];
      if (step) {
        e.preventDefault();
        const to = stepSelection(f, cur, step);
        if (to) setSel(to);
      } else if (e.key === "Enter") {
        setView("foglia");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Un video con l'archivio perso non sta nell'elenco dei clip: la selezione cade sul genitore.
  const select = useCallback((r: Ref) => setSel(r), []);
  const openLeaf = useCallback((r: Ref) => {
    setSel(r);
    setView("foglia");
  }, []);

  /**
   * Aggiorna subito lo stato (la stella deve rispondere al tocco), poi lo conferma al server.
   * Finale e scartata si escludono: una strada messa da parte non puo' essere una scelta finale.
   */
  const mark = async (what: "final" | "discarded") => {
    if (!sel || !node) return;
    const on = !node[what];
    const other = what === "final" ? "discarded" : "final";
    const clearOther = on && node[other];
    const key = keyOf(sel);
    const finalNow = what === "final" ? on : clearOther ? false : node.final;
    setData((d) =>
      d
        ? {
            nodes: d.nodes.map((n) =>
              n.key === key ? { ...n, [what]: on, ...(clearOther ? { [other]: false } : {}) } : n,
            ),
            finals: finalNow ? (d.finals.includes(key) ? d.finals : [...d.finals, key]) : d.finals.filter((k) => k !== key),
          }
        : d,
    );
    const call = (w: "final" | "discarded", v: boolean) =>
      w === "final" ? api.setFinal(photoId, sel.kind, sel.id, v) : api.setDiscard(photoId, sel.kind, sel.id, v);
    try {
      if (clearOther) await call(other, false);
      await call(what, on);
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };

  markRef.current = mark;

  const summary = (() => {
    if (!flow || !sel || !node) return null;
    const nSis = sisters(flow, sel).length;
    const c = sel.kind === "version" ? children(flow, sel.id) : { versions: [], clips: [] };
    const nKids = c.versions.length + c.clips.length;
    const name = sel.kind === "version" ? `v${sel.id}` : (node.kind === "clip" ? (node.model ?? "video") : "video");
    return `${name} · ${nSis === 0 ? "nessuna sorella" : `${nSis} sorell${nSis === 1 ? "a" : "e"}`} · ${
      sel.kind === "clip" ? "video" : nKids === 0 ? "foglia" : `${nKids} figli`
    }`;
  })();

  const finals = data?.finals ?? [];
  const viewProps = flow ? { photoId, flow, sel, onSelect: select, onOpenLeaf: openLeaf } : null;
  const btn = "rounded px-3 py-1 text-sm";

  // Dove si puo' andare da qui: i quattro tasti freccia si accendono solo se il passo porta da qualche parte.
  const can = {
    up: !!(flow && sel && stepSelection(flow, sel, "up")),
    down: !!(flow && sel && stepSelection(flow, sel, "down")),
    prev: !!(flow && sel && stepSelection(flow, sel, "prev")),
    next: !!(flow && sel && stepSelection(flow, sel, "next")),
  };
  const go = (step: "up" | "down" | "prev" | "next") => {
    if (!flow || !sel) return;
    const to = stepSelection(flow, sel, step);
    if (to) setSel(to);
  };
  // La strada fin qui, in piccolo: le ultime tre tappe sono cliccabili, il resto sta in «⋯ N».
  const road = (() => {
    if (!flow || !sel || !node) return [] as number[];
    const v = sel.kind === "version" ? sel.id : node.parent;
    if (v == null || !flow.versions.has(v)) return [];
    return sel.kind === "version" ? ancestors(flow, v) : [...ancestors(flow, v), v];
  })();
  const roadShown = road.slice(-3);
  const arrow = (step: "up" | "down" | "prev" | "next", glyph: string, tip: string) => (
    <button
      type="button"
      data-testid={`nav-${step}`}
      title={tip}
      aria-label={tip}
      disabled={!can[step]}
      onClick={() => go(step)}
      className="h-7 w-7 rounded bg-neutral-800 text-sm hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-neutral-800"
    >
      {glyph}
    </button>
  );

  return (
    <div data-testid="flow-viewer" className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-3 py-2">
        {/* Riga 1: dove sono (foto), come guardo (viste), aiuto e uscita. Uguale in tutte le viste, e il tasto Chiudi sta sempre in alto a destra. */}
        <div className="flex items-center gap-x-3" data-testid="flow-bar">
          <span className="min-w-0 truncate text-sm font-medium" title="La foto di cui stai guardando la storia">{photoId}</span>
          <nav className="flex shrink-0 overflow-hidden rounded bg-neutral-900" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                data-testid={`view-${v.id}`}
                title={v.hint}
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={`px-3 py-1 text-sm ${view === v.id ? "bg-amber-500 font-medium text-black" : "hover:bg-neutral-800"}`}
              >
                {v.label}
              </button>
            ))}
          </nav>
          <span className="flex-1" />
          <button
            type="button"
            data-testid="flow-help"
            aria-expanded={help}
            title="Tasti e simboli (?)"
            onClick={() => setHelp((h) => !h)}
            className="h-7 w-7 shrink-0 rounded bg-neutral-800 text-sm hover:bg-neutral-700"
          >
            ?
          </button>
          <button type="button" data-testid="flow-close" title="Chiudi (Esc)" onClick={onClose} className={`${btn} shrink-0 bg-neutral-800 hover:bg-neutral-700`}>
            ✕<span className="hidden sm:inline"> Chiudi</span>
          </button>
        </div>

        {/* Riga 2: la selezione. Le frecce per muoversi, chi e' selezionato, cosa ne decido. Stessa altezza in ogni vista. */}
        <div className="mt-2 flex items-center gap-x-3" data-testid="flow-nav">
          <span className="flex shrink-0 items-center gap-1" role="group" aria-label="Muoviti nell'albero">
            {arrow("up", "↑", "Al genitore (↑)")}
            {arrow("prev", "←", "Sorella precedente (←)")}
            {arrow("next", "→", "Sorella successiva (→)")}
            {arrow("down", "↓", "Al figlio sul ramo principale (↓)")}
          </span>
          {flow && sel && (
            <NodeThumb photoId={photoId} flow={flow} r={sel} sel={sel} onSelect={select} onOpen={openLeaf} size="h-10" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-300" data-testid="flow-summary" title={summary ?? ""}>
            {summary ?? "Nessuna selezione"}
          </span>
          {sel && node && (
            <span className="flex shrink-0 items-center gap-1.5" data-testid="flow-decide">
              <button
                type="button"
                data-testid="toggle-final"
                title={node.final ? "Togli da foglie finali (f)" : "Segna come foglia finale: una scelta tua, foto o video (f)"}
                onClick={() => mark("final")}
                className={`${btn} ${node.final ? "bg-amber-500 text-black" : "bg-neutral-800 hover:bg-neutral-700"}`}
              >
                {node.final ? "★" : "☆"}
                <span className="hidden sm:inline"> Finale</span>
              </button>
              <button
                type="button"
                data-testid="toggle-discard"
                onClick={() => mark("discarded")}
                title={node.discarded ? "Riprendi questa strada (d)" : "Mette da parte questa strada: resta nell'albero, sbiadita (d)"}
                className={`${btn} ${node.discarded ? "bg-rose-500/30 text-rose-200" : "bg-neutral-800 hover:bg-neutral-700"}`}
              >
                ⊘<span className="hidden sm:inline">{node.discarded ? " Scartata" : " Scarta"}</span>
              </button>
              <button
                type="button"
                data-testid="peek-open"
                disabled={view === "foglia"}
                tabIndex={view === "foglia" ? -1 : 0}
                onClick={() => openLeaf(sel)}
                title="Porta questo nodo al centro (Invio)"
                className={`${btn} bg-amber-500 font-medium text-black ${view === "foglia" ? "invisible" : ""}`}
              >
                Foglia →
              </button>
            </span>
          )}
        </div>

        {/* Riga 3: la strada fin qui. Sempre presente (anche vuota) per non far saltare l'altezza dell'header. */}
        <div className="mt-1.5 flex h-5 items-center gap-1 overflow-x-auto whitespace-nowrap text-[11px] text-neutral-400" data-testid="flow-road" title="La strada fin qui">
          {road.length === 0 ? (
            <span className="text-neutral-600">{sel ? "Radice: nessun genitore dichiarato" : ""}</span>
          ) : (
            <>
              {road.length > roadShown.length && (
                <button type="button" onClick={() => setView("ramo")} title="Apri il Ramo" className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 hover:bg-neutral-700">
                  ⋯ {road.length - roadShown.length} prima
                </button>
              )}
              {roadShown.map((n, i) => (
                <span key={n} className="flex shrink-0 items-center gap-1">
                  {(i > 0 || road.length > roadShown.length) && <span className="text-neutral-600">›</span>}
                  <button type="button" onClick={() => select({ kind: "version", id: n })} className="rounded px-1 py-0.5 hover:bg-neutral-800 hover:text-neutral-100">
                    v{n}
                  </button>
                </span>
              ))}
              <span className="text-neutral-600">›</span>
              <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
                {sel?.kind === "version" ? `v${sel.id}` : "video"}
              </span>
            </>
          )}
        </div>

        {help && (
          <div className="mt-2 grid gap-x-6 gap-y-1 rounded bg-neutral-900 p-3 text-[11px] text-neutral-300 sm:grid-cols-2" data-testid="flow-help-panel">
            <div>
              <p className="mb-1 uppercase tracking-wide text-neutral-500">Tasti</p>
              <p><b>1 2 3</b> cambiano vista · <b>↑</b> genitore · <b>↓</b> figlio · <b>← →</b> sorelle · <b>Invio</b> al centro · <b>Esc</b> chiude</p>
              <p><b>f</b> finale · <b>d</b> scarta · Mappa: <b>+ −</b> zoom · <b>0</b> adatta · <b>c</b> centra · trascina per spostarti · <b>Ctrl/Cmd + rotella</b> zoom</p>
            </div>
            <div>
              <p className="mb-1 uppercase tracking-wide text-neutral-500">Simboli</p>
              <p><b>⑂ N</b> N sorelle (nate dallo stesso genitore) · <b>★</b> finale · <b>♥</b> favorita della galleria · <b>⊘</b> scartata</p>
              <p>Cambiare vista non cambia la selezione: ti ritrovi sempre nello stesso punto.</p>
            </div>
          </div>
        )}

        {flow && finals.length > 0 && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto" data-testid="finals">
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-amber-300">★ Finali · {finals.length}</span>
            {finals.map((k) => {
              const r = refOfKey(k);
              return <NodeThumb key={k} photoId={photoId} flow={flow} r={r} sel={sel} onSelect={select} onOpen={openLeaf} size="h-12" />;
            })}
          </div>
        )}
      </header>

      {error && <p className="px-3 py-1 text-xs text-rose-300">{error}</p>}
      {!viewProps && !error && <p className="p-4 text-sm text-neutral-500">Carico…</p>}

      {viewProps && (
        <main className="min-h-0 flex-1 overflow-hidden" data-testid="flow-body" data-view={view}>
          {view === "foglia" && (
            <LeafView
              key={sel ? keyOf(sel) : "none"}
              {...viewProps}
              clips={clips}
              onClipsChanged={onClipsChanged}
              onGoBranch={() => setView("ramo")}
              onPickVersion={onPickVersion}
              onClose={onClose}
            />
          )}
          {view === "ramo" && <BranchView {...viewProps} />}
          {view === "mappa" && <MapView {...viewProps} />}
        </main>
      )}
    </div>
  );
}
