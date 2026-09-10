import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { jsonFetch } from "../api";
import { Badge, Bott, Choose, Header, Page, Panel, SectionHeader, Toolbar } from "../ui";

type Entry = {
  id: number; tool: string; arguments: unknown; outcome: "ok" | "errore";
  message: string; duration_ms: number; project: string | null; created_at: number;
};
type Log = { entries: Entry[]; next_before: number | null; tools: string[]; retention: { max_rows: number; days: number } };

export default function Activity() {
  const [tool, setTool] = useState("");
  const [outcome, setOutcome] = useState<"" | "ok" | "errore">("");
  const [log, setLog] = useState<Log | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async (before?: number) => {
    const id = ++request.current;
    setBusy(true);
    setError("");
    if (!before) setLog((old) => old ? { ...old, entries: [], next_before: null } : null);
    const query = new URLSearchParams();
    if (tool) query.set("tool", tool);
    if (outcome) query.set("outcome", outcome);
    if (before) query.set("before", String(before));
    try {
      const result = await jsonFetch<Log>(`/api/mcp-log?${query}`);
      if (id === request.current) setLog((old) => ({ ...result, entries: before ? [...(old?.entries ?? []), ...result.entries] : result.entries }));
    } catch {
      if (id === request.current) setError("Il registro non risponde. Riprova con Aggiorna.");
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [tool, outcome]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);

  return (
    <Page>
      <Header title="Registro MCP" below="Le chiamate degli strumenti, dalla più recente: progetto, durata ed esito.">
        <Bott weight="primary" size="l" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden /> {busy ? "Carico…" : "Aggiorna"}
        </Bott>
      </Header>
      <Toolbar>
        <Choose title="Filtra per strumento" value={tool} width={220} size="m" onChange={setTool}
          items={[{ v: "", text: "Tutti gli strumenti" }, ...(log?.tools ?? []).map((name) => ({ v: name, text: name }))]} />
        <Choose title="Filtra per esito" value={outcome} width={150} size="m" onChange={setOutcome}
          items={[{ v: "", text: "Tutti gli esiti" }, { v: "ok", text: "Riuscite" }, { v: "errore", text: "Errori" }]} />
        {log && <span className="text-[12px] text-neutral-400">Ultimi {log.retention.days} giorni, fino a {log.retention.max_rows.toLocaleString("it-IT")} chiamate.</span>}
      </Toolbar>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!error && !busy && log?.entries.length === 0 && (
        <Panel><p className="text-sm text-neutral-400">{tool || outcome ? "Nessuna chiamata corrisponde ai filtri." : "Nessuna chiamata registrata. Le prossime operazioni MCP compariranno qui."}</p></Panel>
      )}
      <div aria-busy={busy} aria-label="Chiamate MCP" className="space-y-3">
        {log?.entries.map((entry) => (
          <Panel key={entry.id}>
            <SectionHeader title={<span className="break-all">{entry.tool}</span>}
              below={<Badge tone={entry.outcome === "ok" ? "good" : "bad"}>{entry.outcome === "ok" ? "Riuscita" : "Errore"}</Badge>}>
              <time className="text-[12px] text-neutral-400 sm:ml-auto" dateTime={new Date(entry.created_at).toISOString()}>
                {new Date(entry.created_at).toLocaleString("it-IT")}
              </time>
            </SectionHeader>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-400">
              <span className="break-all">Progetto: {entry.project ?? "Globale"}</span>
              <span>{entry.duration_ms.toLocaleString("it-IT")} ms</span>
            </div>
            <p className="break-words whitespace-pre-wrap text-[12px] text-neutral-300">{entry.message}</p>
            <details className="text-[12px]">
              <summary className="min-h-11 sm:min-h-0 cursor-pointer py-2 text-neutral-400 hover:text-neutral-100">Argomenti</summary>
              <pre className="whitespace-pre-wrap break-all rounded border border-neutral-800 p-2 text-neutral-300">{JSON.stringify(entry.arguments, null, 2)}</pre>
            </details>
          </Panel>
        ))}
      </div>
      {log?.next_before && <Bott disabled={busy} onClick={() => void load(log.next_before!)}>
        <ChevronDown className="w-4 h-4" aria-hidden />
        Carica precedenti
      </Bott>}
    </Page>
  );
}
