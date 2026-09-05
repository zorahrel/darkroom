import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Search as SearchIcon } from "lucide-react";

/**
 * The app's interface pieces.
 *
 * Two reasons to keep them in one place.
 *
 * The first is the system's shell: native `<select>` and `<input>` bring in a
 * menu drawn by macOS, a ring of blue fire and a typeface that is not the
 * page's. Drawing them yourself means redoing what the native ones gave for
 * free, though, and that is the part usually forgotten: keyboard (arrows,
 * enter, esc, Home/End), closing on an outside click, role and state for anyone
 * reading the screen, and focus returning where it was.
 *
 * The second is hierarchy. A button says, before it is even read, how much it
 * matters: if every action draws itself, "open" and "delete forever" end up
 * with the same weight, and whoever looks has to read to find out which of the
 * two ruins their day. Here the weights are four and they are declared:
 *
 *   primary   the action that view exists for. Filled. One per view.
 *   normal    an ordinary action. Outlined.
 *   quiet     utility: it is there, but it does not ask for attention. Text only.
 *   danger    destroys something. **Never shown first**: it is the second face
 *             of `<Confirm>`, not a button you leave lying around.
 */

// ---- sizes ----------------------------------------------------------------
// Three sizes, not fourteen. `s` for the dense bars of an editor, `m` for
// panels, `l` for page actions.
const SIZE = {
  s: "text-[10.5px] px-1.5 py-0.5 rounded-sm gap-1",
  m: "text-[12px] px-2 py-1 rounded gap-1.5",
  l: "text-[13px] px-3 py-1.5 rounded gap-2",
} as const;

export type Size = keyof typeof SIZE;
export type Weight = "primario" | "normale" | "quieto" | "pericolo";

const WEIGHT: Record<Weight, string> = {
  primario: "border-transparent bg-neutral-100 text-neutral-900 hover:bg-white font-medium",
  normale: "border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:text-neutral-100",
  quieto: "border-transparent text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70",
  pericolo: "border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50",
};

