#!/usr/bin/env python3
"""
Rimette la luce DALL'ALTO nelle foto identita', prima che diventino un render.

PERCHE' ESISTE, e perche' solo adesso. Per tredici tiri ho provato a ribaltare
la direzione della luce dal prompt: descrivendola, facendone il reverse dalla
reference, entrando dalla reference come materia, e perfino con `generate`
senza nessuna foto in ingresso. Tutti falliti, e l'ultimo ha dimostrato la
causa: anche SENZA sorgente la luce resta dal basso, quindi non la eredita
l'edit — la portano le FOTO IDENTITA' allegate, che sono illuminate dal basso
(-3,8 e -11,8 sull'asse alto-basso).

E il 13/09 e' stato misurato che gli allegati trasferiscono davvero, purche' il
prompt nomini cio' che portano: tingendo di ciano le foto identita' E
dichiarandolo nel prompt, la percentuale di viso ciano e' passata da 2,0% a
24,0% (ref 26,7%). Stessa strada, altra proprieta': se il colore si trasferisce
dagli allegati, la DIREZIONE dovrebbe trasferirsi allo stesso modo.

COSA FA. Applica una rampa di luminanza sul canale L (a* e b* intatti: non e'
un viraggio, e' una luce), piu' chiara in alto e appena spostata di lato, e
cerca il guadagno che porta il viso ai valori della reference:

    alto-basso  +19,8      quanto la fronte e' piu' chiara del mento
    sx-dx        -4,1      quasi niente: la reference e' FRONTALE-alta

IL SECONDO NUMERO NON E' UN DETTAGLIO. L'utente su v128: "sembra un faretto
dal lato". Misurato, il rapporto laterale/verticale:

    reference   0,21      v113  0,36      v128  0,61

cioe' inseguendo l'asse verticale avevo lasciato peggiorare quello laterale,
fino a tre volte la reference. Per questo qui il bersaglio e' il VETTORE, non
una delle sue due componenti: un guadagno che sistema l'alto-basso e sballa il
laterale non passa.

USO
    python3 scripts/relight_identity.py in.jpg out.png [--alto 19.8] [--lat -4.1]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from skimage.color import lab2rgb, rgb2lab

MOONDREAM = "/Users/zorahrel/bin/moondream"


def riquadro_viso(path: Path):
    """Il riquadro del viso in coordinate 0-1, dal rilevatore."""
    out = subprocess.run(
        [MOONDREAM, str(path), "--detect", "face"],
        capture_output=True, text=True, timeout=180,
    ).stdout
    try:
        b = json.loads(out)["objects"][0]
    except Exception:
        return None
    return b["x_min"], b["x_max"], b["y_min"], b["y_max"]


def assi(L: np.ndarray) -> tuple[float, float]:
    """alto-basso e sx-dx di un ritaglio di viso, come key_direction.py."""
    h, w = L.shape
    alto = float(L[: h // 3].mean() - L[2 * h // 3:].mean())
    sx = float(L[:, : w // 3].mean() - L[:, 2 * w // 3:].mean())
    return alto, sx


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    bersaglio_alto = float(sys.argv[sys.argv.index("--alto") + 1]) if "--alto" in sys.argv else 19.8
    bersaglio_lat = float(sys.argv[sys.argv.index("--lat") + 1]) if "--lat" in sys.argv else -4.1

    box = riquadro_viso(src)
    if box is None:
        print("viso non trovato")
        return 1
    x0, x1, y0, y1 = box

    im = ImageOps.exif_transpose(Image.open(src).convert("RGB"))
    w, h = im.size
    lab = rgb2lab(np.asarray(im, float) / 255)

    # Coordinate normalizzate RISPETTO AL VISO, non all'immagine: la rampa deve
    # essere ripida quanto basta sul viso, e il viso puo' occupare un decimo
    # dell'inquadratura o meta'. Fuori dal riquadro la rampa continua, cosi' il
    # collo e le spalle restano coerenti invece di avere uno scalino.
    yy = (np.arange(h)[:, None] / h - (y0 + y1) / 2) / max(y1 - y0, 1e-6)
    xx = (np.arange(w)[None, :] / w - (x0 + x1) / 2) / max(x1 - x0, 1e-6)

    def applica(kv: float, kh: float) -> np.ndarray:
        out = lab.copy()
        # -yy: sopra il centro del viso yy e' negativo, e li' si deve schiarire.
        out[..., 0] = np.clip(lab[..., 0] + kv * (-yy) + kh * (-xx), 0, 100)
        return out

    def misura(l: np.ndarray) -> tuple[float, float]:
        crop = l[int(y0 * h): int(y1 * h), int(x0 * w): int(x1 * w), 0]
        return assi(crop)

    a0, s0 = misura(lab)
    # I due guadagni sono indipendenti (uno agisce su y, l'altro su x) e la
    # risposta e' lineare: due sonde bastano a trovare la pendenza, senza
    # cercare a tentoni.
    a1, _ = misura(applica(10.0, 0.0))
    _, s1 = misura(applica(0.0, 10.0))
    kv = 10.0 * (bersaglio_alto - a0) / max(a1 - a0, 1e-6)
    kh = 10.0 * (bersaglio_lat - s0) / max(s1 - s0, 1e-6)

    fin = applica(kv, kh)
    af, sf = misura(fin)
    Image.fromarray((np.clip(lab2rgb(fin), 0, 1) * 255).astype(np.uint8)).save(dst)
    print(f"{src.name:36} alto-basso {a0:+6.1f} -> {af:+6.1f}   sx-dx {s0:+5.1f} -> {sf:+5.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
