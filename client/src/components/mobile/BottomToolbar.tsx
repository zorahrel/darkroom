import { useState, type ReactNode } from "react";
import { IconPlus } from "./icons";

// Per-step management, attached to a ToolGroup that represents a real pipeline
// step (absent for non-step groups like "Genera"). Drives the reorder / enable /
// remove controls shown in the panel header and the chip's on/off + order badge.
export type StepControls = {
  order: number; // 1-based position in the chain (display)
  index: number; // 0-based position in the real steps[] array (for drag-reorder)
  enabled: boolean;
  onToggle: (v: boolean) => void;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  // Reset this step's params to their defaults. Present only when the step has
  // been edited away from default, so a pristine step shows no reset affordance.
  onReset?: () => void;
  summary?: string;
};

// A tool in the mobile bottom strip: one chip that opens a ToolPanel rendering
// `render()` when tapped. If `step` is set it's a reorderable pipeline step.
export type ToolGroup = {
  id: string;
  label: string;
  icon: ReactNode;
  render: () => ReactNode;
  step?: StepControls;
};

export type AddableStep = { type: string; label: string; icon: ReactNode };

// The horizontal strip of step chips at the very bottom of the editor — the
// pipeline itself, in order. Scrolls sideways when it overflows. An optional
// trailing "+" chip opens a small menu to append a new step.
export default function BottomToolbar({
  groups,
  activeId,
  onSelect,
  addable,
  onAdd,
}: {
  groups: ToolGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
  addable?: AddableStep[];
  onAdd?: (type: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="relative bg-neutral-950 border-t border-neutral-800">
      {addOpen && addable && onAdd && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setAddOpen(false)} />
          <div className="absolute right-2 bottom-full mb-2 z-10 w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl p-1.5">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-neutral-500">
              Aggiungi step
            </div>
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

      <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-2">
        {groups.map((g) => {
          const active = activeId === g.id;
          const dim = g.step && !g.step.enabled;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              className={
                "relative flex flex-col items-center justify-center gap-1 shrink-0 w-[4.6rem] py-1.5 rounded-lg text-[11px] transition-colors " +
                (active
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 active:bg-neutral-900")
              }
            >
              {g.step && (
                <span className="absolute top-1 left-1.5 text-[9px] tabular-nums text-neutral-600">
                  {g.step.order}
                </span>
              )}
              <span className={"relative " + (dim ? "opacity-40" : "")}>
                {g.icon}
                {g.step && (
                  <span
                    className={
                      "absolute -right-1.5 -top-1 w-1.5 h-1.5 rounded-full " +
                      (g.step.enabled ? "bg-emerald-400" : "bg-neutral-600")
                    }
                  />
                )}
              </span>
              <span
                className={"leading-tight text-center line-clamp-1 " + (dim ? "opacity-50" : "")}
              >
                {shortLabel(g.label)}
              </span>
            </button>
          );
        })}

        {addable && onAdd && (
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="flex flex-col items-center justify-center gap-1 shrink-0 w-[4.6rem] py-1.5 rounded-lg text-[11px] text-neutral-400 active:bg-neutral-900"
            aria-label="aggiungi step"
          >
            <IconPlus />
            <span className="leading-tight">Aggiungi</span>
          </button>
        )}
      </div>
    </div>
  );
}

// The full step labels ("Bilanciamento bianco") are too long for a 4.6rem chip.
// Trim to a single tight word so the icon carries the meaning.
function shortLabel(label: string): string {
  const map: Record<string, string> = {
    "Bilanciamento bianco": "Bianco",
    Livelli: "Livelli",
    Sakura: "Sakura",
    "Cielo (celesti)": "Cielo",
    LUT: "LUT",
    "Color (finale)": "Color",
    "Generazione AI": "Genera",
    Genera: "Genera",
  };
  return map[label] ?? label.split(" ")[0] ?? label;
}
