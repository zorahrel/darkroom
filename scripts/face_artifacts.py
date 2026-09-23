#!/usr/bin/env python3
"""
Quanto e' «rotta» una faccia: gli artefatti che l'utente vede come
«tipo artefatto di chatgpt», in tre numeri.

    dettaglio      deviazione dell'high-pass sulla luminanza del viso, a scala
                   fissa (512 px di lato). Una faccia vera ha pori e micro-
                   contrasto; una inventata da pochi pixel e' liscia o impastata.
    rumore colore  deviazione dell'high-pass su a*/b*: le chiazze di colore che
                   una passata dopo l'altra accumulano.
    reticolo       quanta energia dello spettro sta in picchi isolati (rapporto
                   picco/mediana, media dei primi 20): la trama regolare dei
                   generatori, che l'occhio legge come «plastica a quadretti».

Si confronta sempre con la FOTO VERA della stessa persona: i valori assoluti
dipendono da luce e compressione, lo scarto no.

Uso: face_artifacts.py <img> [<img> ...]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from body_and_skin import face_box  # noqa: E402
from skimage.color import rgb2lab  # noqa: E402

LATO = 512


def viso(path: str) -> Image.Image | None:
    im = Image.open(path).convert("RGB")
    # Il rilevatore vuole un file, e sulle foto da 4000 px fallisce: si cerca su
    # una copia ridotta e si riportano le coordinate (normalizzate 0-1).
    cerca = Path(path)
    tmp = None
    if max(im.size) > 1600:
        s = 1600 / max(im.size)
        tmp = Path("/tmp") / f"_fa_{Path(path).stem}.jpg"
        im.resize((round(im.width * s), round(im.height * s))).save(tmp, quality=92)
        cerca = tmp
    fb = face_box(cerca)
    if tmp:
        tmp.unlink(missing_ok=True)
    if not fb:
        return None
    x0, y0 = fb["x_min"] * im.width, fb["y_min"] * im.height
    x1, y1 = fb["x_max"] * im.width, fb["y_max"] * im.height
    return im.crop((int(x0), int(y0), int(x1), int(y1)))


def misura(path: str) -> dict | None:
    v = viso(path)
    if v is None:
        return None
    lato_originale = min(v.size)
    v = v.resize((LATO, LATO), Image.LANCZOS)
    arr = np.asarray(v, float) / 255
    lab = rgb2lab(arr)
    L = lab[..., 0]
    blur = np.asarray(Image.fromarray((L * 2.55).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), float) / 2.55
    dettaglio = float(np.std(L - blur))
    ch = []
    for c in (1, 2):
        canale = lab[..., c]
        sm = np.asarray(
            Image.fromarray(np.clip(canale + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)),
            float,
        ) - 128
        ch.append(np.std(canale - sm))
    rumore = float(np.mean(ch))
    F = np.abs(np.fft.fftshift(np.fft.fft2(L - L.mean())))
    c = LATO // 2
    F[c - 8 : c + 8, c - 8 : c + 8] = 0  # via le basse frequenze (la forma del viso)
    piatto = np.sort(F.ravel())[::-1]
    reticolo = float(np.mean(piatto[:20]) / (np.median(F) + 1e-9))
    return {"lato": lato_originale, "dettaglio": dettaglio, "rumore": rumore, "reticolo": reticolo}


if __name__ == "__main__":
    print(f"{'file':34} {'viso px':>8} {'dettaglio':>10} {'rumore col':>11} {'reticolo':>9}")
    for p in sys.argv[1:]:
        m = misura(p)
        nome = Path(p).name[:34]
        if m is None:
            print(f"{nome:34} {'viso non trovato':>40}")
            continue
        print(f"{nome:34} {m['lato']:>8} {m['dettaglio']:>10.2f} {m['rumore']:>11.2f} {m['reticolo']:>9.0f}")
