import { useMemo } from "react";
import {
  type ColorGrade,
  type GradeStep,
  type GradeStepType,
  type Lut,
  type PromptConfig,
  type AiStepParams,
  DEFAULT_CONFIG,
  STEP_LABELS,
  STEP_ORDER,
  newStep,
} from "../api";
import PromptBuilder from "./PromptBuilder";

// Editor della pipeline colore come lista ORDINATA di step. Ogni step si
// attiva/disattiva, si riordina (▲▼), si rimuove (✕) e ha i suoi parametri.
// Il parente possiede il master `enabled`; qui si edita solo `grade.steps`.
export default function StepEditor({
  grade,
  onChange,
  luts,
  onHoverStep,
}: {
  grade: ColorGrade;
  onChange: (g: ColorGrade) => void;
  luts: Lut[];
  // Passa l'indice dello step sotto il mouse (o null all'uscita) così il parente
  // può mostrare l'anteprima della foto FINO a quello step.
  onHoverStep?: (index: number | null) => void;
}) {
  const steps = grade.steps;

  const lutGroups = useMemo(() => {
    const m = new Map<string, Lut[]>();
    for (const l of luts) {
      const arr = m.get(l.group) ?? [];
      arr.push(l);
      m.set(l.group, arr);
    }
    return [...m.entries()];
  }, [luts]);

  function setSteps(next: GradeStep[]) {
    onChange({ ...grade, steps: next });
  }
  function patchStep(i: number, p: Partial<GradeStep>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  }
  function patchParams(i: number, p: Record<string, unknown>) {
    setSteps(
      steps.map((s, idx) => (idx === i ? { ...s, params: { ...s.params, ...p } } : s)),
    );
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setSteps(next);
  }
  function remove(i: number) {
    setSteps(steps.filter((_, idx) => idx !== i));
  }
  function add(type: GradeStepType) {
    setSteps([...steps, newStep(type)]);
  }

  return (
    <div className="space-y-2" onMouseLeave={() => onHoverStep?.(null)}>
      {steps.map((s, i) => (
        <div
          key={s.id}
          onMouseEnter={() => onHoverStep?.(i)}
          className={
            "rounded-lg border bg-neutral-950/60 transition-shadow " +
            (s.enabled ? "border-neutral-700" : "border-neutral-800 opacity-60") +
            (onHoverStep ? " hover:border-sky-600 hover:shadow-[0_0_0_1px] hover:shadow-sky-600/40" : "")
          }
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="flex flex-col -my-1">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-neutral-500 hover:text-white disabled:opacity-20 leading-none text-xs"
                aria-label="su"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                className="text-neutral-500 hover:text-white disabled:opacity-20 leading-none text-xs"
                aria-label="giù"
              >
                ▼
              </button>
            </div>
            <span className="text-[10px] tabular-nums text-neutral-600 w-4">{i + 1}</span>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => patchStep(i, { enabled: e.target.checked })}
              />
              <span className={s.enabled ? "text-neutral-100" : "text-neutral-400"}>
                {STEP_LABELS[s.type]}
              </span>
            </label>
            {s.type === "ai" && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
                generativo
              </span>
            )}
            <div className="flex-1" />
            <span
              className="text-[11px] text-neutral-500 truncate max-w-[48%] text-right hidden sm:inline"
              title={stepSummary(s)}
            >
              {stepSummary(s)}
            </span>
            <button
              onClick={() => remove(i)}
              className="text-neutral-500 hover:text-red-400 text-sm px-1"
              aria-label="rimuovi step"
              title="rimuovi step"
            >
              ✕
            </button>
          </div>
          {s.enabled && (
            <div className="px-3 pb-3">
              <StepParams
                step={s}
                lutGroups={lutGroups}
                onParams={(p) => patchParams(i, p)}
              />
            </div>
          )}
        </div>
      ))}

      <AddStep onAdd={add} />
    </div>
  );
}

