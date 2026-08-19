"""Audit del set: cerca i difetti REALI sui render, misurandoli.

Le euristiche precedenti erano fragili e hanno prodotto falsi allarmi (contavano
pixel chiari sul bordo e chiamavano "tagliato" un soggetto intero). Qui si
misurano solo cose che hanno una definizione precisa e una soglia tarata su casi
gia' verificati a occhio:

  ambra    : dominante gialla sul SOGGETTO ILLUMINATO (non sulla media del
             frame, che su un notturno e' fredda per via del cielo e nasconde
             il problema). Tarato su IMG_2906 v83 (+45 = ambra evidente) e
             19A084A4 (+50). Sotto +25 nessuno si e' mai lamentato.
  bruciato : percentuale di pixel a 255 su tutti e tre i canali — dettaglio
             perso per sempre, non recuperabile in grading.
  piatto   : deviazione standard della luminanza molto bassa = immagine morta.
  mancante : la foto non ha nemmeno un render.

Il colore si misura sul file SERVITO (/graded), non sul PNG grezzo: e' quello
che si vede nella dashboard e nel post, ed e' cio' che conta.
"""
import os
import sqlite3
import sys
import urllib.parse
import urllib.request

import io

import numpy as np
from PIL import Image

DB = "photos.db"
BASE = "http://127.0.0.1:3535"
AMBRA_SOGLIA = 25.0
BRUCIATO_SOGLIA = 1.0   # % di pixel completamente bianchi
PIATTO_SOGLIA = 28.0    # std della luminanza


def graded(photo_id: str, image_path: str) -> "Image.Image | None":
    """Scarica la versione servita dalla dashboard (grading applicato)."""
    fn = os.path.basename(image_path)
    url = f"{BASE}/graded/{urllib.parse.quote(photo_id)}/{urllib.parse.quote(fn)}?w=700"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
        if len(data) < 2000:
            return None
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None


def misura(im: "Image.Image") -> dict:
    a = np.asarray(im).astype(float)
    L = a.mean(2)
    lit = a[L > np.percentile(L, 88)]          # le superfici illuminate
    R, G, B = (lit[:, i].mean() for i in range(3))
    bianchi = float((a.min(2) >= 254).mean() * 100)
    return {
        "ambra": float((R + G) / 2 - B),
        "bruciato": bianchi,
        "piattezza": float(L.std()),
    }


def main() -> int:
    db = sqlite3.connect(DB)
    rows = db.execute(
        """
        select p.id, p.taken_at, p.skipped,
               (select v.image_path from versions v
                 where v.photo_id = p.id
                 order by (v.id = p.favorite_version_id) desc, v.id desc limit 1)
        from photos p
        where exists (select 1 from collection_photos cp where cp.photo_id = p.id)
        order by p.id
        """
    ).fetchall()

    problemi = []
    for pid, taken, skipped, path in rows:
        if skipped:
            continue
        if not path or not os.path.exists(path):
            problemi.append((pid, "nessun render", 0.0))
            continue
        im = graded(pid, path)
        if im is None:
            problemi.append((pid, "graded non servito", 0.0))
            continue
        m = misura(im)
        ora = None
        if taken:
            import datetime
            ora = datetime.datetime.fromtimestamp(taken / 1000).hour
        notte = ora is not None and (ora >= 18 or ora < 6)
        if notte and m["ambra"] > AMBRA_SOGLIA:
            problemi.append((pid, "ambra sul soggetto", m["ambra"]))
        if m["bruciato"] > BRUCIATO_SOGLIA:
            problemi.append((pid, "highlight bruciati", m["bruciato"]))
        if m["piattezza"] < PIATTO_SOGLIA:
            problemi.append((pid, "immagine piatta", m["piattezza"]))

    print(f"foto nei post analizzate: {len(rows)}")
    print(f"problemi trovati: {len(problemi)}\n")
    for pid, why, val in sorted(problemi, key=lambda x: -x[2]):
        print(f"  {pid:42s} {why:22s} {val:6.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
