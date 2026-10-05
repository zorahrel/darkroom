import { useState } from "react";
import { api, clipDownloadUrl, clipFileUrl, type Clip } from "../api";
import { Bott, Confirm } from "../ui";

const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

/**
 * I video nati da questa foto. Il primo fotogramma e' una sua versione.
 *
 * Il tasto in evidenza copia l'ORIGINALE in ~/Downloads: lo stesso file dell'archivio, senza
 * ricodifica, quindi la massima qualita' che il modello ha prodotto. Il link piccolo fa la
 * stessa cosa dal browser, per quando Darkroom gira su un'altra macchina.
 */
export default function ClipsCard({ clips, onChanged }: { clips: Clip[]; onChanged: () => void | Promise<unknown> }) {
  if (clips.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Video">
      <h3 className="text-xs uppercase tracking-wide text-neutral-400">Video · {clips.length}</h3>
      {clips.map((c) => (
        <ClipItem key={c.id} clip={c} onChanged={onChanged} />
      ))}
    </section>
  );
}

function ClipItem({ clip, onChanged }: { clip: Clip; onChanged: () => void | Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api.saveClipToDownloads(clip.id);
      setSaved(`${r.path.replace(/^\/Users\/[^/]+/, "~")} · ${fmtSize(r.size)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const meta = [
    clip.model,
    clip.width && clip.height ? `${clip.width}×${clip.height}` : null,
    clip.duration ? `${clip.duration.toFixed(1)} s` : null,
    clip.fps ? `${Math.round(clip.fps)} fps` : null,
    clip.has_audio ? "con audio" : "senza audio",
    fmtSize(clip.size),
    clip.version_number != null ? `da v${clip.version_number}` : null,
    clip.credits != null ? `${clip.credits} crediti` : null,
  ].filter(Boolean);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2 space-y-2">
      <p className="text-xs text-neutral-400 tabular-nums">{meta.join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Bott weight="primary" onClick={save} disabled={saving || !clip.available} title="Copia l'originale in ~/Downloads, senza ricodificare">
          {saving ? "Salvo…" : "Salva in Download (originale)"}
        </Bott>
        {clip.available && (
          <a
            href={clipDownloadUrl(clip.id)}
            download={clip.download_name}
            className="text-xs text-neutral-400 underline hover:text-neutral-200"
          >
            Scarica dal browser
          </a>
        )}
        <Confirm
          question="Tolgo il video da questo elenco? Il file resta nell'archivio."
          confirm="Togli"
          onConfirm={async () => {
            await api.forgetClip(clip.id);
            await onChanged();
          }}
          size="s"
        >
          Togli
        </Confirm>
      </div>
      {saved && <p className="text-xs text-emerald-300 break-all">Salvato in {saved}</p>}
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {clip.available ? (
        <video
          src={clipFileUrl(clip.id)}
          controls
          loop
          playsInline
          preload="metadata"
          className="w-full max-h-[60vh] rounded bg-black"
        />
      ) : (
        <p className="text-sm text-rose-300">Il file non e' piu' nell'archivio del progetto.</p>
      )}
      {clip.prompt && (
        <details>
          <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-300">Prompt</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-400">
            {clip.prompt}
          </pre>
        </details>
      )}
    </div>
  );
}
