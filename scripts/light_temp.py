#!/usr/bin/env python3
"""
Di che colore e' la luce che mi batte in faccia: fredda o calda.

PERCHE' NON BASTAVA LA CROMA. `body_and_skin.py` dice QUANTO colore ha la
pelle; questo dice DA CHE PARTE. Sono due difetti diversi che vivono nello
stesso numero, ed e' per questo che correggere la croma in post non ha chiuso
il secondo: `skin_desaturate.py` scala a* e b* insieme, il che conserva la
tinta per costruzione — puo' portare a* da +18 a +10, mai a -7.

COSA MISURA. Il riquadro del viso si divide in due popolazioni:

  alte luci   pixel sopra l'80° percentile di L  — dove batte la chiave
  ombre       pixel fra il 20° e il 45°          — dove la chiave non arriva

e di ciascuna si legge a* (verde-rosso) e b* (blu-giallo). La differenza fra
le due dice il colore della SORGENTE, non quello della pelle: la pelle e' la
stessa in entrambe le zone, cambia solo cosa la illumina.

LA FIRMA CHE SI CERCA, misurata il 09/09:

                       alte luci a* b*    ombre a* b*
  la tua reference       -7,1 / +5,9     +10,8 / -3,9     chiave FREDDA
  la tua foto vera      +15,4 / +19,4    +15,1 / +12,6    luce piatta
  v113 generata         +18,0 / +20,2     +8,9 / -11,5    chiave CALDA
  v113 consegnata       +10,6 / +11,5     +7,7 / -14,4    chiave CALDA

Nella reference le zone piu' illuminate sono le piu' FREDDE (a* negativo,
verso il ciano) e il calore dell'incarnato sopravvive solo in ombra: e' la
firma di una chiave bianca-azzurra con un fondale blu che rimbalza. Nei render
succede il contrario, e sono 25 punti di a* di differenza sul punto che
l'occhio guarda per primo.

  a* alte luci < 0        chiave fredda, come la reference
  a* alte luci > a* ombre chiave calda: e' il difetto

USO
    python3 scripts/light_temp.py refs/luce-bg-studio-blu.png gen/v115.png …

Esce 1 se l'ultimo file ha la chiave piu' calda delle ombre.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"


def viso_lab(path: Path):
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
    return rgb2lab(crop)


def misura(path: Path):
    lab = viso_lab(path)
    if lab is None:
        return None
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    hi = L > np.percentile(L, 80)
    lo = (L > np.percentile(L, 20)) & (L < np.percentile(L, 45))
    return dict(
        hi_a=float(A[hi].mean()), hi_b=float(B[hi].mean()),
        lo_a=float(A[lo].mean()), lo_b=float(B[lo].mean()),
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    print(f"{'file':30} {'luci a*':>8} {'luci b*':>8} {'ombre a*':>9} {'ombre b*':>9}  chiave")
    ultimo = None
    for p in sys.argv[1:]:
        r = misura(Path(p))
        nome = Path(p).name[:30]
        if not r:
            print(f"{nome:30}   (viso non trovato)")
            continue
        fredda = r["hi_a"] < r["lo_a"]
        print(
            f"{nome:30} {r['hi_a']:8.1f} {r['hi_b']:8.1f} {r['lo_a']:9.1f} {r['lo_b']:9.1f}"
            f"  {'FREDDA' if fredda else 'calda ← difetto'}"
        )
        ultimo = r
    return 0 if (ultimo and ultimo["hi_a"] < ultimo["lo_a"]) else 1


if __name__ == "__main__":
    sys.exit(main())
