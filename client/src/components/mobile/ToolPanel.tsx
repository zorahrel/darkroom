import type { ToolGroup } from "./BottomToolbar";
import { IconClose, IconChevronUp, IconChevronDown, IconTrash, IconReset } from "./icons";

// The parameter panel: sits in normal flow directly above the step strip (both
// inside the shell's bottom dock), so it can never render off-screen — the photo
// area shrinks to make room, Lightroom-style. Its header carries the pipeline
// controls for the step (enable · reorder · remove); the body renders the step's
// params with touch-grade sliders (.dr-touch).
export default function ToolPanel({
  group,
  onClose,
  bare = false,
}: {
  group: ToolGroup | null;
  onClose: () => void;
  // `bare` drops the panel's own top border/rounding/shadow — used when it's
  // embedded in the dock's two-pane (preview + controls) row, which owns those.
  bare?: boolean;
}) {
  if (!group) return null;
  const step = group.step;
  return (
    <div
      className={
        "dr-panel-in bg-neutral-900 " +
        (bare ? "" : "border-t border-neutral-800 rounded-t-2xl shadow-2xl")
      }
    >
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-neutral-800">
        <span className="text-neutral-300">{group.icon}</span>
        <span className="text-sm font-medium text-neutral-100 flex-1 truncate ml-1">
          {group.label}
        </span>

        {step && (
          <>
            <button
              onClick={() => step.onToggle(!step.enabled)}
              className={
                "flex items-center gap-1.5 mr-1 px-2 py-1 rounded-full text-[11px] font-medium " +
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
                aria-label="ripristina valori di default"
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
          </>
        )}

        <button
          onClick={onClose}
          className="p-1.5 rounded text-neutral-400 hover:text-white"
          aria-label="chiudi pannello"
        >
          <IconClose />
        </button>
      </div>

      <div className="dr-touch max-h-[42dvh] overflow-y-auto px-4 py-4">{group.render()}</div>
    </div>
  );
}
