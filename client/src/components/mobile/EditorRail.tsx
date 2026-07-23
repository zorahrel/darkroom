import { useEffect, useState, type ReactNode } from "react";
import type { ToolGroup, AddableStep } from "./BottomToolbar";
import type { MasterControls } from "./EditorShell";
import {
  IconClose,
  IconChevronUp,
  IconChevronDown,
  IconChevronRight,
  IconReset,
  IconTrash,
  IconPlus,
  IconLayers,
  IconGrip,
} from "./icons";

export type { ToolGroup, AddableStep };

// Lightroom-style editor: a big live preview fills the main area, the pipeline
// lives in a scrollable accordion rail on the RIGHT (desktop) or a bottom sheet
// (mobile). Every step header is always visible ("see the pipeline"); expand one
// to edit its params and watch the preview update live. Reuses the same
// `ToolGroup[]` the bottom-dock editor uses, so per-step controls aren't
// duplicated. The desktop rail collapses with a toggle to give the preview the
// full width.
export default function EditorRail({
  title,
  leftAction,
  rightAction,
  preview,
  groups,
  master,
  addable,
  onAdd,
  onReorderStep,
  onClose,
  storageKey = "darkroom.rail",
}: {
  title: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  preview: ReactNode;
  groups: ToolGroup[];
  master?: MasterControls;
  addable?: AddableStep[];
  onAdd?: (type: string) => void;
  // Reorder a pipeline step from one steps[] index to another (drag-and-drop).
  onReorderStep?: (from: number, to: number) => void;
  onClose?: () => void;
  // Distinct key per surface (Home vs Detail) so their rail-open / open-section
  // preferences don't collide in localStorage.
  storageKey?: string;
}) {
  const [railOpen, setRailOpen] = useState(
    () => localStorage.getItem(`${storageKey}.open`) !== "0",
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  function toggleRail(v: boolean) {
    setRailOpen(v);
    localStorage.setItem(`${storageKey}.open`, v ? "1" : "0");
  }

  // Esc: close the mobile sheet first, else leave the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (sheetOpen) {
        e.preventDefault();
        setSheetOpen(false);
      } else if (onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, onClose]);

  const pipeline = (
    <PipelineList
      groups={groups}
      master={master}
      addable={addable}
      onAdd={onAdd}
      onReorderStep={onReorderStep}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
      {/* Header a riga singola che non sfora mai: le due barre d'azione sono
          shrink-0 (non si comprimono), il titolo è l'unico a cedere spazio
          (min-w-0 + truncate → ellissi) quando la larghezza scarseggia. */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <div className="shrink-0">{leftAction}</div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">{title}</span>
        <div className="shrink-0">{rightAction}</div>
        {/* Desktop-only rail collapse toggle. */}
        <button
          onClick={() => toggleRail(!railOpen)}
          className="hidden lg:flex shrink-0 items-center gap-1 p-1.5 rounded text-neutral-400 hover:text-white"
          aria-label={railOpen ? "nascondi pannello" : "mostra pannello"}
          title={railOpen ? "nascondi pannello" : "mostra pannello"}
        >
          <IconLayers />
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Main preview — always visible, updates live as you edit. */}
        <div className="relative flex-1 min-h-0 bg-black">{preview}</div>

        {/* Desktop rail. */}
        {railOpen && (
          <aside className="hidden lg:flex w-[360px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
            {pipeline}
          </aside>
        )}
      </div>

      {/* Mobile: a Pipeline button + a bottom sheet with the same list. */}
      <button
        onClick={() => setSheetOpen(true)}
        className="lg:hidden flex items-center justify-center gap-2 py-2.5 border-t border-neutral-800 bg-neutral-950 text-sm text-neutral-200 shrink-0"
      >
        <IconLayers /> Pipeline
        {master && (
          <span
            className={
              "ml-1 w-1.5 h-1.5 rounded-full " +
              (master.enabled ? "bg-emerald-400" : "bg-neutral-600")
            }
          />
        )}
      </button>
      {sheetOpen && (
        <div className="lg:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] flex flex-col rounded-t-2xl border-t border-neutral-800 bg-neutral-950 shadow-2xl">
            <div className="flex items-center px-3 py-2 border-b border-neutral-800 shrink-0">
              <span className="text-sm font-medium flex-1">Pipeline</span>
              <button
                onClick={() => setSheetOpen(false)}
                className="p-1.5 rounded text-neutral-400 hover:text-white"
                aria-label="chiudi"
              >
                <IconClose />
              </button>
            </div>
            {pipeline}
          </div>
        </div>
      )}
    </div>
  );
}

