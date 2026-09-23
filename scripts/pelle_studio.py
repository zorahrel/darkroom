#!/usr/bin/env python3
"""
Quanto e' uniforme la luce sul viso, e quanto e' pulita la pelle.

L'UTENTE, 24/09, su v165: «la luce non sembra uniforme e curata da studio, e
diciamo che rimuove imperfezioni». Due giudizi, due numeri:

    uniformita'  deviazione della luminanza del viso dopo una sfocatura larga
                 (un dodicesimo della larghezza del viso): e' la luce che
                 cambia da una zona all'altra, non la grana. Piu' basso = luce
                 piu' uniforme.
    macchie      deviazione di a* (rosso-verde) su scala MEDIA, tra una
                 sfocatura piccola e una larga: brufoli, rossori, chiazze.
                 La grana fine (pori) e l'illuminazione larga restano fuori.
                 Piu' basso = pelle piu' pulita.

Si misura solo la PELLE: via gli occhiali (molto scuri) e i riflessi bruciati.
La fascia degli occhi e' esclusa comunque, perche' ci stanno gli occhiali.

Uso: pelle_studio.py <immagine> [<immagine> ...]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from skimage.color import rgb2lab

sys.path.insert(0, str(Path(__file__).parent))
from face_artifacts import viso  # noqa: E402

LATO = 512


def misura(path: str) -> dict | None:
    v = viso(path)
    if v is None:
        return None
    v = v.resize((LATO, LATO))
    lab = rgb2lab(np.asarray(v, float) / 255)
    L, a = lab[..., 0], lab[..., 1]

    pelle = (L > 25) & (L < 97)
    riga = np.arange(LATO)[:, None] / LATO
    # fascia occhi/occhiali: circa dal 28% al 52% dell'altezza del riquadro
    pelle &= ~((riga > 0.28) & (riga < 0.52))
    if pelle.sum() < 2000:
        return None

    def sfoca(x: np.ndarray, r: float) -> np.ndarray:
        # sfocatura pesata sulla maschera: la pelle non si mescola con gli occhiali
        m = pelle.astype(float)
        return gaussian_filter(x * m, r) / np.maximum(gaussian_filter(m, r), 1e-6)

    largo = LATO / 12
    uniformita = float(np.std(sfoca(L, largo)[pelle]))
    medio = sfoca(a, 3) - sfoca(a, largo)
    macchie = float(np.std(medio[pelle]))
    return {"uniformita": uniformita, "macchie": macchie}


if __name__ == "__main__":
    print(f"{'file':34} {'uniformita':>11} {'macchie':>8}")
    for p in sys.argv[1:]:
        m = misura(p)
        nome = Path(p).name[:34]
        if not m:
            print(f"{nome:34} viso non trovato")
            continue
        print(f"{nome:34} {m['uniformita']:>11.2f} {m['macchie']:>8.2f}")
