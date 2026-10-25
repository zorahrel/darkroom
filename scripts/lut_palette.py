#!/usr/bin/env python3
"""LUT 3D che porta un gruppo di foto verso la palette di un altro gruppo.

    lut_palette.py --target feed/*.jpg --source giappone/*.png --out palette.cube
                   [--dose-l 0.6] [--dose-ab 0.8] [--size 33] [--report]

Serve a far stare insieme cose nate separate: i post nuovi e la foto profilo
accanto al feed che c'e' gia'. La palette e' quella del gruppo TARGET (il feed);
la LUT si costruisce sulle statistiche del gruppo SOURCE, quindi per due gruppi
diversi (i post del Giappone, una foto profilo) servono due LUT verso la stessa
palette, non una sola.

Cosa sposta, in Lab:
- la luminosita' con una curva per quantili (i neri restano neri, le luci non
  si bruciano: la curva e' monotona e mescolata con l'identita' da --dose-l);
- il colore con media e dispersione di a/b (tinta e saturazione), mescolato da
  --dose-ab.
Non sposta la geometria della tinta per zone (cieli, pelle): e' un look
globale, come una LUT di pellicola, non una correzione locale.
"""
import argparse
import glob
import json

import numpy as np
from PIL import Image


def srgb_to_lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_srgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f**3 > 216 / 24389, f**3, (116 * f - 16) / (24389 / 27)) * np.array([0.95047, 1.0, 1.08883])
    m = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
    c = np.clip(xyz @ m.T, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)


def load_lab(paths, side=256):
    out = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im.thumbnail((side, side))
        out.append(srgb_to_lab(np.asarray(im, float).reshape(-1, 3) / 255))
    return np.concatenate(out)


class Palette:
    def __init__(self, src, tgt, dose_l, dose_ab):
        q = np.linspace(0, 100, 101)
        sq, tq = np.percentile(src[:, 0], q), np.percentile(tgt[:, 0], q)
        # Quantili ripetuti (molti pixel neri) rompono l'interpolazione: si
        # rendono strettamente crescenti prima di usarli come ascisse.
        sq = np.maximum.accumulate(sq + np.arange(101) * 1e-6)
        self.sq, self.tq, self.dl, self.dab = sq, tq, dose_l, dose_ab
        self.sm, self.ss = src[:, 1:].mean(0), src[:, 1:].std(0) + 1e-6
        self.tm, self.ts = tgt[:, 1:].mean(0), tgt[:, 1:].std(0) + 1e-6

    def __call__(self, lab):
        L = lab[..., 0]
        L2 = np.interp(L, self.sq, self.tq)
        ab = lab[..., 1:]
        ab2 = (ab - self.sm) * (self.ts / self.ss) + self.tm
        return np.concatenate(
            [(L + self.dl * (L2 - L))[..., None], ab + self.dab * (ab2 - ab)], -1
        )


def stats(lab):
    rgb = lab_to_srgb(lab)
    mx, mn = rgb.max(-1), rgb.min(-1)
    return {
        "L_medio": round(float(lab[:, 0].mean()), 1),
        "a_medio": round(float(lab[:, 1].mean()), 1),
        "b_medio": round(float(lab[:, 2].mean()), 1),
        "croma": round(float(np.hypot(lab[:, 1], lab[:, 2]).mean()), 1),
        "saturazione": round(float(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0).mean()), 2),
        "scuri_pct": round(float(100 * (lab[:, 0] < 15).mean()), 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", nargs="+", required=True)
    ap.add_argument("--source", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dose-l", type=float, default=0.6)
    ap.add_argument("--dose-ab", type=float, default=0.8)
    ap.add_argument("--size", type=int, default=33)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    expand = lambda xs: sorted({p for x in xs for p in (glob.glob(x) or [x])})
    tgt, src = load_lab(expand(a.target)), load_lab(expand(a.source))
    pal = Palette(src, tgt, a.dose_l, a.dose_ab)

    n = a.size
    g = np.linspace(0, 1, n)
    # .cube: il rosso varia piu' in fretta, poi il verde, poi il blu.
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    grid = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = lab_to_srgb(pal(srgb_to_lab(grid)))
    with open(a.out, "w") as f:
        f.write(f'TITLE "palette {a.dose_l}/{a.dose_ab}"\nLUT_3D_SIZE {n}\n')
        for v in out:
            f.write(f"{v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
    if a.report:
        print(json.dumps({"target": stats(tgt), "source": stats(src), "dopo": stats(pal(src))}))


if __name__ == "__main__":
    main()
