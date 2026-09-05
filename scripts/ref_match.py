#!/usr/bin/env python3
"""How closely a variant resembles its reference, in numbers.

Why looking is not enough. On one project the same question put to a vision
model got the same answer ("hard directional light from the side") for both the
target and a render with flat light: the difference was there, just not in the
vocabulary. Measured, it was 3.8 against 1.9.

The three quantities are chosen because they answer different questions, and no
single one of them is enough to say "it resembles it":

  background  how much of the border is bright. A white background and a dark
              one change the reading of everything else, and that was the
              difference I had missed for a whole day.
  area        how much room the subject takes up. Says the framing without
              depending on where the crop falls.
  light       ratio between vertical and horizontal modulation INSIDE the
              subject. High = a band crossing the face; close to 1 = side or
              flat light. Measured inside the silhouette, not over the whole
              image: the background would skew it, and indeed it had.

Usage: python3 scripts/ref_match.py <variant> <reference>
Prints JSON with both sets of measurements and the gap between them.
"""
import json
import sys

import numpy as np
from PIL import Image

SIDE = 256
# Below this threshold a pixel is "subject". The background of studio references
# is bright; with a dark background the silhouette cannot be told apart, and we
# say so instead of returning a number that merely looks like a measurement.
SUBJECT_THRESHOLD = 200
BANDS = 8


def _measure(path: str) -> dict:
    img = Image.open(path).convert("L").resize((SIDE, SIDE))
    a = np.asarray(img, dtype=float)
    subject = a < SUBJECT_THRESHOLD

    border = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    bright_background = float(np.mean(border > 225) * 100)
    area = float(subject.mean())

    # When the whole image falls below the threshold there is no silhouette left
    # to measure: it is all "subject". The measurements stay coherent but stop
    # telling one degradation from a worse one, so we declare it instead of
    # returning numbers that look like they still discriminate.
    saturated = bool(area > 0.98 or area < 0.02)

    rows = np.where(subject.mean(axis=1) > 0.05)[0]
    if len(rows) < BANDS:
        # No readable silhouette: a ratio computed over four pixels would be a
        # number, not a measurement.
        return {
            "background": round(bright_background, 1),
            "area": round(area, 3),
            "light": None,
            "saturated": saturated,
        }

    box = a[rows[0] : rows[-1] + 1]
    mask = subject[rows[0] : rows[-1] + 1]
    h, w = box.shape
    vertical, horizontal = [], []
    for i in range(BANDS):
        band = mask[i * h // BANDS : (i + 1) * h // BANDS]
        pixels = box[i * h // BANDS : (i + 1) * h // BANDS][band]
        if pixels.size:
            vertical.append(pixels.mean())
        column = mask[:, i * w // BANDS : (i + 1) * w // BANDS]
        pixels = box[:, i * w // BANDS : (i + 1) * w // BANDS][column]
        if pixels.size:
            horizontal.append(pixels.mean())
    if len(vertical) < 2 or len(horizontal) < 2:
        return {
            "background": round(bright_background, 1),
            "area": round(area, 3),
            "light": None,
            "saturated": saturated,
        }

    horizontal_amplitude = max(horizontal) - min(horizontal)
    # A perfectly flat horizontal would divide by zero: we clamp from below
    # instead of returning infinity, which would say nothing on the page.
    light = (max(vertical) - min(vertical)) / max(horizontal_amplitude, 1.0)
    return {
        "background": round(bright_background, 1),
        "area": round(area, 3),
        "light": round(light, 1),
        "saturated": saturated,
    }


def compare(variant: str, reference: str) -> dict:
    v = _measure(variant)
    r = _measure(reference)
    gaps = {
        "background": round(abs(v["background"] - r["background"]), 1),
        "area": round(abs(v["area"] - r["area"]), 3),
        "light": None
        if v["light"] is None or r["light"] is None
        else round(abs(v["light"] - r["light"]), 1),
    }
    # A single distance for ordering variants. The weights make quantities with
    # different scales comparable: 0.05 of area and 15 points of background
    # weigh the same, which is roughly how alike they look to the eye.
    distance = gaps["background"] / 50 + gaps["area"] * 3
    if gaps["light"] is not None:
        distance += gaps["light"] / 2
    return {
        "variant": v,
        "reference": r,
        "gaps": gaps,
        "distance": round(distance, 2),
        # Past saturation the distance is a lower bound: the variant is at least
        # this far, maybe further. Saying so avoids reading as "identical" two
        # images the metric can no longer separate.
        "saturated": bool(v.get("saturated") or r.get("saturated")),
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "usage: ref_match.py <variant> <reference>"}))
        sys.exit(1)
    try:
        print(json.dumps(compare(sys.argv[1], sys.argv[2])))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
