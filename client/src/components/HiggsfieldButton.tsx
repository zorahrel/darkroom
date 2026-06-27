import { useEffect, useMemo, useRef, useState } from "react";
import { api, type HiggsfieldModel, type HiggsfieldStatus } from "../api";

export default function HiggsfieldButton({
  photoId,
  initialSelection,
  onEnqueued,
}: {
  photoId: string;
  initialSelection?: string | null;
  onEnqueued: () => void | Promise<unknown>;
}) {
  const saved = useMemo(() => {
    if (!initialSelection) return null;
    try {
      return JSON.parse(initialSelection) as {
        model: string;
        params?: Record<string, string>;
      };
    } catch {
      return null;
    }
  }, [initialSelection]);

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<HiggsfieldStatus | null>(null);
  const [models, setModels] = useState<HiggsfieldModel[]>([]);
  const [modelId, setModelId] = useState<string>(saved?.model ?? "nano_banana_pro");
  const [params, setParams] = useState<Record<string, string>>(saved?.params ?? {});
  const [touchedParams, setTouchedParams] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [costing, setCosting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load status + models when the panel first opens.
  useEffect(() => {
    if (!open || models.length) return;
    api.higgsfieldStatus().then(setStatus).catch(() => {});
    api
      .higgsfieldModels()
      .then((r) => setModels(r.models))
      .catch(() => {});
  }, [open, models.length]);

  const model = useMemo(
    () => models.find((m) => m.id === modelId) ?? null,
    [models, modelId],
  );

  // Set params for the selected model: keep the saved selection for the saved
  // model (until the user changes anything), otherwise fall back to defaults.
  useEffect(() => {
    if (!model) return;
    const next: Record<string, string> = {};
    for (const p of model.parameters) {
      if (p.options && p.options.length) {
        next[p.name] = p.default ?? p.options[0] ?? "";
      }
    }
    // Aspect ratio is a separate field on the model; default to portrait 3:4
    // (matches most Japan shots) so edits keep the original orientation.
    if (model.aspect_ratios?.length) {
      next.aspect_ratio = model.aspect_ratios.includes("3:4")
        ? "3:4"
        : (model.aspect_ratios[0] ?? "");
    }
    if (!touchedParams && saved?.model === model.id && saved.params) {
      for (const [k, val] of Object.entries(saved.params)) {
        if (k in next) next[k] = val;
      }
    }
    setParams(next);
  }, [model, saved, touchedParams]);

  // Live cost preflight (debounced) on model/param change.
  useEffect(() => {
    if (!open || !modelId) return;
    let alive = true;
    setCosting(true);
    const t = setTimeout(() => {
      api
        .higgsfieldCost(modelId, params)
        .then((r) => {
          if (alive) setCost(r.cost?.credits_exact ?? null);
        })
        .catch(() => alive && setCost(null))
        .finally(() => alive && setCosting(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, modelId, params]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Only show param dropdowns we know how to render (enum options).
  const enumParams = (model?.parameters ?? []).filter(
    (p) => p.options && p.options.length > 1,
  );

  const credits = status?.credits;
  const notEnough =
    typeof credits === "number" && cost !== null && credits < cost;

  async function submit() {
    setSubmitting(true);
    try {
      await api.generateHiggsfield(photoId, modelId, params);
      setOpen(false);
      await onEnqueued();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative inline-block" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 normal-case font-medium tracking-normal text-white"
      >
        ✨ Higgsfield
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-3 shadow-xl space-y-3 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-200">
              Genera con Higgsfield
            </span>
            {typeof credits === "number" && (
              <span className="text-[10px] text-neutral-400">
                {credits.toFixed(1)} crediti
              </span>
            )}
          </div>

          {status && !status.configured && (
            <div className="text-[11px] text-amber-300">
              Higgsfield non collegato (manca il token OAuth).
            </div>
          )}

          {models.length === 0 ? (
            <div className="text-[11px] text-neutral-500">Carico modelli…</div>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Modello
                </span>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full text-xs rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-neutral-100"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.provider_name}
                    </option>
                  ))}
                </select>
              </label>

              {model?.description && (
                <p className="text-[10px] text-neutral-500 leading-snug">
                  {model.description}
                </p>
              )}

              {model?.aspect_ratios?.length ? (
                <label className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    aspect ratio
                  </span>
                  <select
                    value={params.aspect_ratio ?? ""}
                    onChange={(e) => {
                      setTouchedParams(true);
                      setParams((prev) => ({
                        ...prev,
                        aspect_ratio: e.target.value,
                      }));
                    }}
                    className="w-full text-xs rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-neutral-100"
                  >
                    {model.aspect_ratios.map((ar) => (
                      <option key={ar} value={ar}>
                        {ar}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {enumParams.map((p) => (
                <label key={p.name} className="block space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    {p.name}
                  </span>
                  <select
                    value={params[p.name] ?? p.default ?? ""}
                    onChange={(e) => {
                      setTouchedParams(true);
                      setParams((prev) => ({ ...prev, [p.name]: e.target.value }));
                    }}
                    className="w-full text-xs rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-neutral-100"
                  >
                    {p.options!.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-neutral-400">
                  Costo:{" "}
                  {costing ? (
                    <span className="text-neutral-500">…</span>
                  ) : cost !== null ? (
                    <span className="text-fuchsia-300 font-medium">
                      {cost} cr
                    </span>
                  ) : (
                    <span className="text-neutral-600">n/d</span>
                  )}
                </span>
                <button
                  onClick={submit}
                  disabled={submitting || notEnough}
                  className="text-xs px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-40 text-white font-medium"
                >
                  {submitting
                    ? "Enqueue…"
                    : notEnough
                      ? "Crediti insuff."
                      : `Genera${cost !== null ? ` (${cost} cr)` : ""}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
