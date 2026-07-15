import { useEffect, useRef, useState } from "react";
import { api, type ColorGrade, type Lut } from "../api";
import PipelineBar from "./Color";
import Library from "./Grid";
import { IconLayers, IconClose } from "../components/mobile/icons";

// Unified home: the pipeline toolbar sits atop the single photo library, which
// is the live preview surface. Grade + graded-view live here and are shared
// down to both, so toggling the grade re-renders the grid in place.
// Compact numeric signature of the grade — used as the initial cache-bust seed
// so an out-of-band grade change is reflected on the next page load, not only
// after an in-UI edit (which already bumps `bust` on save).
function gradeSig(g: ColorGrade): number {
  const s = `${g.enabled ? 1 : 0}|${JSON.stringify(g.steps)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export default function Home() {
  const [grade, setGrade] = useState<ColorGrade | null>(null);
  const [luts, setLuts] = useState<Lut[]>([]);
  const [bust, setBust] = useState(0);
  const [saving, setSaving] = useState(false);
  const [gradedView, setGradedView] = useState(true);
  const [reload, setReload] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    api.luts().then((r) => {
      setLuts(r.luts);
      setGrade(r.current);
      // Seed the cache-bust from the grade content so an out-of-band change
      // (grade edited via API, not the slider) refreshes graded previews on the
      // next load — otherwise a plain reload reuses the cached image (same URL).
      setBust(gradeSig(r.current));
    });
  }, []);

  // Debounced persist: update local state instantly, save 500ms after the last
  // change, then bust the graded-image cache so the grid repaints.
  function patch(p: Partial<ColorGrade>) {
    setGrade((g) => (g ? { ...g, ...p } : g));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setGrade((g) => {
        if (!g) return g;
        setSaving(true);
        api
          .setColorGrade(g)
          .then(() => setBust(Date.now()))
          .finally(() => setSaving(false));
        return g;
      });
    }, 500);
  }

  if (!grade) return <div className="p-6 text-neutral-400">Carico…</div>;

  const panel = (
    <PipelineBar
      grade={grade}
      luts={luts}
      patch={patch}
      saving={saving}
      gradedView={gradedView}
      setGradedView={setGradedView}
      onChanged={() => {
        setBust(Date.now());
        setReload((n) => n + 1);
      }}
    />
  );

  // Grid (gallery) and pipeline are visible together: grid scrolls on the left,
  // the pipeline rail stays pinned on the right (desktop). On mobile the rail
  // becomes a bottom sheet behind a floating button — the grid keeps the width.
  return (
    <div className="lg:flex lg:items-start lg:gap-4">
      <div className="flex-1 min-w-0 pb-20 lg:pb-4">
        <Library graded={gradedView && grade.enabled} bust={bust} reloadKey={reload} />
      </div>

      <aside className="hidden lg:flex flex-col w-[340px] shrink-0 sticky top-[68px] h-[calc(100vh-88px)] rounded-xl border border-neutral-800 overflow-hidden bg-neutral-950">
        {panel}
      </aside>

      {/* Mobile: floating button opens the pipeline as a bottom sheet. */}
      <button
        onClick={() => setSheetOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-neutral-100 text-neutral-900 shadow-lg font-medium text-sm"
      >
        <IconLayers /> Pipeline
        <span
          className={"w-1.5 h-1.5 rounded-full " + (grade.enabled ? "bg-emerald-500" : "bg-neutral-400")}
        />
      </button>
      {sheetOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 h-[86dvh] flex flex-col rounded-t-2xl border-t border-neutral-800 bg-neutral-950 overflow-hidden shadow-2xl">
            <div className="flex items-center px-3 py-2 border-b border-neutral-800 shrink-0">
              <span className="text-sm font-medium flex-1">Pipeline — default del set</span>
              <button
                onClick={() => setSheetOpen(false)}
                className="p-1.5 rounded text-neutral-400 hover:text-white"
                aria-label="chiudi"
              >
                <IconClose />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <PipelineBar
                grade={grade}
                luts={luts}
                patch={patch}
                saving={saving}
                gradedView={gradedView}
                setGradedView={setGradedView}
                onChanged={() => {
                  setBust(Date.now());
                  setReload((n) => n + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
