#!/usr/bin/env python3
"""color_grade.py — deterministic local color grade as an ordered STEP engine.

The pipeline is an ordered list of steps; each one can be toggled, has its own
params, and the order is editable. Step types:
  • white_balance — robust AWB (cast from neutral greys) or scene-match (shared gain).
  • levels        — black/white on LUMA (same scale on every channel, no hue shift).
  • sakura        — pink_lift: lighter, more coherent pink hues.
  • lut           — 3D LUT (ffmpeg lut3d) at a 0-100 dose, with an optional reduced
                    dose on night / red-dominant scenes (auto_dose).
  • color         — final color correction: temp/tint/saturation/brightness/contrast.
                    This is the "color at the end", applied after the LUT.

Usage (new, step-based — used by the server):
  color_grade.py --input in.png --output out.jpg --steps-file steps.json \
                 [--wb-gain r,g,b] [--max-width 1600] [--quality 90]
  steps.json = [{"type":"lut","enabled":true,"params":{"lut":"/abs/x.cube",
                 "dose":80,"auto_dose":true,"dose_night":30}}, ...]
  (LUT paths in params must be ABSOLUTE and already resolved by the caller.)

Usage (legacy, back-compat — single flags → equivalent steps):
  color_grade.py --input in.png --output out.jpg --lut '/path/look.cube' \
                 --dose 55 --awb --sakura [--auto-dose --dose-low 30]

The LUT is copied to a temp path without spaces/apostrophes (ffmpeg's lut3d
filter can't escape those characters). Requires numpy, Pillow, and ffmpeg
(set the FFMPEG env var to override the binary; defaults to `ffmpeg` on PATH).
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
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


def levels(a, black=0.4, white=99.6):
    luma = (a * LUMA).sum(-1)
    lo = np.percentile(luma, black); hi = np.percentile(luma, white)
    return np.clip((a - lo) * 255.0 / max(hi - lo, 1.0), 0, 255)


def pink_lift(a):
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


def color_correct(a, p):
    """Final color correction (after the LUT). Params -100..100, 0 = neutral:
      temp        — warm(+)/cool(-): raise R, lower B (or vice versa).
      tint        — magenta(+)/green(-): acts on the G channel.
      saturation  — -100 = b/w, +100 = ~2x.
      brightness  — global multiplier.
      contrast    — around mid (128).
    This is the step that cools an over-orange night shot or gives pop to a flat
    one. a: float32 HxWx3 0-255."""
    temp = float(p.get("temp", 0)) / 100.0
    tint = float(p.get("tint", 0)) / 100.0
    sat = float(p.get("saturation", 0)) / 100.0
    bri = float(p.get("brightness", 0)) / 100.0
    con = float(p.get("contrast", 0)) / 100.0
    x = a.astype(np.float32).copy()
    if temp:
        x[..., 0] *= (1.0 + 0.30 * temp)
        x[..., 2] *= (1.0 - 0.30 * temp)
    if tint:
        # magenta (+) lowers green; green (-) raises it
        x[..., 1] *= (1.0 - 0.30 * tint)
    if bri:
        x *= (1.0 + 0.50 * bri)
    if con:
        x = (x - 128.0) * (1.0 + 0.60 * con) + 128.0
    if sat:
        luma = (x * LUMA).sum(-1, keepdims=True)
        x = luma + (x - luma) * (1.0 + sat)
    return np.clip(x, 0, 255)


def scene_is_warm_dark(a):
    """Classify the scene to decide the LUT dose. A warm summer LUT washes the
    blue sky into muddy teal on dark/night scenes, and pushes already
    red-dominant scenes fully to orange. Here we recognize those cases (low luma
    = night/dusk, or a dominant red channel) to apply a reduced dose and keep the
    blue sky / a natural rendition. a: float32 0-255."""
    luma = (a * LUMA).sum(-1).mean()
    r, g, b = a[..., 0].mean(), a[..., 1].mean(), a[..., 2].mean()
    r_frac = r / (r + g + b + 1e-6)
    return bool(luma < 65.0 or r_frac > 0.44)


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


def run_step(a, step, wb_gain):
    """Apply a single step to the array (float32 0-255) and return it."""
    t = step.get("type")
    p = step.get("params", {}) or {}
    if t == "white_balance":
        if p.get("scene_match") and wb_gain is not None:
            return np.clip(a * np.asarray(wb_gain, np.float32), 0, 255)
        if p.get("awb", True):
            return awb(a)
        return a
    if t == "levels":
        return levels(a, float(p.get("black", 0.4)), float(p.get("white", 99.6)))
    if t == "sakura":
        return pink_lift(a)
    if t == "lut":
        lut = p.get("lut", "") or ""
        dose = float(p.get("dose", 0))
        if p.get("auto_dose") and p.get("dose_night") is not None and scene_is_warm_dark(a):
            dose = float(p.get("dose_night"))
        d = max(0.0, min(100.0, dose)) / 100.0
        if lut and d > 0 and os.path.isfile(lut):
            with tempfile.TemporaryDirectory() as td:
                la = apply_lut(a, lut, td)
            return a * (1 - d) + la * d
        return a
    if t == "color":
        return color_correct(a, p)
    return a  # unknown type → no-op


def grade_steps(inp, out, steps, max_width, quality, wb_gain=None):
    """Run the ordered list of steps. steps = [{type,enabled,params}, ...]."""
    im = ImageOps.exif_transpose(Image.open(inp)).convert("RGB")
    if max_width and im.width > max_width:
        nh = int(im.height * max_width / im.width)
        im = im.resize((max_width, nh), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)

    for step in steps:
        if not step.get("enabled", True):
            continue
        a = run_step(a, step, wb_gain)

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    ext = os.path.splitext(out)[1].lower()
    if ext in (".jpg", ".jpeg"):
        img.save(out, quality=quality, subsampling=0)
    else:
        img.save(out)
    return out


def legacy_steps(args):
    """Build the equivalent steps from the legacy flags (CLI back-compat)."""
    steps = [
        {"type": "white_balance", "enabled": bool(args.awb or args.wb_gain),
         "params": {"awb": bool(args.awb), "scene_match": bool(args.wb_gain)}},
        {"type": "levels", "enabled": True, "params": {}},
        {"type": "sakura", "enabled": bool(args.sakura), "params": {}},
        {"type": "lut", "enabled": True,
         "params": {"lut": args.lut, "dose": args.dose,
                    "auto_dose": bool(args.auto_dose),
                    "dose_night": args.dose_low}},
    ]
    return steps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--steps-file", default="",
                    help="JSON with the ordered list of steps (absolute LUT paths)")
    ap.add_argument("--lut", default="")
    ap.add_argument("--dose", type=float, default=55.0)
    ap.add_argument("--dose-low", type=float, default=None,
                    help="reduced dose for night/red-dominant scenes (with --auto-dose)")
    ap.add_argument("--auto-dose", action="store_true",
                    help="lower the dose to --dose-low on night/warm scenes")
    ap.add_argument("--awb", action="store_true")
    ap.add_argument("--sakura", action="store_true")
    ap.add_argument("--max-width", type=int, default=0)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--wb-gain", default="", help="fixed 'r,g,b' gain, replaces --awb (scene-match)")
    args = ap.parse_args()
    wb_gain = None
    if args.wb_gain:
        wb_gain = [float(x) for x in args.wb_gain.split(",")]
    try:
        if args.steps_file:
            with open(args.steps_file) as f:
                steps = json.load(f)
        else:
            steps = legacy_steps(args)
        grade_steps(args.input, args.output, steps,
                    args.max_width or 0, args.quality, wb_gain)
        print("OK " + args.output)
    except Exception as e:
        print("ERR " + str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