function AddStep({ onAdd }: { onAdd: (t: GradeStepType) => void }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs text-neutral-500">aggiungi step:</span>
      {STEP_ORDER.map((t) => (
        <button
          key={t}
          onClick={() => onAdd(t)}
          className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white"
        >
          + {STEP_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(v: unknown): boolean {
  return v === true;
}

// One-line digest of a step's params, shown in the (collapsed) header so the
// whole pipeline reads at a glance — and so the AI step never looks inert.
function stepSummary(s: GradeStep): string {
  const p = s.params;
  switch (s.type) {
    case "white_balance":
      return bool(p.scene_match) ? "scene-match" : bool(p.awb) ? "AWB" : "off";
    case "levels":
      return `nero ${num(p.black, 0.4)} · bianco ${num(p.white, 99.6)}`;
    case "sakura":
      return "auto";
    case "lut": {
      const name =
        String(p.lut ?? "")
          .split("/")
          .pop()
          ?.replace(/\.cube$/i, "")
          .trim() || "nessuna";
      const dose = bool(p.auto_dose)
        ? `${num(p.dose, 80)}% · notte ${num(p.dose_night, 30)}%`
        : `${num(p.dose, 80)}%`;
      return `${name} · ${dose}`;
    }
    case "color": {
      const keys: [string, string][] = [
        ["temp", "temp"],
        ["tint", "tint"],
        ["saturation", "sat"],
        ["brightness", "lum"],
        ["contrast", "contr"],
      ];
      const active = keys
        .filter(([k]) => num(p[k], 0) !== 0)
        .map(([k, lbl]) => `${lbl} ${num(p[k]) > 0 ? "+" : ""}${num(p[k])}`);
      return active.length ? active.join(" · ") : "neutro";
    }
    case "ai": {
      const prov = p.provider === "higgsfield" ? "Higgsfield" : "ChatGPT";
      const cfg = p.config as Record<string, unknown> | undefined;
      const custom = cfg && Object.keys(cfg).length > 0;
      return `${prov} · ${custom ? "config propria" : "eredita look del set"} · solo nel bake`;
    }
    default:
      return "";
  }
}

function StepParams({
  step,
  lutGroups,
  onParams,
}: {
  step: GradeStep;
  lutGroups: [string, Lut[]][];
  onParams: (p: Record<string, unknown>) => void;
}) {
  const p = step.params;

  if (step.type === "white_balance") {
    return (
      <div className="space-y-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={bool(p.awb)}
            onChange={(e) => onParams({ awb: e.target.checked })}
          />
          AWB robusto (cast stimato dai grigi)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={bool(p.scene_match)}
            onChange={(e) => onParams({ scene_match: e.target.checked })}
          />
          Scene-match (WB uniforme fra scatti gemelli)
        </label>
        <p className="text-[11px] text-neutral-500">
          Scene-match, dove attivo, sostituisce l'AWB per-immagine con un gain
          condiviso dal gruppo.
        </p>
      </div>
    );
  }

  if (step.type === "levels") {
    return (
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">nero (percentile) · {num(p.black, 0.4)}</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={num(p.black, 0.4)}
            onChange={(e) => onParams({ black: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">bianco (percentile) · {num(p.white, 99.6)}</span>
          <input
            type="range"
            min={95}
            max={100}
            step={0.1}
            value={num(p.white, 99.6)}
            onChange={(e) => onParams({ white: Number(e.target.value) })}
          />
        </label>
      </div>
    );
  }

  if (step.type === "sakura") {
    return (
      <p className="text-[11px] text-neutral-500">
        Schiarisce e uniforma i sakura (nessun parametro).
      </p>
    );
  }

  if (step.type === "lut") {
    const autoDose = bool(p.auto_dose);
    return (
      <div className="space-y-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">LUT</span>
          <select
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5"
            value={String(p.lut ?? "")}
            onChange={(e) => onParams({ lut: e.target.value })}
          >
            <option value="">— nessuna —</option>
            {lutGroups.map(([group, arr]) => (
              <optgroup key={group} label={group}>
                {arr.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">
            Dose · <b className="text-neutral-200">{num(p.dose, 80)}%</b>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={num(p.dose, 80)}
            onChange={(e) => onParams({ dose: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoDose}
            onChange={(e) => onParams({ auto_dose: e.target.checked })}
          />
          Auto-dose sulle notturne/rosso-dominanti
        </label>
        {autoDose && (
          <label className="flex flex-col gap-1">
            <span className="text-neutral-400">
              Dose notturne · <b className="text-neutral-200">{num(p.dose_night, 30)}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={num(p.dose_night, 30)}
              onChange={(e) => onParams({ dose_night: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
    );
  }

  if (step.type === "color") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <ColorSlider label="Temperatura (freddo ↔ caldo)" k="temp" p={p} onParams={onParams} />
        <ColorSlider label="Tinta (verde ↔ magenta)" k="tint" p={p} onParams={onParams} />
        <ColorSlider label="Saturazione" k="saturation" p={p} onParams={onParams} />
        <ColorSlider label="Luminosità" k="brightness" p={p} onParams={onParams} />
        <ColorSlider label="Contrasto" k="contrast" p={p} onParams={onParams} />
      </div>
    );
  }

  if (step.type === "ai") {
    return <AiStepEditor params={step.params as unknown as AiStepParams} onParams={onParams} />;
  }

  return null;
}

// Generative step: pick the worker + configure the FULL prompt via PromptBuilder.
// The config is stored complete (seeded from DEFAULT_CONFIG) so the bake applies
// exactly what's shown here. This step is skipped by the live /graded preview —
// it only runs during a bake, editing the previous step's working image.
function AiStepEditor({
  params,
  onParams,
}: {
  params: AiStepParams;
  onParams: (p: Record<string, unknown>) => void;
}) {
  const provider = params.provider === "higgsfield" ? "higgsfield" : "chatgpt";
  const config: PromptConfig = { ...DEFAULT_CONFIG, ...(params.config ?? {}) };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-neutral-400">Provider</span>
        <select
          className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1"
          value={provider}
          onChange={(e) => onParams({ provider: e.target.value })}
        >
          <option value="chatgpt">ChatGPT (web)</option>
          <option value="higgsfield">Higgsfield</option>
        </select>
      </div>
      <p className="text-[11px] text-neutral-500">
        Rigenera l'immagine di lavoro con questa config. In un bake multi-pass,
        l'output diventa l'input dello step successivo.
      </p>
      <PromptBuilder
        value={config}
        onChange={(next) => onParams({ config: next })}
        showPreview={false}
      />
    </div>
  );
}

function ColorSlider({
  label,
  k,
  p,
  onParams,
}: {
  label: string;
  k: string;
  p: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
}) {
  const v = num(p[k], 0);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-neutral-400 flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-200">{v > 0 ? `+${v}` : v}</span>
      </span>
      <input
        type="range"
        min={-100}
        max={100}
        value={v}
        onChange={(e) => onParams({ [k]: Number(e.target.value) })}
        onDoubleClick={() => onParams({ [k]: 0 })}
        title="doppio click = 0"
      />
    </label>
  );
}
