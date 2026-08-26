import { useState, type ReactNode } from "react";

// Un accordion riusabile: header cliccabile (chevron + titolo + riepilogo live +
// badge di coda) che apre/chiude il corpo. Lo stato aperto è persistito su
// localStorage con `storageKey`, così ogni pipeline resta com'è stata lasciata.
// Il `summary` compare sempre da chiuso e, da aperto, solo su schermi ≥ sm — così
// su mobile l'header resta magro e da desktop hai comunque lo stato a colpo d'occhio.
export default function Accordion({
  title,
  summary,
  trailing,
  storageKey,
  defaultOpen = false,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  trailing?: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const v = localStorage.getItem(storageKey);
    return v === null ? defaultOpen : v === "1";
  });
  function toggle() {
    setOpen((o) => {
      const next = !o;
      localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-600"
      >
        <span
          className={`shrink-0 text-neutral-400 transition-transform motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ▶
        </span>
        {title}
        {summary != null && (
          <span
            className={`min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${
              open ? "hidden sm:flex" : "flex"
            }`}
          >
            {summary}
          </span>
        )}
        <div className="flex-1 min-w-[1rem]" />
        {trailing}
        <span className="shrink-0 text-xs text-neutral-400 group-hover:text-neutral-300">
          {open ? "chiudi" : "apri"}
        </span>
      </button>
      {open && <div className={bodyClassName ?? "mt-4"}>{children}</div>}
    </div>
  );
}
