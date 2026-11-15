"""Somiglianza del viso con ArcFace (insightface, modello buffalo_l), la stessa misura
dei benchmark di identita'.

L'ancora e' la media degli embedding delle foto vere evidenziate in Darkroom
(tabella reference_pick del progetto profilo). Per dare un metro, stampa anche la
somiglianza di ogni foto vera con l'ancora fatta dalle ALTRE quattro: e' quanto
somiglia Attilio a se stesso fra un selfie e l'altro. Un'immagine generata sotto
quella fascia non e' lui.

  ~/.venvs/arcface/bin/python scripts/somiglianza.py IMG [IMG ...]
"""
import os, sys, sqlite3
import numpy as np, cv2
from insightface.app import FaceAnalysis

P = os.path.expanduser("~/Darkroom/projects/profilo")
app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
app.prepare(ctx_id=-1, det_size=(640, 640))


def emb(path):
    img = cv2.imread(path)
    if img is None:
        return None
    faces = app.get(img)
    if not faces:
        return None
    f = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    return f.normed_embedding


def norm(v):
    return v / np.linalg.norm(v)


vere = [r[0] for r in sqlite3.connect(f"{P}/photos.db").execute("SELECT file FROM reference_pick ORDER BY file")]
E = {f: emb(f"{P}/data/refs/{f}") for f in vere}
E = {f: e for f, e in E.items() if e is not None}
ancora = norm(np.mean(list(E.values()), axis=0))

print("metro (ogni foto vera contro le altre):")
for f, e in E.items():
    altre = norm(np.mean([v for k, v in E.items() if k != f], axis=0))
    print(f"  {float(e @ altre):.3f}  {f}")

# --tutti: un face sheet ha piu' visi, ognuno va misurato (righe dall'alto, poi da sinistra)
if sys.argv[1:2] == ["--tutti"]:
    for path in sys.argv[2:]:
        fs = app.get(cv2.imread(path))
        fs.sort(key=lambda f: (round(f.bbox[1] / 300), f.bbox[0]))
        print(path, " ".join(f"{float(f.normed_embedding @ ancora):.3f}" for f in fs) or "nessun viso")
    sys.exit(0)

for path in sys.argv[1:]:
    e = emb(path)
    print(f"{'nessun viso' if e is None else f'{float(e @ ancora):.3f}'}  {path}")
