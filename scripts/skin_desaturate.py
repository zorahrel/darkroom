#!/usr/bin/env python3
"""
Porta la croma dell'incarnato a un bersaglio, senza toccare il resto.

PERCHE' ESISTE. La reference dell'utente ha la pelle a croma 13,4; i render di
questo progetto stanno fra 22 e 27. Le due strade dentro il generatore sono
state misurate entrambe il 09/09 e nessuna arriva:

  · allegare la reference come campione  -> croma 18,7  ma area lucida 4,30%
    (la reference ha area lucida 26,71%: quella luce desatura la pelle PROPRIO
    perche' la copre di riflessi speculari, i due fatti non si separano)
  · chiederlo a parole, senza campione    -> croma 23,0  con l'opacita' salva

Il colore pero' e' l'unica cosa che si puo' correggere DOPO in modo esatto e
reversibile, senza rigiocare un dado da cinque minuti. Questo script lo fa
sull'incarnato soltanto: il cielo dietro, i capelli e la maglia nera restano
identici, perche' una desaturazione globale (color_grade.py --saturation)
spegnerebbe anche il fondo, che invece e' gia' giusto.

COME. Si lavora in Lab, dove la luminanza non e' toccata da nessuna operazione
sul colore:
  1. maschera dell'incarnato: pixel con tinta fra 20 e 70 gradi (il cono
     dell'incarnato, dal rosato all'ambrato) e croma sopra 6. La maglia nera,
     il fondale blu e i capelli scuri ne restano fuori per costruzione.
  2. la maschera si sfuma (raggio 2 px) perche' un bordo netto fra pelle
     desaturata e sfondo si vedrebbe come un ritaglio.
  3. a* e b* si scalano del fattore che porta la croma MEDIANA della pelle al
     bersaglio. Scalare a* e b* insieme conserva la TINTA: la pelle diventa
     meno colorata, non di un altro colore.
  4. L resta intatto: la pelle non si schiarisce ne' si scurisce, e il lucido
     (che vive in L) non viene ne' creato ne' tolto.

USO
    skin_desaturate.py in.png out.png [--croma 13.4]

Stampa la croma prima e dopo, misurata come in body_and_skin.py, cosi' il
risultato si verifica nello stesso colpo in cui si produce.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from skimage.color import lab2rgb, rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"


def croma_viso(path: Path) -> float:
    """La stessa lettura di body_and_skin.py, per confrontare mele con mele."""
    out = subprocess.run(
        [MOONDREAM, str(path), "--detect", "face"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    try:
        bb = json.loads(out)["objects"][0]
    except Exception:
        return float("nan")
    im = ImageOps.exif_transpose(Image.open(path).convert("RGB"))
    w, h = im.size
    crop = np.asarray(im, float)[
        int(bb["y_min"] * h): int(bb["y_max"] * h),
        int(bb["x_min"] * w): int(bb["x_max"] * w),
    ] / 255
    lab = rgb2lab(crop)
    m = lab[..., 0] > np.percentile(lab[..., 0], 45)
    return float(np.hypot(lab[..., 1][m], lab[..., 2][m]).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--croma", type=float, default=13.4, help="bersaglio (default: la reference)")
    a = ap.parse_args()

    src = Path(a.input)
    im = ImageOps.exif_transpose(Image.open(src).convert("RGB"))
    lab = rgb2lab(np.asarray(im, float) / 255)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]

    croma = np.hypot(A, B)
    tinta = np.degrees(np.arctan2(B, A))
    pelle = (tinta > 20) & (tinta < 70) & (croma > 6)
    if pelle.sum() < 500:
        print("incarnato non trovato: niente da fare")
        return 1

    morbida = np.asarray(
        Image.fromarray((pelle * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)),
        float,
    ) / 255

    def applica(fattore: float, dove: Path) -> None:
        k = 1 - morbida * (1 - fattore)  # 1 fuori dall'incarnato, `fattore` dentro
        o = lab.copy()
        o[..., 1] = A * k
        o[..., 2] = B * k
        Image.fromarray((np.clip(lab2rgb(o), 0, 1) * 255).astype(np.uint8)).save(dove)

    # Il fattore NON si calcola in forma chiusa: la maschera copre tutto
    # l'incarnato dell'immagine, mentre la croma che conta e' quella misurata
    # come in body_and_skin.py (solo il viso, solo i pixel illuminati). Le due
    # popolazioni non coincidono — primo tentativo: 0,70 atteso, 16,4 ottenuto
    # contro 13,4 — quindi si chiude ad anello sulla misura vera, 3 passi.
    out = Path(a.output)
    prima = croma_viso(src)
    fattore = min(1.0, a.croma / float(np.median(croma[pelle])))
    for _ in range(3):
        applica(fattore, out)
        dopo = croma_viso(out)
        if abs(dopo - a.croma) < 0.4 or not np.isfinite(dopo):
            break
        fattore = max(0.05, min(1.0, fattore * a.croma / dopo))

    print(f"fattore {fattore:.2f} su {100 * pelle.mean():.1f}% dei pixel")
    print(f"croma viso  prima {prima:5.1f}   dopo {dopo:5.1f}   bersaglio {a.croma:.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
