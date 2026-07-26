import { useCallback, useEffect, useState } from "react";
import { api, type FavoriteSuggestion, type VersionReport } from "../../api";

/**
 * Quality panel for the render on screen: what the checks found, and which
 * version they'd pick. Nothing here changes the photo on its own — promoting a
 * suggestion is one explicit click.
 */
export function QualityCheck({
  photoId,
  versionId,
  currentFavoriteId,
  onFavoriteChanged,
}: {
  photoId: string;
  versionId: number | null;
  currentFavoriteId: number | null;
  onFavoriteChanged: () => Promise<unknown> | void;
}) {
  const [reports, setReports] = useState<VersionReport[]>([]);
  const [suggestion, setSuggestion] = useState<FavoriteSuggestion | null>(null);
  const [busy, setBusy] = useState<"check" | "promote" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.photoReports(photoId);
    setReports(res.reports);
    setSuggestion(res.suggestion);
  }, [photoId]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  const current = reports.find((r) => r.version_id === versionId) ?? null;

  async function run(kind: "check" | "promote", fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-3 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <button
          disabled={busy !== null}
          onClick={() => run("check", () => api.checkPhoto(photoId))}
          className="text-xs px-2.5 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50"
        >
          {busy === "check" ? "Controllo…" : "Controlla le versioni"}
        </button>
        {current && <ScoreBadge score={current.score} />}
        <span className="text-xs text-neutral-500">
          {reports.length
            ? `${reports.length} version${reports.length === 1 ? "e" : "i"} controllate`
            : "mai controllata"}
        </span>
      </div>

      {error && (
        <div className="text-xs rounded border border-red-900 bg-red-950/50 text-red-200 px-2 py-1.5">
          {error}
        </div>
      )}

      {current ? (
        <ul className="space-y-1">
          {current.checks.map((check) => (
            <li key={check.code} className="flex items-start gap-2 text-xs">
              <VerdictDot verdict={check.verdict} />
              <span className={check.verdict === "hit" ? "text-amber-200" : "text-neutral-400"}>
                {check.code}
                {check.detail && <span className="text-neutral-600"> — {check.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-neutral-500">
          Questa versione non è ancora stata controllata.
        </p>
      )}

      {suggestion?.suggested_version_id && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-2 space-y-1.5">
          <div className="text-xs text-neutral-400">
            Le verifiche preferiscono la{" "}
            <span className="text-white">v{suggestion.suggested_version_number}</span> —{" "}
            {suggestion.reason}.
          </div>
          {suggestion.differs && (
            <button
              disabled={busy !== null}
              onClick={() =>
                run("promote", async () => {
                  await api.setFavorite(photoId, suggestion.suggested_version_id!);
                  await onFavoriteChanged();
                })
              }
              className="text-xs px-2.5 py-1.5 rounded bg-emerald-800 hover:bg-emerald-700 border border-emerald-700 disabled:opacity-50"
            >
              {busy === "promote" ? "Imposto…" : `Usa la v${suggestion.suggested_version_number} come preferita`}
            </button>
          )}
          {!suggestion.differs && currentFavoriteId !== null && (
            <div className="text-xs text-emerald-300">È già la preferita.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 9
      ? "bg-emerald-900/40 text-emerald-200 border-emerald-800/60"
      : score >= 6
        ? "bg-amber-900/40 text-amber-200 border-amber-800/60"
        : "bg-red-900/40 text-red-200 border-red-800/60";
  return (
    <span className={"text-[11px] px-2 py-0.5 rounded-full border " + tone}>{score}/10</span>
  );
}

function VerdictDot({ verdict }: { verdict: string }) {
  const color =
    verdict === "hit"
      ? "bg-amber-400"
      : verdict === "clear"
        ? "bg-emerald-500"
        : verdict === "unsure"
          ? "bg-neutral-500"
          : "bg-red-500";
  return <span className={"mt-1 w-1.5 h-1.5 rounded-full shrink-0 " + color} />;
}
