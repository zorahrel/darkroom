/** Active-project resolution and the fetch wrapper every call goes through. */
import { nelGuscioDesktop } from "../guscio";

// ---- Active project (multi-project / Studio) ------------------------------
// The active project is taken from the URL path (`/p/:pid/...`) so links are
// shareable/bookmarkable and Back/Forward move between projects. It's sent on
// every API call via the `x-darkroom-project` header and appended as
// `?project=` to image URLs (which can't carry custom headers). No `/p/:pid`
// segment (e.g. `/studio`) = the server's default project.
export function currentProject(): string {
  if (typeof window === "undefined") return "";
  const m = window.location.pathname.match(/^\/p\/([^/]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

/** Remember the last-opened project so `/` can land back on it. */
export function rememberProject(pid: string): void {
  if (typeof localStorage === "undefined") return;
  if (pid) localStorage.setItem("darkroom.project", pid);
  else localStorage.removeItem("darkroom.project");
}

/** Last-opened project (for the `/` landing redirect / Studio highlight). */
export function lastProject(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem("darkroom.project") || "";
}

/**
 * La radice del backend.
 *
 * Nel browser è vuota: le chiamate sono relative alla pagina, che il backend serve
 * già. Nell'applicazione desktop la pagina arriva dal guscio (`tauri://localhost`) e
 * una chiamata relativa finirebbe lì invece che al backend — che è esattamente il
 * difetto per cui la prima finestra mostrava «Il catalogo non risponde: 500».
 *
 * L'anteprima di uno scatto aperto non passa di qui: nell'applicazione ha una strada
 * propria che non tocca la rete (vedi `guscio.ts`). Ma quella strada vuole il percorso
 * del file, e le schede di `/studio` mostrano progetti che non sono aperti: di quei
 * file non si sa niente. Le loro immagini tornano quindi al backend, e per arrivarci
 * devono essere assolute come tutto il resto.
 */
export function radiceApi(): string {
  return nelGuscioDesktop() ? `http://127.0.0.1:${PORTA_BACKEND}` : "";
}

/** La stessa porta della versione web: l'app è un'altra finestra sullo stesso lavoro. */
const PORTA_BACKEND = 3535;

/** Un indirizzo assoluto quando serve, relativo quando basta. */
export function assoluto(url: string): string {
  return url.startsWith("http") || url.startsWith("anteprima:") ? url : radiceApi() + url;
}

/** Append the active project as a query param (for <img> URLs). */
export function pq(url: string): string {
  const p = currentProject();
  const u = assoluto(url);
  if (!p) return u;
  const sep = u.includes("?") ? "&" : "?";
  return `${u}${sep}project=${encodeURIComponent(p)}`;
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const p = currentProject();
  const res = await fetch(assoluto(url), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(p ? { "x-darkroom-project": p } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${url}: ${text}`);
  }
  return (await res.json()) as T;
}
