#!/usr/bin/env python3
"""Quanto e DA CHE PARTE il fondo si accende, in numeri.

Perche' serve. Un fondale da studio non e' una tinta: e' scuro in alto e si
accende dove batte la lampada. E' quel bagliore la sorgente che poi si legge
sulle spalle. Una sfumatura che si spegne scendendo non ha niente da cui far
venire la luce, e nessuna frase nel prompt puo' inventargliela.

I numeri, uno per sponda:

  sx / dx  L* del fondo nella fascia bassa meno L* nella fascia alta, misurato
           sulla colonna laterale corrispondente. Positivo = si accende
           scendendo.
  asimm    |sx - dx|. E' il numero che discrimina davvero, ed e' il motivo per
           cui questo script misura due sponde invece di una.

DUE ERRORI GIA' FATTI QUI, ENTRAMBI COSTATI UN VERDETTO SBAGLIATO:

1. Mediare le due sponde insieme. Un render acceso solo a sinistra
   (v74: +48.3 / -4.7) dava media +40.5 contro il +36.9 del riferimento e
   sembrava il piu' fedele del lotto. Non lo era: al riferimento le sponde si
   accendono tutte e due (+38.5 / +38.3, asimm 0.2), a v74 una sola (asimm 53).
   La media nascondeva esattamente la differenza che contava.

2. Mascherare il soggetto per "pulire" la misura. La maschera parte dal colore
   del bordo alto, che e' scuro; il fondale ACCESO in basso finisce percio'
   classificato come soggetto e viene escluso. Cosi' il riferimento misurava
   -10.2, cioe' il contrario di quello che si vede guardandolo. Le colonne
   laterali senza maschera sono grezze ma non mentono: su un ritratto a 35mm
   le spalle non arrivano al 10% laterale. Se un giorno ci arrivassero,
   `copertura` scende e il numero va riletto, non creduto.

Uso: bg_gradient.py RIFERIMENTO IMG [IMG...]
"""
import json
import sys

import numpy as np
from PIL import Image
from skimage.color import rgb2lab

W = 900
SIDE = 0.10       # frazione di larghezza presa a sinistra e a destra
TOP = (0.02, 0.16)
BOT = (0.84, 0.98)


def measure(path):
    im = Image.open(path).convert("RGB")
    if im.width > W:
        im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    lab = rgb2lab(np.asarray(im, dtype=np.float64) / 255.0)
    L = lab[..., 0]
    h, w = L.shape
    k = max(2, int(w * SIDE))

    def band(a, b, sl):
        return float(np.median(L[int(h * a):int(h * b), sl]))

    left = band(*BOT, slice(0, k)) - band(*TOP, slice(0, k))
    right = band(*BOT, slice(w - k, w)) - band(*TOP, slice(w - k, w))

    # tinta della fascia bassa: dice QUALE colore si accende
    px = np.concatenate([lab[int(h * BOT[0]):int(h * BOT[1]), :k],
                         lab[int(h * BOT[0]):int(h * BOT[1]), w - k:]], axis=1).reshape(-1, 3)
    return {
        "file": path.split("/")[-1].rsplit(".", 1)[0],
        "sx": round(left, 1),
        "dx": round(right, 1),
        "asimm": round(abs(left - right), 1),
        "ab_basso": [round(float(np.median(px[:, 1])), 1), round(float(np.median(px[:, 2])), 1)],
    }


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    rows = [measure(p) for p in argv]
    ref = rows[0]
    print(f"{'':14} {'sx':>7} {'dx':>7} {'asimm':>7} {'scarto':>8}")
    for r in rows:
        is_ref = r is ref
        gap = "--" if is_ref else f"{(abs(r['sx'] - ref['sx']) + abs(r['dx'] - ref['dx'])) / 2:.1f}"
        print(f"{('RIFERIMENTO' if is_ref else r['file']):14} "
              f"{r['sx']:+7.1f} {r['dx']:+7.1f} {r['asimm']:7.1f} {gap:>8}")
    if "--json" in argv:
        print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main([a for a in sys.argv[1:] if a != "--json"])
