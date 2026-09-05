import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  STEP_LABELS,
  STEP_ORDER,
  api,
  gradedPreviewUrl,
  gradedUrl,
  newStep,
  type ColorGrade,
  type GradeStepType,
  type Lut,
  type PromptConfig,
} from "../../api";
import { StepParams, groupLuts, isStepTouched, stepSummary } from "../StepEditor";
import {
  IconBookmark,
  IconChevronLeft,
  IconClose,
  IconDownload,
  IconInfo,
  IconShieldCheck,
  IconLayers,
  IconRedo,
  IconText,
  IconUndo,
  StepIcon,
} from "../mobile/icons";
import PresetsPanel from "../PresetsPanel";
import { useDebouncedImage } from "../../lib/useDebouncedImage";
import { useHistory } from "../../lib/useHistory";
import EditorRail, { type ToolGroup, type AddableStep } from "../mobile/EditorRail";
import Spinner from "./Spinner";
import { ExtraInstructionsCard } from "./ExtraInstructionsCard";
import { FinalPromptView } from "./FinalPromptView";
import { PhotoConfigCard } from "./PhotoConfigCard";
import { QualityCheck } from "./QualityCheck";

export function PhotoPipeline({
  photoId,
  versionNumber,
  versionId,
  favoriteVersionId,
  effectiveConfig,
  hasConfigOverride,
  prompt,
  extraInitial,
  effectiveGrade,
  hasGradeOverride,
  luts,
  onSaved,
  navigating,
  onExit,
  mobileExtras,
  infoPanel,
  photoNav,
  openStepId,
}: {
  photoId: string;
  versionNumber: number | null;
  /** Row id of the render on screen — the quality panel checks this one. */
  versionId?: number | null;
  favoriteVersionId?: number | null;
  effectiveConfig: PromptConfig;
  hasConfigOverride: boolean;
  prompt: string;
  extraInitial: string;
  effectiveGrade: ColorGrade;
  hasGradeOverride: boolean;
  luts: Lut[];
  onSaved: () => Promise<unknown> | void;
  navigating?: boolean;
  onExit: () => void;
  mobileExtras?: ReactNode;
  infoPanel?: ReactNode;
  photoNav?: {
    prev: string | null;
    next: string | null;
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
  /** Deep-link (`?step=<id>`): expand and scroll to this step on mount. */
  openStepId?: string | null;
}) {
  // Colour state with undo/redo: `setDraft` records the history, slider drags
  // collapse into a single step (coalescing in the hook).
  const {
    state: draft,
    set: setDraft,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetHistory,
  } = useHistory<ColorGrade>(effectiveGrade);
  const [saving, setSaving] = useState(false);
  const [compare, setCompare] = useState(false);
  const [baking, setBaking] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  // Feedback for the two non-per-photo-save actions (bake, salva-come-globale) —
  // shown in the master row, whichever fired last.
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const hasAiStep = draft.steps.some((s) => s.enabled && s.type === "ai");
  const effSig = JSON.stringify(effectiveGrade);
  // Re-sync (and clear history) when the upstream effective grade changes,
  // e.g. after a save/reset/refresh — that becomes the new undo baseline.
  useEffect(() => resetHistory(effectiveGrade), [effSig, resetHistory]);

  // Undo/redo keyboard shortcuts (⌘Z / ⌘⇧Z), ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Full-screen mobile editor (<lg): as soon as there is a version the shell is
  // already there under the photo (no entry button). The generations live in a
  // "Versions" panel inside the shell, so the overlay hides nothing.
  const lutGroups = useMemo(() => groupLuts(luts), [luts]);

  const hasVersion = versionNumber != null;
  const W = 720;
  const previewSrc = hasVersion
    ? gradedPreviewUrl(photoId, versionNumber, draft, W)
    : "";
  // Debounce + preload the graded preview so dragging a slider fires a few
  // renders (not one per pixel) and never flashes blank between frames.
  const { shown: previewShown, loading: previewLoading } = useDebouncedImage(previewSrc || null, 150);
  const displaySrc = previewShown ?? previewSrc;
  const baseSrc = hasVersion
    ? `/thumb/gen/${encodeURIComponent(photoId)}/v${String(versionNumber).padStart(2, "0")}.png?w=${W}`
    : "";
  const dirty = JSON.stringify(draft) !== effSig;
  // While loading the graded render (or switching photo) show the ungraded base
  // underneath + a spinner, so it's clear something is happening.
  const busy = !!navigating || previewLoading;
  const showBase = compare || !draft.enabled || busy;

  // Salva/bake/reset condivisi fra la action row desktop e la toolbar mobile.
  async function doSave() {
    setSaving(true);
    try {
      await api.setPhotoGrade(photoId, draft);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function doReset() {
    setSaving(true);
    try {
      await api.setPhotoGrade(photoId, null);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }
  async function doBake() {
    setBaking(true);
    setActionMsg(hasAiStep ? "Bake in corso (step AI, può richiedere minuti)…" : "Bake…");
    try {
      const res = await api.bake(photoId);
      setActionMsg(res.ok ? "Bake completato ✓" : `Bake fallito: ${res.error ?? "?"}`);
      if (res.ok) await onSaved();
    } catch (e) {
      setActionMsg(`Bake fallito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBaking(false);
    }
  }
  // Promotes THIS photo's grade to the default for the whole set (overwrites
  // settings.color_grade) — the only way from the detail view to touch the
  // global one, distinct from the "Save" below which only writes the photo's
  // override.
  async function doSaveGlobal() {
    if (
      !confirm(
        "Salvare questo grade come default per TUTTO il set?\n\nSovrascrive il grade globale — ogni foto senza un override proprio lo erediterà.",
      )
    )
      return;
    setSavingGlobal(true);
    setActionMsg("Salvo come default del set…");
    try {
      await api.setColorGrade(draft);
      setActionMsg("Impostato come default del set ✓");
      await onSaved();
    } catch (e) {
      setActionMsg(`Salvataggio globale fallito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingGlobal(false);
    }
  }
  // Exports the current version's full-res graded image (download).
  function doExport() {
    if (versionNumber == null) return;
    const a = document.createElement("a");
    a.href = gradedUrl(photoId, versionNumber, undefined, Date.now());
    a.download = `${photoId}-v${String(versionNumber).padStart(2, "0")}-graded.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function patchStepAt(idx: number, patch: Partial<ColorGrade["steps"][number]>) {
    setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === idx ? { ...s, ...patch } : s)) });
  }
  function patchParamsAt(idx: number, p: Record<string, unknown>) {
    setDraft({
      ...draft,
      steps: draft.steps.map((s, j) => (j === idx ? { ...s, params: { ...s.params, ...p } } : s)),
    });
  }
  function moveStepAt(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const next = draft.steps.slice();
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    setDraft({ ...draft, steps: next });
  }
  function reorderStepAt(from: number, to: number) {
    if (from === to) return;
    const next = draft.steps.slice();
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setDraft({ ...draft, steps: next });
  }
  function removeStepAt(idx: number) {
    setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== idx) });
  }
  function addStep(type: GradeStepType) {
    setDraft({ ...draft, steps: [...draft.steps, newStep(type)] });
  }
  // Applies a preset as this photo's override (then saved with the Save button).
  function applyGrade(g: ColorGrade) {
    setDraft({ enabled: g.enabled, steps: g.steps });
  }

  // Mobile toolbar: "Generate" (the ChatGPT generation, not a step of the
  // chain) + every deterministic step as a reorderable chip. Each step's panel
  // shows ONLY the parameters; enable/reorder/remove live in its header (step).
  const mobileGroups: ToolGroup[] = useMemo(() => {
    const groups: ToolGroup[] = [
      ...(mobileExtras
        ? [
            {
              id: "versioni",
              label: "Versioni",
              icon: <IconLayers />,
              render: () => <>{mobileExtras}</>,
            } satisfies ToolGroup,
          ]
        : []),
      {
        id: "preset",
        label: "Preset",
        icon: <IconBookmark />,
        render: () => (
          <PresetsPanel grade={draft} onApply={applyGrade} applyLabel="Applica alla foto" />
        ),
      },
      {
        id: "generate",
        label: "Genera",
        icon: <StepIcon type="ai" />,
        render: () => (
          <div className="space-y-4">
            <PhotoConfigCard
              photoId={photoId}
              config={effectiveConfig}
              hasOverride={hasConfigOverride}
              prompt={prompt}
              onSaved={onSaved}
            />
            <ExtraInstructionsCard photoId={photoId} initial={extraInitial} onSaved={onSaved} />
          </div>
        ),
      },
      {
        id: "prompt",
        label: "Prompt",
        icon: <IconText />,
        render: () => <FinalPromptView prompt={prompt} />,
      },
      ...(versionId
        ? [
            {
              id: "quality",
              label: "Qualità",
              icon: <IconShieldCheck />,
              render: () => (
                <QualityCheck
                  photoId={photoId}
                  versionId={versionId}
                  currentFavoriteId={favoriteVersionId ?? null}
                  onFavoriteChanged={onSaved}
                />
              ),
            } satisfies ToolGroup,
          ]
        : []),
      ...(infoPanel
        ? [
            {
              id: "info",
              label: "Info",
              icon: <IconInfo />,
              render: () => <>{infoPanel}</>,
            } satisfies ToolGroup,
          ]
        : []),
    ];
    let order = 0;
    draft.steps.forEach((s, idx) => {
      if (s.type === "ai") return;
      order += 1;
      groups.push({
        id: s.id,
        label: STEP_LABELS[s.type],
        icon: <StepIcon type={s.type} />,
        step: {
          order,
          index: idx,
          enabled: s.enabled,
          onToggle: (v) => patchStepAt(idx, { enabled: v }),
          canUp: idx > 0,
          canDown: idx < draft.steps.length - 1,
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
            <p className="text-sm text-neutral-400">
              Step disattivo. Attivalo dall'interruttore qui sopra per modificarne i parametri.
            </p>
          ),
      });
    });
    // OUTPUT — last chip on the bar: exports the full-res graded version.
    groups.push({
      id: "export",
      label: "Esporta",
      icon: <IconDownload />,
      render: () => (
        <div className="space-y-3">
          <p className="text-sm text-neutral-400">
            Scarica questa versione con il grade applicato, a piena risoluzione
            (render al volo, come il deliverable finale).
          </p>
          <button
            onClick={doExport}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white"
          >
            <IconDownload /> Scarica full-res
          </button>
          <div className="pt-2 mt-2 border-t border-neutral-800 space-y-2">
            <p className="text-sm text-neutral-400">
              <b className="text-neutral-200">Bake</b>: crea una nuova versione con
              questo grade già bruciato nei pixel (non più calcolato al volo).
              Serve per congelare il risultato — es. prima di cambiare il grade
              globale, o per costruirci sopra un altro step AI — non per il
              lavoro quotidiano: fino a qui il grade si vede già live nell'anteprima
              e nell'export.
            </p>
            <button
              disabled={baking || dirty}
              onClick={doBake}
              title={dirty ? "Salva prima le modifiche per poter fare il bake" : undefined}
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-violet-700 text-violet-200 hover:bg-violet-950/40 disabled:opacity-50"
            >
              {baking ? "Bake in corso…" : "Bake — nuova versione"}
            </button>
            {dirty && (
              <p className="text-[11px] text-amber-400">
                Ci sono modifiche non salvate: salva prima di fare il bake.
              </p>
            )}
          </div>
        </div>
      ),
    });
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, lutGroups, photoId, versionNumber, versionId, favoriteVersionId, effectiveConfig, hasConfigOverride, prompt, extraInitial, onSaved, mobileExtras, infoPanel]);

  const addableSteps: AddableStep[] = STEP_ORDER.filter((t) => t !== "ai").map((t) => ({
    type: t,
    label: STEP_LABELS[t],
    icon: <StepIcon type={t} className="w-4 h-4" />,
  }));

  if (!hasVersion) {
    return (
      <div className="text-sm text-neutral-400">
        Genera una versione per attivare il grade colore.
      </div>
    );
  }

  // The live preview fills the main area of the rail at every width — hold to
  // see the ungraded original, spinner while a fresh render decodes.
  const previewNode = (
    <div
      className="absolute inset-0 select-none"
      onMouseDown={() => setCompare(true)}
      onMouseUp={() => setCompare(false)}
      onMouseLeave={() => setCompare(false)}
      onTouchStart={() => setCompare(true)}
      onTouchEnd={() => setCompare(false)}
      title="Tieni premuto per l'originale (senza grade)"
    >
      <img
        src={displaySrc}
        alt="anteprima gradata"
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
      />
      <img
        src={baseSrc}
        alt="base"
        className={
          "absolute inset-0 w-full h-full object-contain transition-opacity " +
          (showBase ? "opacity-100" : "opacity-0")
        }
        draggable={false}
      />
      <span className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-neutral-200 pointer-events-none">
        {busy ? "carico…" : showBase ? "originale ChatGPT (no grade)" : "grade completo"}
      </span>
      {busy && <Spinner />}
    </div>
  );

  return (
      <EditorRail
          storageKey="darkroom.rail.detail"
          openStepId={openStepId}
          preview={previewNode}
          onReorderStep={reorderStepAt}
          title={
            photoNav && photoNav.index >= 0
              ? `${photoId} · ${photoNav.index + 1}/${photoNav.total}`
              : photoId
          }
          leftAction={
            <div className="flex items-center gap-0.5">
              <button
                onClick={onExit}
                className="p-1.5 rounded text-neutral-400 hover:text-white"
                aria-label="torna alla libreria"
              >
                <IconClose />
              </button>
              {photoNav && (
                <>
                  <button
                    onClick={photoNav.onPrev}
                    disabled={!photoNav.prev}
                    className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-30"
                    aria-label="foto precedente"
                  >
                    <IconChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={photoNav.onNext}
                    disabled={!photoNav.next}
                    className="p-1.5 rounded text-neutral-400 hover:text-white disabled:opacity-30"
                    aria-label="foto successiva"
                  >
                    <IconChevronLeft className="w-4 h-4 rotate-180" />
                  </button>
                </>
              )}
            </div>
          }
          rightAction={
            <div className="flex items-center gap-1.5">
              <button
                disabled={!canUndo}
                onClick={undo}
                aria-label="annulla"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-25"
              >
                <IconUndo />
              </button>
              <button
                disabled={!canRedo}
                onClick={redo}
                aria-label="ripristina"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white disabled:opacity-25"
              >
                <IconRedo />
              </button>
              {dirty && <span className="text-[10px] text-amber-400">•</span>}
              {hasGradeOverride && (
                <button
                  disabled={saving}
                  onClick={doReset}
                  aria-label="reset override"
                  title="Reset override"
                  className="text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 disabled:opacity-50 whitespace-nowrap"
                >
                  Reset
                </button>
              )}
              <button
                disabled={savingGlobal}
                onClick={doSaveGlobal}
                aria-label="salva come grade globale"
                title="Salva questo grade come default per tutto il set (sovrascrive il grade globale — le foto senza override lo erediteranno)"
                className="text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border border-violet-700 text-violet-200 disabled:opacity-50 whitespace-nowrap"
              >
                {savingGlobal ? "…" : "Globale"}
              </button>
              <button
                disabled={saving || !dirty}
                onClick={doSave}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white disabled:opacity-50"
              >
                {saving ? "…" : "Salva"}
              </button>
            </div>
          }
          master={{
            enabled: draft.enabled,
            onToggle: (val) => setDraft({ ...draft, enabled: val }),
            info: actionMsg ?? (hasGradeOverride ? "override locale" : "eredita il grade globale"),
          }}
          addable={addableSteps}
          onAdd={(t) => addStep(t as GradeStepType)}
          onClose={onExit}
          groups={mobileGroups}
        />
  );
}
