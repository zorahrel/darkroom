import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Scegli, Spunta } from "../ui";
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
                className="text-neutral-400 hover:text-white disabled:opacity-20 leading-none text-xs"
                aria-label="su"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                className="text-neutral-400 hover:text-white disabled:opacity-20 leading-none text-xs"
                aria-label="giù"
              >
                ▼
              </button>
            </div>
            <span className="text-[10px] tabular-nums text-neutral-400 w-4">{i + 1}</span>
            <Spunta segnata={s.enabled} onCambia={(v) => patchStep(i, { enabled: v })}
                    titolo={s.enabled ? "Questo passo è acceso" : "Questo passo è spento"}>
              <span className={`text-[13px] font-medium ${s.enabled ? "text-neutral-100" : "text-neutral-400"}`}>
                {STEP_LABELS[s.type]}
              </span>
            </Spunta>
            <div className="flex-1" />
            <span
              className="text-[11px] text-neutral-400 truncate max-w-[48%] text-right hidden sm:inline"
              title={stepSummary(s)}
            >
              {stepSummary(s)}
            </span>
            {isStepTouched(s) && (
              <button
                onClick={() => resetParams(i)}
                className="text-neutral-400 hover:text-white text-sm px-1 leading-none"
                aria-label="ripristina valori di default"
                title="ripristina default"
              >
                ↺
              </button>
            )}
            <button
              onClick={() => remove(i)}
              className="text-neutral-400 hover:text-red-400 text-sm px-1"
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
      <span className="text-xs text-neutral-400">aggiungi step:</span>
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
  const base = summaryBody(s);
  const mask = (s.params.mask as { type?: string } | undefined)?.type;
  if (mask === "radial") return `${base} · mask ◎`;
  if (mask === "linear") return `${base} · mask ▤`;
  return base;
}

