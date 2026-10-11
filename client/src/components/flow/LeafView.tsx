import { genUrl, thumbRefUrl, type Clip } from "../../api";
import { ClipItem } from "../ClipsCard";
import NodeThumb, { type ViewProps } from "./NodeThumb";
import { ancestors, children, nodeOf, sisters, type Ref } from "./tree";

/**
 * La FOGLIA: un nodo al centro, con sopra da dove arriva e sotto cosa ne e' nato.
 *
 *   SOPRA   i riferimenti usati e la strada dai genitori (anche scartati: servono a capire)
 *   CENTRO  l'immagine o il video, con le sue sorelle subito sotto
 *   SOTTO   le versioni e i video nati da lei; se non ce n'e', lo dice: e' una foglia
 *
 * Cliccare un nodo qui lo porta al centro: si sale e si scende lungo l'albero restando sulla stessa pagina.
 */
export default function LeafView({
  photoId,
  flow,
  sel,
  onSelect,
  onOpenLeaf,
  clips,
  onClipsChanged,
  onGoBranch,
  onPickVersion,
  onClose,
}: ViewProps & {
  clips: Clip[];
  onClipsChanged: () => void | Promise<unknown>;
  onGoBranch: () => void;
  onPickVersion?: (n: number) => void;
  onClose: () => void;
}) {
  const node = sel ? nodeOf(flow, sel) : undefined;
  if (!sel || !node) return <p className="p-4 text-sm text-neutral-400">Scegli una versione o un video.</p>;

  const parentVersion = node.parent;
  const chain: number[] =
    node.kind === "version"
      ? ancestors(flow, node.version_number)
      : parentVersion != null
        ? [...ancestors(flow, parentVersion), parentVersion]
        : [];
  const near = chain.slice(-3);
  const farther = chain.length - near.length;
  const sis = sisters(flow, sel);
  const kids = sel.kind === "version" ? children(flow, sel.id) : { versions: [], clips: [] };
  const clip = sel.kind === "clip" ? (clips.find((c) => c.id === sel.id) ?? null) : null;
  const thumb = (r: Ref, size = "h-14") => (
    <NodeThumb key={`${r.kind}${r.id}`} photoId={photoId} flow={flow} r={r} sel={sel} onSelect={onSelect} onOpen={onOpenLeaf} size={size} />
  );
  const h = "mb-1 text-[11px] uppercase tracking-wide text-neutral-400";

  return (
    <div className="h-full overflow-y-auto overscroll-contain" data-testid="leaf-scroll">
    <div className="mx-auto max-w-md space-y-4 p-3 pb-10" data-testid="leaf-view">
      <section data-testid="leaf-origin">
        <h3 className={h}>Da dove arriva</h3>
        {node.kind === "version" && node.refs.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-xs text-neutral-500">Riferimenti usati</p>
            <div className="flex flex-wrap gap-2">
              {node.refs.map((f) => (
                <img
                  key={f}
                  src={thumbRefUrl(f, 160)}
                  alt={f}
                  title={f}
                  loading="lazy"
                  className="h-14 rounded object-cover ring-1 ring-neutral-700"
                />
              ))}
            </div>
          </div>
        )}
        {chain.length === 0 ? (
          <p className="text-xs text-neutral-500">
            {sel.kind === "clip" ? "Un video senza primo fotogramma: un riferimento." : "Nessun genitore dichiarato: questa è una radice."}
          </p>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {farther > 0 && (
              <button type="button" onClick={onGoBranch} className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700">
                ⋯ {farther} prima
              </button>
            )}
            {near.map((n) => (
              <span key={n} className="flex items-center gap-1.5">
                {thumb({ kind: "version", id: n })}
                <span className="text-neutral-600">›</span>
              </span>
            ))}
            <span className="shrink-0 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">questa</span>
          </div>
        )}
      </section>

      <section data-testid="leaf-center" className="space-y-2">
        {clip ? (
          <ClipItem key={clip.id} clip={clip} onChanged={onClipsChanged} />
        ) : node.kind === "version" ? (
          <>
            <img
              src={genUrl(photoId, node.version_number)}
              alt={`v${node.version_number}`}
              className="max-h-[62vh] w-full rounded bg-black object-contain"
            />
            <p className="text-xs text-neutral-400">
              v{node.version_number}
              {node.note ? ` · ${node.note}` : ""}
            </p>
            {onPickVersion && (
              <button
                type="button"
                onClick={() => {
                  onPickVersion(node.version_number);
                  onClose();
                }}
                className="rounded bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700"
              >
                Apri nell'editor
              </button>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-400">Video non più nell'archivio.</p>
        )}
        <div data-testid="leaf-sisters">
          <h3 className={h}>Sorelle · {sis.length}</h3>
          {sis.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nessuna: è l'unica nata da {parentVersion != null ? `v${parentVersion}` : "questa radice"}.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">{sis.map((r) => thumb(r))}</div>
          )}
        </div>
      </section>

      <section data-testid="leaf-below">
        <h3 className={h}>Cosa ne è nato · {kids.versions.length + kids.clips.length}</h3>
        {sel.kind === "clip" ? (
          <p className="text-xs text-neutral-500">Un video è sempre una foglia.</p>
        ) : kids.versions.length + kids.clips.length === 0 ? (
          <p className="text-xs text-neutral-500">Niente: è una foglia.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {kids.versions.map((v) => thumb({ kind: "version", id: v.version_number }))}
            {kids.clips.map((c) => thumb({ kind: "clip", id: c.clip_id }))}
          </div>
        )}
      </section>
    </div>
    </div>
  );
}
