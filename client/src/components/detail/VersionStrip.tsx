import { useEffect, useRef, useState } from "react";
import { thumbGenUrl, type Version } from "../../api";

// Ritocco = un lavoro a mano sopra un'altra versione, non una generazione
// pulita: un file fatto in locale (`provider: local`) oppure un lineage che
// dichiara la `materia` da cui parte (le zanne innestate hanno provider chatgpt
// ma partono dalla v68). La ricetta da sola non basta: anche le generazioni
// normali ne scrivono una.
export function isRetouch(v: Version): boolean {
  if (v.provider === "local") return true;
  if (!v.lineage) return false;
  try {
    const l = JSON.parse(v.lineage) as { materia?: unknown };
    return l.materia != null;
  } catch {
    return false;
  }
}

/**
 * Pellicola delle versioni sotto l'anteprima: la piu' vecchia a sinistra, la
 * piu' nuova a destra, sempre visibile a ogni larghezza (il carosello sotto i
 * 1024 px sta dentro una scheda chiusa).
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
  // Le versioni ritoccate stanno dietro un tasto: la striscia di default mostra solo
  // quelle generate dall'AI, altrimenti le due famiglie si confondono. Quella aperta
  // resta sempre visibile, cosi' "partenza" e i link ?v= non spariscono dalla vista.
  const [mostraRitocchi, setMostraRitocchi] = useState(false);
  const nRitocchi = versions.filter(isRetouch).length;

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
  }, [current, versions.length, mostraRitocchi]);

  if (versions.length === 0) return null;

  return (
    <div
      ref={scrollerRef}
      data-testid="version-strip"
      className="relative shrink-0 flex gap-1.5 overflow-x-auto px-2 py-1.5 bg-neutral-950 border-t border-neutral-800"
    >
      {nRitocchi > 0 && (
        <button
          type="button"
          onClick={() => setMostraRitocchi((x) => !x)}
          aria-pressed={mostraRitocchi}
          data-testid="toggle-ritocchi"
          title={mostraRitocchi ? "Nascondi i ritocchi" : "Mostra anche i ritocchi"}
          // Lo sticky si ferma al padding della striscia (px-2): l'ombra piena del fondo copre
          // quegli 8 px, sennò le miniature che scorrono sotto spuntano a sinistra del tasto.
          className={
            "sticky left-0 z-10 shrink-0 w-14 h-14 rounded border-2 text-[10px] leading-tight uppercase tracking-wide shadow-[-0.5rem_0_0_0.25rem_#0a0a0a] " +
            (mostraRitocchi
              ? "border-fuchsia-500 bg-fuchsia-700 text-white"
              : "border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-fuchsia-500")
          }
        >
          ritocchi
          <br />
          <span className="tabular-nums text-xs">{nRitocchi}</span>
        </button>
      )}
      {versions.map((v, idx) => {
        const selected = idx === current;
        const favorite = v.id === favoriteVersionId;
        const retouch = isRetouch(v);
        if (retouch && !selected && !mostraRitocchi) return null;
        return (
          <button
            key={v.id}
            ref={selected ? selectedRef : undefined}
            type="button"
            onClick={() => onSelect(idx)}
            data-version={v.version_number}
            data-selected={selected || undefined}
            aria-label={`versione ${v.version_number}`}
            aria-current={selected || undefined}
            title={`v${v.version_number}${favorite ? " · preferita" : ""}${retouch ? " · ritocco" : ""}`}
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
            {retouch && (
              <span className="absolute top-0 left-0 px-1 text-[8px] leading-3 uppercase tracking-wide bg-fuchsia-700/90 text-white">
                ritocco
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
