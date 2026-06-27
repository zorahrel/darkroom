import { useCallback, useEffect, useRef, useState } from "react";

export default function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "RAW",
  afterLabel = "EDIT",
}: {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50); // % from left where the divider sits
  const [dragging, setDragging] = useState(false);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, x)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => updateFromClientX(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, updateFromClientX]);

  return (
    <div
      ref={wrapRef}
      onPointerDown={(e) => {
        setDragging(true);
        updateFromClientX(e.clientX);
      }}
      className="relative w-full aspect-square rounded-lg overflow-hidden bg-black border border-neutral-800 select-none touch-none cursor-ew-resize"
    >
      {/* AFTER (bottom layer, full) */}
      <img
        src={afterSrc}
        alt={afterLabel}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        draggable={false}
      />
      {/* BEFORE (top layer, clipped to left side based on pos) */}
      <img
        src={beforeSrc}
        alt={beforeLabel}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
        draggable={false}
      />

      {/* Divider line */}
      <div
        className="absolute top-0 bottom-0 w-px bg-white/90 pointer-events-none"
        style={{ left: `${pos}%` }}
      />
      {/* Handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white text-neutral-900 flex items-center justify-center shadow-lg text-xs font-bold pointer-events-none"
        style={{ left: `${pos}%` }}
      >
        ⇆
      </div>

      {/* Labels */}
      <span className="absolute top-2 left-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-neutral-200 pointer-events-none">
        {beforeLabel}
      </span>
      <span className="absolute top-2 right-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-neutral-200 pointer-events-none">
        {afterLabel}
      </span>
    </div>
  );
}
