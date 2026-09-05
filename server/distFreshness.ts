import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Is the `dist` being served older than the client sources?
 *
 * The server serves `dist/` statically, but nothing rebuilds it when
 * `client/src` changes. The result is silent and poisonous: you look at the
 * dashboard, you see the UI from nine days ago and you conclude a change was
 * never made — while it is right there in the code. It really happened, for
 * nine days, and there was not a single signal anywhere.
 *
 * Here nothing is guessed: the most recent file under `client/` is compared
 * against `dist/index.html`. Returns null when all is well.
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
      // node_modules and dist are not sources: watching them would keep the
      // alarm permanently on and therefore useless.
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

/** A warning line ready to print, or null if the build is up to date. */
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
