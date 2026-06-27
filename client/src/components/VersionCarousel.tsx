import { useEffect, useState } from "react";
import type { Version } from "../api";
import { genUrl } from "../api";
import CompareSlider from "./CompareSlider";

export default function VersionCarousel({
  versions,
  current,
  onChange,
  isFavorite,
  beforeSrc,
  onFavoriteToggle,
  onDelete,
}: {
  versions: Version[];
  current: number;
  onChange: (idx: number) => void;
  isFavorite: boolean;
  beforeSrc?: string;
  onFavoriteToggle: () => void;
  onDelete: () => void;
}) {
  const [compare, setCompare] = useState(false);
  // Keyboard: F toggles favorite. Photo navigation (←/→) is handled by the
  // Detail page; versions are switched via the on-screen ‹ › buttons.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }
      if (e.key.toLowerCase() === "f" && versions.length > 0) {
        onFavoriteToggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [versions.length, onFavoriteToggle]);

  const CONFIG_LABELS: Record<string, string> = {
    preset: "Preset",
    film_stock: "Pellicola",
    white_balance: "Bilanc. bianco",
    geometry: "Geometria",
    composition: "Composizione",
    harmony: "Armonia",
    time_of_day: "Luce",
    palette: "Palette",
    contrast: "Contrasto",
    grain: "Grana",
    shadows: "Ombre",
    highlights: "Highlight",
    bloom: "Bloom",
    dof: "DoF",
    skin_tones: "Skin/pink",
    food: "Cibo",
    atmosphere: "Atmosfera",
    cleanup: "Cleanup",
  };

  const ConfigSummary = ({ config }: { config?: string | null }) => {
    if (!config) return null;
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(config);
    } catch {
      return null;
    }
    const scalars = Object.entries(CONFIG_LABELS)
      .map(([k, label]) => [label, cfg[k]] as const)
      .filter(([, v]) => v != null && v !== "");
    const preserve = Array.isArray(cfg.preserve) ? (cfg.preserve as string[]) : [];
    const exclude = Array.isArray(cfg.exclude) ? (cfg.exclude as string[]) : [];
    const freeform =
      typeof cfg.freeform === "string" ? cfg.freeform.trim() : "";

    return (
      <div className="mt-2 p-3 bg-neutral-950 border border-neutral-800 rounded space-y-2">
        <div className="flex flex-wrap gap-1">
          {scalars.map(([label, v]) => (
            <span
              key={label}
              className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300"
            >
              {label}: <span className="text-neutral-100">{String(v)}</span>
            </span>
          ))}
        </div>
        {freeform && (
          <div className="text-[11px] text-sky-200">
            <span className="text-neutral-500">extra:</span> {freeform}
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 text-[10px] text-neutral-500">
          {preserve.length > 0 && <span>preserve: {preserve.join(", ")}</span>}
          {exclude.length > 0 && <span>esclusioni: {exclude.length}</span>}
        </div>
      </div>
    );
  };

  const EngineTag = ({ version }: { version: Version }) => {
    if (version.provider !== "higgsfield") {
      if (version.provider === "chatgpt") {
        return <span className="ml-2 text-neutral-500">· ChatGPT</span>;
      }
      return null;
    }
    let label = "Higgsfield";
    if (version.provider_params) {
      try {
        const pp = JSON.parse(version.provider_params) as {
          model: string;
          params?: Record<string, string>;
        };
        const extras = Object.values(pp.params ?? {}).join(", ");
        label = `Higgsfield · ${pp.model}${extras ? ` (${extras})` : ""}`;
      } catch {}
    }
    const cost =
      typeof version.credits === "number" ? ` · ${version.credits} cr` : "";
    return (
      <span className="ml-2 px-1.5 py-0.5 rounded bg-fuchsia-900/40 text-fuchsia-200 text-[10px]">
        {label}
        {cost}
      </span>
    );
  };

  if (versions.length === 0) {
    return (
      <div className="aspect-square w-full rounded-lg bg-neutral-900 border border-dashed border-neutral-800 flex items-center justify-center">
        <div className="text-center text-sm text-neutral-500">
          <div className="text-2xl mb-2">⊕</div>
          Nessuna versione generata.
          <br />
          Premi <kbd className="px-1 py-0.5 bg-neutral-800 rounded text-[10px]">G</kbd>{" "}
          o «Genera nuova versione» qui sotto.
        </div>
      </div>
    );
  }

  const v = versions[current];
  if (!v) return null;

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-black border border-neutral-800">
        {compare && beforeSrc ? (
          <CompareSlider
            beforeSrc={beforeSrc}
            afterSrc={genUrl(v.photo_id, v.version_number)}
            beforeLabel="RAW"
            afterLabel={`v${String(v.version_number).padStart(2, "0")}`}
          />
        ) : (
          <img
            src={genUrl(v.photo_id, v.version_number)}
            alt={`v${v.version_number}`}
            className="w-full h-full object-contain"
          />
        )}
        {!compare && versions.length > 1 && (
          <>
            <button
              onClick={() => onChange(Math.max(0, current - 1))}
              disabled={current === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 disabled:opacity-30 flex items-center justify-center text-white"
              aria-label="precedente"
            >
              ‹
            </button>
            <button
              onClick={() => onChange(Math.min(versions.length - 1, current + 1))}
              disabled={current === versions.length - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 disabled:opacity-30 flex items-center justify-center text-white"
              aria-label="successiva"
            >
              ›
            </button>
          </>
        )}
        {beforeSrc && (
          <button
            onClick={() => setCompare((c) => !c)}
            className={
              "absolute top-2 left-2 z-10 text-[11px] px-2 py-1 rounded border transition-colors " +
              (compare
                ? "bg-amber-600 border-amber-500 text-amber-50"
                : "bg-black/60 border-neutral-600 text-neutral-100 hover:bg-black/80")
            }
          >
            {compare ? "✕ Compare" : "⇆ Compare"}
          </button>
        )}
        {isFavorite && !compare && (
          <span className="absolute top-2 right-2 px-2 py-1 rounded bg-amber-500 text-amber-950 text-xs font-medium">
            ★ Preferita
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span>
          v{v.version_number} di {versions.length}
          {v.source === "imported" && (
            <span className="ml-2 text-neutral-500">(importata da TEST1)</span>
          )}
          <EngineTag version={v} />
        </span>
        <span className="text-neutral-600">·</span>
        <span>{new Date(v.created_at).toLocaleString("it-IT")}</span>
        <div className="flex-1" />
        <button
          onClick={onFavoriteToggle}
          className={
            "px-2 py-1 rounded border " +
            (isFavorite
              ? "bg-amber-500/20 text-amber-300 border-amber-700"
              : "bg-neutral-900 text-neutral-300 border-neutral-700 hover:border-amber-700")
          }
          title="F"
        >
          {isFavorite ? "★ Preferita" : "☆ Marca preferita"}
        </button>
        <button
          onClick={() => {
            if (confirm(`Eliminare v${v.version_number}?`)) onDelete();
          }}
          className="px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-700"
        >
          Elimina
        </button>
      </div>

      {versions.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {versions.map((vv, i) => (
            <button
              key={vv.id}
              onClick={() => onChange(i)}
              className={
                "flex-none w-16 h-16 rounded overflow-hidden border-2 transition-colors " +
                (i === current
                  ? "border-blue-500"
                  : "border-transparent hover:border-neutral-600")
              }
            >
              <img
                src={genUrl(vv.photo_id, vv.version_number)}
                alt={`v${vv.version_number}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer hover:text-neutral-300 select-none">
          prompt e configurazione usati
        </summary>
        <ConfigSummary config={v.config} />
        <pre className="mt-2 p-3 bg-neutral-950 border border-neutral-800 rounded text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
          {v.prompt_used}
        </pre>
      </details>
    </div>
  );
}
