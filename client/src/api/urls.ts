/** Image URLs. Every one carries the active project (images can't send headers). */

import { pq } from "./http";
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

export function thumbRawUrl(id: string, w?: number): string {
  const q = w ? `?w=${w}` : "";
  return pq(`/thumb/raw/${encodeURIComponent(id)}${q}`);
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

/** Immagine di stile del progetto (`data/refs`). */
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

/** JPG composto di un collage (slide del carosello). */
export function collageUrl(id: string, opts: { graded?: boolean; size?: string; bust?: number } = {}): string {
  const q = new URLSearchParams();
  if (opts.graded === false) q.set("graded", "0");
  if (opts.size) q.set("size", opts.size);
  if (opts.bust) q.set("t", String(opts.bust));
  const qs = q.toString();
  return pq(`/api/collages/${encodeURIComponent(id)}/image${qs ? `?${qs}` : ""}`);
}
