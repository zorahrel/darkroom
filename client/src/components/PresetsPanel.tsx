import { useEffect, useRef, useState } from "react";
import { api, type ColorGrade, type Preset } from "../api";
import {
  IconDownload,
  IconUpload,
  IconTrash,
  IconPencil,
  IconClose,
} from "./mobile/icons";

// Reusable preset / template manager. Used for the global look (Color) and for
// per-photo overrides (Detail), on desktop and inside the mobile editor. It owns
// its own list + import state; `onApply` hands a grade back to the parent, which
// decides whether that means the set default or this photo's override.
export default function PresetsPanel({
  grade,
  onApply,
  applyLabel = "Applica",
  className = "",
}: {
  grade: ColorGrade;
  onApply: (g: ColorGrade) => void;
  applyLabel?: string;
  className?: string;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [imp, setImp] = useState<{ name: string; notes: string[]; grade: ColorGrade } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    api.presets().then((r) => setPresets(r.presets)).catch(() => {});
  }
  useEffect(load, []);

  function defaultName() {
    const n = grade.steps.filter((s) => s.enabled && s.type !== "ai").length;
    return `Preset ${new Date().toLocaleDateString("it-IT")} · ${n} step`;
  }

  async function saveCurrent() {
    setBusy(true);
    try {
      await api.createPreset(newName.trim() || defaultName(), grade);
      setNewName("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      const text = await f.text();
      const res = await api.importTemplate(f.name, text, false);
      setImp({ name: res.name, notes: res.notes, grade: res.grade });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Import fallito");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveImported() {
    if (!imp) return;
    setBusy(true);
    try {
      await api.createPreset(imp.name, imp.grade);
      setImp(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  function exportGrade() {
    const blob = new Blob([JSON.stringify({ name: "darkroom-grade", grade }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `darkroom-grade-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doRename(id: number) {
    const name = renameVal.trim();
    setRenaming(null);
    if (!name) return;
    await api.renamePreset(id, name);
    load();
  }

  return (
    <div className={"space-y-3 " + className}>
      {/* Save the current state as a preset */}
      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
          placeholder={defaultName()}
          className="flex-1 min-w-0 bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-neutral-600"
        />
        <button
          disabled={busy}
          onClick={saveCurrent}
          className="shrink-0 text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
        >
          Salva preset
        </button>
      </div>

      {/* Import / export template */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.xmp,.xml,.cube,.lrtemplate"
          onChange={onFile}
          className="hidden"
        />
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          <IconUpload /> Importa template
        </button>
        <button
          onClick={exportGrade}
          className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded border border-neutral-700 hover:border-neutral-500"
        >
          <IconDownload /> Esporta JSON
        </button>
        <span className="text-[11px] text-neutral-400">Lightroom / Camera Raw .xmp · .lrtemplate · .cube · .json</span>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {/* Import outcome: shows what was mapped and what was not */}
      {imp && (
        <div className="rounded-lg border border-sky-900/60 bg-sky-950/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-sky-200 flex-1 truncate">
              Importato: {imp.name}
            </span>
            <button onClick={() => setImp(null)} className="p-1 text-neutral-400 hover:text-white" aria-label="chiudi">
              <IconClose />
            </button>
          </div>
          <ul className="text-[11px] text-neutral-400 list-disc pl-4 space-y-0.5">
            {imp.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onApply(imp.grade);
                setImp(null);
              }}
              className="text-sm px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600"
            >
              {applyLabel}
            </button>
            <button
              disabled={busy}
              onClick={saveImported}
              className="text-sm px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
            >
              Salva come preset
            </button>
          </div>
        </div>
      )}

      {/* Lista preset salvati */}
      {presets.length === 0 ? (
        <p className="text-xs text-neutral-400">Nessun preset salvato.</p>
      ) : (
        <ul className="space-y-1">
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5"
            >
              {renaming === p.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doRename(p.id)}
                  onBlur={() => doRename(p.id)}
                  className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-sm"
                />
              ) : (
                <span className="flex-1 min-w-0 truncate text-sm">
                  {p.name}
                  {p.source === "import" && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                      import
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={() => onApply(p.grade)}
                className="shrink-0 text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              >
                {applyLabel}
              </button>
              <button
                onClick={() => {
                  setRenaming(p.id);
                  setRenameVal(p.name);
                }}
                className="shrink-0 p-1 text-neutral-400 hover:text-white"
                aria-label="rinomina"
              >
                <IconPencil />
              </button>
              <button
                onClick={async () => {
                  await api.deletePreset(p.id);
                  load();
                }}
                className="shrink-0 p-1 text-neutral-400 hover:text-red-400"
                aria-label="elimina"
              >
                <IconTrash />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
