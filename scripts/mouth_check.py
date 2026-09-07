#!/usr/bin/env python3
"""La bocca del render e' la mia? Una misura, non un'impressione.

Perche': su una foto profilo con gli occhiali da sole la bocca e' meta'
dell'identita' che resta visibile — gli occhi sono coperti. Dire "la bocca non
e' quella" e' un giudizio giusto ma non azionabile: serve sapere DI QUANTO e in
CHE senso (piu' larga? piu' carnosa? piu' in alto?), e soprattutto se il
difetto cresce quando il viso ha pochi pixel, che e' l'ipotesi del 35mm.

Come: il riquadro del viso e quello della bocca li dice il modello di visione
(`moondream --detect`), la bocca cercata DENTRO il ritaglio del viso perche' a
mezzo busto la bocca full-frame e' un oggetto da 30 px e il modello la sbaglia.
Le due misure sono adimensionali, quindi confrontabili fra foto di taglia
diversa:

  larghezza  = larghezza bocca / larghezza viso
  spessore   = altezza bocca / larghezza bocca      (quanto e' carnosa)
  altezza    = (centro bocca - centro viso) / altezza viso   (dov'e' piantata)

In piu' riporta i PIXEL del viso nell'immagine originale: e' la variabile che
l'ipotesi accusa.

Uso: mouth_check.py FILE [FILE...]
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")


def detect(path: Path, what: str):
    out = subprocess.run([MOONDREAM, str(path), "--detect", what],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise SystemExit(f"moondream --detect {what} fallito su {path.name}: {out.stderr.strip()[:200]}")
    start = out.stdout.find("{")
    objs = json.loads(out.stdout[start:]).get("objects") or []
    if not objs:
        return None
    return max(objs, key=lambda o: (o["x_max"] - o["x_min"]) * (o["y_max"] - o["y_min"]))


def measure(path: Path):
    # exif_transpose, non Image.open e basta: le foto di telefono arrivano
    # ruotate via EXIF, e senza raddrizzarle il riquadro del viso esce di
    # traverso — misurato sul selfie 56E4, che dava una bocca "spessa 2,5
    # volte la sua larghezza", cioe' un rettangolo verticale: non una bocca.
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    W, H = im.size
    small = Path("/tmp") / f"mouth_{path.stem}.jpg"
    im.resize((1024, round(H * 1024 / W)), Image.LANCZOS).save(small, "JPEG", quality=92)
    face = detect(small, "face")
    if not face:
        return None
    fw, fh = (face["x_max"] - face["x_min"]), (face["y_max"] - face["y_min"])
    # Il ritaglio del viso, un po' largo: la bocca sta in basso e un box stretto
    # la taglia proprio dove serve misurarla.
    pad = 0.12
    box = (max(face["x_min"] - pad * fw, 0), max(face["y_min"] - pad * fh, 0),
           min(face["x_max"] + pad * fw, 1), min(face["y_max"] + pad * fh, 1))
    crop = im.crop((round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)))
    cw, ch = crop.size
    face_px = fw * W  # quanti pixel VERI ha il viso nell'originale
    crop = crop.resize((768, round(ch * 768 / cw)), Image.LANCZOS)
    face_crop = Path("/tmp") / f"face_{path.stem}.jpg"
    crop.save(face_crop, "JPEG", quality=95)
    mouth = detect(face_crop, "mouth")
    if not mouth:
        return {"file": path.name, "face_px": face_px, "mouth": None, "crop": str(face_crop)}
    mw = mouth["x_max"] - mouth["x_min"]
    mh = mouth["y_max"] - mouth["y_min"]
    # Riportate al riquadro del viso: il crop e' il viso + pad su ogni lato.
    scale = 1 + 2 * pad
    return {
        "file": path.name,
        "face_px": round(face_px),
        "larghezza": round(mw * scale, 3),
        "spessore": round(mh / mw, 3),
        "altezza": round(((mouth["y_min"] + mouth["y_max"]) / 2 - 0.5) * scale, 3),
        "crop": str(face_crop),
    }


if __name__ == "__main__":
    rows = [measure(Path(p)) for p in sys.argv[1:]]
    print(f"{'file':<34}{'viso px':>9}{'larghezza':>11}{'spessore':>10}{'altezza':>9}")
    for r in rows:
        if not r:
            print("  (nessun viso)")
            continue
        if r["mouth"] is None if "mouth" in r else False:
            print(f"{r['file']:<34}{r['face_px']:>9}   bocca non trovata")
            continue
        print(f"{r['file']:<34}{r['face_px']:>9}{r['larghezza']:>11}{r['spessore']:>10}{r['altezza']:>9}")
    print("\ncrop dei visi:", " ".join(r["crop"] for r in rows if r))
