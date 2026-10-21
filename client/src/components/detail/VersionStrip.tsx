import { useEffect, useRef } from "react";
import { thumbGenUrl, type Version } from "../../api";

/** Un ritocco sta sotto la sua principale (`parent_version_id`); il resto e' una generazione. */
export function isRetouch(v: Version): boolean {
  return v.parent_version_id != null;
}

/** «v364 · r1» per un ritocco, «v364» per una principale. */
export function versionLabel(v: Version, versions: Version[]): string {
  if (v.parent_version_id == null) return `v${v.version_number}`;
  const parent = versions.find((x) => x.id === v.parent_version_id);
  return parent ? `v${parent.version_number} · r${v.retouch_number ?? "?"}` : `v${v.version_number}`;
}

/**
 * Pellicola delle versioni sotto l'anteprima: solo le principali, la piu'
 * vecchia a sinistra. I ritocchi della selezionata stanno in una seconda riga
 * sotto (r1, r2…), con «originale» per tornare alla principale. I `?v=`
 * continuano a puntare al numero globale, quindi un ritocco si apre lo stesso.
 */
export function VersionStrip({
  photoId,
  versions,
  current,
  favoriteVersionId,
  onSelect,
}: {
  photoId: string;
  versions: Version[];
  current: number;
  favoriteVersionId: number | null;
  onSelect: (idx: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const shown = versions[current];
  // La principale della selezionata: e' lei che si accende nella prima riga anche
  // quando si guarda un suo ritocco.
  const rootId = shown ? (shown.parent_version_id ?? shown.id) : null;
  const retouchesOf = (id: number) =>
    versions
      .map((v, idx) => ({ v, idx }))
      .filter(({ v }) => v.parent_version_id === id)
      .sort((a, b) => (a.v.retouch_number ?? 0) - (b.v.retouch_number ?? 0));
  const rootRetouches = rootId != null ? retouchesOf(rootId) : [];

  // Tiene la selezionata dentro la striscia. Niente scrollIntoView: su WebKit
  // trascina anche i contenitori sopra, e l'editor e' a tutto schermo.
  useEffect(() => {
    const box = scrollerRef.current;
    const el = selectedRef.current;
    if (!box || !el) return;
    // La striscia e' `relative`: offsetLeft e' gia' misurato da lei.
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left - 8;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8;
  }, [rootId, versions.length]);

  if (versions.length === 0) return null;

  const rootIdx = versions.findIndex((v) => v.id === rootId);
  const root = versions[rootIdx];

  return (
    <div className="shrink-0 bg-neutral-950 border-t border-neutral-800">
      <div
        ref={scrollerRef}
        data-testid="version-strip"
        className="relative flex gap-1.5 overflow-x-auto px-2 py-1.5"
      >
        {versions.map((v, idx) => {
          if (isRetouch(v)) return null;
          const selected = v.id === rootId;
          const favorite = v.id === favoriteVersionId;
          const kids = retouchesOf(v.id);
          const favoriteKid = kids.find(({ v: k }) => k.id === favoriteVersionId);
          return (
            <button
              key={v.id}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onSelect(idx)}
              data-version={v.version_number}
              data-selected={selected || undefined}
              aria-label={`versione ${v.version_number}`}
              aria-current={(selected && shown?.id === v.id) || undefined}
              title={
                `v${v.version_number}${favorite ? " · preferita" : ""}` +
                (kids.length ? ` · ${kids.length} ritocchi` : "") +
                (favoriteKid ? ` · preferito r${favoriteKid.v.retouch_number}` : "")
              }
              className={
                "relative shrink-0 w-14 h-14 rounded overflow-hidden bg-black border-2 " +
                (selected ? "border-sky-400" : "border-transparent opacity-70 hover:opacity-100")
              }
            >
              <img
                src={thumbGenUrl(photoId, v.version_number, 160)}
                alt=""
                loading="lazy"
                draggable={false}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-0 left-0 px-1 text-[10px] leading-4 tabular-nums bg-black/70 text-neutral-100">
                v{v.version_number}
              </span>
              {favorite && (
                <span className="absolute top-0 right-0 px-0.5 text-[11px] leading-4 text-amber-300 bg-black/60" aria-label="preferita">
                  ★
                </span>
              )}
              {kids.length > 0 && (
                <span
                  data-testid="retouch-count"
                  className={
                    "absolute top-0 left-0 px-1 text-[9px] leading-3 tabular-nums " +
                    (favoriteKid ? "bg-amber-500 text-black" : "bg-fuchsia-700/90 text-white")
                  }
                >
                  +{kids.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {rootRetouches.length > 0 && root && (
        <div
          data-testid="retouch-strip"
          className="flex items-center gap-1.5 overflow-x-auto px-2 pb-1.5"
        >
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-500 pr-1">
            ritocchi di v{root.version_number}
          </span>
          <RetouchChip
            label="originale"
            selected={shown?.id === rootId}
            favorite={rootId === favoriteVersionId}
            onClick={() => onSelect(rootIdx)}
            version={root.version_number}
          />
          {rootRetouches.map(({ v, idx }) => (
            <RetouchChip
              key={v.id}
              label={`r${v.retouch_number ?? "?"}`}
              selected={shown?.id === v.id}
              favorite={v.id === favoriteVersionId}
              onClick={() => onSelect(idx)}
              version={v.version_number}
              thumb={thumbGenUrl(photoId, v.version_number, 160)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RetouchChip({
  label,
  selected,
  favorite,
  onClick,
  version,
  thumb,
}: {
  label: string;
  selected: boolean;
  favorite: boolean;
  onClick: () => void;
  version: number;
  thumb?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-version={version}
      data-selected={selected || undefined}
      aria-current={selected || undefined}
      aria-label={`${label} (v${version})`}
      title={`${label} · file v${version}${favorite ? " · preferita" : ""}`}
      className={
        "relative shrink-0 flex items-center gap-1 h-9 pr-2 rounded border-2 text-xs tabular-nums " +
        (thumb ? "pl-0" : "pl-2") +
        " " +
        (selected
          ? "border-sky-400 bg-neutral-800 text-white"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500")
      }
    >
      {thumb && <img src={thumb} alt="" loading="lazy" draggable={false} className="h-full aspect-square object-cover rounded-l-sm" />}
      {label}
      {favorite && <span className="text-amber-300" aria-label="preferita">★</span>}
    </button>
  );
}
