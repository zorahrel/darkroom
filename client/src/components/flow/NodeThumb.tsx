import { thumbGenUrl } from "../../api";
import { children, nodeOf, sisters, type Flow, type Ref } from "./tree";

/**
 * La miniatura di un nodo, uguale in tutte e tre le viste.
 *
 * Dice a colpo d'occhio le cose che prima non si capivano: se ha sorelle (⑂N), se e' la scelta
 * finale (★), la favorita della galleria (♥) o una strada messa da parte (⊘, sbiadita).
 */
export default function NodeThumb({
  photoId,
  flow,
  r,
  sel,
  onSelect,
  onOpen,
  size = "h-14",
}: {
  photoId: string;
  flow: Flow;
  r: Ref;
  sel: Ref | null;
  onSelect: (r: Ref) => void;
  onOpen?: (r: Ref) => void;
  /** Un'altezza di Tailwind: la larghezza segue il formato 9:16. */
  size?: string;
}) {
  const node = nodeOf(flow, r);
  if (!node) return null;
  const on = !!sel && sel.kind === r.kind && sel.id === r.id;
  const nSis = sisters(flow, r).length;
  const nKids = r.kind === "version" ? children(flow, r.id).versions.length + children(flow, r.id).clips.length : 0;
  const discarded = node.discarded;
  const label = r.kind === "version" ? `v${r.id}` : (node.kind === "clip" ? (node.model ?? "video") : "video");
  const tip = [
    label,
    nSis > 0 ? `${nSis} sorell${nSis === 1 ? "a" : "e"}` : "nessuna sorella",
    r.kind === "version" ? (nKids ? `${nKids} figli` : "foglia") : null,
    node.final ? "finale" : null,
    discarded ? "scartata" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const frame = r.kind === "version" ? r.id : node.parent;

  return (
    <button
      type="button"
      onClick={() => onSelect(r)}
      onDoubleClick={() => onOpen?.(r)}
      title={tip}
      data-testid={`flow-${r.kind === "version" ? "v" : "c"}${r.id}`}
      className={`relative aspect-[9/16] shrink-0 overflow-hidden rounded bg-neutral-900 ${size} ${
        on ? "ring-2 ring-amber-400" : "ring-1 ring-neutral-700 hover:ring-neutral-400"
      } ${discarded ? "opacity-40 grayscale" : ""}`}
    >
      {frame != null ? (
        <img src={thumbGenUrl(photoId, frame, 160)} alt={label} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">rif.</span>
      )}
      {r.kind === "clip" && (
        <span className="absolute inset-0 flex items-center justify-center text-lg text-white drop-shadow">▶</span>
      )}
      <span className="absolute bottom-0 inset-x-0 truncate bg-black/70 px-0.5 text-center text-[9px] leading-[15px] tracking-tight tabular-nums text-neutral-100">
        {label}
      </span>
      {node.final && <span className="absolute right-0.5 top-0.5 text-amber-400 drop-shadow">★</span>}
      {node.kind === "version" && node.favorite && (
        <span className="absolute left-0.5 top-0.5 text-[10px] text-sky-300 drop-shadow">♥</span>
      )}
      {discarded && (
        <span className="absolute inset-0 flex items-center justify-center text-2xl text-rose-300">⊘</span>
      )}
      {/* Sopra l'etichetta, non accanto: su una miniatura 9:16 alta 56 px (31 di larghezza) le due
          cose in fondo si coprivano e restava leggibile solo «⑂17», uguale su ogni sorella. */}
      {nSis > 0 && (
        <span className="absolute bottom-[15px] right-0 rounded-l bg-amber-500 px-1 text-[10px] leading-[14px] font-semibold text-black">
          ⑂{nSis}
        </span>
      )}
    </button>
  );
}

export type ViewProps = {
  photoId: string;
  flow: Flow;
  sel: Ref | null;
  onSelect: (r: Ref) => void;
  /** Porta il nodo nella vista Foglia (doppio clic, o «Vedi foglia»). */
  onOpenLeaf: (r: Ref) => void;
};
