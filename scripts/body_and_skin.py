#!/usr/bin/env python3
"""
Quanto sono largo di spalle, e di che colore mi fa la pelle la luce.

PERCHE' STANNO INSIEME. Sono i due modi in cui un ritratto "non e' come la
reference" pur avendo fondo e inquadratura giusti: la corporatura sbagliata
(«sembro troppo chad») e l'incarnato sbagliato («il colore della luce non e'
quello»). Nessuno dei due si vede nei numeri che questo progetto gia' misura —
stacco, lucido, gradiente del fondo restano tutti a posto mentre questi due
scivolano.

LE DUE COLONNE.

  sp/testa  larghezza della linea delle spalle divisa per la larghezza della
            testa, letta su una riga appena sotto il mento. E' NORMALIZZATA:
            confronta ritratti con inquadrature diverse, che e' il punto —
            un mezzo busto piu' stretto non deve far sembrare le spalle piu'
            larghe. Quando la sagoma tocca il bordo il valore e' un MINIMO
            (marcato con >=): le spalle escono dal fotogramma e il vero
            rapporto e' maggiore.

  croma     saturazione media della pelle del viso in Lab (hypot(a*,b*)), sui
            pixel sopra la mediana di luminanza del riquadro del viso — cioe'
            pelle illuminata, non capelli ne' occhiali. Dice quanto colore ha
            l'incarnato: una luce bianca forte LAVA la pelle e abbassa questo
            numero, una luce calda lo alza.

  L         luminanza media di quegli stessi pixel: quanto e' chiara la pelle.

  tinta     angolo di tinta in gradi. Sotto i 40 l'incarnato vira al rosso /
            magenta, sopra i 50 al giallo / arancio. Serve per distinguere "e'
            desaturata" da "e' andata di colore".

I BERSAGLI, misurati il 09/09 sulla reference dell'utente e sulle sue foto:

    reference (altra persona)   sp/testa 2,16   croma 13,4   L 68,1   tinta 51
    la sua pelle vera           sp/testa>=1,36  croma 24,9   L 59,7   tinta 45
    v94                         sp/testa 3,60   croma 24,7   L 53,9   tinta 35
    v103 consegnata             sp/testa 2,87   croma 27,2   L 57,0   tinta 48

  (Il rapporto e' STABILE rispetto alla risoluzione di lavoro: verificato il
  09/09 a W=512, 900 e 1400, i tre valori coincidono entro 0,01. Una misura
  ad-hoc precedente aveva dato 3,80 per v103 leggendo la riga sbagliata della
  sagoma — se un numero non si riproduce, e' il numero a essere sbagliato,
  non l'immagine.)

  Da leggere insieme, perche' dicono due cose diverse. Sulle SPALLE la
  reference e la foto vera concordano (~2,1) e il render e' quasi al doppio:
  e' un difetto, senza ambiguita'. Sulla PELLE invece la reference (13,4) e la
  pelle vera dell'utente (24,9) NON concordano: il render sta sulla pelle vera,
  ed e' la reference a essere desaturata, perche' la sua luce e' bianca e
  forte. Seguire la reference qui e' una SCELTA di luce, non una correzione di
  identita' — e va detto invece di far finta che 13,4 sia "il giusto".

COME SI USA
    python3 scripts/body_and_skin.py refs/luce-bg-studio-blu.png gen/v103.png …

Esce 1 se l'ultimo file passato ha le spalle oltre 2,8 teste: soglia a meta'
strada fra la reference e il render sbagliato, utile in catena.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"
W = 900  # larghezza di lavoro per la sagoma
SOGLIA_SPALLE = 2.8


def face_box(path: Path):
    """Riquadro del viso in coordinate 0-1, dal detector (non dalla didascalia)."""
    out = subprocess.run(
        [MOONDREAM, str(path), "--detect", "face"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    try:
        return json.loads(out)["objects"][0]
    except Exception:
        return None


def sagoma(img: Image.Image, soglia: float = 25.0) -> np.ndarray:
    """Maschera del soggetto: il fondo si stima riga per riga dai due margini."""
    a = np.asarray(img.convert("RGB").resize((W, int(W * img.height / img.width))), float)
    m = max(4, int(W * 0.04))
    bg = np.median(np.concatenate([a[:, :m], a[:, -m:]], axis=1), axis=1)
    # Dove i due margini non concordano, il soggetto tocca il bordo: li' la
    # stima del fondo si eredita dalle righe pulite subito sopra.
    disc = np.linalg.norm(np.median(a[:, :m], 1) - np.median(a[:, -m:], 1), axis=1)
    sporche = disc > soglia
    for y in np.nonzero(sporche)[0]:
        lo = max(0, y - 15)
        pulite = ~sporche[lo:y]
        if pulite.any():
            bg[y] = bg[lo:y][pulite][-1]
    return np.linalg.norm(a - bg[:, None, :], axis=2) > 30


def misura(path: Path):
    im = ImageOps.exif_transpose(Image.open(path).convert("RGB"))
    bb = face_box(path)
    if not bb:
        return None

    # --- spalle, sulla sagoma ---
    m = sagoma(im)
    h, w = m.shape
    testa = (bb["x_max"] - bb["x_min"]) * w
    # una mezza altezza-viso sotto il mento: li' c'e' la spalla, non il collo
    y = min(h - 1, int(bb["y_max"] * h + (bb["y_max"] - bb["y_min"]) * h * 0.55))
    xs = np.nonzero(m[y])[0]
    rapporto = (xs[-1] - xs[0]) / testa if xs.size else float("nan")
    troncata = bool(xs.size and (xs[0] <= 2 or xs[-1] >= w - 3))

    # --- pelle, nel riquadro del viso ---
    W2, H2 = im.size
    crop = np.asarray(im, float)[
        int(bb["y_min"] * H2): int(bb["y_max"] * H2),
        int(bb["x_min"] * W2): int(bb["x_max"] * W2),
    ] / 255
    lab = rgb2lab(crop)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    pelle = L > np.percentile(L, 45)  # scarta capelli, occhiali, ombre dure
    return dict(
        sp=rapporto, troncata=troncata,
        croma=float(np.hypot(A[pelle], B[pelle]).mean()),
        L=float(L[pelle].mean()),
        tinta=float(np.degrees(np.arctan2(B[pelle].mean(), A[pelle].mean()))),
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    print(f"{'file':34} {'sp/testa':>9} {'croma':>7} {'L':>6} {'tinta':>6}")
    ultimo = None
    for p in sys.argv[1:]:
        r = misura(Path(p))
        name = Path(p).name[:34]
        if not r:
            print(f"{name:34}   (viso non trovato)")
            continue
        sp = f"{'>=' if r['troncata'] else ' '}{r['sp']:.2f}"
        nota = "  ← chad" if r["sp"] > SOGLIA_SPALLE else ""
        print(f"{name:34} {sp:>9} {r['croma']:7.1f} {r['L']:6.1f} {r['tinta']:6.0f}{nota}")
        ultimo = r
    return 1 if ultimo and ultimo["sp"] > SOGLIA_SPALLE else 0


if __name__ == "__main__":
    sys.exit(main())
