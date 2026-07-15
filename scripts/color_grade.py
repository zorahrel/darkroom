#!/usr/bin/env python3
"""color_grade.py — deterministic local color grade as an ordered STEP engine.

The pipeline is an ordered list of steps; each one can be toggled, has its own
params, and the order is editable. Step types:
  • white_balance — robust AWB (cast from neutral greys) or scene-match (shared gain).
  • levels        — black/white on LUMA (same scale on every channel, no hue shift).
  • sakura        — pink_lift: lighter, more coherent pink hues.
  • sky           — sky_lift: lighter, less muddy cyan/blue sky hues.
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
import argparse, colorsys, json, os, shutil, subprocess, sys, tempfile
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


def levels(a, black=0.4, white=99.6, soft=False):
    luma = (a * LUMA).sum(-1)
    lo = np.percentile(luma, black); hi = np.percentile(luma, white)
    y = (a - lo) * 255.0 / max(hi - lo, 1.0)
    if not soft:
        return np.clip(y, 0, 255)
    # Soft highlight knee: instead of hard-clipping the stretched top to pure
    # white, roll it off with a tanh shoulder above `knee` so highlights
    # compress toward (but never reach) 255 — keeps texture in bright skies /
    # signage instead of a burnt flat patch. Shadows/black point untouched.
    x = y / 255.0
    knee = 0.82
    comp = knee + (1.0 - knee) * np.tanh(np.clip((x - knee) / (1.0 - knee), 0, None))
    x = np.where(x > knee, comp, x)
    return np.clip(x * 255.0, 0, 255)


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


def sky_lift(a, amount=40.0):
    """Lighten light-blue/cyan sky tones. amount 0-100 -> 0..~35% lift toward
    white inside the masked hue. Masks cyan/blue hue (~180-250°) with moderate
    saturation/value so it targets skies, not deep-navy shadow or saturated
    blue signage/clothing (those sit outside the s/v band below)."""
    amt = max(0.0, min(100.0, amount)) / 100.0
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
    sky = (hue >= 180) & (hue <= 250) & (s > 0.08) & (s < 0.85) & (v > 0.30)
    lift = 0.35 * amt
    for c in range(3):
        out[..., c] = np.where(sky, np.clip(x[..., c] + lift * (1 - x[..., c]), 0, 1), x[..., c])
    return np.clip(out * 255, 0, 255)


def color_correct(a, p):
    """Final color correction (after the LUT). Params -100..100, 0 = neutral:
      temp        — warm(+)/cool(-): raise R, lower B (or vice versa).
      tint        — magenta(+)/green(-): acts on the G channel.
      exposure    — photographic stops: +100 ≈ +1.5 EV (multiplicative).
      highlights  — brighten(+)/recover(-) the top tonal range (luma-masked).
      shadows     — lift(+)/deepen(-) the bottom tonal range (luma-masked).
      whites      — brighten(+)/pull(-) the extreme highlights (tight mask).
      blacks      — lift(+)/deepen(-) the extreme shadows (tight mask).
      brightness  — global linear multiplier.
      contrast    — around mid (128).
      saturation  — -100 = b/w, +100 = ~2x (uniform).
      vibrance    — like saturation but weighted toward low-sat pixels (protects
                    already-saturated colors and skin).
    Tone moves (exposure/highlights/shadows) apply a per-pixel gain to all three
    channels, so hue is preserved. a: float32 HxWx3 0-255."""
    temp = float(p.get("temp", 0)) / 100.0
    tint = float(p.get("tint", 0)) / 100.0
    exposure = float(p.get("exposure", 0)) / 100.0
    highlights = float(p.get("highlights", 0)) / 100.0
    shadows = float(p.get("shadows", 0)) / 100.0
    whites = float(p.get("whites", 0)) / 100.0
    blacks = float(p.get("blacks", 0)) / 100.0
    bri = float(p.get("brightness", 0)) / 100.0
    con = float(p.get("contrast", 0)) / 100.0
    sat = float(p.get("saturation", 0)) / 100.0
    vib = float(p.get("vibrance", 0)) / 100.0
    x = a.astype(np.float32).copy()
    if temp:
        x[..., 0] *= (1.0 + 0.30 * temp)
        x[..., 2] *= (1.0 - 0.30 * temp)
    if tint:
        # magenta (+) lowers green; green (-) raises it
        x[..., 1] *= (1.0 - 0.30 * tint)
    if exposure:
        x *= float(2.0 ** (1.5 * exposure))  # +100 → +1.5 stop, -100 → -1.5 stop
    if highlights or shadows:
        lum = (x * LUMA).sum(-1, keepdims=True) / 255.0  # 0..1
        shadow_mask = np.clip(1.0 - lum / 0.5, 0.0, 1.0) ** 1.5
        highlight_mask = np.clip((lum - 0.5) / 0.5, 0.0, 1.0) ** 1.5
        gain = 1.0 + 0.60 * shadows * shadow_mask + 0.60 * highlights * highlight_mask
        x = x * gain
    if whites or blacks:
        # Whites/Blacks act on the extreme ends (tighter masks than highlights/
        # shadows). +whites brightens the brightest tones, +blacks lifts the
        # darkest (Lightroom sign convention).
        lum = (x * LUMA).sum(-1, keepdims=True) / 255.0
        white_mask = np.clip((lum - 0.7) / 0.3, 0.0, 1.0) ** 1.2
        black_mask = np.clip((0.3 - lum) / 0.3, 0.0, 1.0) ** 1.2
        gain = 1.0 + 0.50 * whites * white_mask + 0.50 * blacks * black_mask
        x = x * gain
    if bri:
        x *= (1.0 + 0.50 * bri)
    if con:
        x = (x - 128.0) * (1.0 + 0.60 * con) + 128.0
    if sat:
        luma = (x * LUMA).sum(-1, keepdims=True)
        x = luma + (x - luma) * (1.0 + sat)
    if vib:
        luma = (x * LUMA).sum(-1, keepdims=True)
        mx = x.max(-1, keepdims=True)
        mn = x.min(-1, keepdims=True)
        cur_sat = (mx - mn) / np.clip(mx, 1.0, None)  # 0..1
        weight = 1.0 - cur_sat  # low-sat pixels get the bigger push
        x = luma + (x - luma) * (1.0 + vib * weight)
    return np.clip(x, 0, 255)


# Lightroom's eight HSL bands and their approximate hue centers (degrees).
HSL_BANDS = {
    "red": 0.0, "orange": 30.0, "yellow": 60.0, "green": 120.0,
    "aqua": 180.0, "blue": 240.0, "purple": 290.0, "magenta": 330.0,
}


def _rgb_to_hsv(x):
    """x: float32 HxWx3 0-255 → (h[0..360], s[0..1], v[0..1])."""
    r, g, b = x[..., 0] / 255.0, x[..., 1] / 255.0, x[..., 2] / 255.0
    mx = np.maximum.reduce([r, g, b])
    mn = np.minimum.reduce([r, g, b])
    d = mx - mn
    dd = np.where(d == 0, 1.0, d)
    h = np.zeros_like(mx)
    rm = (mx == r); gm = (mx == g) & ~rm; bm = (mx == b) & ~rm & ~gm
    h[rm] = (((g - b) / dd)[rm]) % 6
    h[gm] = (((b - r) / dd)[gm] + 2)
    h[bm] = (((r - g) / dd)[bm] + 4)
    h *= 60.0
    s = np.where(mx == 0, 0.0, d / np.where(mx == 0, 1.0, mx))
    return h, s, mx


def _hsv_to_rgb(h, s, v):
    h = h % 360.0
    c = v * s
    hp = h / 60.0
    xx = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(h)
    cond = [hp < 1, hp < 2, hp < 3, hp < 4, hp < 5, hp <= 6.0]
    r = np.select(cond, [c, xx, z, z, xx, c], default=z)
    g = np.select(cond, [xx, c, c, xx, z, z], default=z)
    b = np.select(cond, [z, z, xx, c, c, xx], default=z)
    m = (v - c)[..., None]
    return (np.stack([r, g, b], -1) + m) * 255.0


def hsl_adjust(a, p):
    """Per-hue-band HSL, à la Lightroom's Color Mixer. For each of the 8 bands
    the pixel gets a smooth weight from its hue distance to the band center, then
    hue (±30°), saturation and luminance are nudged by that weight. Params are
    keyed hue_<band>/sat_<band>/lum_<band>, each -100..100."""
    h, s, v = _rgb_to_hsv(a)
    dh = np.zeros_like(h); ds = np.zeros_like(h); dl = np.zeros_like(h)
    spread = 45.0
    touched = False
    for name, center in HSL_BANDS.items():
        hue_amt = float(p.get("hue_" + name, 0)) / 100.0
        sat_amt = float(p.get("sat_" + name, 0)) / 100.0
        lum_amt = float(p.get("lum_" + name, 0)) / 100.0
        if not (hue_amt or sat_amt or lum_amt):
            continue
        touched = True
        diff = np.abs(((h - center + 180.0) % 360.0) - 180.0)  # circular distance
        w = np.clip(1.0 - diff / spread, 0.0, 1.0)
        if hue_amt:
            dh += hue_amt * 30.0 * w
        if sat_amt:
            ds += sat_amt * w
        if lum_amt:
            dl += lum_amt * w
    if not touched:
        return a
    h2 = h + dh
    s2 = np.clip(s * (1.0 + ds), 0.0, 1.0)
    v2 = np.clip(v * (1.0 + 0.5 * dl), 0.0, 1.0)
    return np.clip(_hsv_to_rgb(h2, s2, v2), 0.0, 255.0)


def _curve_lut_points(points):
    """256-entry LUT from a list of [x,y] control points (0-255), linearly
    interpolated. Points are sorted and de-duplicated on x."""
    pts = sorted(([float(x), float(y)] for x, y in points), key=lambda q: q[0])
    xs, ys, seen = [], [], set()
    for x, y in pts:
        xi = max(0.0, min(255.0, x))
        if xi in seen:
            continue
        seen.add(xi); xs.append(xi); ys.append(max(0.0, min(255.0, y)))
    if len(xs) < 2:
        return np.arange(256, dtype=np.float32)
    return np.clip(np.interp(np.arange(256), xs, ys), 0, 255).astype(np.float32)


def _curve_lut_parametric(sh, dk, lt, hl):
    """256-entry LUT from Lightroom-style parametric sliders (each -1..1) as
    smooth bumps over the shadow/dark/light/highlight quarters."""
    x = np.arange(256, dtype=np.float32)
    lut = x.copy()
    for center, amt in zip((32.0, 96.0, 160.0, 224.0), (sh, dk, lt, hl)):
        if amt:
            lut += amt * 45.0 * np.exp(-0.5 * ((x - center) / 48.0) ** 2)
    return np.clip(lut, 0, 255)


def apply_curve(a, p):
    """Tone curve step. The composite curve applies to all channels (a `points`
    RGB point curve, else the parametric shadows/darks/lights/highlights). Then
    optional per-channel point curves (points_r/points_g/points_b) apply to R/G/B
    — matching Lightroom's composite + red/green/blue curves. a: float32 0-255."""
    out = a.astype(np.float32)

    pts = p.get("points")
    composite = None
    if isinstance(pts, list) and len(pts) >= 2:
        composite = _curve_lut_points(pts)
    else:
        sh = float(p.get("shadows", 0)) / 100.0
        dk = float(p.get("darks", 0)) / 100.0
        lt = float(p.get("lights", 0)) / 100.0
        hl = float(p.get("highlights", 0)) / 100.0
        if sh or dk or lt or hl:
            composite = _curve_lut_parametric(sh, dk, lt, hl)
    if composite is not None:
        idx = np.clip(out, 0, 255).astype(np.int32)
        out = composite[idx]

    for ci, key in ((0, "points_r"), (1, "points_g"), (2, "points_b")):
        cpts = p.get(key)
        if isinstance(cpts, list) and len(cpts) >= 2:
            lut = _curve_lut_points(cpts)
            idx = np.clip(out[..., ci], 0, 255).astype(np.int32)
            out[..., ci] = lut[idx]

    return np.clip(out, 0, 255)


