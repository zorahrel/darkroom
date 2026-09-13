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
/**
 * Dove sta il backend, visto da questa pagina.
 *
 * LA REGOLA E' "CHI MI HA SERVITO", non "quale porta di solito".
 *
 * Se la pagina arriva da http(s) — l'app aperta in un browser, in un riquadro,
 * su un'altra porta — il backend e' chi l'ha servita: stringa vuota, cioe'
 * indirizzi relativi, e si va sulla porta giusta per costruzione.
 *
 * La porta cablata serve SOLO quando un'origine utile non c'e': il guscio
 * desktop carica la pagina da `tauri://`, e da li' un indirizzo relativo
 * punterebbe dentro il pacchetto invece che al server.
 *
 * Perche' la distinzione non e' teorica: il 13/09 Darkroom aperto in un
 * riquadro Tauri servito da :3737 chiamava :3535 (un server spento poco prima)
 * e restava su "Carico l'albero…" a tempo indefinito. `nelGuscioDesktop()` era
 * vero — il riquadro E' Tauri — ma la pagina veniva da http, e li' la porta
 * giusta era la sua, non quella scritta nel codice.
 */
export function radiceApi(): string {
  if (typeof window !== "undefined" && /^https?:$/.test(window.location?.protocol ?? "")) {
    return "";
  }
  return nelGuscioDesktop() ? `http://127.0.0.1:${PORTA_BACKEND}` : "";
}

/** La porta del guscio desktop, usata solo quando la pagina non viene da http. */
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
    throw new Error(messaggioErrore(res.status, url, text));
  }
  return (await res.json()) as T;
}

/**
 * L'errore come lo leggerebbe una persona.
 *
 * Il backend risponde `{"error":"cartella inesistente: …"}`, e finché il corpo veniva
 * incollato tale e quale l'utente si trovava le graffe e le virgolette in mezzo alla
 * frase — con il codice di stato e la rotta davanti, che a lui non dicono niente.
 * Quando la frase c'è si mostra quella; quando non c'è resta tutto, perché a quel
 * punto lo stato e la rotta sono l'unica cosa da cui ripartire.
 */
export function messaggioErrore(stato: number, url: string, corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { error?: unknown };
    if (typeof j.error === "string" && j.error.trim()) return j.error;
  } catch {
    /* Non era JSON: sotto c'è il ripiego. */
  }
  return `${stato} ${url}: ${corpo}`;
}
