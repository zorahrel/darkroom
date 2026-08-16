#!/usr/bin/env python3
"""collage.py — comporre più foto in una sola slide di carosello.

Niente cornici e niente sfondo a vista: una slide che sembra una slide, non una
pagina di album. Tre modi, tutti a pieno formato:

  • grid    — griglia a contatto, tagli netti, zero aria.
  • hero    — una foto domina in alto, le altre in striscia sotto.
  • mosaic  — una grande a sinistra, la colonna delle altre a destra.
  • stack   — una foto piena e le altre appoggiate sopra, a filo vivo, con la
              loro ombra. Lo sfondo non si vede mai: sotto c'è già una foto.
  • split   — due foto, taglio netto. Solo con 2 immagini.

Uso:
  collage.py --out out.jpg --mode grid --layout 2x2 --size 1080x1350 img...
  collage.py --out out.jpg --mode stack --size 1080x1350 img...

Il canvas di default è 1080x1350 (4:5, il formato che occupa più schermo su
Instagram). Le immagini in eccesso rispetto alle celle sono ignorate: il
chiamante sceglie il layout, non lo script.
"""
import argparse
import math
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps


def parse_layout(text):
    """'2x2' → (2 colonne, 2 righe). Il primo numero sono le COLONNE."""
    try:
        cols, rows = (int(x) for x in text.lower().split("x", 1))
    except ValueError:
        raise SystemExit(f"layout non valido: {text!r} (atteso tipo '2x2')")
    if not (1 <= cols <= 6 and 1 <= rows <= 6):
        raise SystemExit(f"layout fuori scala: {text!r}")
    return cols, rows


def parse_size(text):
    try:
        w, h = (int(x) for x in text.lower().split("x", 1))
    except ValueError:
        raise SystemExit(f"size non valida: {text!r} (atteso tipo '1080x1350')")
    if not (64 <= w <= 8000 and 64 <= h <= 8000):
        raise SystemExit(f"size fuori scala: {text!r}")
    return w, h


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def fit(im, size):
    return ImageOps.fit(im, size, method=Image.LANCZOS, centering=(0.5, 0.5))


def render_grid(images, W, H, cols, rows):
    """Griglia a contatto: nessun gutter, nessun bordo. L'ultima colonna/riga
    assorbe i pixel di resto, così non resta mai una riga di fondo scoperta."""
    canvas = Image.new("RGB", (W, H))
    bw, bh = W // cols, H // rows
    for i, im in enumerate(images[: cols * rows]):
        c, r = i % cols, i // cols
        w = W - c * bw if c == cols - 1 else bw
        h = H - r * bh if r == rows - 1 else bh
        canvas.paste(fit(im, (w, h)), (c * bw, r * bh))
    return canvas


def render_stack(images, W, H):
    """Una foto a tutto campo, le altre appoggiate sopra a filo vivo.

    Nessuna cornice: le stampe sopra sono la foto e basta, staccate dal fondo
    solo dalla loro ombra. Le posizioni non si sovrappongono fra loro e stanno
    lontane dal centro, dove di solito c'è il soggetto della foto di fondo."""
    canvas = fit(images[0], (W, H))

    # (lato relativo, centro x, centro y, gradi). Angoli piccoli: una stampa
    # buttata lì, non un fotomontaggio.
    spots = [
        (0.46, 0.68, 0.20, -4.0),
        (0.38, 0.28, 0.74, 3.5),
        (0.30, 0.74, 0.80, -2.5),
    ]
    for im, (scale, ax, ay, angle) in zip(images[1:4], spots):
        side = int(min(W, H) * scale)
        card = fit(im, (side, side))
        rot = card.rotate(angle, resample=Image.BICUBIC, expand=True)
        mask = Image.new("L", card.size, 255).rotate(
            angle, resample=Image.BICUBIC, expand=True
        )
        x = int(ax * W) - rot.width // 2
        y = int(ay * H) - rot.height // 2

        # L'ombra è la stampa stessa, sfocata e spostata: scurisce quel che c'è
        # sotto invece di disegnarci sopra un rettangolo grigio.
        blur = max(8, side // 20)
        shadow = mask.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * 0.6))
        sh = Image.new("L", canvas.size, 0)
        sh.paste(shadow, (x + blur // 2, y + blur // 2))
        canvas = Image.composite(Image.new("RGB", canvas.size, "#0a0a0a"), canvas, sh)
        canvas.paste(rot, (x, y), mask)
    return canvas


def render_hero(images, W, H):
    """Una foto domina in alto, le altre in striscia sotto, tutte a contatto.

    È il taglio che regge meglio in un carosello: si legge una gerarchia (questa
    è la scena, queste sono le note a margine) invece di quattro foto che si
    contendono l'attenzione."""
    rest = images[1:5] or images[:1]
    n = len(rest)
    strip_h = int(H * (0.30 if n <= 2 else 0.26))
    canvas = Image.new("RGB", (W, H))
    canvas.paste(fit(images[0], (W, H - strip_h)), (0, 0))
    bw = W // n
    for i, im in enumerate(rest):
        w = W - i * bw if i == n - 1 else bw
        canvas.paste(fit(im, (w, strip_h)), (i * bw, H - strip_h))
    return canvas


def render_mosaic(images, W, H):
    """Una grande a sinistra, la colonna delle altre a destra: tagli netti,
    proporzioni diverse. Serve quando una foto vale più delle altre ma non
    abbastanza da prendersi tutta la slide."""
    rest = images[1:4] or images[:1]
    n = len(rest)
    big_w = int(W * 0.62)
    canvas = Image.new("RGB", (W, H))
    canvas.paste(fit(images[0], (big_w, H)), (0, 0))
    bh = H // n
    for i, im in enumerate(rest):
        h = H - i * bh if i == n - 1 else bh
        canvas.paste(fit(im, (W - big_w, h)), (big_w, i * bh))
    return canvas


def render_split(images, W, H):
    """Due foto, taglio netto verticale leggermente inclinato."""
    a, b = fit(images[0], (W, H)), fit(images[1], (W, H))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).polygon(
        [(W, 0), (W, H), (int(W * 0.46), H), (int(W * 0.54), 0)], fill=255
    )
    out = a.copy()
    out.paste(b, (0, 0), mask)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("images", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument(
        "--mode", default="grid", choices=["grid", "hero", "mosaic", "stack", "split"]
    )
    ap.add_argument("--layout", default="2x2")
    ap.add_argument("--size", default="1080x1350")
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    W, H = parse_size(args.size)
    images = []
    for path in args.images:
        try:
            images.append(load(path))
        except Exception as e:  # una foto illeggibile non fa saltare la slide
            print(f"skip {path}: {e}", file=sys.stderr)
    if not images:
        raise SystemExit("nessuna immagine leggibile")

    if args.mode == "stack":
        canvas = render_stack(images, W, H)
    elif args.mode == "hero":
        canvas = render_hero(images, W, H)
    elif args.mode == "mosaic":
        canvas = render_mosaic(images, W, H)
    elif args.mode == "split":
        if len(images) < 2:
            raise SystemExit("split richiede 2 immagini")
        canvas = render_split(images, W, H)
    else:
        cols, rows = parse_layout(args.layout)
        canvas = render_grid(images, W, H, cols, rows)

    canvas.save(args.out, quality=args.quality, subsampling=1)
    print(args.out)


if __name__ == "__main__":
    main()