export function Bott({
  children, onClick, active, weight = "normale", size = "m",
  title, disabled, className = "", type = "button",
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  /** A switch's on state: visible without having to read it. */
  active?: boolean;
  weight?: Weight;
  size?: Size;
  title?: string;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const style = disabled
    ? "border-neutral-800 text-neutral-400/50 cursor-not-allowed"
    : active
      ? "border-neutral-400 bg-neutral-800 text-neutral-100"
      : WEIGHT[weight];
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center justify-center border whitespace-nowrap
                  transition-colors focus-visible:outline focus-visible:outline-1
                  focus-visible:outline-offset-1 focus-visible:outline-neutral-300
                  ${SIZE[size]} ${style} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * An action that destroys something.
 *
 * The first touch does nothing: it opens the question. The red button exists
 * only inside the question, and the way out is always beside it. So the
 * dangerous thing does not sit still on screen looking clickable by accident,
 * and whoever sees it sees it together with what actually happens.
 */
export function Confirm({
  children, question, confirm, onConfirm, size = "m", title, className = "",
}: {
  /** Il richiamo, sempre quieto. */
  children: React.ReactNode;
  /** What happens, said in full. */
  question: string;
  /** The red button's text: a verb, not "ok". */
  confirm: string;
  onConfirm: () => void;
  size?: Size;
  title?: string;
  className?: string;
}) {
  const [chiesto, setChiesto] = useState(false);
  useEffect(() => {
    if (!chiesto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setChiesto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [chiesto]);

  if (!chiesto) {
    return (
      <Bott weight="quieto" size={size} title={title} className={className}
            onClick={() => setChiesto(true)}>
        {children}
      </Bott>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[11px] text-neutral-300">{question}</span>
      <Bott weight="pericolo" size={size} onClick={() => { setChiesto(false); onConfirm(); }}>
        {confirm}
      </Bott>
      <Bott weight="quieto" size={size} onClick={() => setChiesto(false)}>lascia stare</Bott>
    </span>
  );
}

/** A status label. It is not clicked and must not look like it could be. */
/**
 * The keyboard shortcut, printed INSIDE the key that runs it.
 *
 * It used to be in a legend beside it («← discard · → keep · ↑ note»). A legend
 * is read once and then becomes furniture: it is always in the same place, it
 * never changes, and the eye stops seeing it exactly when it would be needed —
 * at the moment of hesitating over a key. On the key you look at it every time
 * you look at the key, and whoever learns it stops using the key by themselves.
 */
export function Shortcut({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="px-1 py-px rounded-[3px] border border-current/30 bg-current/10
                 text-[9.5px] leading-none font-medium opacity-70 tabular-nums"
    >
      {children}
    </kbd>
  );
}

/** An action key with its shortcut printed on it. */
export function VerdictButton({
  onClick,
  key,
  className = "",
  children,
}: {
  onClick: () => void;
  key: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-sm border text-[13px] inline-flex items-center gap-2 ${className}`}
    >
      {children}
      <Shortcut>{key}</Shortcut>
    </button>
  );
}

export function Badge({
  children, tone = "neutral", title, className = "",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "waiting" | "bad" | "info";
  title?: string;
  className?: string;
}) {
  const t = {
    neutral: "border-neutral-700 text-neutral-300",
    good: "border-emerald-800 text-emerald-300 bg-emerald-950/40",
    waiting: "border-amber-800 text-amber-200 bg-amber-950/40",
    bad: "border-rose-900 text-rose-200 bg-rose-950/40",
    info: "border-sky-800 text-sky-200 bg-sky-950/40",
  }[tone];
  return (
    <span title={title}
          className={`inline-flex items-center gap-1 border rounded-sm px-1.5 py-[1px]
                      text-[10.5px] whitespace-nowrap ${t} ${className}`}>
      {children}
    </span>
  );
}

/** A switch: on/off reads from the shape, not from the word. */
export function Toggle({
  on, onChange, onText, offText, title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  onText: string;
  offText: string;
  title?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title}
            onClick={() => onChange(!on)}
            className="inline-flex items-center gap-1.5 text-[11px] group">
      <span className={`w-6 h-3.5 rounded-full border transition-colors relative shrink-0 ${
        on ? "bg-emerald-800/70 border-emerald-600" : "bg-neutral-800 border-neutral-600"}`}>
        <span className={`absolute top-[1px] w-[10px] h-[10px] rounded-full transition-all ${
          on ? "left-[12px] bg-emerald-300" : "left-[1px] bg-neutral-400"}`} />
      </span>
      <span className={on ? "text-neutral-200" : "text-neutral-400"}>
        {on ? onText : offText}
      </span>
    </button>
  );
}

/** A page's heading: a title and, below it, what you do here. */
export function Header({
  title, below, children,
}: { title: string; below?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div className="min-w-0 space-y-0.5">
        <h1 className="text-[17px] font-semibold tracking-tight leading-tight">{title}</h1>
        {below && <p className="text-[12px] text-neutral-400 leading-snug">{below}</p>}
      </div>
      {children && <div className="ml-auto flex items-center gap-1.5">{children}</div>}
    </div>
  );
}

// ---- campi ----------------------------------------------------------------

/** A drop-down menu. The value is a string; entries can have a label
 *  different from the value and a note on the right. */
export function Choose<T extends string>({
  value, items, onChange, width = 120, title, size = "s",
}: {
  value: T;
  /** `group` puts a title row before the entry: needed when the list is long
   *  and divided by family (the LUTs, say). */
  items: { v: T; text: string; note?: string; group?: string }[];
  onChange: (v: T) => void;
  width?: number;
  title?: string;
  size?: Size;
}) {
  const [open, setOpen] = useState(false);
  const [evidenziato, setEvidenziato] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const pick = items.find((x) => x.v === value);
  const t = size === "s" ? "text-[10.5px] px-1.5 py-0.5" : "text-[12px] px-2 py-1";

  useEffect(() => {
    if (!open) return;
    setEvidenziato(Math.max(0, items.findIndex((x) => x.v === value)));
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open, items, value]);

  const keys = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setEvidenziato((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setEvidenziato((i) => Math.max(0, i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setEvidenziato(0); }
    else if (e.key === "End") { e.preventDefault(); setEvidenziato(items.length - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const v = items[evidenziato];
      if (v) { onChange(v.v); setOpen(false); }
    }
  };

  return (
    <div ref={box} className="relative" style={{ width: width }}>
      <button
        type="button" title={title} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((a) => !a)} onKeyDown={keys}
        className={`w-full flex items-center gap-1 rounded-sm border border-neutral-700
                    bg-neutral-950 text-neutral-200 text-left ${t}
                    hover:border-neutral-500 focus:outline-none focus:border-neutral-300`}>
        <span className="truncate flex-1">{pick?.text ?? value}</span>
        <span className="text-neutral-400 text-[8px] leading-none">▾</span>
      </button>
      {open && (
        <ul role="listbox" id={id}
            className="absolute z-50 mt-0.5 w-full max-h-[46vh] overflow-y-auto bg-neutral-950
                       border border-neutral-700 rounded-sm shadow-2xl py-0.5">
          {items.map((x, i) => (
            <li key={x.v} role="option" aria-selected={x.v === value}>
              {x.group && x.group !== items[i - 1]?.group && (
                <div className="px-1.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-neutral-400">
                  {x.group}
                </div>
              )}
              <button
                type="button"
                onPointerEnter={() => setEvidenziato(i)}
                onClick={() => { onChange(x.v); setOpen(false); }}
                className={`w-full flex items-baseline gap-2 px-1.5 py-1 text-left text-[10.5px]
                            ${i === evidenziato ? "bg-neutral-800 text-neutral-100" : "text-neutral-300"}`}>
                <span className="truncate flex-1">{x.text}</span>
                {x.note && <span className="text-neutral-400 tabular-nums shrink-0">{x.note}</span>}
                {x.v === value && <span className="text-emerald-400 shrink-0">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A text field without the system's shell. `onEnter`/`onEsc` are the two
 *  keys that matter in an editor. */
export function Field({
  value, onChange, placeholder, onInvio, onEsc, autoFocus, size = "s", className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onInvio?: () => void;
  onEsc?: () => void;
  autoFocus?: boolean;
  size?: Size;
  className?: string;
}) {
  const t = size === "s" ? "text-[10.5px] px-1.5 py-1" : "text-[12px] px-2 py-1.5";
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={(e) => {
        // The page listens for single letters (space, m, z…): while typing, those
        // are text, not commands.
        e.stopPropagation();
        if (e.key === "Enter") onInvio?.();
        if (e.key === "Escape") onEsc?.();
      }}
      className={`appearance-none bg-neutral-950 border border-neutral-700 rounded-sm
                  text-neutral-100 placeholder:text-neutral-400 outline-none
                  focus:border-neutral-300 ${t} ${className}`}
    />
  );
}

/** A text area, same treatment as the field. */
export function Area({
  value, onChange, placeholder, onEsc, onInvia, autoFocus, className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEsc?: () => void;
  /** ⌘enter: a newline has to be possible, so plain enter is not it. */
  onInvia?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <textarea
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onEsc?.();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onInvia?.();
      }}
      className={`appearance-none w-full bg-neutral-950 border border-neutral-700 rounded-sm p-2
                  text-neutral-100 placeholder:text-neutral-400 outline-none resize-none
                  focus:border-neutral-300 ${className}`}
    />
  );
}

/** A number with its steps: the arrows change it, and the system's double
 *  arrow that nobody ever manages to hit does not appear. */
export function NumberField({
  value, onChange, min = 1, max = 4096, step = 1, width = 62, title,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; width?: number; title?: string;
}) {
  const limita = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center rounded-sm border border-neutral-700 bg-neutral-950"
         style={{ width: width }} title={title}>
      <input
        value={value}
        onChange={(e) => { const n = Number(e.target.value.replace(/[^0-9.]/g, "")); if (Number.isFinite(n)) onChange(n); }}
        onBlur={() => onChange(limita(value))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowUp") { e.preventDefault(); onChange(limita(value + step)); }
          if (e.key === "ArrowDown") { e.preventDefault(); onChange(limita(value - step)); }
        }}
        className="appearance-none w-full bg-transparent px-1.5 py-0.5 text-[10.5px] text-neutral-100
                   tabular-nums outline-none"
      />
      <div className="flex flex-col border-l border-neutral-800">
        <button type="button" onClick={() => onChange(limita(value + step))}
                className="px-1 text-[7px] leading-[9px] text-neutral-400 hover:text-neutral-100">▲</button>
        <button type="button" onClick={() => onChange(limita(value - step))}
                className="px-1 text-[7px] leading-[9px] text-neutral-400 hover:text-neutral-100">▼</button>
      </div>
    </div>
  );
}

/**
 * A checkbox.
 *
 * The native one on macOS is blue, square and carries its system border: in a
 * dark row it is the only piece coming from another program. This one behaves
 * the same — space toggles it, focus is visible, the label is clickable — and
 * looks like the rest.
 */
export function Checkbox({
  segnata, onChange, children, title, disabilitata,
}: {
  segnata: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
  title?: string;
  disabilitata?: boolean;
}) {
  return (
    <button
      type="button" role="checkbox" aria-checked={segnata} title={title} disabled={disabilitata}
      onClick={() => onChange(!segnata)}
      className={`inline-flex items-center gap-1.5 text-left text-[11px] group
                  focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2
                  focus-visible:outline-neutral-300 rounded-sm
                  ${disabilitata ? "opacity-50 cursor-not-allowed" : ""}`}>
      <span className={`w-3.5 h-3.5 shrink-0 rounded-sm border grid place-items-center transition-colors ${
        segnata ? "bg-neutral-100 border-neutral-100" : "border-neutral-600 group-hover:border-neutral-400"}`}>
        {segnata && (
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-neutral-900" aria-hidden>
            <path d="M1 5.2 L3.8 8 L9 2" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children && <span className={segnata ? "text-neutral-200" : "text-neutral-400"}>{children}</span>}
    </button>
  );
}

/**
 * A menu of actions behind three dots.
 *
 * Things done rarely — and those that cannot be undone — must not sit still on
 * screen looking clickable by accident. The ✕ that removed a project was on
 * every card, always, a finger away from the title: here you get to it in two
 * gestures and with its label written out in full.
 */
/** How to close the menu from inside. An entry that does its thing and
 *  leaves the menu open forces one more click to get the panel out of the way,
 *  and at that point you cannot tell whether the action went through. */
const CloseMenu = createContext<() => void>(() => {});
export const useCloseMenu = () => useContext(CloseMenu);

export function Altro({
  children, title = "Altre azioni", className = "", discreto = false,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  /** Visible only on hover or on arriving with the tab key — but **never**
   *  while it is open: a semi-transparent menu under the finger moving to
   *  choose an entry is a menu that cannot be used. */
  discreto?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", esc); };
  }, [open]);
  const visibilita = !discreto || open
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <div ref={box} className={`relative ${open ? "z-40" : "z-20"} transition-opacity ${visibilita} ${className}`}>
      <button type="button" title={title} aria-haspopup="menu" aria-expanded={open}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((a) => !a); }}
              className={`px-1 py-0.5 rounded-sm leading-none transition-colors
                          ${open ? "text-neutral-100 bg-neutral-800" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70"}`}>
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      {open && (
        <CloseMenu.Provider value={() => setOpen(false)}>
          <div role="menu"
               className="absolute right-0 z-50 mt-1 min-w-[13rem] rounded border border-neutral-700
                          bg-neutral-950 p-1 shadow-2xl space-y-0.5">
            {children}
          </div>
        </CloseMenu.Provider>
      )}
    </div>
  );
}

/**
 * The filter pills with their count.
 *
 * Born in the grid, copied by hand into the tree, and about to be copied a
 * third time into the references: three copies of the same thing diverge at the
 * first tweak, and that is how a section ends up with yesterday's filters.
 *
 * The count is not decoration: a filter leading to an empty page should be
 * known BEFORE clicking it. For the same reason an entry at zero disables
 * itself instead of disappearing — disappearing would move the others under the
 * finger exactly while it is about to press.
 */
export function Pills<T extends string>({
  items,
  pick,
  onChoose,
  counts,
  /** The entry that does not filter: it stays pressable even at zero, because
   *  it is the way out of a filter showing nothing. */
  neutral,
  className = "",
}: {
  items: readonly { id: T; name: string }[];
  pick: T;
  onChoose: (v: T) => void;
  counts: Record<string, number>;
  neutral?: T;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 shrink-0 ${className}`}>
      {items.map((v) => {
        const n = counts[v.id] ?? 0;
        const active = pick === v.id;
        return (
          <button
            key={v.id}
            onClick={() => onChoose(v.id)}
            disabled={n === 0 && v.id !== neutral}
            title={`${v.name}: ${n}`}
            className={
              "px-1.5 py-0.5 border font-mono uppercase tracking-wide text-[10px] disabled:opacity-30 " +
              (active
                ? "border-amber-500 text-amber-500"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
            }
          >
            {v.name}
            <span className="ml-1 opacity-60 tabular-nums">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A filter entry with its number.
 *
 * The number is not decoration: a filter without a count does not say whether
 * it is worth opening, and the one at zero switches itself off instead of
 * leading to an empty list. It lives here because the tools home and the
 * project list both use it, and two filter bars that resemble each other
 * without matching read as two different things.
 */
export function Filter({
  children, active, onClick, n, title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  n: number;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={n === 0 && !active}
      title={title}
      aria-pressed={active}
      className={
        // py-1, not py-0.5: at 22px tall the target was below the threshold under
        // which you hit the wrong pill, and these sit side by side.
        "px-2 py-1 border rounded-sm text-[11px] leading-[14px] transition-colors disabled:opacity-30 " +
        (active
          ? "border-neutral-300 text-neutral-100"
          : "border-neutral-800 text-neutral-400 hover:border-neutral-600")
      }
    >
      {children}
      <span className="ml-1 opacity-60 tabular-nums">{n}</span>
    </button>
  );
}

/** The search field of a filter bar: the lens goes inside, not beside. */
export function Search({
  value, onChange, placeholder, width = "13rem",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <div className="relative">
      <SearchIcon className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
        style={{ width: width }}
        className="appearance-none bg-neutral-950 border border-neutral-700 rounded-sm pl-7 pr-2 py-1
                   text-[12px] text-neutral-100 placeholder:text-neutral-500 outline-none
                   focus:border-neutral-300"
      />
    </div>
  );
}
