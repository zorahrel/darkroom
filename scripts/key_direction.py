#!/usr/bin/env python3
"""
Da dove arriva la luce: dall'alto o dal basso, da destra o da sinistra.

PERCHE' ESISTE, e perche' e' arrivato tardi. Questo progetto ha misurato per
giorni il COLORE della luce (light_temp.py) e la SATURAZIONE della pelle
(body_and_skin.py) senza mai misurare la cosa che si vede per prima: la
direzione della sorgente. Messe la reference e la consegna fianco a fianco e
GUARDATE invece che misurate, la differenza che salta all'occhio non era
nessuno dei numeri inseguiti — era che la luce arriva da un'altra parte.

COSA MISURA. Nel riquadro del viso, due differenze di luminanza media:

  alto-basso   meta' superiore meno meta' inferiore. Positivo = la fronte e'
               piu' chiara del mento, cioe' softbox IN ALTO. Negativo = luce
               dal basso o frontale piatta, che e' la firma dello "studio
               finto".
  sx-dx        meta' sinistra meno meta' destra: da che lato sta la chiave.
               Vicino a zero = luce simmetrica, che in un ritratto vero non
               capita quasi mai.

I VALORI, misurati il 09/09:

                        alto-basso   sx-dx
  la tua reference        +19,8       -4,1    chiave alta, spostata a destra
  v113 consegnata          -8,5       +2,9    chiave dal basso, da sinistra

Ventotto punti di differenza sull'asse verticale, e il segno e' opposto. Per
confronto: la differenza di temperatura inseguita per un giro intero valeva 25
punti di a* e si vedeva molto meno.

USO
    python3 scripts/key_direction.py refs/luce-bg-studio-blu.png gen/v119.png …

Esce 1 se l'ultimo file ha la chiave dal basso (alto-basso <= 0).
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"


def viso_L(path: Path):
    out = subprocess.run(
        [MOONDREAM, str(path), "--detect", "face"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    try:
        b = json.loads(out)["objects"][0]
    except Exception:
        return None
    im = ImageOps.exif_transpose(Image.open(path).convert("RGB"))
    w, h = im.size
    crop = np.asarray(im, float)[
        int(b["y_min"] * h): int(b["y_max"] * h),
        int(b["x_min"] * w): int(b["x_max"] * w),
    ] / 255
    return rgb2lab(crop)[..., 0]


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    print(f"{'file':32} {'alto-basso':>11} {'sx-dx':>7}  chiave")
    ultimo = None
    for p in sys.argv[1:]:
        L = viso_L(Path(p))
        nome = Path(p).name[:32]
        if L is None:
            print(f"{nome:32}   (viso non trovato)")
            continue
        h, w = L.shape
        v = float(L[: h // 2].mean() - L[h // 2:].mean())
        o = float(L[:, : w // 2].mean() - L[:, w // 2:].mean())
        lato = "da sinistra" if o > 1 else ("da destra" if o < -1 else "simmetrica")
        print(f"{nome:32} {v:11.1f} {o:7.1f}  {'ALTA' if v > 0 else 'dal basso ← difetto'}, {lato}")
        ultimo = v
    return 0 if (ultimo is not None and ultimo > 0) else 1


if __name__ == "__main__":
    sys.exit(main())
