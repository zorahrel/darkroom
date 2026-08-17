#!/usr/bin/env python3
"""match_set.py — armonizza cromaticamente le foto di uno stesso post.

È il "Match Color" di Photoshop, applicato a un gruppo invece che a una coppia:
color transfer statistico in spazio Lab (Reinhard et al., 2001).

## Perché in Lab, e perché solo la crominanza

Il primo tentativo allineava anche la luminanza, ed era sbagliato: dentro un
post ci sono un cervo al sole e un interno in ombra, e forzarli alla stessa
luminanza media li appiattisce entrambi senza avvicinarli davvero. La luce
DIVERSA è informazione, la dominante diversa è un difetto.

Lab separa esattamente questi due aspetti:
  L  = luminanza      → si lascia stare (la scena è quella che è)
  a  = verde↔magenta  → si allinea (è qui che vive la dominante)
  b  = blu↔giallo     → si allinea (idem)

Per ogni canale cromatico si porta media e deviazione standard di ogni foto
verso quelle del gruppo. La deviazione conta quanto la media: due foto possono
avere lo stesso colore medio ma una avere colori tesi e l'altra slavati, e nel
carosello si nota.

## Robustezza

Il bersaglio è la MEDIANA delle statistiche, non la media: una singola foto con
una dominante forte non deve trascinare tutto il gruppo verso di sé.

`strength` (0..1) dosa quanto avvicinarsi: 1 = tutte identiche in tinta, che è
troppo, perché anche il soggetto perde carattere. Il default 0.75 toglie la
deriva lasciando la personalità.

Input  (stdin JSON): {"groups": [{"name","items":[{"id","path"}]}], "strength": 0.75}
Output (stdout JSON): {"<id>": {"a_shift","b_shift","a_scale","b_scale"}, ...}
"""
import json
import sys

import numpy as np
from PIL import Image, ImageOps

# Limiti: uno spostamento oltre questi non è più armonizzazione, è viraggio.
# In Lab, a/b vanno circa da -128 a +127; 12 punti sono già una correzione
# visibile e sufficiente per la deriva che introduce l'edit AI.
MAX_SHIFT = 12.0
MIN_SCALE, MAX_SCALE = 0.80, 1.25


def srgb_to_lab(rgb):
    """sRGB 0..255 → CIE Lab. Implementato a mano: numpy e Pillow bastano, e
    aggiungere opencv/skimage per una conversione di dieci righe è peso inutile."""
    a = rgb / 255.0
    # linearizzazione sRGB
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]], np.float32)
    xyz = lin @ m.T
    # bianco di riferimento D65
    xyz = xyz / np.array([0.95047, 1.0, 1.08883], np.float32)
    e, k = 216 / 24389, 24389 / 27
    f = np.where(xyz > e, np.cbrt(np.clip(xyz, 1e-9, None)), (k * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    A = 500 * (f[..., 0] - f[..., 1])
    B = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, A, B], -1)


def measure(path):
    """Statistiche cromatiche: media e deviazione di a e b sui pixel che contano.

    Si escludono le zone quasi nere e quasi bianche: lì la crominanza è rumore o
    è tagliata, e includerla sposta il bersaglio senza motivo."""
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    im.thumbnail((480, 480))
    lab = srgb_to_lab(np.asarray(im, np.float32))
    L = lab[..., 0]
    m = (L > 12) & (L < 94)
    if m.sum() < 500:
        m = np.ones_like(L, bool)
    a, b = lab[..., 1][m], lab[..., 2][m]
    return {
        "a_mean": float(a.mean()), "a_std": float(a.std()),
        "b_mean": float(b.mean()), "b_std": float(b.std()),
    }


def main():
    req = json.load(sys.stdin)
    strength = float(req.get("strength", 0.75))
    out = {}

    for group in req.get("groups", []):
        items = group.get("items", [])
        if len(items) < 2:
            continue

        stats = {}
        for it in items:
            try:
                stats[it["id"]] = measure(it["path"])
            except Exception as e:  # una foto illeggibile non ferma il gruppo
                print(f"skip {it.get('id')}: {e}", file=sys.stderr)
        if len(stats) < 2:
            continue

        # Bersaglio = mediana del gruppo, robusta all'outlier.
        tgt = {k: float(np.median([s[k] for s in stats.values()])) for k in
               ("a_mean", "a_std", "b_mean", "b_std")}

        for pid, s in stats.items():
            # Scala: quanto "tendere" la crominanza. Dosata da strength.
            a_scale = 1.0 + (tgt["a_std"] / max(s["a_std"], 1e-3) - 1.0) * strength
            b_scale = 1.0 + (tgt["b_std"] / max(s["b_std"], 1e-3) - 1.0) * strength
            a_scale = float(np.clip(a_scale, MIN_SCALE, MAX_SCALE))
            b_scale = float(np.clip(b_scale, MIN_SCALE, MAX_SCALE))
            # Spostamento: calcolato DOPO la scala, perché scalare attorno a zero
            # muove già la media.
            a_shift = float(np.clip((tgt["a_mean"] - s["a_mean"] * a_scale) * strength,
                                    -MAX_SHIFT, MAX_SHIFT))
            b_shift = float(np.clip((tgt["b_mean"] - s["b_mean"] * b_scale) * strength,
                                    -MAX_SHIFT, MAX_SHIFT))
            out[pid] = {
                "a_shift": round(a_shift, 3), "b_shift": round(b_shift, 3),
                "a_scale": round(a_scale, 4), "b_scale": round(b_scale, 4),
            }

    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
