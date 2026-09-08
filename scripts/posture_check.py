#!/usr/bin/env python3
"""
La postura, misurata sulla sagoma invece che raccontata.

PERCHE'. Il prompt di questo progetto non ha MAI detto niente sulla posa: in 84
render generati, "spalle indietro", "eretto" e "schiena" compaiono zero volte.
Dice pero', dalla v54 alla v94 (39 versioni di fila), "Spalle strette e CADENTI,
niente trapezi": una descrizione della CORPORATURA — nata ad agosto per togliere
il "chad" — che il modello non ha modo di distinguere da una POSA. E' l'unica
istruzione di postura mai data, ed e' quella sbagliata. Questo script serve a
non doverci credere sulla parola, ne' prima ne' dopo.

I DUE NUMERI.

  spalla sx/dx   gradi sotto l'orizzontale della LINEA DELLA SPALLA. Bassi =
                 spalle squadrate e aperte; alti = cadenti. La media conta meno
                 dei due valori separati: se sono molto diversi il corpo e' di
                 tre quarti, non storto.
  spalle         ampiezza max in frazione della larghezza dell'immagine. Va
                 tenuta d'occhio MENTRE l'angolo scende: se scendono insieme
                 all'angolo, "raddrizzare" ha allargato, cioe' e' rientrato il
                 "chad" che si combatte da agosto.

COME. Il punto fermo e' il viso, non una strozzatura indovinata: il riquadro
arriva da `moondream --detect face`, lo stesso detector con cui si ritagliano
gli avatar. Da li' si conoscono mento, centro e larghezza della testa. Il
soggetto si stacca dal fondale stimando il fondo RIGA PER RIGA dai margini
laterali (il fondale e' un gradiente verticale). Poi, per ogni colonna dal collo
verso l'esterno, si prende la prima riga di soggetto: quello e' il profilo della
spalla, e la sua pendenza e' la postura. Le colonne entro 0,45 larghezze-viso
dal centro sono collo e si saltano.

LIMITE, dichiarato. Serve un fondale continuo: sulle foto RAW, con la stanza
dietro, la sagoma non si stacca e il numero non vale — lo script lo dice invece
di stampare un numero inventato. Il termine di paragone e' percio' il ritratto
di riferimento dell'utente (fondale da studio), non i suoi RAW.

Uso: python3 scripts/posture_check.py IMG [IMG...] [--soglia 40]
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W = 512  # tutto si misura a questa larghezza: i numeri restano confrontabili
MOONDREAM = os.environ.get("MOONDREAM_BIN", "/Users/zorahrel/bin/moondream")


def face_box(path: Path) -> dict:
    """Riquadro del viso in coordinate 0-1 (lo stesso detector degli avatar)."""
    small = Path("/tmp") / f"posture_{path.stem}.jpg"
    im = Image.open(path).convert("RGB")
    im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS).save(small, "JPEG", quality=88)
    out = subprocess.run([MOONDREAM, str(small), "--detect", "face"],
                         capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise ValueError(f"detector fallito: {out.stderr.strip()[:80]}")
    start = out.stdout.find("{")
    objs = json.loads(out.stdout[start:]).get("objects") or []
    if not objs:
        raise ValueError("nessun viso trovato")
    return max(objs, key=lambda o: (o["x_max"] - o["x_min"]) * (o["y_max"] - o["y_min"]))


def sagoma(img: Image.Image, soglia: float) -> np.ndarray:
    """Maschera booleana del soggetto: fondo stimato riga per riga dai margini."""
    a = np.asarray(img.convert("RGB").resize((W, int(W * img.height / img.width))), float)
    m = max(4, int(W * 0.04))
    bg = np.median(np.concatenate([a[:, :m], a[:, -m:]], axis=1), axis=1)
    # dove i due margini non concordano il soggetto tocca il bordo: li' la stima
    # del fondo si eredita dalle righe pulite subito sopra
    disc = np.linalg.norm(np.median(a[:, :m], 1) - np.median(a[:, -m:], 1), axis=1)
    sporche = disc > soglia
    for y in np.nonzero(sporche)[0]:
        lo = max(0, y - 15)
        pulite = ~sporche[lo:y]
        if pulite.any():
            bg[y] = np.median(bg[lo:y][pulite], axis=0)
    return np.linalg.norm(a - bg[:, None, :], axis=2) > soglia


def spalla(mask: np.ndarray, x_dal: int, x_al: int, verso: int, y_min: int, y_max: int):
    """
    Pendenza in gradi del profilo superiore fra due colonne.

    Ritorna anche quante colonne l'hanno sostenuta: sotto una decina il numero
    non e' una misura, e chi legge deve saperlo.
    """
    xs, ys = [], []
    for x in range(x_dal, x_al, verso):
        if not (0 <= x < mask.shape[1]):
            break
        col = np.nonzero(mask[:, x])[0]
        # La spalla e' il primo soggetto SOTTO IL MENTO. Senza questo taglio la
        # colonna incontra prima i capelli — che sono piu' larghi del riquadro
        # del viso — e la retta misura la caduta della chioma, non la spalla:
        # e' cosi' che una prima versione dava 66 gradi sul ritratto di
        # riferimento, cioe' un numero impossibile per una spalla.
        col = col[(col >= y_min) & (col <= y_max)]
        if col.size:
            xs.append(x)
            ys.append(col[0])
    if len(xs) < 10:
        return float("nan"), len(xs)
    m = np.polyfit(np.array(xs, float), np.array(ys, float), 1)[0]
    return float(np.degrees(np.arctan(abs(m)))), len(xs)


def misura(path: Path, soglia: float) -> dict:
    img = Image.open(path)
    box = face_box(path)
    mask = sagoma(img, soglia)
    h = mask.shape[0]
    cx = (box["x_min"] + box["x_max"]) / 2 * W
    fw = (box["x_max"] - box["x_min"]) * W
    mento = box["y_max"] * h
    # la spalla vive sotto il mento e finisce entro una testa e mezza: piu' giu'
    # c'e' il braccio, che e' verticale e falserebbe la retta
    y_max = int(min(h - 1, mento + 1.5 * fw))
    L, R = [], []
    for y in range(h):
        xs = np.nonzero(mask[y])[0]
        if xs.size > W * 0.02:
            L.append(xs[0]); R.append(xs[-1])
    if not L:
        raise ValueError("sagoma assente: fondale non continuo?")
    collo = 0.45 * fw  # entro questa distanza dal centro e' collo, non spalla
    a_sx, n_sx = spalla(mask, int(cx - collo), int(min(L)), -1, int(mento), y_max)
    a_dx, n_dx = spalla(mask, int(cx + collo), int(max(R)), +1, int(mento), y_max)
    larg = (max(R) - min(L)) / W
    return {"sx": a_sx, "dx": a_dx, "n": min(n_sx, n_dx), "spalle": larg}


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    soglia = 40.0
    if "--soglia" in sys.argv:
        soglia = float(sys.argv[sys.argv.index("--soglia") + 1])
    if not args:
        print(__doc__)
        return 2
    print(f"{'file':34} {'spalla sx':>10} {'spalla dx':>10} {'media':>7} {'spalle':>7}  note")
    for p in args:
        path = Path(p)
        try:
            r = misura(path, soglia)
        except Exception as e:
            print(f"{path.name[:34]:34} {'—':>10} {'—':>10} {'—':>7} {'—':>7}  {e}")
            continue
        media = np.nanmean([r["sx"], r["dx"]])
        nota = "" if r["n"] >= 25 else f"appoggiata su {r['n']} colonne: debole"
        print(f"{path.name[:34]:34} {r['sx']:10.1f} {r['dx']:10.1f} {media:7.1f} {r['spalle']:7.2f}  {nota}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
