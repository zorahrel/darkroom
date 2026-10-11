import { useCallback, useEffect, useMemo, useState } from "react";
import { api, genUrl, thumbGenUrl, type BranchNode, type Branches, type Clip } from "../api";
import { ClipItem } from "./ClipsCard";

/**
 * Il flusso di una foto: versioni e video sullo stesso albero, a schermo intero.
 *
 * Si legge dall'alto verso il basso come la storia del lavoro: la radice in alto, la versione
 * a fuoco in fondo. Su ogni riga stanno le alternative nate da quella versione (altre versioni)
 * e i video che partono da lei. Cliccare una cosa la porta nel visore grande: un'immagine o il
 * player (con zoom, passo-fotogramma e fullscreen). Da li' si decide cosa e' una FOGLIA FINALE:
 * una foto o un video scelti come risultato, anche piu' d'uno.
 */

type Sel = { kind: "version" | "clip"; ref: number };

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
  const [sel, setSel] = useState<Sel | null>(() => {
    if (initialClipId != null && clips.some((c) => c.id === initialClipId)) return { kind: "clip", ref: initialClipId };
    if (clips.length > 0) return { kind: "clip", ref: clips[0]!.id };
    return currentVersion != null ? { kind: "version", ref: currentVersion } : null;
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tree = useMemo(() => {
    if (!data) return null;
    const versions = new Map<number, Extract<BranchNode, { kind: "version" }>>();
    const kids = new Map<number | null, Extract<BranchNode, { kind: "version" }>[]>();
    const clipsBy = new Map<number | null, Extract<BranchNode, { kind: "clip" }>[]>();
    for (const n of data.nodes) {
      if (n.kind === "version") {
        versions.set(n.version_number, n);
        const l = kids.get(n.parent) ?? [];
        l.push(n);
        kids.set(n.parent, l);
      } else {
        const l = clipsBy.get(n.parent) ?? [];
        l.push(n);
        clipsBy.set(n.parent, l);
      }
    }
    return { versions, kids, clipsBy };
  }, [data]);

  /** La versione a fuoco: quella scelta, o quella da cui nasce il video scelto. */
  const focus = useMemo(() => {
    if (!tree || !sel) return currentVersion;
    if (sel.kind === "version") return sel.ref;
    const c = data?.nodes.find((n) => n.kind === "clip" && n.clip_id === sel.ref);
    return (c && c.kind === "clip" ? c.parent : null) ?? currentVersion;
  }, [tree, sel, data, currentVersion]);

  /** Dalla radice alla versione a fuoco. */
  const chain = useMemo(() => {
    if (!tree || focus == null) return [] as number[];
    const out: number[] = [];
    const seen = new Set<number>();
    let n: number | null = focus;
    while (n != null && tree.versions.has(n) && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      n = tree.versions.get(n)!.parent;
    }
    return out.reverse();
  }, [tree, focus]);

  const isFinal = (kind: "version" | "clip", ref: number) =>
    !!data?.finals.includes(kind === "version" ? `v${ref}` : `c${ref}`);

  const toggleFinal = async () => {
    if (!sel) return;
    const on = !isFinal(sel.kind, sel.ref);
    // Aggiorno subito: la stella deve rispondere al tocco, il server conferma dopo.
    setData((d) => {
      if (!d) return d;
      const key = sel.kind === "version" ? `v${sel.ref}` : `c${sel.ref}`;
      return {
        nodes: d.nodes.map((n) => (n.key === key ? { ...n, final: on } : n)),
        finals: on ? [...d.finals, key] : d.finals.filter((k) => k !== key),
      };
    });
    try {
      await api.setFinal(photoId, sel.kind, sel.ref, on);
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };

  const clipById = (id: number) => clips.find((c) => c.id === id) ?? null;
  const selClip = sel?.kind === "clip" ? clipById(sel.ref) : null;
  const selVersionNode = sel?.kind === "version" ? tree?.versions.get(sel.ref) : null;

  const thumb = (n: number, w = 120) => (
    <img src={thumbGenUrl(photoId, n, w)} alt={`v${n}`} loading="lazy" className="h-full w-full object-cover" />
  );
  const star = (on: boolean) => (on ? <span className="absolute right-0.5 top-0.5 text-amber-400 drop-shadow">★</span> : null);
  const ring = (on: boolean) => (on ? "ring-2 ring-amber-400" : "ring-1 ring-neutral-700 hover:ring-neutral-400");

  // Funzioni di rendering e non componenti: un componente definito qui dentro si rimonterebbe a ogni render.
  const versionChip = (n: number, size: string) => {
    const node = tree?.versions.get(n);
    const on = sel?.kind === "version" && sel.ref === n;
    return (
      <button
        key={`v${n}`}
        type="button"
        onClick={() => setSel({ kind: "version", ref: n })}
        title={node?.note ?? `v${n}`}
        data-testid={`flow-v${n}`}
        className={`relative shrink-0 overflow-hidden rounded ${size} ${ring(on)}`}
      >
        {thumb(n)}
        <span className="absolute bottom-0 left-0 bg-black/70 px-1 text-[10px] text-neutral-100">v{n}</span>
        {star(!!node?.final)}
        {node?.favorite && <span className="absolute left-0.5 top-0.5 text-[10px] text-sky-300">♥</span>}
      </button>
    );
  };

  const clipChip = (n: Extract<BranchNode, { kind: "clip" }>, size: string) => {
    const on = sel?.kind === "clip" && sel.ref === n.clip_id;
    return (
      <button
        key={`c${n.clip_id}`}
        type="button"
        onClick={() => setSel({ kind: "clip", ref: n.clip_id })}
        title={`${n.model ?? "video"} · ${n.duration ? n.duration.toFixed(1) : "?"} s`}
        data-testid={`flow-c${n.clip_id}`}
        className={`relative shrink-0 overflow-hidden rounded bg-neutral-900 ${size} ${ring(on)}`}
      >
        {n.parent != null ? thumb(n.parent) : null}
        <span className="absolute inset-0 flex items-center justify-center text-lg text-white drop-shadow">▶</span>
        <span className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 text-[10px] text-amber-200">
          {n.model ?? "video"}
        </span>
        {star(n.final)}
      </button>
    );
  };

  const finals = data?.finals ?? [];

  return (
    <div data-testid="flow-viewer" className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-sm font-medium">{photoId} · flusso</span>
        <span className="flex-1" />
        {sel && (
          <button
            type="button"
            data-testid="toggle-final"
            onClick={toggleFinal}
            className={`rounded px-3 py-1 text-sm ${
              isFinal(sel.kind, sel.ref)
                ? "bg-amber-500 text-black"
                : "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
            }`}
          >
            {isFinal(sel.kind, sel.ref) ? "★ Foglia finale" : "☆ Segna come finale"}
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
          Chiudi ✕
        </button>
      </header>

      {error && <p className="px-3 py-1 text-xs text-rose-300">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-h-0 flex-[3] overflow-y-auto p-3 lg:flex-1">
          <div className="mx-auto max-w-md space-y-2">
            {/* La key azzera zoom, tempo e velocita': passando a un altro video lo stato del precedente non vale. */}
            {selClip && <ClipItem key={selClip.id} clip={selClip} onChanged={onClipsChanged} />}
            {selVersionNode && (
              <div className="space-y-2">
                <img
                  src={genUrl(photoId, selVersionNode.version_number)}
                  alt={`v${selVersionNode.version_number}`}
                  className="max-h-[70vh] w-full rounded bg-black object-contain"
                />
                <p className="text-xs text-neutral-400">
                  v{selVersionNode.version_number}
                  {selVersionNode.note ? ` · ${selVersionNode.note}` : ""}
                </p>
                {onPickVersion && (
                  <button
                    type="button"
                    onClick={() => {
                      onPickVersion(selVersionNode.version_number);
                      onClose();
                    }}
                    className="rounded bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700"
                  >
                    Apri nell'editor
                  </button>
                )}
              </div>
            )}
            {!sel && <p className="text-sm text-neutral-400">Scegli una versione o un video dall'albero.</p>}
          </div>
        </main>

        <aside className="min-h-0 flex-[2] overflow-y-auto border-t border-neutral-800 p-3 lg:w-[380px] lg:flex-none lg:border-l lg:border-t-0">
          <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Foglie finali · {finals.length}</h3>
          {finals.length === 0 ? (
            <p className="mb-3 text-xs text-neutral-500">Nessuna ancora. Apri una cosa e segnala «finale».</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2" data-testid="finals">
              {finals.map((k) => {
                const id = Number(k.slice(1));
                if (k.startsWith("v")) return versionChip(id, "h-20 w-14");
                const node = data?.nodes.find((x) => x.kind === "clip" && x.clip_id === id);
                return node && node.kind === "clip" ? clipChip(node, "h-20 w-14") : null;
              })}
            </div>
          )}

          {(tree?.clipsBy.get(null) ?? []).length > 0 && (
            <>
              <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Senza versione (riferimenti)</h3>
              <div className="mb-3 flex flex-wrap gap-2" data-testid="flow-orphans">
                {(tree?.clipsBy.get(null) ?? []).map((c) => clipChip(c, "h-20 w-14"))}
              </div>
            </>
          )}

          <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Rami</h3>
          {!tree && !error && <p className="text-xs text-neutral-500">Carico…</p>}
          {tree && chain.length === 0 && (
            <p className="text-xs text-neutral-500">
              Le versioni di questa foto non hanno ancora una parentela dichiarata.
            </p>
          )}
          <ol className="space-y-1.5" data-testid="flow-chain">
            {chain.map((n, i) => {
              const next = chain[i + 1] ?? null;
              const others = (tree?.kids.get(n) ?? []).filter((k) => k.version_number !== next);
              const vids = tree?.clipsBy.get(n) ?? [];
              return (
                <li key={n} className="flex items-center gap-2 border-l-2 border-neutral-800 pl-2">
                  {versionChip(n, "h-14 w-10")}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                    {others.map((k) => versionChip(k.version_number, "h-12 w-9 opacity-80"))}
                    {vids.map((c) => clipChip(c, "h-12 w-9"))}
                    {others.length + vids.length === 0 && (
                      <span className="truncate text-[11px] text-neutral-600">
                        {tree?.versions.get(n)?.note?.slice(0, 60) ?? ""}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
