#!/usr/bin/env python3
"""Quanto una variante somiglia alla sua reference, in numeri.

Perché non basta guardarle. Su `profilo` la stessa domanda posta a un modello di
visione ha ricevuto la stessa risposta ("hard directional light from the side")
sia per il target sia per una resa con la luce piatta: la differenza c'era, ma
non nel vocabolario. Misurata, era 3.8 contro 1.9.

Le tre grandezze sono scelte perché rispondono a domande diverse, e una sola non
basta a dire "ci somiglia":

  fondo     quanta parte del bordo è chiara. Un fondo bianco e uno scuro
            cambiano la lettura di tutto il resto, ed era la differenza che non
            avevo visto per un giorno intero.
  area      quanto spazio occupa il soggetto. Dice l'inquadratura senza
            dipendere da dove cade il ritaglio.
  luce      rapporto fra la modulazione verticale e quella orizzontale DENTRO il
            soggetto. Alto = una banda che attraversa il viso; vicino a 1 = luce
            laterale o piatta. Si misura dentro la sagoma, non sull'immagine
            intera: il fondo la falserebbe, e infatti l'aveva falsata.

Uso: python3 scripts/ref_match.py <variante> <reference>
Stampa un JSON con le misure di entrambe e lo scarto.
"""
import json
import sys

import numpy as np
from PIL import Image

LATO = 256
# Sotto questa soglia un pixel è "soggetto". Il fondo delle reference di studio
# è chiaro; con un fondo scuro la sagoma non si distingue e si dichiara, invece
# di restituire un numero che sembra una misura.
SOGLIA_SOGGETTO = 200
BANDE = 8


def _misura(path: str) -> dict:
    img = Image.open(path).convert("L").resize((LATO, LATO))
    a = np.asarray(img, dtype=float)
    soggetto = a < SOGLIA_SOGGETTO

    bordo = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    fondo_chiaro = float(np.mean(bordo > 225) * 100)
    area = float(soggetto.mean())

    # Quando l'immagine intera cade sotto la soglia non c'e' piu' una sagoma da
    # misurare: e' tutta "soggetto". Le misure restano coerenti ma smettono di
    # distinguere fra un degrado e uno peggiore, quindi si dichiara invece di
    # restituire numeri che sembrano ancora discriminare.
    saturo = bool(area > 0.98 or area < 0.02)

    righe = np.where(soggetto.mean(axis=1) > 0.05)[0]
    if len(righe) < BANDE:
        # Nessuna sagoma leggibile: un rapporto calcolato su quattro pixel
        # sarebbe un numero, non una misura.
        return {"fondo": round(fondo_chiaro, 1), "area": round(area, 3), "luce": None, "saturo": saturo}

    box = a[righe[0] : righe[-1] + 1]
    maschera = soggetto[righe[0] : righe[-1] + 1]
    h, w = box.shape
    vert, oriz = [], []
    for i in range(BANDE):
        fascia = maschera[i * h // BANDE : (i + 1) * h // BANDE]
        pixel = box[i * h // BANDE : (i + 1) * h // BANDE][fascia]
        if pixel.size:
            vert.append(pixel.mean())
        colonna = maschera[:, i * w // BANDE : (i + 1) * w // BANDE]
        pixel = box[:, i * w // BANDE : (i + 1) * w // BANDE][colonna]
        if pixel.size:
            oriz.append(pixel.mean())
    if len(vert) < 2 or len(oriz) < 2:
        return {"fondo": round(fondo_chiaro, 1), "area": round(area, 3), "luce": None, "saturo": saturo}

    ampiezza_h = max(oriz) - min(oriz)
    # Un'orizzontale perfettamente piatta darebbe divisione per zero: si limita
    # in basso invece di restituire infinito, che in pagina non direbbe niente.
    luce = (max(vert) - min(vert)) / max(ampiezza_h, 1.0)
    return {
        "fondo": round(fondo_chiaro, 1),
        "area": round(area, 3),
        "luce": round(luce, 1),
        "saturo": saturo,
    }


def confronta(variante: str, reference: str) -> dict:
    v = _misura(variante)
    r = _misura(reference)
    scarti = {
        "fondo": round(abs(v["fondo"] - r["fondo"]), 1),
        "area": round(abs(v["area"] - r["area"]), 3),
        "luce": None if v["luce"] is None or r["luce"] is None else round(abs(v["luce"] - r["luce"]), 1),
    }
    # Distanza unica per ordinare le varianti. I pesi rendono confrontabili
    # grandezze con scale diverse: 0.05 di area e 15 punti di fondo pesano
    # uguale, che è più o meno quanto si somigliano a occhio.
    distanza = scarti["fondo"] / 50 + scarti["area"] * 3
    if scarti["luce"] is not None:
        distanza += scarti["luce"] / 2
    return {
        "variante": v,
        "reference": r,
        "scarti": scarti,
        "distanza": round(distanza, 2),
        # Oltre la saturazione la distanza e' un limite inferiore: la variante
        # e' almeno cosi' lontana, forse di piu'. Dirlo evita di leggere come
        # "uguali" due immagini che la metrica non sa piu' separare.
        "saturo": bool(v.get("saturo") or r.get("saturo")),
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "uso: ref_match.py <variante> <reference>"}))
        sys.exit(1)
    try:
        print(json.dumps(confronta(sys.argv[1], sys.argv[2])))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
