import { useCallback, useEffect, useState } from "react";
import { api, type ImportSummary, type PhotoSource } from "../api";

/**
 * Where this project's photos come from. A folder is either linked (indexed
 * where it lives, nothing copied) or copied into the project — the choice is
 * made per folder, when you add it.
 */
export default function SourcesPage() {
  const [sources, setSources] = useState<PhotoSource[]>([]);
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"link" | "copy">("link");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ImportSummary | null>(null);

  const load = useCallback(async () => {
    const [s, counts] = await Promise.all([api.sources(), api.photoCounts()]);
    setSources(s.sources);
    setPhotoCount(counts.counts.all ?? 0);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(kind: string, fn: () => Promise<ImportSummary | null>) {
    setBusy(kind);
    setError(null);
    try {
      setLast(await fn());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Foto del progetto</h1>
        <p className="text-sm text-neutral-400">
          {photoCount === null
            ? "…"
            : sources.length === 0
              ? photoCount > 0
                ? `${photoCount} foto, indicizzate dalla cartella del progetto.`
                : "Nessuna foto, per ora."
              : `${photoCount} foto da ${sources.length} cartell${sources.length === 1 ? "a" : "e"}.`}{" "}
          Darkroom non tocca mai gli originali: li legge e basta.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 space-y-3">
        <div className="text-sm font-medium">Aggiungi una cartella</div>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/…/Foto/Kyoto"
          className="w-full text-sm bg-neutral-950 border border-neutral-800 rounded px-3 py-2 font-mono"
        />
        <div className="flex flex-wrap gap-2">
          <ModeCard
            selected={mode === "link"}
            onClick={() => setMode("link")}
            title="Lasciale dove sono"
            hint="Le indicizzo sul posto: nessuna copia, nessuno spazio occupato."
          />
          <ModeCard
            selected={mode === "copy"}
            onClick={() => setMode("copy")}
            title="Copiale nel progetto"
            hint="Se la cartella è temporanea (una scheda SD, i download)."
          />
        </div>
        <button
          disabled={!path.trim() || busy !== null}
          onClick={() =>
            run("add", async () => {
              const res = await api.addSource(path.trim(), mode);
              setPath("");
              return res.summary;
            })
          }
          className="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 border border-emerald-700 disabled:opacity-50"
        >
          {busy === "add" ? "Indicizzo…" : "Aggiungi"}
        </button>
        {last && (
          <div className="text-xs text-neutral-400">
            {last.scanned} file trovati · {last.added} aggiunte
            {last.skipped ? ` · ${last.skipped} già presenti` : ""}
            {last.copied ? ` · ${last.copied} copiate` : ""}
          </div>
        )}
        {error && (
          <div className="text-xs rounded border border-red-900 bg-red-950/50 text-red-200 px-2 py-1.5">
            {error}
          </div>
        )}
      </section>

      {sources.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">Cartelle collegate</div>
            <button
              disabled={busy !== null}
              onClick={() => run("rescan", async () => (await api.rescanSources()).summary)}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
              title="Rilegge le cartelle: prende le foto aggiunte nel frattempo"
            >
              {busy === "rescan" ? "Rileggo…" : "Rileggi tutte"}
            </button>
          </div>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li
                key={s.path}
                className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2"
              >
                <span className="text-xs px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400 shrink-0">
                  {s.mode === "link" ? "collegata" : "copiata"}
                </span>
                <span className="text-sm font-mono truncate flex-1" title={s.path}>
                  {s.path}
                </span>
                <button
                  disabled={busy !== null}
                  onClick={() =>
                    run("remove", async () => {
                      await api.removeSource(s.path);
                      return null;
                    })
                  }
                  title="Dimentica questa cartella (le foto già indicizzate restano)"
                  className="text-xs text-neutral-500 hover:text-red-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ModeCard({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 min-w-[14rem] text-left px-3 py-2 rounded-lg border transition-colors " +
        (selected ? "border-sky-600 bg-sky-950/30" : "border-neutral-800 hover:border-neutral-600")
      }
    >
      <div className="text-sm">{title}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>
    </button>
  );
}
