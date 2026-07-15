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
  compare: boolean;
  onCompare: (v: boolean) => void;
  info?: string;
};

// Full-screen editing shell for <lg viewports: fixed header, photo filling the
// space, a master row, then the pipeline step strip with a sliding param panel
// above it. Desktop (lg+) never mounts this — callers gate it with `lg:hidden`
// and keep their existing layout in a `hidden lg:block` sibling.
export default function EditorShell({
  title,
  leftAction,
  rightAction,
  photo,
  groups,
  master,
  addable,
  onAdd,
}: {
  title: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  photo: ReactNode;
  groups: ToolGroup[];
  master?: MasterControls;
  addable?: AddableStep[];
  onAdd?: (type: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = groups.find((g) => g.id === activeId) ?? null;

  // If the open step gets removed (or reordered out of existence), close the panel.
  useEffect(() => {
    if (activeId && !groups.some((g) => g.id === activeId)) setActiveId(null);
  }, [groups, activeId]);

  function select(id: string) {
    setActiveId((cur) => (cur === id ? null : id));
  }

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center gap-2 px-2 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
        {leftAction}
        <span className="text-sm font-medium text-neutral-200 truncate flex-1">{title}</span>
        {rightAction}
      </div>

      <div className="relative flex-1 min-h-0 bg-black">{photo}</div>

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

          <button
            onClick={() => master.onCompare(!master.compare)}
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
        </div>
      )}

      <div className="shrink-0">
        <ToolPanel group={active} onClose={() => setActiveId(null)} />
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
