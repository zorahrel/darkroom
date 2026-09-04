import { useCallback } from "react";

/**
 * Il separatore fra due pannelli.
 *
 * Le larghezze buone dipendono dallo schermo e da cosa si sta facendo: chi
 * cerca una ripresa vuole la libreria larga, chi confronta le alternative vuole
 * l'ispettore largo, e su un portatile non c'è spazio per entrambi. Quindi si
 * trascina, e la misura resta nel browser — è una preferenza di chi guarda, non
 * una proprietà del montaggio.
 */

type Props = {
  /** "col" separa due colonne (si trascina in orizzontale), "riga" due fasce. */
  verso: "col" | "riga";
  /** Il valore corrente in pixel. */
  value: number;
  /** Quanto vale dopo aver trascinato di `d` pixel: il segno lo decide chi
   *  chiama, perché una maniglia a destra di un pannello lo allarga andando a
   *  destra e quella a sinistra fa il contrario. */
  calcola: (value0: number, d: number) => number;
  onChange: (v: number) => void;
  onEnd?: (v: number) => void;
  title?: string;
};

export default function Handle({ verso, value, calcola, onChange, onEnd, title }: Props) {
  const giu = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const p0 = verso === "col" ? e.clientX : e.clientY;
    const v0 = value;
    let last = v0;
    const move = (ev: PointerEvent) => {
      const p = verso === "col" ? ev.clientX : ev.clientY;
      last = calcola(v0, p - p0);
      onChange(last);
    };
    const su = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", su);
      onEnd?.(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", su);
  }, [verso, value, calcola, onChange, onEnd]);

  const col = verso === "col";
  return (
    <div
      onPointerDown={giu}
      title={title}
      className={`shrink-0 group bg-neutral-900 hover:bg-neutral-600 transition-colors
                  flex items-center justify-center
                  ${col ? "w-[5px] cursor-col-resize" : "h-[6px] cursor-row-resize"}`}>
      <div className={`bg-neutral-700 group-hover:bg-neutral-300 rounded-full
                       ${col ? "w-[2px] h-8" : "h-[2px] w-10"}`} />
    </div>
  );
}
