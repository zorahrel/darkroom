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
export function cutIndex(cuts: Pick<VideoCut, "t">[], t: number): number {
  let lo = 0, hi = cuts.length - 1, r = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if ((cuts[m]?.t ?? 0) <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

export const H_RULER = 20;
export const H_ACTS = 16;
export const MIN_SUONO = 34;
export const MIN_TAGLI = 44;
export const MIN_QUADRI = 40;

export type LaneHeights = { suono: number; cuts: number; quadri: number };

/**
 * Come le tre corsie alte si spartiscono lo spazio del pannello.
 *
 * Tirando su il separatore la timeline cresce e l'onda, i blocchi e i
 * fotogrammi crescono con lei — che è il motivo per cui uno la ingrandisce. Se
 * lo spazio non basta si scende ai minimi e la timeline scorre in verticale,
 * invece di schiacciare tutto fino a non dire più niente.
 */
export function laneHeights(height: number): LaneHeights {
  const resta = Math.max(0, height - H_RULER - H_ACTS - 2);
  const minimums = MIN_SUONO + MIN_TAGLI + MIN_QUADRI;
  if (resta <= minimums) return { suono: MIN_SUONO, cuts: MIN_TAGLI, quadri: MIN_QUADRI };
  const extra = resta - minimums;
  return {
    suono: Math.round(MIN_SUONO + extra * 0.24),
    cuts: Math.round(MIN_TAGLI + extra * 0.40),
    quadri: Math.round(MIN_QUADRI + extra * 0.36),
  };
}

/** Ogni quanto mettere una tacca perché il righello resti leggibile: da lontano
 *  una ogni dieci secondi, da vicino una al secondo. */
export function tickStep(pxAlSecondo: number): number {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * pxAlSecondo >= 58) return s;
  return 60;
}

/**
 * Il tempo come lo scrive un montaggio: `ore:minuti:secondi:fotogramma`.
 *
 * `2:05.4` va bene per dire dove sei a occhio, ma non per dire *quale
 * fotogramma*: quattro decimi sono dieci quadri a 24, e un taglio si discute al
 * quadro. Un editor scrive `00:02:05:09` perche' quel numero e' indirizzabile —
 * si puo' scrivere in una nota e ritrovare esatto.
 */
export function timecode(s: number, fps = 24): string {
  const tot = Math.max(0, Math.round(s * fps));
  const f = tot % fps;
  const sec = Math.floor(tot / fps);
  const due = (n: number) => String(n).padStart(2, "0");
  return `${due(Math.floor(sec / 3600))}:${due(Math.floor(sec / 60) % 60)}:${due(sec % 60)}:${due(f)}`;
}

/** Le velocita' della navetta J/K/L, come su qualunque banco di montaggio:
 *  premere piu' volte accelera, K ferma, e indietro e' lo specchio di avanti. */
export function shuttle(attuale: number, tasto: "j" | "k" | "l"): number {
  const scala = [1, 2, 4, 8];
  if (tasto === "k") return 0;
  const verso = tasto === "l" ? 1 : -1;
  if (Math.sign(attuale) !== verso) return verso;                 // cambio di verso: riparti da 1x
  const i = scala.indexOf(Math.abs(attuale));
  return verso * (scala[Math.min(scala.length - 1, i + 1)] ?? 1);
}
