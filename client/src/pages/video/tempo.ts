import type { VideoCut } from "../../api";

/**
 * Le due misure della timeline che si sbagliano in silenzio.
 *
 * Stanno qui, fuori dai componenti, perché un errore in nessuna delle due dà un
 * errore: dà un pannello che apre il taglio sbagliato, o una corsia schiacciata
 * a zero. Si vedono solo guardando, e guardare è esattamente ciò che questa
 * pagina serve a fare bene.
 */

/** Quale taglio sta sotto un istante. Ricerca binaria perché la chiamano il
 *  trasporto a ogni `timeupdate` e la tastiera a ogni freccia. */
export function indiceTaglio(cuts: Pick<VideoCut, "t">[], t: number): number {
  let lo = 0, hi = cuts.length - 1, r = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if ((cuts[m]?.t ?? 0) <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

export const H_RIGHELLO = 20;
export const H_ATTI = 16;
export const MIN_SUONO = 34;
export const MIN_TAGLI = 44;
export const MIN_QUADRI = 40;

export type AltezzeCorsie = { suono: number; tagli: number; quadri: number };

/**
 * Come le tre corsie alte si spartiscono lo spazio del pannello.
 *
 * Tirando su il separatore la timeline cresce e l'onda, i blocchi e i
 * fotogrammi crescono con lei — che è il motivo per cui uno la ingrandisce. Se
 * lo spazio non basta si scende ai minimi e la timeline scorre in verticale,
 * invece di schiacciare tutto fino a non dire più niente.
 */
export function altezzeCorsie(altezza: number): AltezzeCorsie {
  const resta = Math.max(0, altezza - H_RIGHELLO - H_ATTI - 2);
  const minimi = MIN_SUONO + MIN_TAGLI + MIN_QUADRI;
  if (resta <= minimi) return { suono: MIN_SUONO, tagli: MIN_TAGLI, quadri: MIN_QUADRI };
  const extra = resta - minimi;
  return {
    suono: Math.round(MIN_SUONO + extra * 0.24),
    tagli: Math.round(MIN_TAGLI + extra * 0.40),
    quadri: Math.round(MIN_QUADRI + extra * 0.36),
  };
}

/** Ogni quanto mettere una tacca perché il righello resti leggibile: da lontano
 *  una ogni dieci secondi, da vicino una al secondo. */
export function passoTacche(pxAlSecondo: number): number {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxAlSecondo >= 58) return s;
  return 60;
}
