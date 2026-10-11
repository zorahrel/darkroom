import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Branches, type Clip } from "../api";
import BranchView from "./flow/BranchView";
import LeafView from "./flow/LeafView";
import MapView from "./flow/MapView";
import NodeThumb from "./flow/NodeThumb";
import { buildFlow, children, keyOf, nodeOf, refOfKey, sisters, type Ref } from "./flow/tree";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      if (e.key === "1") setView("foglia");
      if (e.key === "2") setView("ramo");
      if (e.key === "3") setView("mappa");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flow = useMemo(() => (data ? buildFlow(data.nodes) : null), [data]);
  const node = flow && sel ? nodeOf(flow, sel) : undefined;
  // Un video con l'archivio perso non sta nell'elenco dei clip: la selezione cade sul genitore.
  const select = useCallback((r: Ref) => setSel(r), []);
  const openLeaf = useCallback((r: Ref) => {
    setSel(r);
    setView("foglia");
  }, []);

  /** Aggiorna subito lo stato (la stella deve rispondere al tocco), poi lo conferma al server. */
  const mark = async (what: "final" | "discarded") => {
    if (!sel || !node) return;
    const on = !node[what];
    const key = keyOf(sel);
    setData((d) =>
      d
        ? {
            nodes: d.nodes.map((n) => (n.key === key ? { ...n, [what]: on } : n)),
            finals: what === "final" ? (on ? [...d.finals, key] : d.finals.filter((k) => k !== key)) : d.finals,
          }
        : d,
    );
    try {
      if (what === "final") await api.setFinal(photoId, sel.kind, sel.id, on);
      else await api.setDiscard(photoId, sel.kind, sel.id, on);
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };

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

  return (
    <div data-testid="flow-viewer" className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
      <header className="shrink-0 border-b border-neutral-800 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{photoId}</span>
          <nav className="flex overflow-hidden rounded bg-neutral-900" aria-label="Vista">
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
          {sel && node && (
            <>
              <button
                type="button"
                data-testid="toggle-final"
                onClick={() => mark("final")}
                className={`${btn} ${node.final ? "bg-amber-500 text-black" : "bg-neutral-800 hover:bg-neutral-700"}`}
              >
                {node.final ? "★ Finale" : "☆ Finale"}
              </button>
              <button
                type="button"
                data-testid="toggle-discard"
                onClick={() => mark("discarded")}
                title="Mette da parte questa strada: resta nell'albero, sbiadita"
                className={`${btn} ${node.discarded ? "bg-rose-500/30 text-rose-200" : "bg-neutral-800 hover:bg-neutral-700"}`}
              >
                {node.discarded ? "⊘ Scartata" : "⊘ Scarta"}
              </button>
            </>
          )}
          <button type="button" onClick={onClose} className={`${btn} bg-neutral-800 hover:bg-neutral-700`}>
            Chiudi ✕
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
          <span data-testid="flow-summary" className="text-neutral-300">
            {summary ?? "Nessuna selezione"}
          </span>
          <span>⑂ sorelle · ★ finale · ♥ favorita della galleria · ⊘ scartata</span>
        </div>
        {flow && finals.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2 overflow-x-auto" data-testid="finals">
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
        <main className="min-h-0 flex-1 overflow-y-auto" data-testid="flow-body" data-view={view}>
          {view === "foglia" && (
            <LeafView
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

      {viewProps && view !== "foglia" && sel && node && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-neutral-800 bg-neutral-900 px-3 py-2" data-testid="flow-peek">
          <NodeThumb {...viewProps} r={sel} size="h-14" onOpen={openLeaf} />
          <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{summary}</span>
          <button
            type="button"
            data-testid="peek-open"
            onClick={() => openLeaf(sel)}
            className="rounded bg-amber-500 px-3 py-1 text-sm font-medium text-black"
          >
            Vedi foglia →
          </button>
        </footer>
      )}
    </div>
  );
}
