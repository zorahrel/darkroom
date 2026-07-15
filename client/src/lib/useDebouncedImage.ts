import { useEffect, useState } from "react";

// Debounce switching the displayed image to `src`, then preload it before
// swapping. Dragging a slider recomputes the graded URL on every tick; without
// this each tick would fire a server render and the <img> would flash blank
// mid-render. We coalesce to one request per idle gap and only show a frame once
// it has decoded. Returns the last fully-loaded src + a loading flag.
export function useDebouncedImage(src: string | null, delayMs = 150) {
  const [committed, setCommitted] = useState<string | null>(src);
  const [shown, setShown] = useState<string | null>(src);
  const [loading, setLoading] = useState(false);

  // src → committed (debounced)
  useEffect(() => {
    const t = window.setTimeout(() => setCommitted(src), delayMs);
    return () => clearTimeout(t);
  }, [src, delayMs]);

  // committed → shown (preload, then swap)
  useEffect(() => {
    if (!committed) {
      setShown(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setShown(committed);
        setLoading(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) setLoading(false);
    };
    img.src = committed;
    return () => {
      cancelled = true;
    };
  }, [committed]);

  return { shown, loading };
}
