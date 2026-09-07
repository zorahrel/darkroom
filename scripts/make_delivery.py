#!/usr/bin/env python3
"""Il set da consegnare per una foto profilo, da una versione scelta.

Produce, in data/consegna/:
  profilo-vNN-2048.png   inquadratura intera, PNG
  profilo-vNN-1024.jpg   inquadratura intera, JPG
  avatar-vNN-1024.jpg    ritaglio quadrato sul viso
  avatar-vNN-400.jpg     lo stesso a misura di avatar

Il ritaglio dell'avatar non e' un center crop: a mezzo busto con un 35mm la
testa non sta al centro, e un ritaglio geometrico taglia il mento o lascia
mezzo cielo. Il riquadro del viso lo dice il modello di visione
(`moondream --detect face`), e il lato del ritaglio si sceglie perche' la
testa occupi HEAD_SHARE dell'altezza: e' cio' che rende leggibile un avatar
a 400px.

Uso: make_delivery.py --version 84 [--src FILE] [--progetto profilo]
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

HEAD_SHARE = 0.55   # quanto del lato deve occupare il viso nell'avatar
LIFT = 0.06         # il centro del ritaglio sta un po' sopra il centro del viso (capelli)
MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")


def face_box(path: Path):
    # Il riquadro si cerca su una copia piccola: e' in coordinate 0-1, quindi
    # vale identico sull'upscalato, e non spedisce 35 MB per quattro numeri.
    small = Path("/tmp") / f"facedet_{path.stem}.jpg"
    im = Image.open(path).convert("RGB")
    im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS).save(small, "JPEG", quality=88)
    out = subprocess.run([MOONDREAM, str(small), "--detect", "face"],
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise SystemExit(f"moondream --detect face fallito: {out.stderr.strip()[:200]}")
    start = out.stdout.find("{")
    objs = json.loads(out.stdout[start:]).get("objects") or []
    if not objs:
        raise SystemExit("nessun viso trovato: l'avatar non si ritaglia a caso, mi fermo")
    return max(objs, key=lambda o: (o["x_max"] - o["x_min"]) * (o["y_max"] - o["y_min"]))


def avatar_crop(im: Image.Image, box) -> Image.Image:
    W, H = im.size
    fh = (box["y_max"] - box["y_min"]) * H
    side = min(W, H, fh / HEAD_SHARE)
    cx = (box["x_min"] + box["x_max"]) / 2 * W
    cy = (box["y_min"] + box["y_max"]) / 2 * H - LIFT * side
    x = min(max(cx - side / 2, 0), W - side)
    y = min(max(cy - side / 2, 0), H - side)
    return im.crop((round(x), round(y), round(x + side), round(y + side)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--progetto", default="profilo")
    ap.add_argument("--src", help="file sorgente (default: l'upscalato della versione)")
    a = ap.parse_args()

    data = Path.home() / "Darkroom" / "projects" / a.progetto / "data"
    src = Path(a.src) if a.src else data / "upscaled" / f"v{a.version}_high-fidelity-4x.png"
    if not src.exists():
        raise SystemExit(f"sorgente mancante: {src}")
    out = data / "consegna"
    out.mkdir(parents=True, exist_ok=True)

    im = Image.open(src).convert("RGB")
    box = face_box(src)
    av = avatar_crop(im, box)
    made = []
    for name, img, size, kind in [
        (f"profilo-v{a.version}-2048.png", im, 2048, "PNG"),
        (f"profilo-v{a.version}-1024.jpg", im, 1024, "JPEG"),
        (f"avatar-v{a.version}-1024.jpg", av, 1024, "JPEG"),
        (f"avatar-v{a.version}-400.jpg", av, 400, "JPEG"),
    ]:
        r = img.resize((size, size), Image.LANCZOS)
        p = out / name
        r.save(p, kind, **({"quality": 92, "subsampling": 0} if kind == "JPEG" else {"optimize": True}))
        made.append((name, p.stat().st_size))
    for n, s in made:
        print(f"  {n:<28}{s/1024:>8.0f} KB")
    print(f"[consegna] {len(made)} file in {out}  (da {src.name})")


if __name__ == "__main__":
    sys.exit(main())
