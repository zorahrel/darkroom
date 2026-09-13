#!/usr/bin/env python3
"""
Il viso stacca dal fondo? Il numero che separa un ritratto da un collage.

PERCHE'. "Sembrano due scatti diversi con lo sfondo" e' un giudizio, ma la sua
causa fisica non lo e': in un ritratto con una lampada sola il soggetto e'
illuminato e il fondale, che sta piu' lontano, riceve meno luce e cade. Se
invece il fondo e' luminoso quanto il viso, manca la prova visiva che la luce
venga da una sorgente unica nella stessa stanza — e l'occhio legge due
immagini sovrapposte, qualunque cosa dica il colore.

COSA MISURA. La luminanza L* del viso contro quella del fondo ALLA STESSA
QUOTA — solo i margini laterali, che sono fondo puro — perche' e' quel
confronto che l'occhio fa. Confrontare il viso con la media di tutto il fondo
darebbe ragione a un'immagine col fondo scuro in alto e sparato in basso, che
e' esattamente il difetto di v101.

PERCHE' IL DETECTOR E NON UNA MASCHERA. La silhouette per soglia sbaglia
proprio nei casi che contano: su un fondale ACCESO classifica il fondo come
soggetto (misurato l'08/09 — `composite_check.py` restituisce `nan` su v101).
Il riquadro del viso viene da moondream, che su questo set non ha mai fallito.

TARATURA (08/09, questo progetto):
    riferimento dell'utente   viso 41,7  fondo 20,8   stacco +20,9
    v94  (accettata)          viso 35,8  fondo 14,2   stacco +21,5
    v101 (scartata: collage)  viso 39,4  fondo 39,8   stacco  -0,4
Una consegna precedente con stacco negativo esiste (v61: -5,3) ed e' proprio
quella che non era leggibile da avatar. Bersaglio: >= +15.

LA SECONDA COLONNA (`coda`) NON E' UN VERDETTO, ed e' onesto dirlo: misura se
la salita del fondale si ferma (plateau) o continua fino al bordo. Separa il
riferimento (0,4) da qualunque render, ma NON separa l'accettata dalla
scartata — v94, che va bene, ha coda 27,4. Serve a capire *come* il modello ha
sbagliato il fondo, non a decidere. A decidere e' lo stacco.

Uso: python3 scripts/subject_separation.py IMG [IMG...]
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab

MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")
BERSAGLIO = 15.0


def riquadro_viso(path: str):
    """Il viso in coordinate 0-1, cercato su una copia piccola."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    piccola = "/tmp/_sep_%d.jpg" % os.getpid()
    im.copy().resize((640, round(640 * im.height / im.width))).save(piccola, quality=88)
    try:
        out = subprocess.run(
            [MOONDREAM, piccola, "--detect", "face"],
            capture_output=True, text=True, timeout=120,
        ).stdout
        d = json.loads(out[out.index("{"):]) if "{" in out else {}
    except Exception:
        return None
    finally:
        if os.path.exists(piccola):
            os.remove(piccola)
    caselle = d.get("objects") or d.get("detections") or []
    return caselle[0] if caselle else None


def misura(path: str):
    a = np.asarray(ImageOps.exif_transpose(Image.open(path)).convert("RGB"), float) / 255
    L = rgb2lab(a)[..., 0]
    h, w = L.shape
    b = riquadro_viso(path)
    if not b:
        return None
    y0, y1 = int(b["y_min"] * h), int(b["y_max"] * h)
    x0, x1 = int(b["x_min"] * w), int(b["x_max"] * w)
    viso = float(L[y0:y1, x0:x1].mean())
    # margini laterali stretti: fondo puro anche quando le spalle sono larghe
    fondo = float(np.concatenate([
        L[y0:y1, : int(w * 0.06)].ravel(),
        L[y0:y1, int(w * 0.94):].ravel(),
    ]).mean())
    # dove finisce la salita del fondale: un ritratto con una lampada ha un
    # PLATEAU (la pozza di luce si ferma), un fondo ri-illuminato no.
    lat = np.concatenate([L[:, : int(w * 0.07)], L[:, int(w * 0.93):]], axis=1)
    prof = np.array([np.median(lat[int(h * q): int(h * q) + max(8, int(h * 0.04))])
                     for q in np.arange(0.05, 0.95, 0.10)])
    coda = float(prof[-3:].max() - prof[-3:].min())  # ~0 = plateau, alto = rampa
    return {"viso": viso, "fondo": fondo, "stacco": viso - fondo, "coda": coda}


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip())
        return 2
    print(f"{'file':34} {'L viso':>7} {'L fondo':>8} {'stacco':>7} {'coda':>6}")
    peggio = None
    for p in sys.argv[1:]:
        r = misura(p)
        nome = os.path.basename(p)[:33]
        if not r:
            print(f"{nome:34} {'viso non trovato':>30}")
            continue
        segno = "  ok" if r["stacco"] >= BERSAGLIO else "  ← collage"
        print(f"{nome:34} {r['viso']:7.1f} {r['fondo']:8.1f} "
              f"{r['stacco']:7.1f} {r['coda']:6.1f}{segno}")
        peggio = r["stacco"] if peggio is None else min(peggio, r["stacco"])
    print(f"\nstacco >= {BERSAGLIO:.0f} = il viso e' la cosa piu' chiara e stacca sul fondo."
          f"\ncoda ~0 = la pozza di luce si ferma (come nel riferimento); alta = fondale ri-illuminato.")
    return 0 if peggio is not None and peggio >= BERSAGLIO else 1


if __name__ == "__main__":
    sys.exit(main())
