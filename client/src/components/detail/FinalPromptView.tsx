import { useState } from "react";

export function FinalPromptView({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const text = prompt?.trim() || "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-900">
          Prompt finale
        </span>
        <span className="text-[11px] text-neutral-500">
          quello che riceve ChatGPT, già assemblato
        </span>
        <div className="flex-1" />
        <span className="text-[10px] tabular-nums text-neutral-600">
          {text.length} car.
        </span>
        <button
          disabled={!text}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard non disponibile: no-op */
            }
          }}
          className="text-xs px-2.5 py-1 rounded border border-neutral-700 hover:bg-neutral-800 disabled:opacity-40"
        >
          {copied ? "Copiato ✓" : "Copia"}
        </button>
      </div>
      {text ? (
        <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-[12px] leading-relaxed text-neutral-200">
          {text}
        </pre>
      ) : (
        <p className="text-sm text-neutral-500">
          Nessun prompt: genera una versione o imposta la config sopra.
        </p>
      )}
    </div>
  );
}

// La pipeline colore per LA SINGOLA foto: anteprima gradata live (tieni premuto
// per la base) + editor degli step in override dedicato. Salva → override
// per-foto; reset → torna al grade globale.
// L'intera pipeline della foto: un'unica anteprima sticky a sinistra (condivisa
// da TUTTI gli stage, guidata dall'hover-step del colore) e gli stage a destra
// nella stessa grammatica bookend della home — Input (viola) → Step (fucsia).
