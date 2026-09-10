import { Save, Trash2 } from "lucide-react";
import { Bott } from "../../ui";
import { useEffect, useState } from "react";
import {
  api,
} from "../../api";

export function ExtraInstructionsCard({
  photoId,
  initial,
  onSaved,
}: {
  photoId: string;
  initial: string;
  onSaved: () => Promise<unknown> | void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(initial), [initial, photoId]);

  const dirty = text.trim() !== initial.trim();

  return (
    <div className="space-y-2 border-t border-neutral-800/70 pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="text-xs font-medium text-neutral-300">
          Istruzioni extra per questa foto
        </div>
        {initial.trim() && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-200">
            attive
          </span>
        )}
        <span className="ml-auto text-[10px] text-neutral-400">
          si sommano alla config, valgono solo qui
        </span>
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="es. 'raddrizza il cartello', 'togli il riflesso sul vetro', 'rendi il cielo meno slavato'"
        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-sm leading-relaxed focus:outline-none focus:border-neutral-600"
      />
      <div className="flex justify-end gap-2">
        {initial.trim() && (
          <Bott
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.setExtraInstructions(photoId, null);
                setText("");
                await onSaved();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Trash2  aria-hidden />
          Rimuovi
          </Bott>
        )}
        <Bott
          disabled={saving || !dirty}
          onClick={async () => {
            setSaving(true);
            try {
              await api.setExtraInstructions(photoId, text.trim() || null);
              await onSaved();
            } finally {
              setSaving(false);
            }
          }}
        >
          <Save  aria-hidden />
          {saving ? "Salvo…" : "Salva"}
        </Bott>
      </div>
    </div>
  );
}

// The COMPLETE final prompt actually sent to ChatGPT for this photo — global
// config + photo override + extra instructions, already assembled by the
// server. Read-only, scrollable, with copy to clipboard.
