#!/usr/bin/env python3
"""
Raffredda le alte luci lasciando calde le ombre, sull'incarnato soltanto.

PERCHE'. La reference ha la chiave FREDDA: sul viso le zone piu' illuminate
stanno ad a* -7,1 e le ombre ad a* +10,8 (`light_temp.py`). I render fanno il
contrario — alte luci +18,0, ombre +8,9 — e chiederlo a parole non lo sposta:
due celle dedicate, `cool-key-fredda` e `cool-key-rimbalzo`, hanno dato 18,4 e
16,9 contro i 18,0 di partenza. Il modello abbassa il giallo (b* da 20,2 a
13,2, verso il 5,9 della reference) ma non inverte la relazione fra luci e
ombre, che e' proprio il fatto da riprodurre.

PERCHE' NON BASTA skin_desaturate.py. Quello scala a* e b* insieme e cosi'
CONSERVA LA TINTA: porta +18 a +10,6, mai sotto zero. Serve uno spostamento,
non una scalatura — e applicato in funzione della luminanza, altrimenti si
raffredda anche l'ombra, che nella reference e' calda.

COME. In Lab, sul solo incarnato (tinta 20-70 gradi, croma > 6, la stessa
maschera di skin_desaturate.py, sfumata di 2 px):

  peso(L) = 0 sotto il 45° percentile del viso, 1 sopra l'80°, lineare in mezzo

  a* -= peso * delta_a      b* -= peso * delta_b

dove i delta portano la MEDIA delle alte luci del viso al bersaglio della
reference. Le ombre, con peso 0, non si muovono: restano calde per costruzione,
che e' esattamente la firma da riprodurre.

Il fattore non si calcola in forma chiusa — la maschera copre tutto
l'incarnato, la misura legge solo il viso — quindi si chiude ad anello sulla
misura vera, come gia' in skin_desaturate.py.

USO
    split_tone.py in.png out.png [--luci-a -7.1] [--luci-b 5.9]

IL BERSAGLIO LETTERALE DELLA REFERENCE FA UN CADAVERE, misurato il 13/09 su
v113 con la stessa domanda posta al giudice visivo per due varianti:

    --luci-a -7,1 (il valore della reference)   36,1% viso ciano   "SICKLY / corpse-like"
    --luci-a  0,0                               16,4% viso ciano   "pelle SANA + luce colorata"

La reference e' una pelle chiara truccata; un incarnato piu' caldo e scuro
portato allo stesso a* diventa verdastro. A 0,0 la RELAZIONE resta quella
giusta — luci neutre su ombre calde, split +8,8 contro +17,8 della reference —
ed e' la prima volta che lo split e' positivo in questo progetto.

Quindi: il bersaglio si insegue sulla relazione, non sul valore assoluto, e
la variante si sceglie GUARDANDOLA. Il numero da solo avrebbe scelto il
cadavere.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from skimage.color import lab2rgb, rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"


def box(path: Path):
    out = subprocess.run(
        [MOONDREAM, str(path), "--detect", "face"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    try:
        return json.loads(out)["objects"][0]
    except Exception:
        return None


def luci_viso(path: Path, bb):
    """a* e b* medi delle alte luci del viso — la stessa lettura di light_temp.py."""
    im = ImageOps.exif_transpose(Image.open(path).convert("RGB"))
    w, h = im.size
    lab = rgb2lab(np.asarray(im, float)[
        int(bb["y_min"] * h): int(bb["y_max"] * h),
        int(bb["x_min"] * w): int(bb["x_max"] * w),
    ] / 255)
    hi = lab[..., 0] > np.percentile(lab[..., 0], 80)
    return float(lab[..., 1][hi].mean()), float(lab[..., 2][hi].mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--luci-a", type=float, default=-7.1, help="a* bersaglio (default: la reference)")
    ap.add_argument("--luci-b", type=float, default=5.9, help="b* bersaglio")
    a = ap.parse_args()

    src = Path(a.input)
    bb = box(src)
    if not bb:
        print("viso non trovato")
        return 1

    im = ImageOps.exif_transpose(Image.open(src).convert("RGB"))
    lab = rgb2lab(np.asarray(im, float) / 255)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]

    croma = np.hypot(A, B)
    tinta = np.degrees(np.arctan2(B, A))
    pelle = (tinta > 20) & (tinta < 70) & (croma > 6)
    if pelle.sum() < 500:
        print("incarnato non trovato")
        return 1
    morbida = np.asarray(
        Image.fromarray((pelle * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)),
        float,
    ) / 255

    # La rampa si tara sul VISO, non su tutta l'immagine: e' li' che il
    # bersaglio e' definito, e un fondale chiaro sposterebbe i percentili.
    h, w = L.shape
    vf = L[int(bb["y_min"] * h): int(bb["y_max"] * h), int(bb["x_min"] * w): int(bb["x_max"] * w)]
    lo, hi = np.percentile(vf, 45), np.percentile(vf, 80)
    rampa = np.clip((L - lo) / max(hi - lo, 1e-6), 0, 1)
    peso = rampa * morbida

    out = Path(a.output)
    da, db = 0.0, 0.0
    for _ in range(4):
        o = lab.copy()
        o[..., 1] = A - peso * da
        o[..., 2] = B - peso * db
        Image.fromarray((np.clip(lab2rgb(o), 0, 1) * 255).astype(np.uint8)).save(out)
        ha, hb = luci_viso(out, bb)
        if abs(ha - a.luci_a) < 0.6 and abs(hb - a.luci_b) < 0.6:
            break
        da += ha - a.luci_a
        db += hb - a.luci_b

    pa, pb = luci_viso(src, bb)
    print(f"spostamento a* {da:+.1f}  b* {db:+.1f}")
    print(f"alte luci  prima a* {pa:6.1f} b* {pb:6.1f}   dopo a* {ha:6.1f} b* {hb:6.1f}   bersaglio {a.luci_a:.1f} / {a.luci_b:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
