"""Audit del set: cerca i difetti REALI sui render, misurandoli.

Le euristiche precedenti erano fragili e hanno prodotto falsi allarmi (contavano
pixel chiari sul bordo e chiamavano "tagliato" un soggetto intero). Qui si
misurano solo cose che hanno una definizione precisa e una soglia tarata su casi
gia' verificati a occhio:

  ambra    : dominante gialla sul SOGGETTO ILLUMINATO (non sulla media del
             frame, che su un notturno e' fredda per via del cielo e nasconde
             il problema). La soglia NON e' inventata: e' tarata sui giudizi
             espressi davvero su questo set —
               v80 = +74.7  "troppo gialla"          (rifiutata)
               v83 = +23.0  "ancora troppo gialla"   (rifiutata)
               v93 = +16.8  "ottimo"                 (accettata)
             quindi il confine sta fra 17 e 23: 20 e' il punto medio. La prima
             soglia era 25 e avrebbe promosso proprio la v83 gia' bocciata.
             Nota: NON si confronta con l'originale. Provato due volte, e due
             volte era sbagliato: il confronto mette a paragone il file GRADED
             (raffreddato dalla pipeline) con lo scatto originale (caldo di
             lampade), che sono scale diverse. Su 19A084A4 l'originale misura
             +114 e ogni render sta sotto: la differenza e' quasi sempre
             negativa e non discrimina niente. Misurato: con quel filtro la
             prova del veleno passava da 3/3 a 1/3.
             Il motivo originario resta valido: Sembrava piu' onesto
             ("segnala solo se il render e' piu' caldo dello scatto"), ma gli
             originali di questo set sono tutti molto piu' caldi dei render
             (+114 contro +77 su 19A084A4), quindi la regola non sarebbe mai
             scattata: un audit che non trova nulla per costruzione. Verificato
             rimettendo come preferita una versione gia' bocciata a occhio —
             passava liscia. La soglia assoluta invece la ripesca.
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
# La porta segue il servizio: 3535 era un secondo launchd duplicato, rimosso.
# Sovrascrivibile con DARKROOM_URL per non ritrovarsi un audit che fallisce
# tutto in silenzio solo perche' il server sta altrove.
BASE = os.environ.get("DARKROOM_URL", "http://127.0.0.1:3737")
AMBRA_SOGLIA = 20.0

# Scene la cui luce E' davvero arancione: la dominante e' il soggetto, non un
# difetto del render. Silenziarle una per una e con una motivazione e' meglio
# di una regola generica: una regola che le copre tutte copre anche i difetti
# veri (provato: confrontare col proprio originale rendeva l'audit cieco).
# Verificate a occhio + descrizione dell'originale.
AMBRA_ACCETTATA = {
    "IMG_2913": "vetrina di coltelli sotto lampade arancioni (originale +86)",
    "IMG_2928": "muro di ema illuminato a lanterne (originale +30)",
    "IMG_2726": "interno a luce calda (originale +31)",
    # Emersa dopo il fix del NaN, esattamente sulla soglia (20.0): e' la carne
    # alla griglia sotto lampade calde, originale +61.6 e il render l'ha gia'
    # dimezzata a +30 in grezza. Raffreddarla ancora significherebbe spegnere
    # il piatto, che e' il soggetto del post "Mangiare al banco".
    "IMG_2953": "carne alla griglia sotto lampade calde (originale +61.6)",
}
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
    # ">" stretto su un'immagine uniforme non seleziona NULLA (tutti i valori
    # coincidono col percentile): la media di un array vuoto e' NaN, e un NaN
    # fallisce in silenzio ogni confronto — il difetto passerebbe inosservato
    # proprio nel caso piu' degenere. ">=" garantisce almeno un pixel.
    soglia = np.percentile(L, 88)
    lit = a[L >= soglia]
    if lit.size == 0:                      # cintura di sicurezza
        lit = a.reshape(-1, a.shape[2])
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
        if notte and m["ambra"] > AMBRA_SOGLIA and pid not in AMBRA_ACCETTATA:
            problemi.append((pid, "ambra sul soggetto", m["ambra"]))
        if m["bruciato"] > BRUCIATO_SOGLIA:
            problemi.append((pid, "highlight bruciati", m["bruciato"]))
        if m["piattezza"] < PIATTO_SOGLIA:
            problemi.append((pid, "immagine piatta", m["piattezza"]))

    print(f"foto nei post analizzate: {len(rows)}")
    if AMBRA_ACCETTATA:
        print(f"ambra accettata (scena realmente calda): {len(AMBRA_ACCETTATA)}")
    print(f"problemi trovati: {len(problemi)}\n")
    for pid, why, val in sorted(problemi, key=lambda x: -x[2]):
        print(f"  {pid:42s} {why:22s} {val:6.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
