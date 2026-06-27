import { useEffect, useState } from "react";

export default function PromptEditor({
  effective,
  global,
  hasOverride,
  onSave,
  onResetToGlobal,
}: {
  effective: string;
  global: string;
  hasOverride: boolean;
  onSave: (next: string | null) => Promise<void>;
  onResetToGlobal: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<string>(effective);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(effective);
  }, [effective]);

  const isUnchanged = draft === effective;
  const matchesGlobal = draft.trim() === global.trim();

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <label className="font-medium text-neutral-300">
          Prompt per questa foto
        </label>
        {hasOverride ? (
          <span className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-900">
            override attivo
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
            usa globale
          </span>
        )}
        <div className="flex-1" />
        {hasOverride && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onResetToGlobal();
              } finally {
                setSaving(false);
              }
            }}
            className="text-[11px] px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500"
          >
            Usa globale
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        className="w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-xs font-mono leading-relaxed focus:outline-none focus:border-neutral-600"
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          disabled={saving || isUnchanged}
          onClick={() => setDraft(effective)}
          className="text-xs px-3 py-1.5 rounded border border-neutral-700 text-neutral-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Annulla
        </button>
        <button
          disabled={saving || isUnchanged}
          onClick={async () => {
            setSaving(true);
            try {
              // If draft equals global, store NULL (no override)
              await onSave(matchesGlobal ? null : draft);
            } finally {
              setSaving(false);
            }
          }}
          className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Salvo…" : "Salva override"}
        </button>
      </div>
    </div>
  );
}
