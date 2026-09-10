#!/usr/bin/env python3
"""
Quanto luccica la pelle, in un numero.

PERCHE'. "La pelle sembra grassa" e' un giudizio, ma la sua causa fisica non lo
e': una pelle unta riflette la luce in modo SPECULARE, cioe' produce sul viso
macchie piccole, molto piu' chiare del resto e desaturate (tendono al bianco
della sorgente). Una pelle opaca diffonde: il viso resta luminoso ma senza
picchi. Quindi non serve chiedere a un modello se sembra unta — si misura il
picco.

IL NUMERO.

  picco    (percentile 99,5 della luminanza del viso) - (mediana del viso), in
           livelli 0-255. E' l'altezza del riflesso sopra la pelle normale.
  area%    percentuale di pixel del viso che stanno oltre meta' di quel picco E
           sono desaturati: la macchia lucida vera e propria.

QUALE DEI DUE GUARDARE: l'AREA, non il picco. Tarato l'08/09 sul selfie vero
dell'utente e sulla v94 che ha giudicato "pelle grassa":

  selfie vero   picco 99,6   area 0,83%
  v94           picco 83,1   area 1,79%

Il picco dice il contrario del giudizio umano — su una foto vera una finestra
lascia un riflesso puntuale altissimo, e va bene cosi'. Il difetto e' la
SUPERFICIE: in v94 il lucido copre il doppio del viso (fronte, naso, zigomi
insieme) invece di stare in un punto. Chi legge questo numero guardi la colonna
area%, e usi il picco solo per sapere quanto e' intenso quel poco che luccica.

Il viso arriva da `moondream --detect face`, lo stesso detector usato per gli
avatar e per la postura: nessuna zona indovinata a mano.

LIMITE, dichiarato. Il picco cresce anche con una luce dura legittima (una
sorgente piccola su una pelle asciutta lascia comunque un bordo brillante), per
questo il confronto va fatto fra render con LA STESSA luce. Fra impianti di luce
diversi il numero non e' comparabile, e in quel caso serve l'occhio.

Uso: python3 scripts/skin_shine.py IMG [IMG...]
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps

MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")


def face_box(path: Path) -> dict:
    small = Path("/tmp") / f"shine_{path.stem[:24]}.jpg"
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS).save(small, "JPEG", quality=88)
    out = subprocess.run([MOONDREAM, str(small), "--detect", "face"],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise ValueError(f"detector fallito: {out.stderr.strip()[:70]}")
    objs = json.loads(out.stdout[out.stdout.find("{"):]).get("objects") or []
    if not objs:
        raise ValueError("nessun viso trovato")
    return max(objs, key=lambda o: (o["x_max"] - o["x_min"]) * (o["y_max"] - o["y_min"]))


def misura(path: Path) -> dict:
    box = face_box(path)
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    W, H = im.size
    # si guarda solo il cuore del viso: i bordi del riquadro prendono capelli e
    # fondo, che sono piu' chiari o piu' scuri e sposterebbero sia mediana che coda
    x0, x1 = box["x_min"] * W, box["x_max"] * W
    y0, y1 = box["y_min"] * H, box["y_max"] * H
    dx, dy = (x1 - x0) * 0.15, (y1 - y0) * 0.15
    crop = np.asarray(im.crop((round(x0 + dx), round(y0 + dy), round(x1 - dx), round(y1 - dy))), float)
    if crop.size < 300:
        raise ValueError("riquadro del viso troppo piccolo")
    lum = crop @ np.array([0.2126, 0.7152, 0.0722])
    mediana = float(np.median(lum))
    picco = float(np.percentile(lum, 99.5)) - mediana
    # la macchia lucida: chiara E desaturata (un riflesso prende il colore della
    # lampada, non della pelle) — senza il secondo vincolo si contano le guance
    mx, mn = crop.max(2), crop.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    macchia = (lum > mediana + picco / 2) & (sat < 0.25)
    # Micro-contrasto: deviazione standard dell'high-pass, sul viso portato a una
    # scala fissa. Serve per la meta' dell'affermazione che il numero sopra non
    # copre: togliere il lucido non deve togliere i pori. Una pelle di plastica
    # ha area 0 e micro-contrasto crollato, e senza questa colonna sarebbe
    # indistinguibile da una pelle opaca vera.
    g = Image.fromarray(lum.astype(np.uint8)).resize((400, 400), Image.LANCZOS)
    ga = np.asarray(g, float)
    micro = float((ga - np.asarray(g.filter(ImageFilter.GaussianBlur(2)), float)).std())
    return {"picco": picco, "area": 100 * float(macchia.mean()), "mediana": mediana, "micro": micro}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    print(f"{'file':32} {'area%':>7} {'micro':>7} {'picco':>7} {'L viso':>7}")
    for p in args:
        path = Path(p)
        try:
            r = misura(path)
        except Exception as e:
            print(f"{path.name[:32]:32} {'—':>7} {'—':>7} {'—':>7} {'—':>7}  {e}")
            continue
        print(f"{path.name[:32]:32} {r['area']:7.2f} {r['micro']:7.2f} {r['picco']:7.1f} {r['mediana']:7.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
