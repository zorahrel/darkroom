import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ColorGrade,
  type Lut,
  type PipelineStatus,
  type PromptConfig,
} from "../api";
import PromptBuilder from "../components/PromptBuilder";

// The pipeline toolbar that sits ATOP the single photo library:
//   original → AI edit (full config) → local color grade → export.
// Grade + graded-view are owned by the parent (Home) and shared with the grid,
// so the library itself is the live preview surface — no separate contact sheet.
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
  // Stage 1 also owns the global prompt (the full config sent to the AI edit).
  const [defaultConfig, setDefaultConfig] = useState<PromptConfig | null>(null);
  const [defaultPromptPreview, setDefaultPromptPreview] = useState("");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    api.getDefaultConfig().then((r) => {
      setDefaultConfig(r.config);
      setDefaultPromptPreview(r.prompt);
    });
    return () => {
      cancelled.current = true;
    };
  }, []);

  // Live pipeline status (queue of the set + current gen config), 2.5s.
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

  const lutGroups = useMemo(() => {
    const m = new Map<string, Lut[]>();
    for (const l of luts) {
      const arr = m.get(l.group) ?? [];
      arr.push(l);
      m.set(l.group, arr);
    }
    return [...m.entries()];
  }, [luts]);

  const q = status?.queue ?? {};
  const active = (q.pending ?? 0) + (q.running ?? 0);
  const g = status?.generation;

  async function waitQueueIdle() {
    // Poll until the set has no pending/running jobs. Survives cap pauses
    // (the runner auto-resumes); bails if the page unmounts.
    for (let i = 0; i < 900 && !cancelled.current; i++) {
      const s = await api.pipelineStatus().catch(() => null);
      if (s) setStatus(s);
      const a = s ? (s.queue.pending ?? 0) + (s.queue.running ?? 0) : 1;
      if (a === 0) return true;
      await new Promise((r) => setTimeout(r, 4000));
    }
    return false;
  }

  async function stageRegenerate() {
    const r = await api.pipelineRegenerate();
    return r.queued;
  }
  async function stagePromote() {
    const r = await api.pipelinePromoteLatest();
    onChanged(); // refresh the library grid — favorites moved
    return r.promoted;
  }
  async function stageExport() {
    return api.exportFavorites();
  }

  async function runFull() {
    if (run.active) return;
    cancelled.current = false;
    setRun({ active: true, msg: "Stage 1 — invio le preferite all'AI (config completa)…" });
    try {
      const queued = await stageRegenerate();
      setRun({ active: true, msg: `Stage 1 — ${queued} in generazione…` });
      await waitQueueIdle();
      setRun({ active: true, msg: "Stage 3 — promuovo le ultime versioni…" });
      const promoted = await stagePromote();
      setRun({ active: true, msg: "Stage 4 — export finali (base + LUT)…" });
      const ex = await stageExport();
      setRun({
        active: false,
        msg: `Pipeline completata · ${promoted} promosse · ${ex.copied}/${ex.total} esportate ${ex.graded ? "con grade" : "(base)"} → ${ex.dir}`,
      });
    } catch (e) {
      setRun({ active: false, msg: "Errore pipeline: " + String(e) });
    }
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
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            originale → <b className="text-neutral-200">AI edit</b> (config completa) →{" "}
            <b className="text-neutral-200">color grade</b> locale → export. Ogni
            fase è controllabile; il comando unico esegue tutta la catena, e la
            libreria qui sotto è l'anteprima live.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={runFull}
          disabled={run.active}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait text-white font-medium"
        >
          {run.active ? "⏳ Pipeline in corso…" : "▶ Esegui pipeline completa"}
        </button>
      </div>

      {run.msg && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-200">
          {run.msg}
        </div>
      )}

      {/* ---- Stage 1: AI generation (full config) ---- */}
      <section className="mb-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 border border-sky-900">
            Stage 1
          </span>
          <h2 className="text-sm font-semibold">Generazione AI — config completa</h2>
          <div className="flex-1" />
          {active > 0 ? (
            <span className="text-xs text-amber-300">
              in coda: {active} ({q.running ?? 0} attivi)
            </span>
          ) : (
            <span className="text-xs text-neutral-500">coda idle</span>
          )}
          <button
            onClick={() => setShowPromptEditor((v) => !v)}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
          >
            {showPromptEditor ? "Chiudi prompt" : "Modifica prompt globale"}
          </button>
          <button
            onClick={() =>
              oneStage(stageRegenerate, "Stage 1 — rigenero il set")
            }
            disabled={run.active}
            className="text-sm px-3 py-1.5 rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-50 text-white"
          >
            Rigenera set
          </button>
        </div>
        {!showPromptEditor && g && (
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-300 content-start">
              <Row k="film stock" v={g.film_stock} />
              <Row k="contrasto" v={g.contrast} />
              <Row k="ombre" v={g.shadows} />
              <Row k="grana" v={g.grain} />
              <Row k="white balance" v={g.white_balance} />
              <Row k="palette" v={g.palette} />
            </dl>
            <div className="text-neutral-400 leading-relaxed max-h-28 overflow-auto rounded bg-neutral-950/50 p-2 border border-neutral-800">
              <span className="text-neutral-500">freeform: </span>
              {g.freeform.slice(0, 320)}
              {g.freeform.length > 320 ? "…" : ""}
            </div>
          </div>
        )}
        {showPromptEditor && defaultConfig && (
          <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 space-y-3">
            <div className="text-xs font-medium text-neutral-400">
              Config completa (prompt globale, default per tutte le foto)
            </div>
            <PromptBuilder
              value={defaultConfig}
              onChange={setDefaultConfig}
              previewPrompt={defaultPromptPreview}
            />
            <div className="flex justify-end gap-2">
              <button
                disabled={savingPrompt}
                onClick={async () => {
                  setSavingPrompt(true);
                  try {
                    const res = await api.setDefaultConfig(defaultConfig);
                    setDefaultPromptPreview(res.prompt);
                    api.pipelineStatus().then(setStatus).catch(() => {});
                    setShowPromptEditor(false);
                  } finally {
                    setSavingPrompt(false);
                  }
                }}
                className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
              >
                {savingPrompt ? "Salvo…" : "Salva default"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---- Stage 2: local color grade ---- */}
      <section className="mb-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs px-1.5 py-0.5 rounded bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-900">
            Stage 2
          </span>
          <h2 className="text-sm font-semibold">Color grade locale</h2>
          <div className="flex-1" />
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-neutral-400">LUT</span>
            <select
              className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5"
              value={grade.lut}
              onChange={(e) => patch({ lut: e.target.value })}
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
            {luts.length === 0 && (
              <span className="text-[11px] text-neutral-500">
                Nessuna LUT: metti dei file .cube in data/luts (o GALLERY_LUT_DIR).
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-400">
              Dose LUT · <b className="text-neutral-200">{grade.dose}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={grade.dose}
              onChange={(e) => patch({ dose: Number(e.target.value) })}
            />
          </label>

          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={grade.awb}
                onChange={(e) => patch({ awb: e.target.checked })}
              />
              AWB robusto (uniforma il bianco)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={grade.pop}
                onChange={(e) => patch({ pop: e.target.checked })}
              />
              Pink pop (rosa più chiari e coerenti)
            </label>
          </div>
        </div>
      </section>

      {/* ---- Stage 3: promote + export ---- */}
      <section className="mb-1 p-3 rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-900">
            Stage 3
          </span>
          <h2 className="text-sm font-semibold">Commit &amp; export</h2>
          <div className="flex-1" />
          <label className="flex items-center gap-2 text-sm mr-2">
            <input
              type="checkbox"
              checked={gradedView}
              onChange={(e) => setGradedView(e.target.checked)}
            />
            Anteprima gradata nella griglia
          </label>
          <button
            onClick={() => oneStage(stagePromote, "Promuovo le ultime versioni")}
            disabled={run.active}
            className="text-sm px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
          >
            Promuovi ultime versioni
          </button>
          <button
            onClick={() => oneStage(stageExport, "Esporto i finali")}
            disabled={run.active}
            className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
          >
            Esporta finali
          </button>
          <span className="text-xs text-neutral-500">
            {status?.favorites ?? 0} preferite
          </span>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-neutral-200 font-medium">{v}</dd>
    </>
  );
}

function shortResult(r: unknown): string {
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (typeof o.queued === "number") return `${o.queued} in coda`;
    if (typeof o.promoted === "number") return `${o.promoted} promosse`;
    if (typeof o.copied === "number") return `${o.copied}/${o.total} esportate`;
  }
  return "";
}