// The scrollable pipeline: master row on top, one accordion section per group,
// an add-step row at the bottom. Self-contained (owns which sections are open)
// so it drops straight into the desktop rail, the mobile sheet, or the Home
// side-panel next to the grid.
export function PipelineList({
  groups,
  master,
  addable,
  onAdd,
  onReorderStep,
}: {
  groups: ToolGroup[];
  master?: MasterControls;
  addable?: AddableStep[];
  onAdd?: (type: string) => void;
  onReorderStep?: (from: number, to: number) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const onToggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Drag-to-reorder state, lifted here so any step section can be the drop
  // target while another is dragged. Indices are into the real steps[] array.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const endDrag = () => {
    setDragIdx(null);
    setOverIdx(null);
  };
  const dropOn = (target: number) => {
    if (onReorderStep && dragIdx !== null && dragIdx !== target) onReorderStep(dragIdx, target);
    endDrag();
  };

  // If an open section disappears (step removed/reordered away), drop it.
  useEffect(() => {
    setOpen((cur) => {
      const ids = new Set(groups.map((g) => g.id));
      let changed = false;
      const next = new Set<string>();
      cur.forEach((id) => (ids.has(id) ? next.add(id) : (changed = true)));
      return changed ? next : cur;
    });
  }, [groups]);
  return (
    <div className="flex flex-col min-h-0 flex-1">
      {master && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
          <button
            onClick={() => master.onToggle(!master.enabled)}
            className={
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium " +
              (master.enabled
                ? "bg-emerald-900/50 text-emerald-300"
                : "bg-neutral-800 text-neutral-400")
            }
          >
            <span
              className={
                "w-1.5 h-1.5 rounded-full " +
                (master.enabled ? "bg-emerald-400" : "bg-neutral-500")
              }
            />
            {master.enabled ? "Grade ON" : "Grade OFF"}
          </button>
          {master.info && (
            <span className="text-[11px] text-neutral-500 truncate">{master.info}</span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {groups.map((g) => {
          const idx = g.step?.index;
          const dnd =
            onReorderStep && idx !== undefined
              ? {
                  dragging: dragIdx === idx,
                  // Drop line: after this step when dragging down onto it,
                  // before it when dragging up onto it (matches the splice).
                  lineBelow: dragIdx !== null && overIdx === idx && dragIdx < idx,
                  lineAbove: dragIdx !== null && overIdx === idx && dragIdx > idx,
                  onStart: () => setDragIdx(idx),
                  onOver: () => setOverIdx(idx),
                  onDrop: () => dropOn(idx),
                  onEnd: endDrag,
                }
              : undefined;
          return (
            <Section
              key={g.id}
              group={g}
              open={open.has(g.id)}
              onToggle={() => onToggle(g.id)}
              dnd={dnd}
            />
          );
        })}
      </div>

      {addable && onAdd && (
        <div className="relative border-t border-neutral-800 shrink-0">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-neutral-300 hover:text-white"
          >
            <IconPlus /> Aggiungi step
          </button>
          {addOpen && (
            <>
              <div className="fixed inset-0 z-0" onClick={() => setAddOpen(false)} />
              <div className="absolute right-2 bottom-full mb-1 z-10 w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl p-1.5">
                {addable.map((a) => (
                  <button
                    key={a.type}
                    onClick={() => {
                      onAdd(a.type);
                      setAddOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-sm text-neutral-200 hover:bg-neutral-800"
                  >
                    <span className="text-neutral-400">{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Drag-and-drop wiring for a single step section (undefined for non-step
// groups, which are neither draggable nor drop targets).
type SectionDnd = {
  dragging: boolean;
  lineAbove: boolean;
  lineBelow: boolean;
  onStart: () => void;
  onOver: () => void;
  onDrop: () => void;
  onEnd: () => void;
};

// One accordion section: header (grip · order · icon · label · summary · enable
// dot · chevron) always shown; body (per-step controls + params) when expanded.
// A step section can be dragged by its grip and reordered while the preview
// stays live; the grip is separate from the toggle button so tapping the row
// still expands it.
function Section({
  group,
  open,
  onToggle,
  dnd,
}: {
  group: ToolGroup;
  open: boolean;
  onToggle: () => void;
  dnd?: SectionDnd;
}) {
  const step = group.step;
  const dim = step && !step.enabled;
  return (
    <div
      className={"border-b border-neutral-800/70 relative " + (dnd?.dragging ? "opacity-40" : "")}
      onDragOver={
        dnd
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              dnd.onOver();
            }
          : undefined
      }
      onDrop={
        dnd
          ? (e) => {
              e.preventDefault();
              dnd.onDrop();
            }
          : undefined
      }
    >
      {dnd?.lineAbove && <div className="absolute inset-x-0 top-0 h-0.5 bg-sky-500 z-10" />}
      {dnd?.lineBelow && <div className="absolute inset-x-0 bottom-0 h-0.5 bg-sky-500 z-10" />}
      <div className="w-full flex items-center gap-1.5 pl-1 pr-3 hover:bg-neutral-900">
        {dnd ? (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", group.id);
              dnd.onStart();
            }}
            onDragEnd={dnd.onEnd}
            className="shrink-0 py-2.5 px-0.5 text-neutral-600 hover:text-neutral-300 cursor-grab active:cursor-grabbing"
            title="trascina per riordinare"
            aria-label="trascina per riordinare"
          >
            <IconGrip className="w-4 h-4" />
          </span>
        ) : (
          <span className="w-1.5 shrink-0" />
        )}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-2 py-2.5 text-left"
        >
        {step && (
          <span className="text-[10px] tabular-nums text-neutral-600 w-3 shrink-0">
            {step.order}
          </span>
        )}
        <span className={"text-neutral-300 shrink-0 relative " + (dim ? "opacity-40" : "")}>
          {group.icon}
          {step && (
            <span
              className={
                "absolute -right-1 -top-0.5 w-1.5 h-1.5 rounded-full " +
                (step.enabled ? "bg-emerald-400" : "bg-neutral-600")
              }
            />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className={"block text-sm truncate " + (dim ? "text-neutral-500" : "text-neutral-100")}>
            {group.label}
          </span>
          {step?.summary && (
            <span className="block text-[11px] text-neutral-500 truncate">{step.summary}</span>
          )}
        </span>
        <span className={"text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>
          <IconChevronRight className="w-4 h-4" />
        </span>
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 dr-touch">
          {step && (
            <div className="flex items-center gap-1 mb-2 pb-2 border-b border-neutral-800/70">
              <button
                onClick={() => step.onToggle(!step.enabled)}
                className={
                  "flex items-center gap-1.5 mr-auto px-2 py-1 rounded-full text-[11px] font-medium " +
                  (step.enabled
                    ? "bg-emerald-900/50 text-emerald-300"
                    : "bg-neutral-800 text-neutral-400")
                }
              >
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (step.enabled ? "bg-emerald-400" : "bg-neutral-500")
                  }
                />
                {step.enabled ? "Attivo" : "Off"}
              </button>
              <button
                onClick={() => step.onMove(-1)}
                disabled={!step.canUp}
                className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-25"
                aria-label="sposta prima"
              >
                <IconChevronUp />
              </button>
              <button
                onClick={() => step.onMove(1)}
                disabled={!step.canDown}
                className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-25"
                aria-label="sposta dopo"
              >
                <IconChevronDown />
              </button>
              {step.onReset && (
                <button
                  onClick={step.onReset}
                  className="p-1.5 rounded text-neutral-400 hover:text-white"
                  aria-label="ripristina default"
                  title="ripristina default"
                >
                  <IconReset />
                </button>
              )}
              <button
                onClick={step.onRemove}
                className="p-1.5 rounded text-neutral-400 hover:text-red-400"
                aria-label="rimuovi step"
              >
                <IconTrash />
              </button>
            </div>
          )}
          {group.render()}
        </div>
      )}
    </div>
  );
}
