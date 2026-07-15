import { useEffect, useMemo, useState } from "react";
import { useDebouncedImage } from "../lib/useDebouncedImage";
import {
  api,
  gradedPreviewUrl,
  STEP_LABELS,
  STEP_ORDER,
  newStep,
  type ColorGrade,
  type GradeStepType,
  type Lut,
  type PipelineStatus,
  type PromptConfig,
} from "../api";
import StepEditor, { StepParams, stepSummary, groupLuts, isStepTouched } from "../components/StepEditor";
import PromptBuilder from "../components/PromptBuilder";
import Accordion from "../components/Accordion";
import PresetsPanel from "../components/PresetsPanel";
import EditorShell, { type ToolGroup, type AddableStep } from "../components/mobile/EditorShell";
import { StepIcon, IconChevronLeft, IconChevronDown, IconBookmark } from "../components/mobile/icons";

// The pipeline toolbar that sits ATOP the photo library, as three bookend stages:
// INPUT (source: folder-editing or from-zero prompt) → STEPS (the deterministic
// transformation chain: WB · levels · sakura · LUT · color) → OUTPUT (export).
// The grade previews LIVE in the grid via /graded and export renders it full-res
// on the fly, so there's no manual bake. AI generation lives in the Input bookend,
// never as a chain step. Grade + graded-view are owned by the parent (Home) and
// shared with the grid, so the library itself is the live preview surface.
export default function PipelineBar({
  grade,
  luts,
  patch,
  saving,
  gradedView,
  setGradedView,
  onChanged,
}: {
  grade: ColorGrade;
  luts: Lut[];
  patch: (p: Partial<ColorGrade>) => void;
  saving: boolean;
  gradedView: boolean;
  setGradedView: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [run, setRun] = useState<{ active: boolean; msg: string }>({
    active: false,
    msg: "",
  });
  const [browserAlive, setBrowserAlive] = useState<boolean | null>(null);

  // Anteprima live (dati) + shell mobile (<lg): un'unica sorgente di stato dietro
  // sia la vista desktop sia l'area foto dell'EditorShell, niente fetch doppio.
  const lv = useLivePreview(grade);
  const lutGroups = useMemo(() => groupLuts(luts), [luts]);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Input stage: the pipeline's source. Two modes — "folder" (edit the existing
  // library) or "prompt" (text-to-image from zero). Persisted so the choice sticks.
  const [inputMode, setInputMode] = useState<"folder" | "prompt">(() =>
    localStorage.getItem("darkroom.pipeline.inputMode") === "prompt"
      ? "prompt"
      : "folder",
  );
  const [genPrompt, setGenPrompt] = useState("");
  const [genCount, setGenCount] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  function pickInputMode(m: "folder" | "prompt") {
    setInputMode(m);
    localStorage.setItem("darkroom.pipeline.inputMode", m);
  }

  // Worker health: generation (regenerate/AI bake) needs the ChatGPT browser up.
  // Surface it here so the generate buttons can warn instead of silently no-op'ing.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .health()
        .then((h) => alive && setBrowserAlive(h.browser))
        .catch(() => alive && setBrowserAlive(null));
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Live pipeline status (queue of the set + favorites), 2.5s.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .pipelineStatus()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Total library size for the "from folder" input summary. Refresh when the
  // favorites count moves (generation adds photos / promote changes the set).
  useEffect(() => {
    let alive = true;
    api
      .photoCounts()
      .then((r) => alive && setTotal(r.counts.all ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status?.favorites]);

  const q = status?.queue ?? {};
  const active = (q.pending ?? 0) + (q.running ?? 0);
  const enabledSteps = grade.steps.filter((s) => s.enabled);

  function patchStepAt(idx: number, p: Partial<ColorGrade["steps"][number]>) {
    patch({ steps: grade.steps.map((s, j) => (j === idx ? { ...s, ...p } : s)) });
  }
  function patchParamsAt(idx: number, p: Record<string, unknown>) {
    patch({
      steps: grade.steps.map((s, j) => (j === idx ? { ...s, params: { ...s.params, ...p } } : s)),
    });
  }
  function moveStepAt(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= grade.steps.length) return;
    const next = grade.steps.slice();
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    patch({ steps: next });
  }
  function removeStepAt(idx: number) {
    patch({ steps: grade.steps.filter((_, j) => j !== idx) });
  }
  function addStep(type: GradeStepType) {
    patch({ steps: [...grade.steps, newStep(type)] });
  }
  // Applica un preset al look globale del set (autosave via patch).
  function applyGrade(g: ColorGrade) {
    patch({ enabled: g.enabled, steps: g.steps });
  }

  // Gruppi della toolbar mobile: solo step deterministici (niente Genera, che a
  // livello globale non è uno step — vive nell'Input/Output qui sopra). Ogni chip
  // è uno step riordinabile; il pannello mostra i parametri, la gestione (enable/
  // riordino/rimuovi) sta nel suo header.
  const mobileGroups: ToolGroup[] = useMemo(() => {
    const groups: ToolGroup[] = [
      {
        id: "preset",
        label: "Preset",
        icon: <IconBookmark />,
        render: () => <PresetsPanel grade={grade} onApply={applyGrade} applyLabel="Applica al set" />,
      },
    ];
    let order = 0;
    grade.steps.forEach((s, idx) => {
      if (s.type === "ai") return;
      order += 1;
      groups.push({
        id: s.id,
        label: STEP_LABELS[s.type],
        icon: <StepIcon type={s.type} />,
        step: {
          order,
          enabled: s.enabled,
          onToggle: (v) => patchStepAt(idx, { enabled: v }),
          canUp: idx > 0,
          canDown: idx < grade.steps.length - 1,
          onMove: (dir) => moveStepAt(idx, dir),
          onRemove: () => removeStepAt(idx),
          onReset: isStepTouched(s)
            ? () => patchStepAt(idx, { params: newStep(s.type).params })
            : undefined,
          summary: stepSummary(s),
        },
        render: () =>
          s.enabled ? (
            <StepParams step={s} lutGroups={lutGroups} onParams={(p) => patchParamsAt(idx, p)} />
          ) : (
            <p className="text-sm text-neutral-500">
              Step disattivo. Attivalo dall'interruttore qui sopra per modificarne i parametri.
            </p>
          ),
      });
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, lutGroups]);

  const addableSteps: AddableStep[] = STEP_ORDER.filter((t) => t !== "ai").map((t) => ({
    type: t,
    label: STEP_LABELS[t],
    icon: <StepIcon type={t} className="w-4 h-4" />,
  }));

  // Direct regeneration of every favorite through the ChatGPT worker using the
  // set's default look — the primary "generate photos" action (restored). It
  // enqueues jobs (serialized on the shared worker); progress shows in the grid
  // rings and the Jobs panel, not a bake progress bar.
  async function regenerateFavorites() {
    if (run.active) return;
    if (browserAlive === false) {
      setRun({
        active: false,
        msg: "Browser ChatGPT offline — avvialo dall'header (⚠) prima di generare.",
      });
      return;
    }
    if (!confirm("Rigenerare TUTTE le preferite via ChatGPT? Serializzato sul worker condiviso (rispetta il cap dell'account).")) return;
    await oneStage(() => api.pipelineRegenerate(), "Rigenero le preferite");
    onChanged();
  }

  // Input "da prompt": text-to-image from zero. Enqueues N generations on the
  // shared worker; they surface in the grid rings + Jobs panel like any other job.
  async function generateFromPrompt() {
    if (run.active) return;
    const prompt = genPrompt.trim();
    if (!prompt) {
      setRun({ active: false, msg: "Scrivi un prompt per generare da zero." });
      return;
    }
    if (browserAlive === false) {
      setRun({
        active: false,
        msg: "Browser ChatGPT offline — avvialo dall'header (⚠) prima di generare.",
      });
      return;
    }
    const n = Math.max(1, Math.min(20, Math.round(genCount) || 1));
    await oneStage(
      () => api.generateNew(prompt, n),
      `Genero ${n} da prompt`,
    );
    onChanged();
  }

  async function reindexTimes() {
    await oneStage(() => api.reindexTimes(), "Reindicizzo gli orari");
    onChanged();
  }

  async function stagePromote() {
    const r = await api.pipelinePromoteLatest();
    onChanged(); // refresh the library grid — favorites moved
    return r.promoted;
  }
  async function stageExport() {
    return api.exportFavorites();
  }

  async function oneStage(fn: () => Promise<unknown>, label: string) {
    if (run.active) return;
    setRun({ active: true, msg: label + "…" });
    try {
      const r = await fn();
      setRun({ active: false, msg: label + " ✓ " + shortResult(r) });
    } catch (e) {
      setRun({ active: false, msg: label + " — errore: " + String(e) });
    }
  }

  return (
    <div>
      <Accordion
        storageKey="darkroom.pipeline.open"
        title={<h1 className="text-lg font-semibold">Pipeline</h1>}
        summary={
          <>
            <span className="shrink-0 text-neutral-500">
              {enabledSteps.length} step · {grade.enabled ? "grade ON" : "grade OFF"}
            </span>
            {active > 0 ? (
              <span className="shrink-0 text-amber-300">
                coda {active} ({q.running ?? 0} attivi)
              </span>
            ) : (
              <span className="shrink-0 text-neutral-600">coda idle</span>
            )}
            {status?.favorites != null && (
              <span className="shrink-0 text-neutral-600">· {status.favorites} preferite</span>
            )}
          </>
        }
        trailing={
          <>
            {browserAlive === false && (
              <span
                className="shrink-0 text-xs px-2 py-1 rounded bg-red-900/40 text-red-200 border border-red-900 whitespace-nowrap"
                title="La generazione AI richiede il browser ChatGPT. Avvialo dall'header."
              >
                ⚠ worker offline
              </span>
            )}
            {saving && <span className="shrink-0 text-xs text-amber-400">salvo…</span>}
          </>
        }
      >
        <p className="text-sm text-neutral-400 max-w-2xl mb-3">
          Dall'<b className="text-neutral-200">input</b> agli step di{" "}
          <b className="text-neutral-200">trasformazione</b> fino all'
          <b className="text-neutral-200">output</b>. Scegli la sorgente (cartella
          o prompt), componi la catena, poi cuoci ed esporta i finali.
        </p>

        {run.msg && (
          <div className="mb-3 text-sm px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-200">
            {run.msg}
          </div>
        )}

        <div className="space-y-1">
        {/* ============ STAGE 1 — INPUT (bookend: la sorgente) ============ */}
      <section className="p-3 rounded-xl border border-violet-900/50 bg-violet-950/10">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
            Input
          </span>
          <h2 className="text-sm font-semibold">Sorgente</h2>
          <div className="flex-1" />
          <div className="inline-flex rounded-lg border border-neutral-700 overflow-hidden text-xs">
            <button
              onClick={() => pickInputMode("folder")}
              className={
                "px-3 py-1.5 transition-colors " +
                (inputMode === "folder"
                  ? "bg-neutral-700 text-white"
                  : "bg-transparent text-neutral-400 hover:text-white")
              }
            >
              Da cartella (editing)
            </button>
            <button
              onClick={() => pickInputMode("prompt")}
              className={
                "px-3 py-1.5 border-l border-neutral-700 transition-colors " +
                (inputMode === "prompt"
                  ? "bg-violet-600 text-white"
                  : "bg-transparent text-neutral-400 hover:text-white")
              }
            >
              Da prompt (genera da 0)
            </button>
          </div>
        </div>

        {inputMode === "folder" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-neutral-400 flex-1 min-w-[16rem]">
                La libreria qui sotto è la sorgente:{" "}
                <b className="text-neutral-200">{total ?? "—"}</b> scatti dalla cartella
                del progetto. Gli step di trasformazione lavorano su questi.
              </p>
              <button
                onClick={reindexTimes}
                disabled={run.active}
                title="Rilegge gli orari EXIF/file per riordinare gli scatti."
                className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
              >
                Reindicizza orari
              </button>
            </div>
            <div className="pt-2 mt-1 border-t border-neutral-800/70 flex flex-wrap items-center gap-3">
              <span className="text-xs text-neutral-500">
                Rigenera i preferiti via ChatGPT col look del set (edit da cartella):
              </span>
              <button
                onClick={regenerateFavorites}
                disabled={run.active}
                title="Rigenera da zero ogni preferita via ChatGPT col look del set."
                className="text-sm px-3 py-1.5 rounded bg-violet-700/80 hover:bg-violet-600 text-white disabled:opacity-50"
              >
                {run.active && run.msg.startsWith("Rigenero") ? "Rigenero…" : "Rigenera preferite"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              rows={3}
              placeholder="Descrivi l'immagine da generare da zero…"
              className="w-full rounded-lg bg-neutral-950 border border-neutral-700 px-3 py-2 text-sm resize-y focus:border-violet-600 outline-none"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                variazioni
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={genCount}
                  onChange={(e) => setGenCount(Number(e.target.value) || 1)}
                  className="w-16 rounded bg-neutral-950 border border-neutral-700 px-2 py-1 text-sm"
                />
              </label>
              <button
                onClick={generateFromPrompt}
                disabled={run.active || !genPrompt.trim()}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm"
              >
                {run.active && run.msg.startsWith("Genero") ? "Genero…" : "Genera da prompt"}
              </button>
              <span className="text-[11px] text-neutral-500">
                Serializzato sul worker ChatGPT condiviso.
              </span>
            </div>
          </div>
        )}

        {/* Look condiviso: guida la generazione da prompt E gli step AI che ereditano */}
        <div className="mt-3">
          <GenerationLook />
        </div>
      </section>

      <StageConnector label="trasformazioni" />

      {/* ============ STAGE 2 — STEP (le trasformazioni, riordinabili) ============ */}
      <section className="p-3 rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 rounded bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-900">
            Step
          </span>
          <h2 className="text-sm font-semibold">Trasformazioni</h2>
          <span className="text-xs text-neutral-500">
            {enabledSteps.length} attivi
          </span>
          <div className="flex-1" />
          {active > 0 ? (
            <span className="text-xs text-amber-300">
              coda: {active} ({q.running ?? 0} attivi)
            </span>
          ) : (
            <span className="text-xs text-neutral-500">coda idle</span>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={grade.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span className={grade.enabled ? "text-emerald-400" : "text-neutral-400"}>
              {grade.enabled ? "Grade ON" : "Grade OFF"}
            </span>
          </label>
          {saving && <span className="text-xs text-amber-400">salvo…</span>}
        </div>

        <p className="text-[11px] text-neutral-500 mb-2">
          Catena deterministica eseguita in ordine. Lo step{" "}
          <b className="text-neutral-300">Color</b> a fine catena è la correzione
          finale dopo la LUT. La generazione via ChatGPT non è uno step: sta
          nell'<b className="text-neutral-300">Input</b> (da prompt o rigenera preferite).
        </p>
        <div className="hidden lg:block">
          <StepEditor grade={grade} onChange={(g) => patch(g)} luts={luts} />
          <details className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/30">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-300 hover:text-white flex items-center gap-2">
              <IconBookmark className="w-4 h-4" /> Preset &amp; template
            </summary>
            <div className="p-3 border-t border-neutral-800">
              <PresetsPanel grade={grade} onApply={applyGrade} applyLabel="Applica al set" />
            </div>
          </details>
          <LivePreviewView grade={grade} {...lv} />
        </div>

        <div className="lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-full flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-2 text-left"
          >
            {lv.shown ? (
              <img src={lv.shown} alt="anteprima" className="w-14 h-14 rounded object-cover shrink-0" />
            ) : (
              <span className="w-14 h-14 rounded bg-neutral-800 shrink-0" />
            )}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-neutral-100">Modifica pipeline</span>
              <span className="block text-xs text-neutral-500 truncate">
                {grade.enabled ? `${enabledSteps.length} step attivi` : "grade OFF"}
              </span>
            </span>
            <IconChevronLeft className="w-5 h-5 rotate-180 text-neutral-600 shrink-0" />
          </button>
          {mobileOpen && (
            <EditorShell
              title="Pipeline — default del set"
              leftAction={
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-1.5 rounded text-neutral-400 hover:text-white"
                  aria-label="chiudi"
                >
                  <IconChevronLeft />
                </button>
              }
              rightAction={saving ? <span className="text-xs text-amber-400">salvo…</span> : null}
              master={{
                enabled: grade.enabled,
                onToggle: (val) => patch({ enabled: val }),
                compare: lv.compare,
                onCompare: lv.setCompare,
                info: "autosalvato",
              }}
              addable={addableSteps}
              onAdd={(t) => addStep(t as GradeStepType)}
              photo={
                <div
                  className="absolute inset-0 select-none"
                  onMouseDown={() => lv.setCompare(true)}
                  onMouseUp={() => lv.setCompare(false)}
                  onTouchStart={() => lv.setCompare(true)}
                  onTouchEnd={() => lv.setCompare(false)}
                >
                  {lv.shown && (
                    <img
                      src={lv.shown}
                      alt="anteprima live"
                      className="absolute inset-0 w-full h-full object-contain"
                      draggable={false}
                    />
                  )}
                  {lv.baseSrc && (
                    <img
                      src={lv.baseSrc}
                      alt="base"
                      className={
                        "absolute inset-0 w-full h-full object-contain transition-opacity " +
                        (lv.compare || !grade.enabled ? "opacity-100" : "opacity-0")
                      }
                      draggable={false}
                    />
                  )}
                  <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-200 pointer-events-none">
                    {lv.compare || !grade.enabled ? "base (no grade)" : gradeLabel(grade)}
                  </span>
                </div>
              }
              groups={mobileGroups}
            />
          )}
        </div>
      </section>

      <StageConnector label="output" />

      {/* ============ STAGE 3 — OUTPUT (bookend: esporta i finali) ============ */}
      <section className="p-3 rounded-xl border border-emerald-900/50 bg-emerald-950/10">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-900">
            Output
          </span>
          <h2 className="text-sm font-semibold">Esporta</h2>
          <span className="text-xs text-neutral-500">{status?.favorites ?? 0} preferite</span>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={gradedView}
              onChange={(e) => setGradedView(e.target.checked)}
            />
            Anteprima gradata nella griglia
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => oneStage(stageExport, "Esporto i finali")}
            disabled={run.active}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
          >
            Esporta finali
          </button>
          <button
            onClick={() => oneStage(stagePromote, "Promuovo le ultime versioni")}
            disabled={run.active}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
          >
            Promuovi ultime versioni
          </button>
        </div>
        <p className="text-[11px] text-neutral-500 mt-2">
          L'export renderizza il grade a piena risoluzione al volo su ogni preferita
          e copia i finali fuori — il look è già applicato, niente bake manuale.
        </p>
      </section>
        </div>
      </Accordion>
    </div>
  );
}

// Connettore verticale fra due stage-cornice: la freccia + etichetta rendono
// esplicito che input/output "avvolgono" gli step nel mezzo. Esportato così la
// Detail riusa la stessa grammatica pipeline invece di reinventarla.
export function StageConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-1.5 pl-4 text-[10px] uppercase tracking-wider text-neutral-600">
      <span aria-hidden>↓</span>
      <span>{label}</span>
      <span className="flex-1 h-px bg-neutral-800/70" />
    </div>
  );
}

// The set's default generation look: the PromptConfig that ChatGPT follows when
// you "Rigenera preferite" or run an AI bake step whose own config is empty
// (inherit). Editing + saving it here is how you tune the whole set's generation
// — restored from the old "prompt globale" panel. Collapsed by default so it
// doesn't crowd the deterministic-grade workflow.
function GenerationLook() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<PromptConfig | null>(null);
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api
      .getDefaultConfig()
      .then((r) => {
        setCfg(r.config);
        setPrompt(r.prompt);
      })
      .catch(() => {});
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await api.setDefaultConfig(cfg);
      setCfg(r.config);
      setPrompt(r.prompt);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
          Generazione
        </span>
        <h2 className="text-sm font-semibold">Look del set (prompt di default)</h2>
        <span className="hidden sm:inline text-xs text-neutral-500">
          — guida ChatGPT quando rigeneri o fai un bake AI
        </span>
        <div className="flex-1" />
        {dirty && <span className="text-xs text-amber-400">non salvato</span>}
        <span className="flex items-center gap-1 text-neutral-500 text-xs">
          {open ? "Chiudi" : "Apri"}
          <IconChevronDown className={"w-4 h-4 transition-transform " + (open ? "rotate-180" : "")} />
        </span>
      </button>
      {open &&
        (cfg ? (
          <div className="mt-3 space-y-3">
            <PromptBuilder
              value={cfg}
              previewPrompt={prompt}
              onChange={(next) => {
                setCfg(next);
                setDirty(true);
              }}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="text-sm px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Salvo…" : "Salva default"}
              </button>
              <span className="text-[11px] text-neutral-500">
                È ciò che uno step <b className="text-neutral-300">Generazione AI</b> eredita
                quando la sua config è vuota.
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-neutral-500">Carico il look…</div>
        ))}
    </section>
  );
}

// Stato dietro l'anteprima live: uno scatto preferito rappresentativo, rigradato
// al volo mentre gli step cambiano (debounced). Estratto in hook così una sola
// chiamata in PipelineBar alimenta sia la vista desktop sia l'area foto della
// shell mobile — nessun fetch/timer duplicato fra le due.
function useLivePreview(grade: ColorGrade) {
  const [fav, setFav] = useState<{ id: string; v: number } | null>(null);
  const [compare, setCompare] = useState(false);
  const W = 720;

  useEffect(() => {
    api
      .listPhotos("with_favorite")
      .then((r) => {
        const p =
          r.photos.find((x) => x.favorite_version_number != null) ?? r.photos[0];
        if (p?.favorite_version_number != null)
          setFav({ id: p.id, v: p.favorite_version_number });
      })
      .catch(() => {});
  }, []);

  // Recompute the URL every render (cheap string); the shared hook debounces the
  // switch + preloads, so a drag fires a few renders, not one per pixel.
  const url = fav ? gradedPreviewUrl(fav.id, fav.v, grade, W) : null;
  const { shown, loading } = useDebouncedImage(url, 150);

  const baseSrc = fav
    ? `/thumb/gen/${encodeURIComponent(fav.id)}/v${String(fav.v).padStart(2, "0")}.png?w=${W}`
    : null;

  return { shown, baseSrc, loading, compare, setCompare };
}

// Vista desktop dell'anteprima live (solo presentazione — lo stato viene da
// useLivePreview, condiviso con la shell mobile). Tieni premuto per la base.
function LivePreviewView({
  grade,
  shown,
  baseSrc,
  loading,
  compare,
  setCompare,
}: {
  grade: ColorGrade;
  shown: string | null;
  baseSrc: string | null;
  loading: boolean;
  compare: boolean;
  setCompare: (v: boolean) => void;
}) {
  return (
    <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start">
      <div
        className="relative w-full sm:w-72 aspect-[4/5] rounded-lg overflow-hidden border border-neutral-800 bg-neutral-950 select-none"
        onMouseDown={() => setCompare(true)}
        onMouseUp={() => setCompare(false)}
        onMouseLeave={() => setCompare(false)}
        title="Tieni premuto per vedere la base (senza grade)"
      >
        {shown && (
          <img
            src={shown}
            alt="anteprima live"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        )}
        {baseSrc && (
          <img
            src={baseSrc}
            alt="base"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity ${
              compare || !grade.enabled ? "opacity-100" : "opacity-0"
            }`}
            draggable={false}
          />
        )}
        {loading && (
          <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-amber-300">
            aggiorno…
          </span>
        )}
        <span className="absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-200 pointer-events-none">
          {compare || !grade.enabled ? "base (no grade)" : gradeLabel(grade)}
        </span>
      </div>
      <div className="text-xs text-neutral-400 max-w-xs space-y-1">
        <div className="text-neutral-300 font-medium">Anteprima live</div>
        <p>
          Segue gli step deterministici in tempo reale su uno scatto campione. Gli
          step AI non compaiono qui (solo nel bake). Tieni premuto sull'immagine
          per confrontare la base senza grade.
        </p>
      </div>
    </div>
  );
}

// Etichetta compatta dello stato grade per l'anteprima: dose della LUT attiva,
// o il numero di step attivi se non c'è una LUT nella catena.
function gradeLabel(grade: ColorGrade): string {
  const lut = grade.steps.find((s) => s.enabled && s.type === "lut");
  if (lut) return `LUT ${Number(lut.params.dose ?? 0)}%`;
  const n = grade.steps.filter((s) => s.enabled).length;
  return `${n} step`;
}

function shortResult(r: unknown): string {
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (typeof o.queued === "number") return `${o.queued} in coda`;
    if (typeof o.promoted === "number") return `${o.promoted} promosse`;
    if (typeof o.copied === "number") return `${o.copied}/${o.total} esportate`;
  }
  if (typeof r === "number") return `${r} promosse`;
  return "";
}