function summaryBody(s: GradeStep): string {
  const p = s.params;
  switch (s.type) {
    case "white_balance":
      return bool(p.scene_match) ? "scene-match" : bool(p.awb) ? "AWB" : "off";
    case "levels":
      return `nero ${num(p.black, 0.4)} · bianco ${num(p.white, 99.6)}${bool(p.soft) ? " · alte luci protette" : ""}`;
    case "sakura": {
      const bits: string[] = [];
      if (num(p.hue_shift, 0)) bits.push(`${num(p.hue_shift, 0) > 0 ? "+" : ""}${num(p.hue_shift, 0)}°`);
      if (num(p.sat, 0)) bits.push(`colore ${num(p.sat, 0) > 0 ? "+" : ""}${num(p.sat, 0)}%`);
      return bits.length ? bits.join(" · ") : "auto";
    }
    case "match":
      return "per post";
    case "sky": {
      const bits = [`+${num(p.amount, 40)}%`];
      if (num(p.desat, 0)) bits.push(`spento ${num(p.desat, 0)}%`);
      if (num(p.warm, 0)) bits.push(`-ciano ${num(p.warm, 0)}%`);
      return bits.join(" · ");
    }
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
// Wraps the per-type body with the shared local-mask controls (every step but
// the generative one can be masked to a radial/linear region).
export function StepParams(props: {
  step: GradeStep;
  lutGroups: [string, Lut[]][];
  onParams: (p: Record<string, unknown>) => void;
}) {
  if (props.step.type === "ai") return <StepBody {...props} />;
  return (
    <div className="space-y-3">
      <StepBody {...props} />
      <MaskControls params={props.step.params} onParams={props.onParams} />
    </div>
  );
}

function StepBody({
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
      <div className="space-y-2.5 text-sm">
        <Spunta segnata={bool(p.awb)} onCambia={(v) => onParams({ awb: v })}>
          AWB robusto (cast stimato dai grigi)
        </Spunta>
        <Spunta segnata={bool(p.scene_match)} onCambia={(v) => onParams({ scene_match: v })}>
          Scene-match (WB uniforme fra scatti gemelli)
        </Spunta>
        <p className="text-[11px] text-neutral-400 leading-snug">
          Scene-match, dove attivo, sostituisce l'AWB per-immagine con un gain
          condiviso dal gruppo.
        </p>
      </div>
    );
  }

  if (step.type === "levels") {
    return (
      <div className="space-y-2.5 text-sm">
        <SliderRow
          label="Nero (percentile)"
          value={num(p.black, 0.4)}
          onChange={(v) => onParams({ black: v })}
          min={0}
          max={5}
          step={0.1}
          format={(v) => v.toFixed(1)}
          resetTo={0.4}
        />
        <SliderRow
          label="Bianco (percentile)"
          value={num(p.white, 99.6)}
          onChange={(v) => onParams({ white: v })}
          min={95}
          max={100}
          step={0.1}
          format={(v) => v.toFixed(1)}
          resetTo={99.6}
        />
        <Spunta segnata={bool(p.soft)} onCambia={(v) => onParams({ soft: v })}>
          <span className="block">
            Proteggi le alte luci
            <span className="block text-[11px] text-neutral-400 leading-snug">
              Comprime i toni chiari verso il bianco invece di bruciarli — utile
              su cieli e insegne molto luminose.
            </span>
          </span>
        </Spunta>
      </div>
    );
  }

  if (step.type === "sakura") {
    return (
      <div className="space-y-2.5 text-sm">
        <SliderRow
          label="Tinta dei sakura (viola → rosa)"
          value={num(p.hue_shift, 0)}
          onChange={(v) => onParams({ hue_shift: v })}
          min={-20}
          max={40}
          format={(v) => `${v > 0 ? "+" : ""}${v}°`}
          resetTo={0}
        />
        <SliderRow
          label="Colore dei sakura"
          value={num(p.sat, 0)}
          onChange={(v) => onParams({ sat: v })}
          min={-50}
          max={100}
          format={(v) => `${v > 0 ? "+" : ""}${v}%`}
          resetTo={0}
        />
        <p className="text-[11px] text-neutral-400 leading-snug">
          Schiarisce e uniforma i sakura. Questo passo di suo tira il rosa verso
          il grigio, e un bilanciamento freddo a valle lo spegne ancora: il
          cursore glielo rimette, solo dentro la banda del rosa — pelle, insegne
          rosse e tramonti restano dove sono.
        </p>
      </div>
    );
  }

  if (step.type === "match") {
    return (
      <p className="text-[11px] text-neutral-400 leading-snug">
        Allinea ogni foto al resto del suo <strong className="text-neutral-300">post</strong>:
        bilanciamento, esposizione e saturazione vengono avvicinati alla mediana
        del gruppo. Serve perché ogni render AI è indipendente, e due scatti
        dello stesso pomeriggio tornano con luci diverse — nel carosello si vede
        come uno scatto di luminosità mentre scorri. Non ha parametri: li calcola
        il server misurando l'intero post. Le foto fuori da un post non vengono
        toccate.
      </p>
    );
  }

  if (step.type === "bloom") {
    return (
      <div className="space-y-2.5 text-sm">
        <SliderRow
          label="Intensità"
          value={num(p.amount, 35)}
          onChange={(v) => onParams({ amount: v })}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          resetTo={35}
        />
        <SliderRow
          label="Soglia (da quanto in su alona)"
          value={num(p.threshold, 68)}
          onChange={(v) => onParams({ threshold: v })}
          min={20}
          max={95}
          format={(v) => `${v}%`}
          resetTo={68}
        />
        <SliderRow
          label="Raggio"
          value={num(p.radius, 14)}
          onChange={(v) => onParams({ radius: v })}
          min={2}
          max={48}
          format={(v) => `${v}px`}
          resetTo={14}
        />
        <SliderRow
          label="Estensione (1 = anche le mezze luci)"
          value={num(p.knee, 2)}
          onChange={(v) => onParams({ knee: v })}
          min={1}
          max={3}
          step={0.1}
          format={(v) => v.toFixed(1)}
          resetTo={2}
        />
        <SliderRow
          label="Concentrazione"
          value={num(p.gain, 1)}
          onChange={(v) => onParams({ gain: v })}
          min={1}
          max={5}
          step={0.1}
          format={(v) => `×${v.toFixed(1)}`}
          resetTo={1}
        />
        <p className="text-[11px] text-neutral-400 leading-snug">
          Alone morbido attorno alle luci esistenti. Con «Estensione» a 2 alonano
          solo i riflessi accecanti: su una scena senza specchi di luce — l'oro
          di un tetto, una lanterna diffusa — il bloom sparisce, e va portata
          verso 1. «Concentrazione» compensa la sfocatura, che sparpaglia
          l'alone finché non si vede più.
        </p>
      </div>
    );
  }

  if (step.type === "sky") {
    return (
      <div className="space-y-2.5 text-sm">
        <SliderRow
          label="Schiarisci i celesti (cielo)"
          value={num(p.amount, 40)}
          onChange={(v) => onParams({ amount: v })}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          resetTo={40}
        />
        <SliderRow
          label="Spegni il celeste (satura meno)"
          value={num(p.desat, 0)}
          onChange={(v) => onParams({ desat: v })}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          resetTo={0}
        />
        <SliderRow
          label="Togli il ciano (verso grigio-azzurro)"
          value={num(p.warm, 0)}
          onChange={(v) => onParams({ warm: v })}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          resetTo={0}
        />
        <p className="text-[11px] text-neutral-400 leading-snug">
          Maschera solo le tonalità ciano/blu chiare (cielo) e le schiarisce —
          non tocca insegne, vestiti o acqua molto saturi. «Spegni il celeste»
          toglie il cielo da cartolina lasciando intatti verdi e insegne blu:
          il Color Mixer non ci arriva pulito perché il cielo vero cade a ~215°,
          nella valle fra le bande aqua e blu.
        </p>
      </div>
    );
  }

  if (step.type === "lut") {
    const autoDose = bool(p.auto_dose);
    return (
      <div className="space-y-2.5 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-neutral-400">LUT</span>
          <Scegli
            valore={String(p.lut ?? "")}
            onCambia={(v) => onParams({ lut: v })}
            larghezza={264}
            taglia="m"
            voci={[
              { v: "", testo: "— nessuna —" },
              ...lutGroups.flatMap(([gruppo, arr]) =>
                arr.map((l) => ({ v: l.id, testo: l.name, gruppo }))),
            ]}
          />
        </label>
        <SliderRow
          label="Dose"
          value={num(p.dose, 80)}
          onChange={(v) => onParams({ dose: v })}
          min={0}
          max={100}
          format={(v) => `${v}%`}
          resetTo={80}
        />
        <Spunta segnata={autoDose} onCambia={(v) => onParams({ auto_dose: v })}>
          Auto-dose sulle notturne/rosso-dominanti
        </Spunta>
        {autoDose && (
          <SliderRow
            label="Dose notturne"
            value={num(p.dose_night, 30)}
            onChange={(v) => onParams({ dose_night: v })}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            resetTo={30}
          />
        )}
      </div>
    );
  }

  if (step.type === "hsl") {
    const hue = BAND_HUE[hslBand] ?? 0;
    const bandTouched = (key: string) =>
      num(p[`hue_${key}`]) || num(p[`sat_${key}`]) || num(p[`lum_${key}`]);
    const bandLabel = HSL_BANDS.find((b) => b.key === hslBand)?.label ?? hslBand;
    const isCeleste = hslBand === "aqua" || hslBand === "blue";
    const resetBand = () =>
      onParams({ [`hue_${hslBand}`]: 0, [`sat_${hslBand}`]: 0, [`lum_${hslBand}`]: 0 });
    return (
      <div className="space-y-2.5 text-sm">
        {/* All 8 bands as their own colour — the whole mixer is legible at a
            glance, and the target band (e.g. the celesti) is one tap away. */}
        <div className="grid grid-cols-8 gap-1">
          {HSL_BANDS.map((b) => {
            const bh = BAND_HUE[b.key] ?? 0;
            const active = hslBand === b.key;
            return (
              <button
                key={b.key}
                onClick={() => setHslBand(b.key)}
                title={b.label}
                aria-label={b.label}
                className={
                  "relative h-7 rounded-md border transition " +
                  (active
                    ? "border-white ring-2 ring-white/70"
                    : "border-black/40 hover:border-white/70")
                }
                style={{ background: bandColor(bh) }}
              >
                {bandTouched(b.key) ? (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-white border border-black/50" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-100 font-medium flex items-center gap-2">
            <span
              className="w-3.5 h-3.5 rounded-full border border-black/40"
              style={{ background: bandColor(hue) }}
            />
            {bandLabel}
            {isCeleste && <span className="text-[10px] text-sky-300/80">· celeste</span>}
          </span>
          <button
            onClick={resetBand}
            disabled={!bandTouched(hslBand)}
            className="text-[11px] px-2 py-0.5 rounded border border-neutral-700 text-neutral-400 hover:text-white disabled:opacity-30"
          >
            azzera banda
          </button>
        </div>
        <div className="grid grid-cols-1 gap-y-2.5">
          <MixerSlider label="Tonalità" k={`hue_${hslBand}`} p={p} onParams={onParams} hue={hue} kind="hue" />
          <MixerSlider label="Saturazione" k={`sat_${hslBand}`} p={p} onParams={onParams} hue={hue} kind="sat" />
          <MixerSlider label="Luminanza" k={`lum_${hslBand}`} p={p} onParams={onParams} hue={hue} kind="lum" />
        </div>
        <p className="text-[11px] text-neutral-400 leading-snug">
          Color mixer per banda (8 colori). Per abbassare i celesti: seleziona
          Acqua e Blu e riduci Saturazione/Luminanza.
        </p>
      </div>
    );
  }

  if (step.type === "curve") {
    const importedPoints = Array.isArray(p.points) ? (p.points as unknown[]) : null;
    return (
      <div className="space-y-2.5 text-sm">
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
          <div className="grid grid-cols-1 gap-y-2.5">
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
        <p className="text-[11px] text-neutral-400 leading-snug">
          Curva parametrica sui quarti tonali. Un import Lightroom con curva a punti
          (composita o per-canale R/G/B) la applica esattamente.
        </p>
      </div>
    );
  }

  if (step.type === "split_tone") {
    return (
      <div className="space-y-2.5 text-sm">
        <RegionTint label="Ombre" region="shadows" p={p} onParams={onParams} />
        <RegionTint label="Mezzitoni" region="midtones" p={p} onParams={onParams} />
        <RegionTint label="Alte luci" region="highlights" p={p} onParams={onParams} />
        <SliderRow
          label="Bilanciamento (ombre ↔ luci)"
          value={num(p.balance, 0)}
          onChange={(v) => onParams({ balance: v })}
          resetTo={0}
        />
      </div>
    );
  }

  if (step.type === "color") {
    return (
      <div className="space-y-2.5 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Toni</div>
          <div className="grid grid-cols-1 gap-y-2.5">
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
          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Colore</div>
          <div className="grid grid-cols-1 gap-y-2.5">
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
        <Scegli valore={provider} larghezza={160} taglia="m"
                onCambia={(v) => onParams({ provider: v })}
                voci={[{ v: "chatgpt", testo: "ChatGPT (web)" },
                       { v: "higgsfield", testo: "Higgsfield" }]} />
      </div>
      <p className="text-[11px] text-neutral-400">
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

// One compact, consistent slider row — label, live value, optional colour-tinted
// track, optional double-click-to-reset. Every step (levels, sky, lut, hsl mixer,
// curve, split-tone, color, local mask) renders its sliders through this so row
// height, value formatting and the reset affordance never drift between steps.
function SliderRow({
  label,
  value,
  onChange,
  min = -100,
  max = 100,
  step = 1,
  format = (v: number) => (v > 0 ? `+${v}` : `${v}`),
  track,
  resetTo,
  dense,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  track?: string;
  resetTo?: number;
  dense?: boolean;
}) {
  return (
    <label className={dense ? "flex flex-col gap-0.5" : "flex flex-col gap-1"}>
      <span
        className={
          dense
            ? "text-[11px] text-neutral-400 flex items-center justify-between"
            : "text-neutral-400 flex items-center justify-between"
        }
      >
        <span>{label}</span>
        <span className={dense ? "tabular-nums" : "tabular-nums text-neutral-200"}>
          {format(value)}
        </span>
      </span>
      <input
        type="range"
        className={track ? "dr-hue" : undefined}
        style={track ? ({ "--dr-track": track } as CSSProperties) : undefined}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={resetTo !== undefined ? () => onChange(resetTo) : undefined}
        title={resetTo !== undefined ? "doppio click = reset" : undefined}
      />
    </label>
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
  return (
    <SliderRow
      label={label}
      value={num(p[k], 0)}
      onChange={(v) => onParams({ [k]: v })}
      resetTo={0}
    />
  );
}

// Hue-band centres, mirrored from color_grade.py HSL_BANDS. Drive the coloured
// mixer swatches and slider tracks so what you see matches what the engine does.
const BAND_HUE: Record<string, number> = {
  red: 0, orange: 30, yellow: 60, green: 120,
  aqua: 180, blue: 240, purple: 290, magenta: 330,
};

function bandColor(hue: number, sat = 72, light = 52) {
  return `hsl(${hue} ${sat}% ${light}%)`;
}

// A color-mixer slider (à la DaVinci/Lightroom): the track is tinted to show the
// effect — a hue sweep, a grey→vivid ramp, or a dark→light ramp for the band.
function MixerSlider({
  label,
  k,
  p,
  onParams,
  hue,
  kind,
}: {
  label: string;
  k: string;
  p: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
  hue: number;
  kind: "hue" | "sat" | "lum";
}) {
  const track =
    kind === "hue"
      ? `linear-gradient(90deg, hsl(${hue - 40} 65% 50%), hsl(${hue} 72% 52%), hsl(${hue + 40} 65% 50%))`
      : kind === "sat"
        ? `linear-gradient(90deg, hsl(${hue} 4% 55%), hsl(${hue} 82% 50%))`
        : `linear-gradient(90deg, hsl(${hue} 45% 13%), hsl(${hue} 55% 52%), hsl(${hue} 38% 92%))`;
  return (
    <SliderRow
      label={label}
      value={num(p[k], 0)}
      onChange={(v) => onParams({ [k]: v })}
      track={track}
      resetTo={0}
    />
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
      <SliderRow
        label="Tonalità"
        value={hue}
        onChange={(v) => onParams({ [`${region}_hue`]: v })}
        min={0}
        max={360}
        format={(v) => `${v}°`}
        resetTo={0}
        dense
      />
      <SliderRow
        label="Saturazione"
        value={sat}
        onChange={(v) => onParams({ [`${region}_sat`]: v })}
        min={0}
        max={100}
        format={(v) => `${v}`}
        resetTo={0}
        dense
      />
    </div>
  );
}

// Defaults when a step's local mask is first turned on.
const MASK_RADIAL = { type: "radial", enabled: true, cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.4, invert: false };
const MASK_LINEAR = { type: "linear", enabled: true, angle: 0, pos: 0.5, feather: 0.4, invert: false };

// Shared local-mask editor: limits a step's effect to a radial or linear region.
// Numeric controls (no canvas) so it works identically on desktop and mobile;
// the engine (scripts/color_grade.py build_mask) blends the step over the input
// by the mask alpha. Collapsed by default so it never clutters a pristine step.
function MaskControls({
  params,
  onParams,
}: {
  params: Record<string, unknown>;
  onParams: (p: Record<string, unknown>) => void;
}) {
  const mask = (params.mask as Record<string, unknown> | undefined) ?? null;
  const type = mask ? String(mask.type) : "";
  const set = (patch: Record<string, unknown>) =>
    onParams({ mask: { ...(mask ?? {}), ...patch } });

  return (
    <details className="rounded-lg border border-neutral-800 bg-neutral-950/40" open={!!mask}>
      <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-neutral-400 hover:text-white flex items-center gap-2">
        Maschera locale
        {mask ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-200">
            {type === "radial" ? "radiale" : "lineare"}
            {bool(mask.invert) ? " · invertita" : ""}
          </span>
        ) : (
          <span className="text-[10px] text-neutral-400">nessuna</span>
        )}
      </summary>
      <div className="px-2.5 pb-2.5 pt-1 space-y-2">
        <div className="flex gap-1">
          {[
            ["", "Nessuna"],
            ["radial", "Radiale"],
            ["linear", "Lineare"],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() =>
                onParams({
                  mask: val === "" ? null : val === "radial" ? MASK_RADIAL : MASK_LINEAR,
                })
              }
              className={
                "px-2 py-1 rounded text-xs border " +
                (type === val
                  ? "border-sky-500 text-white bg-sky-900/30"
                  : "border-neutral-700 text-neutral-400 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {mask && type === "radial" && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <MaskSlider label="Centro X" k="cx" p={mask} set={set} />
            <MaskSlider label="Centro Y" k="cy" p={mask} set={set} />
            <MaskSlider label="Raggio X" k="rx" p={mask} set={set} def={0.4} />
            <MaskSlider label="Raggio Y" k="ry" p={mask} set={set} def={0.4} />
            <MaskSlider label="Sfumatura" k="feather" p={mask} set={set} def={0.4} />
          </div>
        )}

        {mask && type === "linear" && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <MaskSlider label="Angolo" k="angle" p={mask} set={set} min={0} max={360} step={1} pct={false} />
            <MaskSlider label="Posizione" k="pos" p={mask} set={set} />
            <MaskSlider label="Sfumatura" k="feather" p={mask} set={set} def={0.4} />
          </div>
        )}

        {mask && (
          <div className="pt-0.5">
            <Spunta segnata={bool(mask.invert)} onCambia={(v) => set({ invert: v })}>
              Inverti maschera
            </Spunta>
          </div>
        )}
        <p className="text-[11px] text-neutral-400 leading-snug">
          Applica lo step solo dentro la regione (radiale) o su un lato del
          gradiente (lineare). Il resto dell'immagine resta invariato.
        </p>
      </div>
    </details>
  );
}

function MaskSlider({
  label,
  k,
  p,
  set,
  min = 0,
  max = 1,
  step = 0.01,
  def = 0.5,
  pct = true,
}: {
  label: string;
  k: string;
  p: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  min?: number;
  max?: number;
  step?: number;
  def?: number;
  pct?: boolean;
}) {
  return (
    <SliderRow
      label={label}
      value={num(p[k], def)}
      onChange={(v) => set({ [k]: v })}
      min={min}
      max={max}
      step={step}
      format={(v) => (pct ? `${Math.round(v * 100)}%` : `${Math.round(v)}`)}
      resetTo={def}
      dense
    />
  );
}
