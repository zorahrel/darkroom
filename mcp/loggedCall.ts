import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { recordCall, type LogEntry } from "../server/mcpLog.ts";

/** Un solo confine per tutte le chiamate, compresi nomi ignoti ed errori di rete. */
export async function loggedCall(
  tool: string,
  args: Record<string, unknown>,
  project: string | null | (() => string | null),
  invoke: () => Promise<unknown>,
  write: (entry: LogEntry) => void = recordCall,
): Promise<CallToolResult> {
  const when = Date.now();
  const started = performance.now();
  let outcome: LogEntry["outcome"] = "ok";
  let message = "Chiamata completata";
  let response: CallToolResult;
  try {
    const result = await invoke();
    // Alcune API rispondono 200 con un esito applicativo negativo.
    if (result && typeof result === "object") {
      const status = result as Record<string, unknown>;
      if (status.isError === true || status.ok === false || status.error) {
        outcome = "errore";
        message = typeof status.error === "string" ? status.error : "Lo strumento ha restituito un errore";
      }
    }
    response = { ...(outcome === "errore" ? { isError: true } : {}), content: [{ type: "text", text: JSON.stringify(result, null, 2) ?? "null" }] };
  } catch (err) {
    outcome = "errore";
    message = err instanceof Error ? err.message : String(err);
    response = { isError: true, content: [{ type: "text", text: `error: ${message}` }] };
  }
  try {
    write({ tool, arguments: args, project: typeof project === "function" ? project() : project,
      outcome, message, created_at: when, duration_ms: performance.now() - started });
  } catch {
    // Una generazione riuscita non diventa un errore ritentabile per colpa del
    // registro. Il chiamante vede comunque che manca la ricevuta persistente.
    const warning = "Registro MCP non disponibile: questa chiamata non è stata registrata.";
    console.error(`[darkroom-mcp] ${warning}`);
    response.content.push({ type: "text", text: warning });
  }
  return response;
}
