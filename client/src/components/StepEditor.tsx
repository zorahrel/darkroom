import { useMemo, useState } from "react";
import {
  type ColorGrade,
  type GradeStep,
  type GradeStepType,
  type Lut,
  type PromptConfig,
  type AiStepParams,
  DEFAULT_CONFIG,
  HSL_BANDS,
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
  const lutGroups = useMemo(() => groupLuts(luts), [luts]);

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
  function resetParams(i: number) {
    const s = steps[i];
    if (!s) return;
    patchStep(i, { params: newStep(s.type).params });
  }
  function add(type: GradeStepType) {
    setSteps([...steps, newStep(type)]);
  }

  return (
    <div className="space-y-2" onMouseLeave={() => onHoverStep?.(null)}>
      {steps.map((s, i) => (
        // The AI/generative step is bake-only and configured from the photo's
        // AI-edit card, not here — hide it so the pipeline reads as color-only
        // and there's a single AI-edit surface.
        s.type === "ai" ? null : (
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
            <div className="flex-1" />
            <span
              className="text-[11px] text-neutral-500 truncate max-w-[48%] text-right hidden sm:inline"
              title={stepSummary(s)}
            >
              {stepSummary(s)}
            </span>
            {isStepTouched(s) && (
              <button
                onClick={() => resetParams(i)}
                className="text-neutral-500 hover:text-white text-sm px-1 leading-none"
                aria-label="ripristina valori di default"
                title="ripristina default"
              >
                ↺
              </button>
            )}
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
        )
      ))}

      <AddStep onAdd={add} />
    </div>
  );
}

// Exported so the mobile toolbar panel can group LUTs the same way without
// duplicating the grouping logic.
export function groupLuts(luts: Lut[]): [string, Lut[]][] {
  const m = new Map<string, Lut[]>();
  for (const l of luts) {
    const arr = m.get(l.group) ?? [];
    arr.push(l);
    m.set(l.group, arr);
  }
  return [...m.entries()];
}

