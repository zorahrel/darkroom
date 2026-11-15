"""Foglio del viso di Attilio, solo da foto vere: giro della testa alla stessa scala,
mascella da rasato, mappa e macro dei nei. Serve da riferimento d'identita' unico
per le generazioni da zero (niente versioni generate: portano la pelle finta)."""
from PIL import Image, ImageOps, ImageDraw, ImageFont
import sys

R = "/Users/zorahrel/Darkroom/projects/profilo/data/refs/"
OUT = sys.argv[1] if len(sys.argv) > 1 else R + "io-foglio-viso.jpg"

# (file, centro x, centro y, lato) in frazioni di larghezza/altezza: occhi al 40% del riquadro.
GIRO = [("io-360-m61.jpg", .40, .55, .82, "PROFILE"),
        ("io-360-m25.jpg", .45, .54, .76, "THREE-QUARTER"),
        ("io-360-p00.jpg", .48, .54, .88, "FRONT"),
        ("io-360-p50.jpg", .40, .54, .80, "THREE-QUARTER"),
        ("io-360-p66.jpg", .48, .55, .82, "PROFILE")]
RASATO = [("io-rasato-2025-03-08-m08.jpg", .48, .51, .94, "FRONT, SHAVED"),
          ("io-rasato-2023-06-23-p08.jpg", .46, .475, .70, "SLIGHT TURN, SHAVED"),
          ("io-selfie-a461b8b5.png", .48, .60, .82, "NO GLASSES (orange lamp: ignore the colour)")]

def font(n):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try: return ImageFont.truetype(p, n)
        except OSError: pass
    return ImageFont.load_default()

def tile(f, cx, cy, s, size):
    im = ImageOps.exif_transpose(Image.open(R + f)).convert("RGB"); W, H = im.size
    S = s * W; x0 = cx * W - S / 2; y0 = cy * H - S / 2
    return im.crop((int(x0), int(y0), int(x0 + S), int(y0 + S))).resize((size, size), Image.LANCZOS)

def frac(f, a, b, c, d):
    im = Image.open(R + f).convert("RGB"); W, H = im.size
    return im.crop((int(a * W), int(b * H), int(c * W), int(d * H)))

BG, INK, RED = (236, 234, 230), (20, 20, 20), (200, 30, 30)
T, G, M = 452, 14, 40
WID = M * 2 + 5 * T + 4 * G
sheet = Image.new("RGB", (WID, 2400), BG); d = ImageDraw.Draw(sheet)
y = M
d.text((M, y), "IDENTITY SHEET  -  the same man in every photo (real photos, no retouching)", font=font(44), fill=INK); y += 64

def heading(text, sub):
    global y
    d.text((M, y), text, font=font(30), fill=INK); y += 38
    if sub: d.text((M, y), sub, font=font(22), fill=RED); y += 32

heading("1  HEAD TURNAROUND, same scale: copy skull shape, nose, ears, hairline, dense brown curls",
        "the beard in these five photos is NOT wanted (the final face is clean-shaven); the pen mark on the forehead in FRONT is not part of the face")
for i, (f, cx, cy, s, lab) in enumerate(GIRO):
    x = M + i * (T + G); sheet.paste(tile(f, cx, cy, s, T), (x, y))
    d.text((x + 8, y + T + 6), lab, font=font(22), fill=INK)
y += T + 44

heading("2  CLEAN-SHAVEN: this is the jaw, chin and skin to draw (pores, light freckles, no stubble)",
        "the round glasses here are prescription glasses: do NOT draw them")
for i, (f, cx, cy, s, lab) in enumerate(RASATO):
    x = M + i * (T + G); sheet.paste(tile(f, cx, cy, s, T), (x, y))
    d.text((x + 8, y + T + 6), lab, font=font(22), fill=INK)
# mappa dei nei dalla tavola d'identita' esistente (foto vera, cerchi rossi numerati)
mappa = frac("io-identita-nei.png", .022, .073, .418, .651)
mappa = mappa.resize((int(T * 2 * mappa.width / mappa.height / 2), T)) if mappa.height else mappa
mx = M + 3 * (T + G); sheet.paste(mappa, (mx, y))
d.text((mx + 8, y + T + 6), "MOLE MAP: only the 4 red-circled moles exist", font=font(22), fill=RED)
y += T + 44

heading("3  THE 4 MOLES at real size: exactly these, in these places, nowhere else", "")
macro = frac("io-identita-nei.png", .015, .713, .985, .993)
k = (WID - 2 * M) / macro.width; macro = macro.resize((WID - 2 * M, int(macro.height * k)), Image.LANCZOS)
sheet.paste(macro, (M, y)); y += macro.height + M

sheet = sheet.crop((0, 0, WID, y)); sheet.save(OUT, quality=93); print(OUT, sheet.size)