def split_tone(a, p):
    """Split toning / color grading: tint shadows, midtones and highlights with
    independent colors. Each region has <r>_hue (0-360) and <r>_sat (0-100); the
    balance (-100..100) shifts the shadow/highlight crossover. The tint pushes
    the pixel toward the region's hue, weighted by a luma mask × saturation, so
    only the targeted tonal band is colored. a: float32 HxWx3 0-255."""
    regions = ("shadows", "midtones", "highlights")
    sats = {r: float(p.get(r + "_sat", 0)) / 100.0 for r in regions}
    if not any(sats.values()):
        return a
    balance = float(p.get("balance", 0)) / 100.0
    x = a.astype(np.float32).copy()
    lum = (x * LUMA).sum(-1, keepdims=True) / 255.0
    pivot = float(np.clip(0.5 - balance * 0.25, 0.05, 0.95))
    weights = {
        "shadows": np.clip((pivot - lum) / pivot, 0.0, 1.0),
        "highlights": np.clip((lum - pivot) / (1.0 - pivot), 0.0, 1.0),
        "midtones": np.clip(1.0 - np.abs(lum - pivot) / 0.5, 0.0, 1.0),
    }
    for r in regions:
        sat = sats[r]
        if sat <= 0:
            continue
        hue = float(p.get(r + "_hue", 0)) % 360.0
        tr, tg, tb = colorsys.hsv_to_rgb(hue / 360.0, 1.0, 1.0)
        tint = np.array([tr, tg, tb], np.float32) - 0.5  # direction toward the hue
        x += (weights[r] * (sat * 60.0)) * tint[None, None, :]
    return np.clip(x, 0.0, 255.0)


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


