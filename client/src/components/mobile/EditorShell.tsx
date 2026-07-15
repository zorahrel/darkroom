import { useEffect, useState, type ReactNode } from "react";
import BottomToolbar, { type ToolGroup, type AddableStep } from "./BottomToolbar";
import ToolPanel from "./ToolPanel";
import { IconCompare } from "./icons";

export type { ToolGroup, AddableStep };

// Master row controls: the whole-grade on/off and the hold-to-compare toggle,
// pinned just under the photo so they're always reachable regardless of which
// step panel is open.
export type MasterControls = {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  // Hold-to-compare — only meaningful when there's a photo (omit in dock mode).
  compare?: boolean;
  onCompare?: (v: boolean) => void;
  info?: string;
};

// Full-screen editing shell: fixed header, photo filling the space, a master
// row, then the pipeline step strip with a sliding param panel above it. Used at
// every width on the per-photo editor (the pipeline bar is the single editor UI);
// callers that only want it on mobile keep gating their mount with `lg:hidden`.
export default function EditorShell({
  title,
  leftAction,
  rightAction,
  photo,
  groups,
  master,
  addable,
  onAdd,
  onClose,
  livePreview,
  variant = "responsive",
}: {
  title: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  photo: ReactNode;
  groups: ToolGroup[];
  master?: MasterControls;
  addable?: AddableStep[];
  onAdd?: (type: string) => void;
  // Esc closes the open step panel first, then calls this (e.g. leave the editor).
  onClose?: () => void;
  // A focused live preview shown while a panel is open (dock variant only): the
  // page behind the dock (e.g. the grid) isn't a live, focused surface. On
  // desktop it sits to the left of the controls; on mobile it stacks on top.
  livePreview?: ReactNode;
  // "responsive" = fullscreen on mobile, bottom dock on desktop (per-photo editor).
  // "dock" = always a bottom dock with no photo area (e.g. the Home grid: the
  // grid itself is the live preview).
  variant?: "responsive" | "dock";
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = groups.find((g) => g.id === activeId) ?? null;

  // If the open step gets removed (or reordered out of existence), close the panel.
  useEffect(() => {
    if (activeId && !groups.some((g) => g.id === activeId)) setActiveId(null);
  }, [groups, activeId]);

  // Esc: close the open panel first, otherwise leave the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (activeId) {
        e.preventDefault();
        setActiveId(null);
      } else if (onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, onClose]);

  function select(id: string) {
    setActiveId((cur) => (cur === id ? null : id));
  }

  const rootClass =
    variant === "dock"
      ? "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-neutral-950 text-neutral-100 border-t border-neutral-800 shadow-2xl"
      : "fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100 lg:inset-x-0 lg:top-auto lg:bottom-0 lg:border-t lg:border-neutral-800 lg:shadow-2xl";

  return (
    <div className={rootClass}>
      <div className="flex items-center gap-2 px-2 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
        {leftAction}
        <span className="text-sm font-medium text-neutral-200 truncate flex-1">{title}</span>
        {rightAction}
      </div>

      {/* On desktop (and always in dock variant) the photo lives in the page
          above — the grid or a large preview — so hide the shell's photo area. */}
      <div
        className={
          "relative flex-1 min-h-0 bg-black " +
          (variant === "dock" ? "hidden" : "lg:hidden")
        }
      >
        {photo}
      </div>

      {master && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-neutral-800 bg-neutral-950 shrink-0">
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

          <div className="flex-1" />

          {master.onCompare && (
            <button
              onClick={() => master.onCompare!(!master.compare)}
              className={
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs " +
                (master.compare
                  ? "bg-sky-900/50 text-sky-200"
                  : "bg-neutral-800 text-neutral-300")
              }
            >
              <IconCompare />
              {master.compare ? "Originale" : "Confronta"}
            </button>
          )}
        </div>
      )}

      <div className="shrink-0">
        {active && livePreview ? (
          // Open state with a live preview: two panes on desktop (preview left,
          // controls right), stacked on mobile (compact preview atop the panel).
          <div className="flex flex-col lg:flex-row lg:items-stretch border-t border-neutral-800">
            <div className="h-40 sm:h-52 lg:h-auto lg:w-[42%] lg:max-w-2xl lg:border-r border-neutral-800 shrink-0">
              {livePreview}
            </div>
            <div className="flex-1 min-w-0">
              <ToolPanel group={active} onClose={() => setActiveId(null)} bare />
            </div>
          </div>
        ) : (
          <ToolPanel group={active} onClose={() => setActiveId(null)} />
        )}
        <BottomToolbar
          groups={groups}
          activeId={activeId}
          onSelect={select}
          addable={addable}
          onAdd={onAdd}
        />
      </div>
    </div>
  );
}
