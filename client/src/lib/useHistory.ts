import { useCallback, useRef, useState } from "react";

// Undo/redo state container. `set` behaves like a normal setter (value or
// updater) but records history. Rapid successive edits within `coalesceMs`
// collapse into a single history entry, so dragging a slider is ONE undo step
// instead of one-per-pixel. Structural edits spaced further apart stay distinct.
export type History<T> = {
  state: T;
  set: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
};

type Stacks<T> = { past: T[]; present: T; future: T[] };

export function useHistory<T>(initial: T, coalesceMs = 450): History<T> {
  const [h, setH] = useState<Stacks<T>>({ past: [], present: initial, future: [] });
  const lastAt = useRef(0);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const now = Date.now();
      const coalesce = now - lastAt.current < coalesceMs;
      lastAt.current = now;
      setH((cur) => {
        const value =
          typeof next === "function" ? (next as (p: T) => T)(cur.present) : next;
        // No-op edits never touch history.
        if (JSON.stringify(value) === JSON.stringify(cur.present)) return cur;
        // Within the coalesce window (and past a first commit): replace the
        // present in place rather than stacking another undo step.
        if (coalesce && cur.past.length > 0) {
          return { past: cur.past, present: value, future: [] };
        }
        return { past: [...cur.past, cur.present], present: value, future: [] };
      });
    },
    [coalesceMs],
  );

  const undo = useCallback(() => {
    lastAt.current = 0; // the next edit after an undo always starts a fresh step
    setH((cur) => {
      if (cur.past.length === 0) return cur;
      const prev = cur.past[cur.past.length - 1] as T;
      return {
        past: cur.past.slice(0, -1),
        present: prev,
        future: [cur.present, ...cur.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    lastAt.current = 0;
    setH((cur) => {
      if (cur.future.length === 0) return cur;
      const nextPresent = cur.future[0] as T;
      return {
        past: [...cur.past, cur.present],
        present: nextPresent,
        future: cur.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback((value: T) => {
    lastAt.current = 0;
    setH({ past: [], present: value, future: [] });
  }, []);

  return {
    state: h.present,
    set,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