def build_mask(shape, mp):
    """Build a per-step local mask (H,W,1) in 0..1 from mask params `mp`.

    Types:
      radial — soft ellipse. cx,cy = center (0..1 relative), rx,ry = radii
               (0..1), feather = 0..1 fraction of the radius used as falloff.
      linear — gradient perpendicular to `angle` (deg), centered at `pos`
               (0..1), transition band width = feather (0..1).
    `invert` flips the mask. Returns None if the type is unknown.
    """
    h, w = shape[0], shape[1]
    ys = ((np.arange(h) + 0.5) / h).astype(np.float32)
    xs = ((np.arange(w) + 0.5) / w).astype(np.float32)
    X, Y = np.meshgrid(xs, ys)
    t = mp.get("type")
    feather = float(mp.get("feather", 0.4))
    feather = min(max(feather, 0.0), 0.99)
    if t == "radial":
        cx = float(mp.get("cx", 0.5)); cy = float(mp.get("cy", 0.5))
        rx = max(float(mp.get("rx", 0.4)), 1e-3)
        ry = max(float(mp.get("ry", 0.4)), 1e-3)
        dx = (X - cx) / rx
        dy = (Y - cy) / ry
        d = np.sqrt(dx * dx + dy * dy)  # 1.0 at the ellipse edge
        inner = 1.0 - feather
        m = np.clip((1.0 - d) / max(1.0 - inner, 1e-3), 0.0, 1.0)
    elif t == "linear":
        ang = np.deg2rad(float(mp.get("angle", 0.0)))
        pos = float(mp.get("pos", 0.5))
        proj = (X - 0.5) * np.cos(ang) + (Y - 0.5) * np.sin(ang)
        center = pos - 0.5
        half = max(feather, 1e-3) * 0.5
        m = np.clip((proj - (center - half)) / (2.0 * half), 0.0, 1.0)
    else:
        return None
    m = m * m * (3.0 - 2.0 * m)  # smoothstep for a natural falloff
    if mp.get("invert"):
        m = 1.0 - m
    return m[..., None].astype(np.float32)


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
        return levels(a, float(p.get("black", 0.4)), float(p.get("white", 99.6)), bool(p.get("soft", False)))
    if t == "sakura":
        return pink_lift(a)
    if t == "sky":
        return sky_lift(a, float(p.get("amount", 40)))
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
    if t == "hsl":
        return hsl_adjust(a, p)
    if t == "curve":
        return apply_curve(a, p)
    if t == "split_tone":
        return split_tone(a, p)
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
        b = run_step(a, step, wb_gain)
        # Optional local mask: blend the step's result over the input by the
        # mask alpha, so the effect applies only where the mask is > 0.
        mp = (step.get("params", {}) or {}).get("mask")
        if mp and mp.get("enabled", True) and b is not a:
            m = build_mask(a.shape, mp)
            if m is not None:
                b = a * (1.0 - m) + b * m
        a = b

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
