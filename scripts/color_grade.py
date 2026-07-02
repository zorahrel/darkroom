#!/usr/bin/env python3
"""color_grade.py — apply a deterministic, uniform local color grade.

Pipeline:
  1. Robust AWB  — estimate the color cast ONLY from neutral pixels (low-saturation
     mid-tones), so colorful subjects don't fool the balance → consistent white
     everywhere = a uniform base.
  2. Levels on LUMA — set black/white with the same scale on every channel, so
     there is no hue shift (a per-channel stretch blows up on scenes without a
     full tonal range).
  3. pink pop (optional) — brighten + slightly desaturate pink hues for a
     coherent look across a set.
  4. 3D LUT (ffmpeg lut3d) — the creative color, applied at a 0-100 dose.

Usage:
  color_grade.py --input in.png --output out.jpg --lut '/path/look.cube' \
                 --dose 55 --awb --pop [--max-width 1600] [--quality 90]

The LUT is copied to a temp path without spaces/apostrophes (ffmpeg's lut3d
filter can't escape those characters). Requires numpy, Pillow, and ffmpeg
(set the FFMPEG env var to override the binary; defaults to `ffmpeg` on PATH).
"""
import argparse, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageOps

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
LUMA = np.array([.299, .587, .114], np.float32)


def awb(a):
    luma = (a * LUMA).sum(-1)
    mx = a.max(-1); mn = a.min(-1)
    sat = (mx - mn) / np.clip(mx, 1, None)
    mask = (luma > 45) & (luma < 215) & (sat < 0.18)
    if mask.sum() < 800:
        mask = (luma > 35) & (luma < 225)
    if mask.sum() < 50:
        return np.clip(a, 0, 255)
    m = a[mask].reshape(-1, 3).mean(0); g = m.mean()
    gain = np.clip(g / np.clip(m, 1, None), 0.82, 1.22)
    return np.clip(a * gain, 0, 255)


def levels(a):
    luma = (a * LUMA).sum(-1)
    lo = np.percentile(luma, 0.4); hi = np.percentile(luma, 99.6)
    return np.clip((a - lo) * 255.0 / max(hi - lo, 1.0), 0, 255)


def pink_pop(a):
    x = a / 255.0; out = x.copy()
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    mx = np.maximum.reduce([r, g, b]); mn = np.minimum.reduce([r, g, b])
    v = mx; s = np.where(mx > 0, (mx - mn) / np.clip(mx, 1e-6, None), 0)
    hue = np.zeros_like(v); d = mx - mn + 1e-6
    rm = (mx == r); gm = (mx == g) & ~rm; bm = (mx == b) & ~rm & ~gm
    hue[rm] = (((g - b) / d)[rm]) % 6
    hue[gm] = (((b - r) / d)[gm] + 2)
    hue[bm] = (((r - g) / d)[bm] + 4)
    hue = hue * 60.0
    pink = ((hue >= 300) | (hue <= 18)) & (s > 0.12) & (s < 0.75) & (v > 0.30)
    for c in range(3):
        out[..., c] = np.where(pink, np.clip(x[..., c] + 0.10 * (1 - x[..., c]), 0, 1), x[..., c])
    vv = out.max(-1, keepdims=True)
    out = np.where(pink[..., None], out * 0.82 + vv * 0.18, out)
    return np.clip(out * 255, 0, 255)


def apply_lut(arr, lut_path, tmpdir):
    """Return the array after the LUT (100%). arr: float32 HxWx3 0-255."""
    safe_lut = os.path.join(tmpdir, "lut.cube")
    shutil.copy(lut_path, safe_lut)
    src = os.path.join(tmpdir, "src.png")
    dst = os.path.join(tmpdir, "lut.png")
    Image.fromarray(arr.astype(np.uint8)).save(src)
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", src,
         "-vf", f"lut3d=file={safe_lut}:interp=trilinear", dst],
        check=True,
    )
    return np.asarray(Image.open(dst).convert("RGB")).astype(np.float32)


def grade(inp, out, lut, dose, do_awb, do_pop, max_width, quality):
    im = ImageOps.exif_transpose(Image.open(inp)).convert("RGB")
    if max_width and im.width > max_width:
        nh = int(im.height * max_width / im.width)
        im = im.resize((max_width, nh), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)

    if do_awb:
        a = awb(a)
    a = levels(a)
    if do_pop:
        a = pink_pop(a)
    uni = a

    d = max(0.0, min(100.0, dose)) / 100.0
    if lut and d > 0 and os.path.isfile(lut):
        with tempfile.TemporaryDirectory() as td:
            la = apply_lut(uni, lut, td)
        fin = uni * (1 - d) + la * d
    else:
        fin = uni

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    img = Image.fromarray(np.clip(fin, 0, 255).astype(np.uint8))
    ext = os.path.splitext(out)[1].lower()
    if ext in (".jpg", ".jpeg"):
        img.save(out, quality=quality, subsampling=0)
    else:
        img.save(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--lut", default="")
    ap.add_argument("--dose", type=float, default=55.0)
    ap.add_argument("--awb", action="store_true")
    ap.add_argument("--pop", action="store_true")
    ap.add_argument("--max-width", type=int, default=0)
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()
    try:
        grade(args.input, args.output, args.lut, args.dose,
              args.awb, args.pop, args.max_width or 0, args.quality)
        print("OK " + args.output)
    except Exception as e:
        print("ERR " + str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
