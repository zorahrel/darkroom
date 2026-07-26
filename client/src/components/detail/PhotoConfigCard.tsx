import { useEffect, useState } from "react";
import {
  api,
  type PromptConfig,
} from "../../api";
import PromptBuilder from "../PromptBuilder";

export function PhotoConfigCard({
  photoId,
  config,
  hasOverride,
  prompt,
  onSaved,
}: {
  photoId: string;
  config: PromptConfig;
  hasOverride: boolean;
  prompt: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [draft, setDraft] = useState<PromptConfig>(config);
  const [saving, setSaving] = useState(false);
  // Re-sync if the upstream config changes (e.g. after refresh)
  useEffect(() => setDraft(config), [config]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
          Input
        </span>
        <h2 className="text-sm font-semibold">Generazione — ChatGPT</h2>
        {hasOverride ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">override attivo</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">eredita default</span>
        )}
      </div>
      <PromptBuilder value={draft} onChange={setDraft} previewPrompt={prompt} />
      <div className="flex gap-2 justify-end">
        {hasOverride && (
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.setPhotoConfig(photoId, null);
                await onSaved();
              } finally {
                setSaving(false);
              }
            }}
            className="text-sm px-3 py-1.5 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50"
          >
            Reset al default
          </button>
        )}
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api.setPhotoConfig(photoId, draft);
              await onSaved();
            } finally {
              setSaving(false);
            }
          }}
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
        >
          {saving ? "Salvo…" : "Salva override"}
        </button>
      </div>
    </div>
  );
}
