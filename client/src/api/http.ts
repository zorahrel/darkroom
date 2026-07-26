/** Active-project resolution and the fetch wrapper every call goes through. */

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

/** Append the active project as a query param (for <img> URLs). */
export function pq(url: string): string {
  const p = currentProject();
  if (!p) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}project=${encodeURIComponent(p)}`;
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const p = currentProject();
  const res = await fetch(url, {
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
