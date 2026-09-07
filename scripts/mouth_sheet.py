#!/usr/bin/env python3
"""La prova della bocca, da guardare: stessi ritagli, stessa scala.

Un numero ("0,24 contro 0,31") non convince nessuno della propria faccia. Qui
ogni immagine viene ritagliata sulla bocca con una finestra larga MEZZA
LARGHEZZA DEL VISO e poi portata tutta alla stessa larghezza: cosi' le bocche
sono confrontabili a occhio, perche' la scala del viso e' stata tolta di mezzo.
E' l'unico modo onesto di mettere accanto un selfie da 2060 px e un render in
cui il viso ne occupa 274.

Uso: mouth_sheet.py --out FILE.html FILE [FILE...]
     ogni FILE puo' essere `path` o `path=Etichetta`
"""
import argparse
import base64
import io
import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")
FINESTRA = 0.55  # larghezza del ritaglio, in frazione della larghezza del viso


def detect(path: Path, what: str):
    out = subprocess.run([MOONDREAM, str(path), "--detect", what],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        return None
    objs = json.loads(out.stdout[out.stdout.find("{"):]).get("objects") or []
    return max(objs, key=lambda o: (o["x_max"] - o["x_min"]) * (o["y_max"] - o["y_min"])) if objs else None


def mouth_tile(path: Path, larghezza=520):
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    W, H = im.size
    small = Path("/tmp") / f"sheet_{abs(hash(str(path)))}.jpg"
    im.resize((1024, round(H * 1024 / W)), Image.LANCZOS).save(small, "JPEG", quality=92)
    face = detect(small, "face")
    if not face:
        return None, None
    fw = (face["x_max"] - face["x_min"])
    # La bocca si cerca dentro il viso: full-frame, a mezzo busto, e' un oggetto
    # da trenta pixel e il modello la sbaglia.
    pad = 0.12
    fx0, fy0 = max(face["x_min"] - pad * fw, 0), max(face["y_min"] - pad * fw, 0)
    fx1, fy1 = min(face["x_max"] + pad * fw, 1), min(face["y_max"] + pad * fw, 1)
    crop = im.crop((round(fx0 * W), round(fy0 * H), round(fx1 * W), round(fy1 * H)))
    cw, ch = crop.size
    fcrop = Path("/tmp") / f"sheetface_{abs(hash(str(path)))}.jpg"
    crop.resize((768, round(ch * 768 / cw)), Image.LANCZOS).save(fcrop, "JPEG", quality=95)
    mouth = detect(fcrop, "mouth")
    if not mouth:
        return None, None
    mw = (mouth["x_max"] - mouth["x_min"]) * (1 + 2 * pad)  # rispetto al viso
    # Il centro bocca, riportato in coordinate dell'immagine intera.
    cx = fx0 + (mouth["x_min"] + mouth["x_max"]) / 2 * (fx1 - fx0)
    cy = fy0 + (mouth["y_min"] + mouth["y_max"]) / 2 * (fy1 - fy0)
    half_w = FINESTRA * fw / 2
    half_h = half_w * 0.62 * W / H  # finestra leggermente schiacciata
    tile = im.crop((round(max(cx - half_w, 0) * W), round(max(cy - half_h, 0) * H),
                    round(min(cx + half_w, 1) * W), round(min(cy + half_h, 1) * H)))
    tw, th = tile.size
    tile = tile.resize((larghezza, max(1, round(th * larghezza / tw))), Image.LANCZOS)
    buf = io.BytesIO()
    tile.save(buf, "JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode(), round(mw, 3)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()

    celle = []
    for spec in a.files:
        path, _, label = spec.partition("=")
        b64, mw = mouth_tile(Path(path))
        celle.append((label or Path(path).name, b64, mw))
        print(f"{label or Path(path).name:<28} larghezza {mw}")

    corpo = "".join(
        f'<figure><img src="data:image/jpeg;base64,{b64}" alt="{lab}">'
        f'<figcaption><b>{lab}</b><span>{"bocca " + str(mw) + " del viso" if mw else "non misurata"}</span></figcaption></figure>'
        if b64 else f'<figure class="vuota"><figcaption><b>{lab}</b><span>bocca non trovata</span></figcaption></figure>'
        for lab, b64, mw in celle
    )
    html = f"""<!doctype html><meta charset=utf-8><title>La bocca</title>
<style>
 body{{background:#111;color:#eee;font:14px/1.5 -apple-system,system-ui,sans-serif;margin:24px}}
 h1{{font-size:18px;font-weight:600;margin:0 0 4px}}
 p.nota{{color:#9a9a9a;max-width:70ch;margin:0 0 20px}}
 .griglia{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}}
 figure{{margin:0;background:#1b1b1b;border-radius:10px;overflow:hidden}}
 figure img{{width:100%;display:block}}
 figcaption{{padding:8px 10px;display:flex;justify-content:space-between;gap:8px;font-size:12px}}
 figcaption span{{color:#9a9a9a}}
 .vuota{{padding:40px 10px;text-align:center;color:#777}}
</style>
<h1>La bocca, alla stessa scala</h1>
<p class=nota>Ogni ritaglio e' largo il 55% della larghezza del viso e poi portato alla stessa
larghezza in pagina: la scala del viso e' tolta di mezzo, quindi le bocche si confrontano a occhio.
Il numero e' la larghezza della bocca in frazione della larghezza del viso.</p>
<div class=griglia>{corpo}</div>"""
    Path(a.out).write_text(html, encoding="utf-8")
    print("\nscritto", a.out)
