import { anteprimaInProcesso } from "../guscio";
/** Image URLs. Every one carries the active project (images can't send headers). */

import { assoluto, pq } from "./http";
import type { ColorGrade } from "./types";

/** URL of a generation with the global color look applied on the fly.
 *  `bust` changes when grade settings change, to defeat the browser cache. */
export function gradedUrl(
  photoId: string,
  versionNumber: number,
  w?: number,
  bust?: string | number,
): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const params = new URLSearchParams();
  if (w) params.set("w", String(w));
  if (bust !== undefined) params.set("b", String(bust));
  const q = params.toString();
  return pq(`/graded/${encodeURIComponent(photoId)}/${filename}${q ? "?" + q : ""}`);
}

// Like gradedUrl but overlays an UNSAVED grade passed as a JSON blob in `g`, so
// a preview can render the current step values before they're persisted. The
// server caches per (steps,wbGain,width), so a grade already seen is instant.
export function gradedPreviewUrl(
  photoId: string,
  versionNumber: number,
  grade: ColorGrade,
  w?: number,
): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const p = new URLSearchParams();
  if (w) p.set("w", String(w));
  p.set("g", JSON.stringify(grade));
  return pq(`/graded/${encodeURIComponent(photoId)}/${filename}?${p.toString()}`);
}

export function rawUrl(id: string, _ext?: string): string {
  // Canonical original URL: resolves the stored path server-side, so it works
  // for both imported originals and generated photos.
  return pq(`/orig/${encodeURIComponent(id)}`);
}

/**
 * L'anteprima di uno scatto originale.
 *
 * Passando `percorsoFile`, dentro l'applicazione desktop l'immagine arriva dal motore
 * nello stesso processo e non da una richiesta HTTP. Senza percorso, o nel browser,
 * resta l'endpoint di sempre: la versione web non perde niente.
 */
export function thumbRawUrl(id: string, w?: number, percorsoFile?: string | null): string {
  const diretta = anteprimaInProcesso(percorsoFile, w ?? 480);
  if (diretta) return diretta;
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/raw/${encodeURIComponent(id)}${q}`);
}

/**
 * L'anteprima di uno scatto di un progetto **diverso** da quello aperto.
 *
 * `thumbRawUrl` prende il progetto dall'indirizzo della pagina, e in `/studio` non
 * c'è: le schede mostrerebbero tutte le foto dello stesso progetto, o nessuna.
 */
export function thumbRawUrlDi(pid: string, id: string, w = 256): string {
  return assoluto(`/thumb/raw/${encodeURIComponent(id)}?w=${w}&project=${encodeURIComponent(pid)}`);
}

/**
 * Il fotogramma di una clip, per la copertina di un progetto di montaggio.
 *
 * Non passa dal progetto attivo ma dalla cartella, perché è così che il girato è
 * indirizzato ovunque: le clip vivono su disco, non nel database.
 */
export function fotogrammaUrl(cartella: string, clip: string, w = 256, secondo = 1): string {
  const p = new URLSearchParams({ cartella, clip, w: String(w), t: String(secondo) });
  return assoluto(`/api/girato/fotogramma?${p.toString()}`);
}

export function genUrl(photoId: string, versionNumber: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  return pq(`/gen/${encodeURIComponent(photoId)}/${filename}`);
}

export function thumbGenUrl(photoId: string, versionNumber: number, w?: number): string {
  const filename = `v${String(versionNumber).padStart(2, "0")}.png`;
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/gen/${encodeURIComponent(photoId)}/${filename}${q}`);
}

/** The project's style image (`data/refs`). */
export function refUrl(filename: string): string {
  return pq(`/refs/${encodeURIComponent(filename)}`);
}

export function orphanUrl(filename: string): string {
  return pq(`/orphan/${encodeURIComponent(filename)}`);
}

export function thumbOrphanUrl(filename: string): string {
  return pq(`/thumb/orphan/${encodeURIComponent(filename)}`);
}

/** Thumbnail of a panel's current image (same one the export writes). */
export function panelImageUrl(photoId: string, w = 480, bust?: number): string {
  const p = new URLSearchParams({ w: String(w) });
  if (bust !== undefined) p.set("b", String(bust));
  return pq(`/api/storyboard/panels/${encodeURIComponent(photoId)}/image?${p.toString()}`);
}

/** The composed JPG of a collage (a carousel slide). */
export function collageUrl(id: string, opts: { graded?: boolean; size?: string; bust?: number } = {}): string {
  const q = new URLSearchParams();
  if (opts.graded === false) q.set("graded", "0");
  if (opts.size) q.set("size", opts.size);
  if (opts.bust) q.set("t", String(opts.bust));
  const qs = q.toString();
  return pq(`/api/collages/${encodeURIComponent(id)}/image${qs ? `?${qs}` : ""}`);
}

/** Thumbnail of a style image in `data/refs`. */
export function thumbRefUrl(filename: string, w?: number): string {
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/refs/${encodeURIComponent(filename)}${q}`);
}
