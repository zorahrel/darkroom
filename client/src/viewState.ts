import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The state of a view that survives a reload and can be pasted to somebody.
 *
 * The grid already did it by hand (URL as the source of truth, localStorage as
 * the fallback when the URL is bare), the tree did not: every time you came
 * back to the tree the reference toggle was off and the measurement had to be
 * redone. They were two different ways of treating the same thing in the same
 * application, so the rule is now written once.
 *
 * Why the URL before localStorage: a filter is part of *what you are looking
 * at*. If it lives only in the browser, a link sent to somebody else opens a
 * different page from the one you had in front of you.
 *
 * The default value never ends up in the URL: an address bar full of
 * `?overlay=0&mode=over` when everything is as just-opened is noise that hides
 * the parameters that really matter.
 */

/**
 * A write queue shared between all uses of the hook.
 *
 * `null` as a value means «remove this key»: it is what is needed to keep the
 * default values out of the URL.
 */
const held = new Map<string, string | null>();
let flushProgrammato = false;

function enqueue(
  key: string,
  value: string | null,
  applica: (fn: (prev: URLSearchParams) => URLSearchParams, opt: { replace: boolean }) => void,
) {
  held.set(key, value);
  if (flushProgrammato) return;
  flushProgrammato = true;
  // A microtask, not a timer: it applies at the end of this render pass,
  // before the browser paints, so the URL does not "flash".
  queueMicrotask(() => {
    flushProgrammato = false;
    if (held.size === 0) return;
    const edits = [...held.entries()];
    held.clear();
    applica(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of edits) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  });
}

export function useViewState<T extends string | number | boolean>(
  key: string,
  fallback: T,
  options: {
    /** From string to value. Returns `null` if the string is not acceptable:
     *  a `?zoom=banana` must fall back to the default, not break the view. */
    read: (s: string) => T | null;
    /** Under what name to remember it between sessions. Absent = it is not
     *  remembered: right for the things tied to *this* list and not to the way
     *  you work (a selection, a search). */
    memory?: string;
  },
): [T, (v: T) => void] {
  const { read, memory } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  // Only on the first render: after that, the source of truth is React's
  // state. Re-reading the URL every round would set two writes racing.
  const [value, setValue] = useState<T>(() => {
    const daUrl = searchParams.get(key);
    if (daUrl !== null) {
      const v = read(daUrl);
      if (v !== null) return v;
    }
    if (memory) {
      const saved = localStorage.getItem(memory);
      if (saved !== null) {
        const v = read(saved);
        if (v !== null) return v;
      }
    }
    return fallback;
  });

  // Writes from several hooks in the same instant must be JOINED before the
  // URL is touched.
  //
  // Each one used to write on its own with the functional update, which looks
  // safe and is not: React Router propagates the new location asynchronously,
  // so two hooks waking in the same cycle both receive the SAME `prev` and the
  // second erases the first one's change. Observed: opening
  // `?zoom=180&group=scene`, both values are defaults and should be removed,
  // but only one disappeared.
  //
  // Here the changes accumulate in a shared queue and are applied all at once
  // at the end of the pass.
  const setParams = useRef(setSearchParams);
  setParams.current = setSearchParams;

  useEffect(() => {
    if (memory) localStorage.setItem(memory, String(value));
    enqueue(key, value === fallback ? null : String(value), setParams.current);
    // `fallback` and `key` are constants from the caller's point of view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const change = useCallback((v: T) => setValue(v), []);
  return [value, change];
}

/** Ready-made readers, so each view does not rewrite its own parser. */
export const readBool = (s: string): boolean | null =>
  s === "1" || s === "true" ? true : s === "0" || s === "false" ? false : null;

export const readOneOf =
  <T extends string>(ammessi: readonly T[]) =>
  (s: string): T | null =>
    (ammessi as readonly string[]).includes(s) ? (s as T) : null;

export const readNumber =
  (min: number, max: number) =>
  (s: string): number | null => {
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
