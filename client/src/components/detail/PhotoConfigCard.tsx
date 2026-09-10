import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  api,
  type PromptConfig,
} from "../../api";
import { Bott, SectionHeader } from "../../ui";
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
        <SectionHeader title="Generazione ChatGPT" />
        {hasOverride ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-200">override attivo</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">eredita default</span>
        )}
      </div>
      <PromptBuilder value={draft} onChange={setDraft} previewPrompt={prompt} />
      <div className="flex gap-2 justify-end">
        {hasOverride && (
          <Bott
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
          >
            <RotateCcw  aria-hidden />
          Reset al default
          </Bott>
        )}
        <Bott
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
        >
          <Save  aria-hidden />
          {saving ? "Salvo…" : "Salva override"}
        </Bott>
      </div>
    </div>
  );
}
