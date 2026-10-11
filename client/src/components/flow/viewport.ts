/**
 * La matematica del canvas della Mappa, senza DOM: cosi' si puo' provare.
 *
 * Il contenuto (largo `w`, alto `h`, in unita' della mappa) sta dentro un'area scorrevole con un
 * MARGINE di mezza finestra per lato. Senza il margine lo scroll si ferma al bordo e un nodo vicino
 * al bordo non si puo' mai portare al centro: era questo il "non riesco a centrare bene".
 * Con il margine, centrare un punto (x, y) vuol dire scrollare a (x*z, y*z) e basta.
 */
export type Box = { cw: number; ch: number }; // dimensione della finestra visibile

/** Mezza finestra per lato. */
export const margin = ({ cw, ch }: Box) => ({ px: cw / 2, py: ch / 2 });

/** Dimensione totale dell'area scorrevole. */
export function canvasSize(w: number, h: number, z: number, box: Box) {
  const { px, py } = margin(box);
  return { width: w * z + 2 * px, height: h * z + 2 * py };
}

/** Lo scroll che porta il punto (x, y) del contenuto al centro della finestra. */
export function scrollToCenter(x: number, y: number, z: number): { left: number; top: number } {
  return { left: Math.max(0, x * z), top: Math.max(0, y * z) };
}

/** Lo zoom che fa stare tutto il contenuto nella finestra (con un respiro), tenuto fra min e max. */
export function fitZoom(w: number, h: number, box: Box, opts: { min?: number; max?: number; breathe?: number } = {}) {
  const { min = 0.15, max = 1.5, breathe = 0.92 } = opts;
  if (w <= 0 || h <= 0 || box.cw <= 0 || box.ch <= 0) return 1;
  const f = Math.min(box.cw / w, box.ch / h) * breathe;
  return Math.min(max, Math.max(min, Math.round(f * 100) / 100));
}

/** Il punto del contenuto che sta sotto il punto (ox, oy) della finestra, dato lo scroll attuale. */
export function contentPointAt(ox: number, oy: number, scroll: { left: number; top: number }, z: number, box: Box) {
  const { px, py } = margin(box);
  return { x: (scroll.left + ox - px) / z, y: (scroll.top + oy - py) / z };
}

/** Lo scroll che, dopo lo zoom `nz`, tiene fermo il punto sotto (ox, oy). */
export function anchoredScroll(
  ox: number,
  oy: number,
  scroll: { left: number; top: number },
  z: number,
  nz: number,
  box: Box,
): { left: number; top: number } {
  const { px, py } = margin(box);
  const c = contentPointAt(ox, oy, scroll, z, box);
  return { left: Math.max(0, c.x * nz + px - ox), top: Math.max(0, c.y * nz + py - oy) };
}

/** Il punto del contenuto che sta al centro della finestra: serve a sapere se una selezione e' gia' centrata. */
export function centerOf(scroll: { left: number; top: number }, z: number, box: Box) {
  return contentPointAt(box.cw / 2, box.ch / 2, scroll, z, box);
}
