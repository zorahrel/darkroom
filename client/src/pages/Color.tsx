import { useEffect, useRef, useState } from "react";
import {
  api,
  gradedPreviewUrl,
  type ColorGrade,
  type Lut,
  type PipelineStatus,
  type PromptConfig,
} from "../api";
import StepEditor from "../components/StepEditor";
import PromptBuilder from "../components/PromptBuilder";

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
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            Dall'<b className="text-neutral-200">input</b> agli step di{" "}
            <b className="text-neutral-200">trasformazione</b> fino all'
            <b className="text-neutral-200">output</b>. Scegli la sorgente (cartella
            o prompt), componi la catena, poi cuoci ed esporta i finali.
          </p>
        </div>
        <div className="flex-1" />
        {browserAlive === false && (
          <span
            className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-200 border border-red-900 self-center whitespace-nowrap"
            title="La generazione AI richiede il browser ChatGPT. Avvialo dall'header."
          >
            ⚠ worker offline
          </span>
        )}
      </div>

      {run.msg && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-200">
          {run.msg}
        </div>
      )}

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
                {run.active && run.msg.startsWith("Rigenero") ? "⏳ Rigenero…" : "✨ Rigenera preferite"}
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
                {run.active && run.msg.startsWith("Genero") ? "⏳ Genero…" : "✨ Genera da prompt"}
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
        <StepEditor grade={grade} onChange={(g) => patch(g)} luts={luts} />

        <LivePreview grade={grade} />
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
            ▶ Esporta finali
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
        <span className="text-neutral-500 text-xs">{open ? "▲ chiudi" : "▼ apri"}</span>
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

// Live preview: one representative favorite, re-graded on the fly as the steps
// change (debounced), so the LUT dose is judged instantly without waiting for
// the whole grid to re-render. Hold the image to compare the base.
function LivePreview({ grade }: { grade: ColorGrade }) {
  const [fav, setFav] = useState<{ id: string; v: number } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState(false);
  const timer = useRef<number | null>(null);
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

  // Debounce the URL recompute so a drag fires a few requests, not one per pixel.
  useEffect(() => {
    if (!fav) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSrc(gradedPreviewUrl(fav.id, fav.v, grade, W));
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // Re-run when the grade (steps) changes — serialize as the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fav, grade.enabled, JSON.stringify(grade.steps)]);

  // Preload → swap so dragging never flashes blank while the server renders.
  useEffect(() => {
    if (!src) return;
    setLoading(true);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setShown(src);
        setLoading(false);
      }
    };
    img.onerror = () => !cancelled && setLoading(false);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  const baseSrc = fav
    ? `/thumb/gen/${encodeURIComponent(fav.id)}/v${String(fav.v).padStart(2, "0")}.png?w=${W}`
    : null;

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
