#!/usr/bin/env python3
"""
Alza le alte luci della foto di partenza, lasciando stare ombre e medi.

PERCHE'. Il generatore copia la luce della foto che riceve come materia
(misurato piu' volte in questo progetto: direzione ed esposizione della materia
passano quasi intatte nel render). La reference ha le alte luci del viso a
L 91 — il faretto «sovraesposto» che l'utente chiede — mentre le nostre foto di
partenza arrivano a 60-70. Chiederlo nel prompt non le ha mai portate su;
metterlo nella materia si'.

COME. Solo L, in Lab: L' = L + K * smoothstep(soglia, 85, L), tagliato a 99.
Sotto la soglia non cambia niente (ombre e medi restano quelli della foto),
sopra 85 la spinta e' piena. Tinta e croma non si toccano: il colore della luce
lo fa `split_tone.py`, dopo.

USO
    python3 scripts/lift_highlights.py <input> <output> [--k 18] [--soglia 45]
"""
from __future__ import annotations

import argparse

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--k", type=float, default=18.0, help="spinta massima su L")
    ap.add_argument("--soglia", type=float, default=45.0, help="L sotto cui non cambia niente")
    a = ap.parse_args()

    rgb = np.asarray(Image.open(a.input).convert("RGB"), float) / 255
    lab = rgb2lab(rgb)
    L = lab[..., 0]
    t = np.clip((L - a.soglia) / (85 - a.soglia), 0, 1)
    s = t * t * (3 - 2 * t)
    lab[..., 0] = np.clip(L + a.k * s, 0, 99)
    out = (np.clip(lab2rgb(lab), 0, 1) * 255).round().astype(np.uint8)
    Image.fromarray(out).save(a.output)
    print(f"alte luci: L99 {np.percentile(L, 99):.1f} -> {np.percentile(lab[..., 0], 99):.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
