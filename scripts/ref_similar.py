#!/usr/bin/env python3
"""Ordina delle immagini candidate per somiglianza a quelle già scelte.

Perché non chiederlo a un modello di visione: alla domanda "quanto è bella
questa foto" Moondream ha risposto 10 a tutte e su un sì/no ne ha promosse 56
su 59. Descrive, non discrimina — e una selezione che promuove tutto non è una
selezione.

Perché non fidarsi delle parole: cercando "editorial fashion shooting men neon
gel lighting" tornano foto da catalogo, perché è così che si descrive una foto
in un catalogo. I termini che una scena usa davvero ("y2k album cover",
"harsh flash portrait") pescano da un'altra parte.

Quindi il criterio si ricava dalle immagini già tenute. Le grandezze sono
scelte perché SEPARANO: misurate su 8 tenute e 4 scartate dallo stesso lotto,
saturazione (0.52 contro 0.61) e contrasto (0.58 contro 0.55) erano
indistinguibili, mentre il dettaglio dava 6.8 contro 4.4. La texture era il
tratto che decideva, e non era quello che avrei indovinato.

QUANTO VALE, misurato invece che sperato. Costruendo il profilo sulle 3
reference iniziali e mescolando 8 immagini tenute con 4 scartate, le scartate
finiscono in posizione 1, 7, 8, 9 su 12: una è addirittura la più vicina. Il
criterio NON predice il giudizio umano.

Serve per ORDINARE un lotto grande e guardare prima i candidati plausibili --
su 35 immagini è meglio di niente e di un modello che promuove tutto -- ma non
per scartare da solo. La selezione resta a chi guarda.

Uso:
  python3 scripts/ref_similar.py <cartella-scelte> <cartella-candidate>
Stampa i candidati dal più vicino al più lontano.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

LATO = 220


def firma(path: str) -> dict:
    im = Image.open(path).convert("RGB").resize((LATO, LATO))
    rgb = np.asarray(im, dtype=float)
    grigi = np.asarray(im.convert("L"), dtype=float)
    hsv = np.asarray(im.convert("HSV"), dtype=float)
    bordo = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return {
        "sat": float(hsv[:, :, 1].mean() / 255),
        "contrasto": float((np.percentile(grigi, 95) - np.percentile(grigi, 5)) / 255),
        # Quanto il fondo è UN colore solo: alto = fondo da studio, basso = scena.
        "fondo_vario": float(bordo.std(axis=0).mean() / 255),
        "neri": float((grigi < 40).mean()),
        # Texture e grana. È la grandezza che ha separato le scelte reali dalle
        # scartate, dove saturazione e contrasto non dicevano niente.
        "dettaglio": float(np.abs(np.diff(grigi, axis=0)).mean() / 50),
    }


# I pesi seguono il potere separante misurato, non l'intuizione: il dettaglio
# pesa il doppio perché è l'unico che distingueva davvero.
PESI = {"sat": 1.0, "contrasto": 1.0, "fondo_vario": 1.5, "neri": 1.0, "dettaglio": 2.0}


def profilo(cartella: str) -> dict:
    files = [f for f in glob.glob(os.path.join(cartella, "*")) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    if not files:
        raise SystemExit(f"nessuna immagine in {cartella}")
    firme = [firma(f) for f in files]
    return {k: sum(f[k] for f in firme) / len(firme) for k in PESI}


def distanza(a: dict, b: dict) -> float:
    return sum(abs(a[k] - b[k]) * p for k, p in PESI.items())


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("uso: ref_similar.py <cartella-scelte> <cartella-candidate>")
        raise SystemExit(1)
    rif = profilo(sys.argv[1])
    cand = [
        f
        for f in glob.glob(os.path.join(sys.argv[2], "*"))
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]
    punteggi = sorted((distanza(rif, firma(f)), f) for f in cand)
    print(json.dumps({"profilo": {k: round(v, 3) for k, v in rif.items()}}, indent=1))
    for d, f in punteggi:
        print(f"{d:6.2f}  {os.path.basename(f)}")
