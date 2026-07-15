import { useEffect, useMemo, useState } from "react";
import {
  api,
  STEP_LABELS,
  STEP_ORDER,
  newStep,
  type ColorGrade,
  type GradeStepType,
  type Lut,
  type PipelineStatus,
  type PromptConfig,
} from "../api";
import { StepParams, stepSummary, groupLuts, isStepTouched } from "../components/StepEditor";
import PromptBuilder from "../components/PromptBuilder";
import PresetsPanel from "../components/PresetsPanel";
import { PipelineList, type ToolGroup, type AddableStep } from "../components/mobile/EditorRail";
import LivePreview from "../components/LivePreview";
import { StepIcon, IconChevronDown, IconBookmark, IconDownload } from "../components/mobile/icons";

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

  const lutGroups = useMemo(() => groupLuts(luts), [luts]);

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
  // Ricalcolata a ogni render (non memoizzata): il gruppo Input contiene controlli
  // con stato che cambia spesso (prompt, conteggio) e deve restare fresco.
  const mobileGroups: ToolGroup[] = (() => {
    const groups: ToolGroup[] = [
      {
        id: "input",
        label: "Input",
        icon: <StepIcon type="ai" />,
        render: () => (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-neutral-700 overflow-hidden text-xs">
              <button
                onClick={() => pickInputMode("folder")}
                className={
                  "px-3 py-1.5 " +
                  (inputMode === "folder"
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-400 hover:text-white")
                }
              >
                Da cartella
              </button>
              <button
                onClick={() => pickInputMode("prompt")}
                className={
                  "px-3 py-1.5 border-l border-neutral-700 " +
                  (inputMode === "prompt"
                    ? "bg-violet-600 text-white"
                    : "text-neutral-400 hover:text-white")
                }
              >
                Da prompt
              </button>
            </div>
            {inputMode === "folder" ? (
              <div className="space-y-2">
                <p className="text-sm text-neutral-400">
                  La griglia qui è la sorgente ({total ?? "—"} scatti). Gli step
                  di trasformazione lavorano su questi.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={reindexTimes}
                    disabled={run.active}
                    className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
                  >
                    Reindicizza orari
                  </button>
                  <button
                    onClick={regenerateFavorites}
                    disabled={run.active}
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
                    className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium text-sm"
                  >
                    {run.active && run.msg.startsWith("Genero") ? "Genero…" : "Genera da prompt"}
                  </button>
                </div>
              </div>
            )}
            <div className="pt-1">
              <GenerationLook />
            </div>
          </div>
        ),
      },
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
    // OUTPUT — ultimo chip: esporta le preferite col grade, a piena risoluzione.
    groups.push({
      id: "esporta",
      label: "Esporta",
      icon: <IconDownload />,
      render: () => (
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">
            Renderizza le preferite col grade a piena risoluzione e le copia
            nella cartella di export.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => oneStage(stageExport, "Esporta")}
              disabled={run.active}
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
            >
              <IconDownload /> Esporta {status?.favorites ?? 0} preferite
            </button>
            <button
              onClick={() => oneStage(stagePromote, "Promuovo le ultime versioni")}
              disabled={run.active}
              className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
            >
              Promuovi ultime versioni
            </button>
            {run.msg && <span className="text-xs text-neutral-400">{run.msg}</span>}
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
              checked={gradedView}
              onChange={(e) => setGradedView(e.target.checked)}
            />
            Anteprima gradata nella griglia
          </label>
        </div>
      ),
    });
    return groups;
  })();

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

  // The pipeline PANEL content (not a layout of its own): a compact live preview
  // on top, then the accordion pipeline, then a status/graded-view footer. Home
  // drops this into the desktop side-rail (next to the grid) or the mobile sheet,
  // so the grid and the pipeline are visible together.
  return (
    <div className="flex flex-col h-full min-h-0 bg-neutral-950">
      <div className="h-44 lg:h-52 shrink-0 border-b border-neutral-800">
        <LivePreview grade={grade} />
      </div>
      <PipelineList
        groups={mobileGroups}
        master={{
          enabled: grade.enabled,
          onToggle: (v: boolean) => patch({ enabled: v }),
          info: run.msg || `${enabledSteps.length} step · ${grade.enabled ? "ON" : "OFF"}`,
        }}
        addable={addableSteps}
        onAdd={(t: string) => addStep(t as GradeStepType)}
      />
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-neutral-800 text-[11px] text-neutral-400">
        {browserAlive === false && (
          <span
            className="px-2 py-0.5 rounded bg-red-900/40 text-red-200 border border-red-900 whitespace-nowrap"
            title="La generazione AI richiede il browser ChatGPT (avvialo dall'header)."
          >
            worker offline
          </span>
        )}
        {saving && <span className="text-amber-400">salvo…</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={gradedView} onChange={(e) => setGradedView(e.target.checked)} />
          anteprima gradata nella griglia
        </label>
      </div>
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
