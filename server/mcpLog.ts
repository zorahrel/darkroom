import { type Database } from "bun:sqlite";
import { defaultDb } from "./db.ts";

export const LOG_MAX_ROWS = 5_000;
export const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const LOG_ARGUMENT_BYTES = 16_384;
export const LOG_MESSAGE_BYTES = 2_048;
const REDACTED = "[oscurato]";
const SECRET_FIELD = /key|token|secret|password|passwd|auth|credential|cookie|session|private/i;
const PATH_FIELD = /path|file|folder|directory|root/i;

// Il database predefinito ospita anche le chiamate globali e quelle fallite prima
// di aprire un progetto. Il contesto HTTP non deve spostare il registro altrove.
export function logDatabase(): Database {
  return defaultDb();
}

/** Anche gli errori possono ripetere un argomento riservato: oscuriamo entrambi. */
export function redactText(text: string, secrets: string[] = []): string {
  let safe = text;
  for (const secret of secrets.sort((a, b) => b.length - a.length)) {
    if (secret) safe = safe.split(secret).join(REDACTED);
  }
  return safe
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, REDACTED)
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, REDACTED)
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, REDACTED)
    .replace(/\b[\w.-]*(?:key|token|secret|password|passwd|authorization|credential|cookie)[\w.-]*["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, REDACTED)
    .replace(/(?:https?|file):\/\/[^\s<>"']+/gi, REDACTED)
    .replace(/["'](?:\/|~\/|[A-Za-z]:\\)[^"'\n]+["']/g, REDACTED)
    .replace(/(?:\b[A-Za-z]:\\|\\\\|~\/|\.{1,2}\/|\/)[^\s<>"',;)}\]]+/g, REDACTED);
}

function secretValues(value: unknown, key = "", out: string[] = []): string[] {
  if (typeof value === "string") {
    if (SECRET_FIELD.test(key) || PATH_FIELD.test(key)) out.push(value, JSON.stringify(value).slice(1, -1));
    // Nei prompt si incollano anche oggetti JSON, talvolta già serializzati.
    // Riconoscerli conserva la struttura senza perdere i segreti annidati.
    if (/^[\s]*[\[{"]/.test(value)) {
      try { secretValues(JSON.parse(value), "", out); } catch { /* Testo libero. */ }
    }
    // L'errore HTTP può precedere un JSON che contiene un secondo JSON come
    // stringa: decodifichiamo quel frammento prima di cercare i nomi riservati.
    for (const match of value.matchAll(/"(?:\\.|[^"\\])*"/g)) {
      if (match[0].includes('\\"')) {
        try { secretValues(JSON.parse(match[0]), "", out); } catch { /* Frammento incompleto. */ }
      }
    }
    for (const match of value.matchAll(/(?:https?|file):\/\/[^\s<>"']+/gi)) {
      try {
        const url = new URL(match[0]);
        if (url.password) out.push(decodeURIComponent(url.password));
        if (url.username) out.push(decodeURIComponent(url.username));
        for (const [name, part] of url.searchParams) if (SECRET_FIELD.test(name)) out.push(part);
      } catch { /* Un URL incompleto viene comunque oscurato nel testo. */ }
    }
    for (const match of value.matchAll(/\b[\w.-]*(?:key|token|secret|password|passwd|authorization|credential|cookie)[\w.-]*["']?\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;&]+))/gi)) {
      out.push(match[1] ?? match[2] ?? match[3] ?? "");
    }
  }
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) secretValues(v, SECRET_FIELD.test(key) || PATH_FIELD.test(key) ? key : k, out);
  }
  return out;
}

function redact(value: unknown, secrets: string[], key = ""): unknown {
  if (SECRET_FIELD.test(key) || PATH_FIELD.test(key)) return REDACTED;
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactText(k, secrets), redact(v, secrets, k)]));
  }
  return value;
}

/** Il limite è in byte: anche prompt enormi o Unicode devono rispettare il tetto. */
function bounded(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  return Buffer.from(text).subarray(0, bytes - 32).toString("utf8") + "… [troncato]";
}

export type LogEntry = {
  tool: string;
  arguments: Record<string, unknown>;
  outcome: "ok" | "errore";
  message: string;
  duration_ms: number;
  project: string | null;
  created_at: number;
};

export function pruneLog(d = logDatabase(), now = Date.now()): void {
  d.run("DELETE FROM mcp_log WHERE created_at < ?", [now - LOG_MAX_AGE_MS]);
  d.run(`DELETE FROM mcp_log WHERE id <= (
    SELECT id FROM mcp_log ORDER BY id DESC LIMIT 1 OFFSET ?
  )`, [LOG_MAX_ROWS]);
}

export function recordCall(entry: LogEntry, d = logDatabase()): void {
  const secrets = secretValues(entry.message, "", secretValues(entry.arguments));
  const safe = redact(entry.arguments, secrets);
  const serialized = JSON.stringify(safe);
  // Un JSON troncato non sarebbe più leggibile dalla vista: conserviamo un riassunto.
  const args = Buffer.byteLength(serialized) <= LOG_ARGUMENT_BYTES
    ? serialized : JSON.stringify({ nota: "Argomenti troncati", anteprima: bounded(serialized, LOG_ARGUMENT_BYTES / 2) });
  d.transaction(() => {
    d.run(`INSERT INTO mcp_log (tool, arguments, outcome, message, duration_ms, project, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      bounded(redactText(entry.tool, secrets), 128), args, entry.outcome,
      bounded(redactText(entry.message, secrets), LOG_MESSAGE_BYTES),
      Math.max(0, Math.round(entry.duration_ms)),
      entry.project === null ? null : bounded(redactText(entry.project, secrets), 128), entry.created_at,
    ]);
    pruneLog(d);
  })();
}

export type LogFilters = { tool?: string; outcome?: "ok" | "errore"; before?: number; limit?: number; project?: string };
export type LogRow = Omit<LogEntry, "arguments"> & { id: number; arguments: unknown };
export function readLog(filters: LogFilters = {}, d = logDatabase()) {
  pruneLog(d);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.tool) { where.push("tool = ?"); params.push(filters.tool); }
  if (filters.outcome) { where.push("outcome = ?"); params.push(filters.outcome); }
  if (filters.project) { where.push("project = ?"); params.push(filters.project); }
  if (filters.before) { where.push("id < ?"); params.push(filters.before); }
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const rows = d.query<Omit<LogRow, "arguments"> & { arguments: string }, (string | number)[]>(
    `SELECT * FROM mcp_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
  ).all(...params, limit + 1);
  const entries = rows.slice(0, limit).map((row) => ({ ...row, arguments: JSON.parse(row.arguments) as unknown }));
  return {
    entries,
    next_before: rows.length > limit ? entries.at(-1)!.id : null,
    tools: d.query<{ tool: string }, []>("SELECT DISTINCT tool FROM mcp_log ORDER BY tool").all().map((r) => r.tool),
    retention: { max_rows: LOG_MAX_ROWS, days: LOG_MAX_AGE_MS / 86_400_000 },
  };
}
