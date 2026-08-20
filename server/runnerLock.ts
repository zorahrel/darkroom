import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Un solo runner per DB.
 *
 * Darkroom e' finito con DUE servizi launchd che eseguivano lo stesso
 * `server/index.ts` sulla stessa cartella (porte 3535 e 3737): due job runner
 * sullo stesso `photos.db` e sullo stesso account ChatGPT. Il claim atomico dei
 * job e il lock del browser evitavano il danno peggiore, ma restava il resto:
 * due processi che bussano allo stesso account acceleravano il cap silenzioso,
 * e la contesa in scrittura sul DB produceva SQLITE_BUSY (che a sua volta
 * usciva come HTTP 500).
 *
 * Nessuno se n'era accorto per settimane, perche' entrambi rispondevano
 * correttamente: il duplicato non rompe niente, spreca e basta — il tipo di
 * guasto che si nota solo quando ha gia' fatto danni.
 *
 * Qui si scrive un file con il PID del runner attivo. Chi parte dopo lo vede,
 * dice CHI e' l'altro e non avvia il proprio runner: serve l'HTTP (utile per
 * una seconda finestra in sola lettura), non una seconda coda.
 */
export type RunnerLock =
  | { ok: true; release: () => void }
  | { ok: false; holderPid: number };

/** Il processo esiste ancora? (kill 0 non manda segnali, verifica soltanto.) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = il processo ESISTE ma è di un altro utente (o privilegiato, come
    // launchd): trattarlo da morto significherebbe rubargli il lock. Solo
    // ESRCH ("no such process") dice davvero che non c'è più.
    return (e as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * Prova a diventare il runner attivo per questo DB.
 *
 * Un lock stantio (processo morto senza rilasciare) viene rilevato e ripreso:
 * un lockfile che sopravvive a un crash bloccherebbe la coda per sempre, che e'
 * peggio del problema che risolve.
 */
export function acquireRunnerLock(lockPath: string): RunnerLock {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const prev = Number(readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(prev) && prev > 0 && prev !== process.pid && alive(prev)) {
      return { ok: false, holderPid: prev };
    }
    // Stale: il proprietario non c'e' piu'.
    try {
      unlinkSync(lockPath);
    } catch {
      /* se sparisce sotto di noi va bene lo stesso */
    }
  }
  writeFileSync(lockPath, String(process.pid));
  const release = () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* best effort */
    }
  };
  return { ok: true, release };
}
