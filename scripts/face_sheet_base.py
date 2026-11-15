"""Base del face sheet: le 5 foto vere evidenziate (reference_pick), ognuna ritagliata
sul viso in una cella di una griglia 3x2 su grigio chiaro. ChatGPT poi MODIFICA questa
base invece di generare da zero: ogni cella parte dal viso vero, ed e' questo che tiene
le proporzioni (da zero la somiglianza scendeva a 0,17).

La prima cella (profilo dal lato opposto) e' vuota: nessuna foto evidenziata ha quel lato.
I selfie dal telefono e quello allo specchio sono speculari (orecchino a sinistra
dell'inquadratura, a destra nella foto della felpa): li raddrizzo, cosi' in tutte le
celle orecchino e nei stanno dallo stesso lato vero, l'orecchio sinistro.
"""
import os, sqlite3
import cv2
from PIL import Image, ImageOps, ImageDraw
from insightface.app import FaceAnalysis

P = os.path.expanduser("~/Darkroom/projects/profilo")
R = f"{P}/data/refs"
CELLA, W, H = 512, 1536, 1024
GRIGIO = (206, 206, 206)
SPECULARI = {"io-rasato-2023-06-23-p13.jpg", "io-selfie-rasato-orecchino.jpg",
             "io-occhiali-vista-632DC4E9.jpeg", "io-selfie-barba-vicino.jpg"}
# cella -> foto evidenziata (la rotazione misurata con ArcFace decide la vista)
POSTI = {1: None, 2: "io-felpa-mano-1.png", 3: "io-rasato-2023-06-23-p13.jpg",
         4: "io-selfie-rasato-orecchino.jpg", 5: "io-occhiali-vista-632DC4E9.jpeg", 6: "io-selfie-barba-vicino.jpg"}

picks = {r[0] for r in sqlite3.connect(f"{P}/photos.db").execute("SELECT file FROM reference_pick")}
assert {f for f in POSTI.values() if f} == picks, f"le celle devono usare esattamente le evidenziate: {sorted(picks)}"

app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
app.prepare(ctx_id=-1, det_size=(640, 640))
out = Image.new("RGB", (W, H), GRIGIO)
d = ImageDraw.Draw(out)
for n, f in POSTI.items():
    x0, y0 = ((n - 1) % 3) * CELLA, ((n - 1) // 3) * CELLA
    if f:
        im = ImageOps.exif_transpose(Image.open(f"{R}/{f}")).convert("RGB")
        if f in SPECULARI:
            im = ImageOps.mirror(im)
        fc = max(app.get(cv2.cvtColor(__import__("numpy").array(im), cv2.COLOR_RGB2BGR)),
                 key=lambda a: (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]))
        bx0, by0, bx1, by1 = fc.bbox
        lato = max(bx1 - bx0, by1 - by0) * 1.75
        cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2 - (by1 - by0) * 0.08
        box = [int(cx - lato / 2), int(cy - lato / 2), int(cx + lato / 2), int(cy + lato / 2)]
        # oltre il bordo della foto resta grigio, non nero
        crop = im.crop((max(box[0], 0), max(box[1], 0), min(box[2], im.width), min(box[3], im.height)))
        pad = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), GRIGIO)
        pad.paste(crop, (max(-box[0], 0), max(-box[1], 0)))
        out.paste(pad.resize((CELLA - 8, CELLA - 8), Image.LANCZOS), (x0 + 4, y0 + 4))
    d.rectangle([x0 + 10, y0 + 10, x0 + 46, y0 + 46], fill="white")
    d.text((x0 + 22, y0 + 18), str(n), fill="black")
out.save(f"{R}/io-face-sheet-base.png")
print(f"{R}/io-face-sheet-base.png", out.size)
