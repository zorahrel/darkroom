import { useEffect, useRef, useState } from "react";
import { api, type ColorGrade, type Lut } from "../api";
import PipelineBar from "./Color";
import Library from "./Grid";

// Unified home: the pipeline toolbar sits atop the single photo library, which
// is the live preview surface. Grade + graded-view live here and are shared
// down to both, so toggling the grade re-renders the grid in place.
export default function Home() {
  const [grade, setGrade] = useState<ColorGrade | null>(null);
  const [luts, setLuts] = useState<Lut[]>([]);
  const [bust, setBust] = useState(0);
  const [saving, setSaving] = useState(false);
  const [gradedView, setGradedView] = useState(true);
  const [reload, setReload] = useState(0);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    api.luts().then((r) => {
      setLuts(r.luts);
      setGrade(r.current);
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

  return (
    <div className="space-y-4">
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
      <div className="pt-3 border-t border-neutral-800">
        <Library graded={gradedView && grade.enabled} bust={bust} reloadKey={reload} />
      </div>
    </div>
  );
}
