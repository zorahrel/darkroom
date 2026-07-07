#!/usr/bin/env python3
"""Scene white-balance match.

Given scene groups (shots of the same scene), compute for each shot a fixed
per-channel gain that pulls its neutral mean onto the group's shared neutral
target. Applying an identical target to every member removes the white-balance
drift that the GPT edit introduces between near-identical shots — deterministic,
content-robust (it only scales channels, never transfers content statistics).

Input  (stdin JSON): {"groups": [[{"id","path"}, ...], ...]}
Output (stdout JSON): {"<id>": [gr, gg, gb], ...}   # only for groups of >= 2

Singletons are omitted (no group ⇒ keep per-image AWB downstream).
"""
import sys
import json
import numpy as np
from PIL import Image, ImageOps

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
CLAMP_LO, CLAMP_HI = 0.80, 1.25  # keep the correction gentle, never extreme


def neutral_mean(path):
    """Mean RGB of the near-neutral mid-tone pixels — the WB signature."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((520, 520))
    a = np.asarray(im, np.float32)
    luma = (a * LUMA).sum(-1)
    mx = a.max(-1)
    mn = a.min(-1)
    sat = (mx - mn) / np.clip(mx, 1, None)
    m = (luma > 45) & (luma < 215) & (sat < 0.18)
    if m.sum() < 300:
        m = (luma > 35) & (luma < 225)
    if m.sum() < 50:
        return a.reshape(-1, 3).mean(0)
    return a[m].reshape(-1, 3).mean(0)


def main():
    req = json.load(sys.stdin)
    out = {}
    for group in req.get("groups", []):
        if len(group) < 2:
            continue
        means = {}
        for item in group:
            try:
                means[item["id"]] = neutral_mean(item["path"])
            except Exception:
                pass
        if len(means) < 2:
            continue
        target = np.mean(list(means.values()), axis=0)  # shared neutral target
        for pid, nm in means.items():
            gain = np.clip(target / np.clip(nm, 1, None), CLAMP_LO, CLAMP_HI)
            out[pid] = [round(float(x), 4) for x in gain]
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
