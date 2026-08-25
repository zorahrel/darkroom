"""Correlazione strutturale fra due immagini (-1..1), su miniature 16x16.

Serve al worker per una domanda sola e decisiva: l'immagine tornata e' per caso
uno degli allegati? Non serve a giudicare se l'edit e' bello, e non deve:
le ricette cambiano l'inquadratura apposta, quindi una correlazione bassa con
la sorgente e' lavoro corretto, non un guasto. Misurato il 25/08: un ritaglio
quadrato legittimo scende a 0.03.

Uso: img_corr.py A B  ->  stampa il numero
"""
import sys
import numpy as np
from PIL import Image, ImageOps

def sig(p):
    im = ImageOps.exif_transpose(Image.open(p)).convert("L").resize((16, 16))
    a = np.asarray(im, np.float32)
    return (a - a.mean()) / (a.std() + 1e-6)

try:
    print(f"{float((sig(sys.argv[1]) * sig(sys.argv[2])).mean()):.4f}")
except Exception as e:
    # In caso di dubbio non si blocca una generazione buona: si dichiara ignoto.
    print("nan", file=sys.stdout)
    print(f"img_corr: {e}", file=sys.stderr)
