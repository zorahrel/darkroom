import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Il `dist` servito e' piu' vecchio dei sorgenti del client?
 *
 * Il server serve `dist/` staticamente, ma niente lo ricostruisce quando
 * cambia `client/src`. Il risultato e' silenzioso e velenoso: si guarda la
 * dashboard, si vede la UI di nove giorni fa e si conclude che una modifica
 * non e' stata fatta — mentre nel codice c'e'. E' successo davvero, per nove
 * giorni, e non c'era un solo segnale da nessuna parte.
 *
 * Qui non si indovina: si confronta il file piu' recente di `client/` con
 * `dist/index.html`. Ritorna null quando e' tutto a posto.
 */
export function staleDist(repoRoot: string): { newest: string; ageSeconds: number } | null {
  const distIndex = join(repoRoot, "dist", "index.html");
  if (!existsSync(distIndex)) {
    return { newest: "(dist assente)", ageSeconds: 0 };
  }
  const builtAt = statSync(distIndex).mtimeMs;

  let newest = { path: "", mtime: 0 };
  const walk = (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as import("node:fs").Dirent[];
    } catch {
      return;
    }
    for (const e of entries) {
      // node_modules e dist non sono sorgenti: guardarli renderebbe l'allarme
      // sempre acceso e quindi inutile.
      if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(tsx?|css|html)$/.test(e.name)) continue;
      const m = statSync(p).mtimeMs;
      if (m > newest.mtime) newest = { path: p, mtime: m };
    }
  };
  walk(join(repoRoot, "client"));

  if (!newest.path || newest.mtime <= builtAt) return null;
  return {
    newest: newest.path.replace(repoRoot + "/", ""),
    ageSeconds: Math.round((newest.mtime - builtAt) / 1000),
  };
}

/** Riga di avviso pronta da stampare, o null se il build e' aggiornato. */
export function staleDistWarning(repoRoot: string): string | null {
  const s = staleDist(repoRoot);
  if (!s) return null;
  if (s.newest === "(dist assente)") {
    return "[dist] MANCA il build del client: la dashboard non verra' servita. Esegui: bun run build:client";
  }
  const mins = Math.round(s.ageSeconds / 60);
  const when = mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}min`;
  return `[dist] Il build del client e' VECCHIO di ${when} rispetto a ${s.newest}: stai servendo una dashboard superata. Esegui: bun run build:client`;
}
