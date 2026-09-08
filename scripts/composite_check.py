#!/usr/bin/env python3
"""Misura la 'firma da fotomontaggio' di un ritratto su fondo uniforme.

Tre numeri, tutti letti dai pixel, nessun giudizio di modello:

  spill  chroma che il fondo lascia sul bordo del soggetto (unita' Lab, verso
         la tinta del fondo). In una foto vera un fondo colorato e luminoso
         bagna spalle e mascella. Vicino a 0 = soggetto illuminato per conto suo.
  ombra  L del fondo attaccato al soggetto meno L del fondo lontano.
         Negativo = c'e' una caduta/ombra portata. Esattamente 0 = fondo piatto
         dietro un ritaglio.
  bordo  larghezza 10-90%% della transizione soggetto/fondo, in pixel a 1200px
         di lato. Sotto ~1.5 e' un taglio, non una messa a fuoco.

Uso: composite_check.py IMG [IMG...]
"""
import sys
import numpy as np
from PIL import Image
from skimage.color import rgb2lab
from skimage.filters import threshold_otsu
from scipy import ndimage

W = 1200


def load(path):
    im = Image.open(path).convert("RGB")
    if im.width > W:
        im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    return rgb2lab(np.asarray(im, dtype=np.float64) / 255.0)


def segment(lab):
    """Fondo = colore modale del bordo alto/laterale. Soggetto = il resto."""
    h, w, _ = lab.shape
    border = np.concatenate([
        lab[: max(1, h // 20)].reshape(-1, 3),
        lab[:, : max(1, w // 20)].reshape(-1, 3),
        lab[:, -max(1, w // 20):].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)
    d = np.linalg.norm(lab - bg, axis=2)
    # Otsu sulla distanza dal fondo: regge anche il soggetto scuro su fondo scuro,
    # dove una soglia fissa prende due pixel o mezza immagine.
    thr = float(threshold_otsu(d))
    subj = d > thr
    subj = ndimage.binary_fill_holes(subj)
    lbl, n = ndimage.label(subj)
    if n:
        sizes = ndimage.sum(subj, lbl, range(1, n + 1))
        subj = lbl == (int(np.argmax(sizes)) + 1)
    return bg, subj


def bands(subj):
    er = lambda k: ndimage.binary_erosion(subj, iterations=k)
    di = lambda k: ndimage.binary_dilation(subj, iterations=k)
    inner = er(2) & ~er(10)          # 2..10 px dentro la silhouette
    core = er(40)                    # ben dentro il soggetto
    outer = di(15) & ~di(3)          # 3..15 px fuori, sul fondo
    far = ~di(60)                    # fondo lontano
    return inner, core, outer, far


def edge_width(lab, bg, subj):
    """10-90%% della salita di deltaE attraverso il bordo, per riga."""
    d = np.linalg.norm(lab - bg, axis=2)
    lo, hi = np.percentile(d[~subj], 50), np.percentile(d[subj], 50)
    if hi - lo < 5:
        return float("nan")
    t10, t90 = lo + 0.1 * (hi - lo), lo + 0.9 * (hi - lo)
    widths = []
    h, w = subj.shape
    for y in range(0, h, 3):
        row, sr = d[y], subj[y]
        xs = np.flatnonzero(np.diff(sr.astype(np.int8)) != 0)
        for x in xs:
            seg = row[max(0, x - 12): x + 13]
            if seg.size < 8:
                continue
            a = np.flatnonzero(seg >= t10)
            b = np.flatnonzero(seg >= t90)
            if a.size and b.size:
                wdt = abs(int(b[0]) - int(a[0]))
                if 0 <= wdt <= 24:
                    widths.append(wdt)
    return float(np.median(widths)) if widths else float("nan")


def measure(path):
    lab = load(path)
    bg, subj = segment(lab)
    frac = subj.mean()
    if not (0.03 < frac < 0.9):
        return dict(path=path, error=f"segmentazione incerta (soggetto {frac:.0%})")
    inner, core, outer, far = bands(subj)
    if core.sum() < 200 or inner.sum() < 200:
        return dict(path=path, error="soggetto troppo piccolo per le bande")

    ab = lab[..., 1:]
    L = lab[..., 0]
    core_ab = ab[core].mean(axis=0)
    # direzione della tinta del fondo, dal neutro: e' quella che una luce di
    # quel colore lascia addosso al soggetto.
    hue = bg[1:] / max(np.linalg.norm(bg[1:]), 1e-6)

    dirv = bg[1:] - core_ab
    n = np.linalg.norm(dirv)
    spill = float(((ab[inner] - core_ab) @ (dirv / n if n > 1e-6 else 0)).mean())

    # tinta ambientale: quanto del colore del fondo sta ADDOSSO al soggetto, e
    # soprattutto quanto ce n'e' in piu' nelle sue zone scure. Con una sola
    # sorgente colorata le ombre vanno verso la sorgente; in un montaggio le
    # ombre restano pelle neutra e questo numero sta intorno a zero.
    p = ab[core] @ hue
    l = L[core]
    lo, hi = np.percentile(l, 33), np.percentile(l, 67)
    tint = float(p.mean())
    shade_tint = float(p[l <= lo].mean() - p[l >= hi].mean())

    # gradiente del fondo: L del fondo in basso meno L del fondo in alto, letto
    # solo sui margini laterali per non passare mai dal soggetto. Serve a dire
    # se un fondale ACCESO e' stato copiato o appiattito: nel riferimento che
    # l'utente ha mandato l'08/09 vale +45 (quasi nero sopra, ciano acceso
    # sotto), e un fondo inventato dal modello sta intorno a 0 o va al contrario.
    marg = np.zeros(subj.shape, bool)
    mw = max(2, subj.shape[1] // 25)
    marg[:, :mw] = True
    marg[:, -mw:] = True
    marg &= ~ndimage.binary_dilation(subj, iterations=8)
    hb = subj.shape[0] // 5
    top, bot = marg.copy(), marg.copy()
    top[hb:] = False
    bot[:-hb] = False
    grad = (
        float(L[bot].mean() - L[top].mean())
        if top.sum() > 50 and bot.sum() > 50
        else float("nan")
    )

    return dict(
        path=path, spill=spill, tint=tint, shade=shade_tint,
        shadow=float(L[outer].mean() - L[far].mean()),
        edge=edge_width(lab, bg, subj), grad=grad,
        bg_L=float(bg[0]), subj_L=float(L[core].mean()),
    )


if __name__ == "__main__":
    print(f"{'file':<26}{'tinta':>8}{'ombre':>8}{'spill':>8}{'ombra':>8}{'bordo':>7}{'grad':>8}  {'L sogg/fondo':>13}")
    for p in sys.argv[1:]:
        r = measure(p)
        name = p.split("/")[-1]
        if "error" in r:
            print(f"{name:<26}  {r['error']}")
        else:
            print(f"{name:<26}{r['tint']:>8.2f}{r['shade']:>8.2f}{r['spill']:>8.2f}"
                  f"{r['shadow']:>8.2f}{r['edge']:>7.1f}{r['grad']:>8.1f}  "
                  f"{r['subj_L']:>6.1f} /{r['bg_L']:>6.1f}")
