#!/usr/bin/env python3
"""
Porta l'incarnato alla SUA esposizione e al SUO calore, non a quelli della
reference.

PERCHE' ESISTE. Il 13/09 l'utente su v128: "l'incarnato e' troppo pallido",
"dovrebbe essere un po' sovraesposto". Misurato sul viso:

                     v128    la SUA pelle vera    reference
    L                34,5          46,3              41,7
    croma            12,5          21,1              12,2
    alte luci >85%    0,7%          3,5%             13,7%

E' lo stesso errore gia' fatto due volte su questo progetto: prendere per
bersaglio il numero LETTERALE della reference, che ritrae una persona dalla
pelle piu' chiara e meno satura. Inseguendo croma 12,2 sono arrivato a 12,5 —
cioe' ho reso la sua pelle pallida quanto quella di un'altra persona, mentre
la sua vera sta a 21,1. E a forza di istruzioni "opaca e asciutta" ho spento
anche le alte luci, che nella reference sono il 13,7% del viso: e' proprio
quella sovraesposizione a farla sembrare una foto di moda.

BERSAGLI, quindi, presi dalla PERSONA e non dal modello:

    L      -> 45      la sua pelle vera (46,3), un filo sotto
    croma  -> 20      la sua pelle vera (21,1)

La tinta (l'angolo di a*/b*) non si tocca: si scalano i due raggi, cosi' i
riflessi ciano restano dove sono e cambia solo quanto e' accesa e quanto e'
satura la pelle.

USO
    python3 scripts/skin_exposure.py in.png out.png [--L 45] [--croma 20]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from skimage.color import lab2rgb, rgb2lab

sys.path.insert(0, str(Path(__file__).parent))
from light_temp import viso_lab  # noqa: E402


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    tL = float(sys.argv[sys.argv.index("--L") + 1]) if "--L" in sys.argv else 45.0
    tC = float(sys.argv[sys.argv.index("--croma") + 1]) if "--croma" in sys.argv else 20.0

    im = ImageOps.exif_transpose(Image.open(src).convert("RGB"))
    lab = rgb2lab(np.asarray(im, float) / 255)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    croma = np.sqrt(a**2 + b**2)
    tinta = np.degrees(np.arctan2(b, a))

    # Stessa maschera di skin_desaturate.py: il cono dell'incarnato. Include
    # anche i pixel ciano (croma bassa) perche' quelli sono la LUCE sulla
    # pelle, e devono salire di esposizione insieme al resto del viso.
    pelle = ((tinta > 0) & (tinta < 80) & (croma > 4)) | ((croma <= 4) & (L > 20))
    morbida = np.asarray(
        Image.fromarray((pelle * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)),
        float,
    ) / 255

    prima = viso_lab(src)
    if prima is None:
        print("viso non trovato")
        return 1
    L0 = float(prima[..., 0].mean())
    C0 = float(np.sqrt(prima[..., 1] ** 2 + prima[..., 2] ** 2).mean())

    # L: si ALZA, non si moltiplica. Una moltiplicazione schiarisce anche le
    # ombre in proporzione e appiattisce il modellato; una somma sposta tutta
    # la curva e lascia intatti gli stacchi, che sono quello che fa "figo".
    dL = tL - L0
    kC = tC / max(C0, 1e-6)

    # Si ITERA, non si applica una volta sola: la maschera dell'incarnato non
    # copre tutto il riquadro del viso (capelli, occhiali, barba restano
    # fuori), quindi alzare L di dL sposta la MEDIA del riquadro di meno.
    # Tre passate bastano: misurato 34,5 -> 39,7 in una, -> 45,0 in tre.
    def applica(dL: float, kC: float) -> np.ndarray:
        out = lab.copy()
        out[..., 0] = np.clip(L + dL * morbida, 0, 100)
        out[..., 1] = a * (1 + (kC - 1) * morbida)
        out[..., 2] = b * (1 + (kC - 1) * morbida)
        return out

    for _ in range(6):
        out = applica(dL, kC)
        Image.fromarray((np.clip(lab2rgb(out), 0, 1) * 255).astype(np.uint8)).save(dst)
        v = viso_lab(dst)
        eL, eC = tL - float(v[..., 0].mean()), tC / max(float(np.sqrt(v[..., 1]**2 + v[..., 2]**2).mean()), 1e-6)
        if abs(eL) < 0.6 and abs(eC - 1) < 0.03:
            break
        dL += eL
        kC *= eC

    dopo = viso_lab(dst)
    L1 = float(dopo[..., 0].mean())
    C1 = float(np.sqrt(dopo[..., 1] ** 2 + dopo[..., 2] ** 2).mean())
    alte = 100 * float((dopo[..., 0] > 85).mean())
    ciano = 100 * float((dopo[..., 1] < 0).mean())
    print(
        f"{src.name:26} L {L0:5.1f} -> {L1:5.1f}   croma {C0:5.1f} -> {C1:5.1f}"
        f"   alte luci {alte:4.1f}%   ciano {ciano:4.1f}%"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
