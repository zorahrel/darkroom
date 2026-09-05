import { useCallback } from "react";

/**
 * The divider between two panels.
 *
 * The good widths depend on the screen and on what you are doing: somebody
 * looking for a shot wants a wide library, somebody comparing alternatives
 * wants a wide inspector, and on a laptop there is no room for both. So it is
 * dragged, and the size stays in the browser — it is a preference of whoever is
 * watching, not a property of the cut.
 */

type Props = {
  /** "col" separa due colonne (si trascina in orizzontale), "riga" due fasce. */
  toward: "col" | "row";
  /** Il valore corrente in pixel. */
  value: number;
  /** What it is worth after dragging by `d` pixels: the caller decides the
   *  sign, because a handle to the right of a panel widens it by going right
   *  and the one on the left does the opposite. */
  compute: (value0: number, d: number) => number;
  onChange: (v: number) => void;
  onEnd?: (v: number) => void;
  title?: string;
};

export default function Handle({ toward, value, compute, onChange, onEnd, title }: Props) {
  const giu = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const p0 = toward === "col" ? e.clientX : e.clientY;
    const v0 = value;
    let last = v0;
    const move = (ev: PointerEvent) => {
      const p = toward === "col" ? ev.clientX : ev.clientY;
      last = compute(v0, p - p0);
      onChange(last);
    };
    const su = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", su);
      onEnd?.(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", su);
  }, [toward, value, compute, onChange, onEnd]);

  const col = toward === "col";
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
