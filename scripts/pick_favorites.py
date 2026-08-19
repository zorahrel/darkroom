"""Sceglie la versione preferita per le foto dei post che non ne hanno una.

Perche' serve: senza una preferita, il post mostra "l'ultima versione", che
cambia da sola al prossimo rigenero. Un render buono puo' sparire senza che
nessuno se ne accorga — e' esattamente il "perdersi le cose" da evitare.
Fissare la preferita congela la scelta; resta modificabile a mano in un click.

Come sceglie: fra le ultime versioni di ogni foto prende quella che misura
meglio sul file SERVITO (grading applicato, cioe' quello che si vede davvero).
Penalizza i difetti che abbiamo visto emergere su questo set:
  - ambra sul soggetto illuminato, solo per gli scatti notturni;
  - highlight bruciati (dettaglio perso, non recuperabile);
  - immagine piatta (nessun contrasto).
A parita' di punteggio vince la piu' recente, che incorpora i fix piu' nuovi
del prompt.

Non tocca le foto che hanno gia' una preferita: quella e' una scelta umana.
"""
import datetime
import io
import json
import os
import sqlite3
import sys
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

BASE = "http://127.0.0.1:3535"
ULTIME_N = 3


def graded(photo_id: str, image_path: str):
    fn = os.path.basename(image_path)
    url = f"{BASE}/graded/{urllib.parse.quote(photo_id)}/{urllib.parse.quote(fn)}?w=600"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read()
        if len(data) < 2000:
            return None
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None


def penalita(im, notte: bool) -> float:
    a = np.asarray(im).astype(float)
    L = a.mean(2)
    lit = a[L > np.percentile(L, 88)]
    R, G, B = (lit[:, i].mean() for i in range(3))
    ambra = (R + G) / 2 - B
    bruciato = float((a.min(2) >= 254).mean() * 100)
    piattezza = float(L.std())

    p = 0.0
    # Soglia tarata sui giudizi reali: +23 era "ancora troppo gialla", +17
    # "ottimo". Vedi scripts/audit_set.py per la tabella completa.
    if notte and ambra > 20:
        p += (ambra - 20) * 2
    if bruciato > 1.0:
        p += (bruciato - 1.0) * 10
    if piattezza < 28:
        p += (28 - piattezza) * 3
    return p


def main() -> int:
    dry = "--apply" not in sys.argv
    db = sqlite3.connect("photos.db")
    rows = db.execute(
        """
        select distinct p.id, p.taken_at
        from photos p join collection_photos cp on cp.photo_id = p.id
        where p.favorite_version_id is null and p.skipped = 0
        order by p.id
        """
    ).fetchall()

    scelte = []
    for pid, taken in rows:
        vers = db.execute(
            "select id, version_number, image_path from versions where photo_id = ?"
            " order by id desc limit ?",
            (pid, ULTIME_N),
        ).fetchall()
        vers = [v for v in vers if v[2] and os.path.exists(v[2])]
        if not vers:
            print(f"  {pid:42s} nessun render — salto")
            continue
        ora = datetime.datetime.fromtimestamp(taken / 1000).hour if taken else None
        notte = ora is not None and (ora >= 18 or ora < 6)

        migliore = None
        for vid, vnum, path in vers:          # gia' dalla piu' recente
            im = graded(pid, path)
            if im is None:
                continue
            p = penalita(im, notte)
            if migliore is None or p < migliore[2] - 1e-9:
                migliore = (vid, vnum, p)
        if migliore is None:
            print(f"  {pid:42s} graded non servito — salto")
            continue
        scelte.append((pid, migliore[0], migliore[1], migliore[2]))
        print(f"  {pid:42s} -> v{migliore[1]:<4d} penalita={migliore[2]:6.1f}")

    print(f"\nfoto senza preferita: {len(rows)}   scelte: {len(scelte)}")
    if dry:
        print("(prova a vuoto — rilancia con --apply per scrivere)")
        return 0

    for pid, vid, _vnum, _p in scelte:
        req = urllib.request.Request(
            f"{BASE}/api/photos/{urllib.parse.quote(pid)}/favorite",
            data=json.dumps({"version_id": vid}).encode(),
            headers={"content-type": "application/json"},
            method="PUT",
        )
        urllib.request.urlopen(req).read()
    print(f"preferite impostate: {len(scelte)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
