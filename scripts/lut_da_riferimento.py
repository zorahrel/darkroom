#!/usr/bin/env python3
"""
LUT 3D (.cube) costruita da una foto di riferimento, da applicare a un'altra foto.

Perche' esiste: la tinta delle alte luci sulla pelle (a 0, b 7 nella reference) non si
fissa a parole nel prompt: in nove giri uscivano arancio o grigio-blu.

Come: trasferimento di tinta SOLO sulla pelle, per fascia di luminosita'. Si isolano i
pixel di tonalita' pelle (angolo a/b e saturazione) in tutte e due le foto, si misura in
ogni fascia di L la media (a, b), e la LUT sposta la sorgente verso la reference di
quella differenza, con peso zero fuori dalla tonalita' pelle. Luminosita', neri, fondo e
capelli non si toccano. (Prima prova, scartata: trasporto di Monge-Kantorovich su tutta
l'immagine: con contenuti diversi schiariva le alte luci a L 98 e alzava i neri a 23.)
`--dose` 0-100 sfuma fra identita' e look pieno.

Uso: lut_da_riferimento.py --sorgente a.png --riferimento ref.png --lut out.cube
         [--applica a.png --uscita b.png] [--dose 100] [--size 33]
La LUT dipende dalla coppia: per una foto diversa, rigenerala con una sorgente simile.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))

D65 = np.array([0.95047, 1.0, 1.08883])
M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
MI = np.linalg.inv(M)


def srgb_to_lab(rgb):
    c = np.asarray(rgb, float) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = (c @ M.T) / D65
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_srgb(lab):
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * D65
    c = np.clip(xyz @ MI.T, 0, 1)
    c = np.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, 12.92 * c)
    return np.clip(c * 255.0, 0, 255)


def pixels(path, lato=300):
    im = Image.open(path).convert("RGB")
    im.thumbnail((lato, lato))
    return srgb_to_lab(np.asarray(im).reshape(-1, 3))


FASCE = np.array([30.0, 42.0, 54.0, 66.0, 78.0, 90.0])  # centri delle fasce di L


def peso_pelle(lab):
    """0-1: quanto un pixel e' di tonalita' pelle (angolo a/b caldo, saturazione media)."""
    a_, b_ = lab[..., 1], lab[..., 2]
    ang = np.degrees(np.arctan2(b_, a_))
    chroma = np.hypot(a_, b_)
    h = np.clip(ang / 20, 0, 1) * np.clip((90 - ang) / 20, 0, 1)  # 0..90 gradi, pieno da 20 a 70
    c = np.clip((chroma - 6) / 8, 0, 1) * np.clip((55 - chroma) / 15, 0, 1)
    l_ = np.clip((lab[..., 0] - 22) / 8, 0, 1)             # fuori dai neri e dai capelli
    return h * c * l_


def deltas(src, ref):
    """Differenza (a, b) fra riferimento e sorgente per fascia di L, solo sulla pelle."""
    d = np.zeros((len(FASCE), 2))
    for k, c in enumerate(FASCE):
        out = []
        for lab in (src, ref):
            w = peso_pelle(lab) * np.clip(1 - np.abs(lab[:, 0] - c) / 12, 0, 1)
            out.append((lab[:, 1:] * w[:, None]).sum(0) / max(w.sum(), 1e-6) if w.sum() > 50 else None)
        d[k] = (out[1] - out[0]) if out[0] is not None and out[1] is not None else (d[k - 1] if k else 0)
    return d


def scrivi_cube(path, trasforma, size):
    g = np.linspace(0, 255, size)
    # .cube: il rosso varia piu' in fretta
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = lab_to_srgb(trasforma(srgb_to_lab(rgb))) / 255.0
    with open(path, "w") as f:
        f.write(f"TITLE \"{Path(path).stem}\"\nLUT_3D_SIZE {size}\n")
        for r_, g_, b_ in out:
            f.write(f"{r_:.6f} {g_:.6f} {b_:.6f}\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sorgente", required=True)
    ap.add_argument("--riferimento", required=True)
    ap.add_argument("--lut", required=True)
    ap.add_argument("--applica")
    ap.add_argument("--uscita")
    ap.add_argument("--dose", type=float, default=100.0)
    ap.add_argument("--size", type=int, default=33)
    a = ap.parse_args()

    d = deltas(pixels(a.sorgente), pixels(a.riferimento))
    print("spostamento a/b per fascia di L", dict(zip(FASCE.astype(int).tolist(), d.round(1).tolist())))
    k = a.dose / 100.0

    def trasforma(lab):
        sh = np.stack([np.interp(lab[..., 0], FASCE, d[:, 0]), np.interp(lab[..., 0], FASCE, d[:, 1])], -1)
        out = lab.copy()
        out[..., 1:] += k * peso_pelle(lab)[..., None] * sh
        return out

    scrivi_cube(a.lut, trasforma, a.size)
    print(f"LUT scritta: {a.lut} ({a.size}^3, dose {a.dose:g})")
    if a.applica:
        from color_grade import apply_lut

        arr = np.asarray(Image.open(a.applica).convert("RGB"))
        out = apply_lut(arr.copy(), a.lut)
        Image.fromarray(np.asarray(out).astype(np.uint8)).save(a.uscita)
        print(f"applicata: {a.uscita}")


if __name__ == "__main__":
    main()