function AddStep({ onAdd }: { onAdd: (t: GradeStepType) => void }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs text-neutral-500">aggiungi step:</span>
      {STEP_ORDER.filter((t) => t !== "ai").map((t) => (
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

// True when a step's params have been edited away from its type's defaults —
// used to show the per-step reset affordance only when it would do something.
export function isStepTouched(s: GradeStep): boolean {
  if (s.type === "ai") return false;
  return JSON.stringify(s.params) !== JSON.stringify(newStep(s.type).params);
}

// One-line digest of a step's params, shown in the (collapsed) header so the
// whole pipeline reads at a glance — and so the AI step never looks inert.
// Exported for reuse by the mobile bottom-toolbar panel (same digest, same source).
export function stepSummary(s: GradeStep): string {
  const p = s.params;
  switch (s.type) {
    case "white_balance":
      return bool(p.scene_match) ? "scene-match" : bool(p.awb) ? "AWB" : "off";
    case "levels":
      return `nero ${num(p.black, 0.4)} · bianco ${num(p.white, 99.6)}`;
    case "sakura":
      return "auto";
    case "sky":
      return `+${num(p.amount, 40)}%`;
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
    case "hsl": {
      const bands = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
      const active = bands.filter(
        (b) => num(p[`hue_${b}`]) || num(p[`sat_${b}`]) || num(p[`lum_${b}`]),
      );
      return active.length ? `${active.length} bande` : "neutro";
    }
    case "curve": {
      if (Array.isArray(p.points) && p.points.length >= 2) return `curva · ${p.points.length} punti`;
      const perCh = ["points_r", "points_g", "points_b"].some((k) => Array.isArray(p[k]));
      if (perCh) return "curve per-canale";
      const active = ["shadows", "darks", "lights", "highlights"].filter((k) => num(p[k]));
      return active.length ? `${active.length} zone` : "lineare";
    }
    case "split_tone": {
      const active = ["shadows", "midtones", "highlights"].filter((r) => num(p[`${r}_sat`]));
      return active.length ? `${active.length} tinte` : "neutro";
    }
    case "color": {
      const keys: [string, string][] = [
        ["exposure", "esp"],
        ["contrast", "contr"],
        ["highlights", "alte"],
        ["shadows", "ombre"],
        ["whites", "bianchi"],
        ["blacks", "neri"],
        ["temp", "temp"],
        ["tint", "tint"],
        ["saturation", "sat"],
        ["brightness", "lum"],
        ["vibrance", "vibr"],
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

// Exported for reuse by the mobile bottom-toolbar panel — same per-type
// controls, rendered inside a ToolPanel instead of an always-expanded card.
export function StepParams({
  step,
  lutGroups,
  onParams,
}: {
  step: GradeStep;
  lutGroups: [string, Lut[]][];
  onParams: (p: Record<string, unknown>) => void;
}) {
  const p = step.params;
  // Selected HSL band (only meaningful for the 'hsl' step); declared here so the
  // hook order stays stable across step types.
  const [hslBand, setHslBand] = useState<string>("red");

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

  if (step.type === "sky") {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-400 flex items-center justify-between">
          <span>Schiarisci i celesti (cielo)</span>
          <span className="tabular-nums text-neutral-200">{num(p.amount, 40)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={num(p.amount, 40)}
          onChange={(e) => onParams({ amount: Number(e.target.value) })}
        />
        <p className="text-[11px] text-neutral-500">
          Maschera solo le tonalità ciano/blu chiare (cielo) e le schiarisce —
          non tocca insegne, vestiti o acqua molto saturi.
        </p>
      </label>
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

  if (step.type === "hsl") {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {HSL_BANDS.map((b) => {
            const active = hslBand === b.key;
            const touched =
              num(p[`hue_${b.key}`]) || num(p[`sat_${b.key}`]) || num(p[`lum_${b.key}`]);
            return (
              <button
                key={b.key}
                onClick={() => setHslBand(b.key)}
                className={
                  "px-2 py-1 rounded text-xs border " +
                  (active
                    ? "border-sky-500 text-white bg-sky-900/30"
                    : "border-neutral-700 text-neutral-400 hover:text-white")
                }
              >
                {b.label}
                {touched ? <span className="ml-1 text-sky-400">•</span> : null}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-y-2">
          <ColorSlider label="Tonalità" k={`hue_${hslBand}`} p={p} onParams={onParams} />
          <ColorSlider label="Saturazione" k={`sat_${hslBand}`} p={p} onParams={onParams} />
          <ColorSlider label="Luminanza" k={`lum_${hslBand}`} p={p} onParams={onParams} />
        </div>
        <p className="text-[11px] text-neutral-500">
          Regola una banda di colore alla volta (come il Color Mixer di Lightroom).
        </p>
      </div>
    );
  }

  if (step.type === "curve") {
    const importedPoints = Array.isArray(p.points) ? (p.points as unknown[]) : null;
    return (
      <div className="space-y-3 text-sm">
        {importedPoints && importedPoints.length >= 2 ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-900/60 bg-sky-950/20 px-3 py-2">
            <span className="text-sky-200 text-xs flex-1">
              Curva importata · {importedPoints.length} punti
            </span>
            <button
              onClick={() => onParams({ points: null })}
              className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:text-white"
            >
              Rimuovi
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            <ColorSlider label="Alte luci" k="highlights" p={p} onParams={onParams} />
            <ColorSlider label="Chiari" k="lights" p={p} onParams={onParams} />
            <ColorSlider label="Scuri" k="darks" p={p} onParams={onParams} />
            <ColorSlider label="Ombre" k="shadows" p={p} onParams={onParams} />
          </div>
        )}
        {(["points_r", "points_g", "points_b"] as const).some((k) => Array.isArray(p[k])) && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-900/60 bg-sky-950/20 px-3 py-2">
            <span className="text-sky-200 text-xs flex-1">
              Curve per-canale:{" "}
              {(["points_r", "points_g", "points_b"] as const)
                .filter((k) => Array.isArray(p[k]))
                .map((k) => k.slice(-1).toUpperCase())
                .join(" · ")}
            </span>
            <button
              onClick={() => onParams({ points_r: null, points_g: null, points_b: null })}
              className="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-300 hover:text-white"
            >
              Rimuovi
            </button>
          </div>
        )}
        <p className="text-[11px] text-neutral-500">
          Curva parametrica sui quarti tonali. Un import Lightroom con curva a punti
          (composita o per-canale R/G/B) la applica esattamente.
        </p>
      </div>
    );
  }

  if (step.type === "split_tone") {
    return (
      <div className="space-y-2 text-sm">
        <RegionTint label="Ombre" region="shadows" p={p} onParams={onParams} />
        <RegionTint label="Mezzitoni" region="midtones" p={p} onParams={onParams} />
        <RegionTint label="Alte luci" region="highlights" p={p} onParams={onParams} />
        <label className="flex flex-col gap-1 pt-1">
          <span className="text-neutral-400 flex items-center justify-between">
            <span>Bilanciamento (ombre ↔ luci)</span>
            <span className="tabular-nums text-neutral-200">{num(p.balance, 0)}</span>
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            value={num(p.balance, 0)}
            onChange={(e) => onParams({ balance: Number(e.target.value) })}
            onDoubleClick={() => onParams({ balance: 0 })}
          />
        </label>
      </div>
    );
  }

  if (step.type === "color") {
    return (
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Toni</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            <ColorSlider label="Esposizione" k="exposure" p={p} onParams={onParams} />
            <ColorSlider label="Contrasto" k="contrast" p={p} onParams={onParams} />
            <ColorSlider label="Alte luci" k="highlights" p={p} onParams={onParams} />
            <ColorSlider label="Ombre" k="shadows" p={p} onParams={onParams} />
            <ColorSlider label="Bianchi" k="whites" p={p} onParams={onParams} />
            <ColorSlider label="Neri" k="blacks" p={p} onParams={onParams} />
            <ColorSlider label="Luminosità" k="brightness" p={p} onParams={onParams} />
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">Colore</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            <ColorSlider label="Temperatura (freddo ↔ caldo)" k="temp" p={p} onParams={onParams} />
            <ColorSlider label="Tinta (verde ↔ magenta)" k="tint" p={p} onParams={onParams} />
            <ColorSlider label="Saturazione" k="saturation" p={p} onParams={onParams} />
            <ColorSlider label="Vividezza (protegge i colori già saturi)" k="vibrance" p={p} onParams={onParams} />
          </div>
        </div>
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

// One tonal region of the split-tone step: a hue (0-360) + saturation (0-100)
// pair with a live swatch of the resulting tint.
function RegionTint({
  label,
  region,
  p,
  onParams,
}: {
  label: string;
  region: string;
  p: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
}) {
  const hue = num(p[`${region}_hue`], 0);
  const sat = num(p[`${region}_sat`], 0);
  return (
    <div className="rounded-lg border border-neutral-800 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span
          className="w-4 h-4 rounded-full border border-neutral-700"
          style={{ background: sat > 0 ? `hsl(${hue} ${sat}% 55%)` : "transparent" }}
        />
        <span className="text-neutral-300">{label}</span>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-neutral-500 flex items-center justify-between">
          <span>Tonalità</span>
          <span className="tabular-nums">{hue}°</span>
        </span>
        <input
          type="range"
          min={0}
          max={360}
          value={hue}
          onChange={(e) => onParams({ [`${region}_hue`]: Number(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[11px] text-neutral-500 flex items-center justify-between">
          <span>Saturazione</span>
          <span className="tabular-nums">{sat}</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={sat}
          onChange={(e) => onParams({ [`${region}_sat`]: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
