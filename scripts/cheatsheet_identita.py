#!/usr/bin/env python3
"""
La tavola di identità di Attilio: una sola immagine con tutto quello che un
generatore deve rispettare e che io devo poter controllare a colpo d'occhio.

Perché esiste: i nei li ho descritti a parole tre volte e tre volte erano
sbagliati (lentiggini sul naso, un neo sotto il labbro che era barba corta).
Qui ogni segno è cerchiato SULLA FOTO VERA rasata, non raccontato.

Uso: python3 scripts/cheatsheet_identita.py [uscita.png]
Foto principale: io-rasato-2023-06-23-p08, selfie allo specchio RIBALTATO
in orizzontale per tornare al verso reale (orecchino dallo stesso lato delle
altre foto). La prima versione usava 2025-03-08-m08: stanco, e la guancia
opposta era in ombra, così il neo scuro sembrava «due puntini tenui».
Nei verificati al 300% su p08 (28/09), coordinate nel file NON ribaltato.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

sys.path.insert(0, str(Path(__file__).parent))
from body_and_skin import face_box  # noqa: E402

REFS = Path.home() / "Darkroom/projects/profilo/data/refs"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REFS / "io-cheatsheet.png"
BASE = REFS / "io-rasato-2023-06-23-p08.jpg"
FLIP = True  # selfie allo specchio
ORECCHINO = REFS / "io-rasato-2025-03-08-m08.jpg"  # in p08 porta un dilatatore scuro
GIRO = ["io-360-m61.jpg", "io-360-m44.jpg", "io-360-m25.jpg", "io-360-p00.jpg",
        "io-360-p19.jpg", "io-360-p50.jpg", "io-360-p66.jpg"]
# nei: (etichetta, x, y) in frazioni della foto base, raggio del cerchio in px pieni
NEI = [("1", .337, .495, 45), ("2", .465, .465, 30), ("3", .332, .438, 30), ("4", .645, .519, 38)]

F = "/System/Library/Fonts/Helvetica.ttc"
def font(s, bold=False):
    return ImageFont.truetype(F, s, index=1 if bold else 0)

BG, INK, ACC, MUTE = (246, 244, 240), (20, 20, 20), (214, 40, 40), (110, 110, 110)
W, H = 2600, 1590
sheet = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(sheet)
d.text((60, 40), "Attilio — riferimento identità", font=font(52, True), fill=INK)
d.text((60, 104), "foto vere, rasato · i numeri rossi sono i nei veri, tutti gli altri non esistono",
       font=font(28), fill=MUTE)

# 1) viso rasato grande con i nei cerchiati
base = ImageOps.exif_transpose(Image.open(BASE)).convert("RGB")
if FLIP:
    base = ImageOps.mirror(base)
    NEI = [(l, 1 - x, y, r) for l, x, y, r in NEI]
bw, bh = base.size
box = (int(.335 * bw), int(.12 * bh), int(.90 * bw), int(.68 * bh))
crop = base.crop(box)
s = 1360 / crop.height
crop = crop.resize((int(crop.width * s), 1360), Image.LANCZOS)
cd = ImageDraw.Draw(crop)
for lab, x, y, r in NEI:
    if not r:
        continue
    X, Y = (x * bw - box[0]) * s, (y * bh - box[1]) * s
    R = r * s + 10
    cd.ellipse([X - R, Y - R, X + R, Y + R], outline=ACC, width=5)
    cd.text((X + R + 6, Y - R - 10), lab, font=font(46, True), fill=ACC)
sheet.paste(crop, (60, 170))
fx = 60 + crop.width + 50

# 2) note
righe = [
    ("Lato dell'orecchino (a destra nella foto):", True),
    ("1  neo in rilievo, color pelle con base scura, ~3 mm, a metà tra naso e orecchio,", False),
    ("    all'altezza della narice. È il segno che mi rende riconoscibile.", False),
    ("2  puntino marrone piccolo nel solco tra guancia e naso, sotto la montatura.", False),
    ("3  puntino rossastro piccolo in alto sulla guancia, sotto l'angolo degli occhiali.", False),
    ("Lato opposto (a sinistra nella foto):", True),
    ("4  neo scuro ~2 mm all'altezza dell'angolo della bocca, verso la mascella.", False),
    ("NON ho: lentiggini sul naso, nei sotto il labbro o sul mento, barba (rasato).", True),
    ("", False),
    ("Bocca: labbro superiore sottile, inferiore appena più pieno, rosa pallido, chiusa.", False),
    ("Capelli: ricci castani fitti sopra, corti ai lati, qualche filo grigio.", False),
    ("Orecchino: cerchietto piccolo al lobo, lato del neo. Qui è argento: lo porto in ORO.", False),
    ("Occhiali nelle foto = da vista; nella foto profilo vanno i Gascan curvi (accessorio).", False),
]
y = 180
for t, b in righe:
    d.text((fx, y), t, font=font(30, b), fill=INK if b or not t.startswith(" ") else INK)
    y += 46

# 3) dettagli: bocca, orecchino, capelli dalla stessa foto
orecchino = ImageOps.exif_transpose(Image.open(ORECCHINO)).convert("RGB")
def dettaglio(x0, y0, x1, y1, w, src=None):
    src = src or base
    sw, sh = src.size
    c = src.crop((int(x0 * sw), int(y0 * sh), int(x1 * sw), int(y1 * sh)))
    return c.resize((w, int(c.height * w / c.width)), Image.LANCZOS)
dett = [("bocca", dettaglio(.40, .495, .66, .585, 420)),
        ("orecchino (in oro)", dettaglio(.70, .53, .82, .65, 240, orecchino)),
        ("capelli", dettaglio(.28, .12, .95, .40, 520))]
dx, dy = fx, y + 20
for n, im in dett:
    sheet.paste(im, (dx, dy + 34))
    d.text((dx, dy), n, font=font(28, True), fill=INK)
    dx += im.width + 30

# 4) giro della testa (qui con barba: conta la forma, non la pelle)
gy = 170 + 1360 - 300
d.text((fx, gy - 44), "Giro della testa — forma, naso, orecchie, capelli (qui c'è barba: ignorarla)",
       font=font(28, True), fill=INK)
gx = fx
for f in GIRO:
    p = REFS / f
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
    try:
        fb = face_box(p)
    except Exception:
        fb = None
    iw, ih = im.size
    if fb:
        cx, cy = (fb["x_min"] + fb["x_max"]) / 2 * iw, (fb["y_min"] + fb["y_max"]) / 2 * ih
        half = max((fb["x_max"] - fb["x_min"]) * iw, (fb["y_max"] - fb["y_min"]) * ih) * 0.85
    else:
        cx, cy, half = iw / 2, ih * .35, min(iw, ih) * .4
    # Ritaglio con la proporzione ESATTA della casella (150x172): se sborda si
    # sposta dentro la foto, se non ci sta si rimpicciolisce. Prima si tagliava
    # al bordo e poi si forzava a 150x172: visi stirati fino a x1,55 (28/09).
    cw, ch = 2 * half, 2 * half * 172 / 150
    k = min(1, iw / cw, ih / ch)
    cw, ch = cw * k, ch * k
    x0 = min(max(0, cx - cw / 2), iw - cw)
    y0 = min(max(0, cy - ch / 2), ih - ch)
    c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
    c = c.resize((150, 172), Image.LANCZOS)
    sheet.paste(c, (gx, gy))
    d.text((gx, gy + 178), f[7:-4].replace("m", "−").replace("p", "+") + "°", font=font(24), fill=MUTE)
    gx += 160

sheet.save(OUT)
print(OUT, sheet.size)
