"""Innesta un ritocco locale della coda sulla scena e tiene le piume dentro il quadro.

Due passi, entrambi su immagini 1672x941 nella cartella corrente (base284.png = scena di partenza):
  1. python3 scripts/kaumat_coda_innesta.py innesta <prefisso> <n>   -> v_<prefisso><n>.png
     Prende <prefisso><n>.png (il ritaglio ritoccato, box 860,380,1672,941), lo rimette sulla base
     solo dove e' davvero cambiato e fuori dalla zona della coda (x>=225, y>=40 del ritaglio) non
     tocca nessun pixel: gambe, piedi e corpo restano quelli della base.
  2. python3 scripts/kaumat_coda_innesta.py stringi <prefisso> <n>   -> w_<prefisso><n>.png
     Comprime di 0.876 in orizzontale la zona a destra di x=1300, cosi' la punta piu estesa delle
     piume finisce a x=1625 (circa 46 px dal bordo) invece di toccarlo.
Limite: i numeri (box, x=1300, x=1625, punto O) sono quelli della v284 e vanno rivisti per altre basi.
"""
import sys
if sys.argv[1] == "innesta":
    from PIL import Image, ImageFilter
    import numpy as np, sys
    pref,n=sys.argv[2],sys.argv[3]
    base=Image.open('base284.png').convert('RGB'); W,H=base.size
    box=(860,380,1672,941); cw,ch=box[2]-box[0],box[3]-box[1]
    orig=np.array(base.crop(box),float)
    new=np.array(Image.open(f'{pref}{n}.png').convert('RGB').resize((cw,ch),Image.LANCZOS),float)
    diff=np.abs(orig-new).max(axis=2)
    dm=Image.fromarray((diff>16).astype(np.uint8)*255).filter(ImageFilter.MaxFilter(25)).filter(ImageFilter.GaussianBlur(9))
    dm=np.array(dm,float)/255
    yy,xx=np.mgrid[0:ch,0:cw]
    rect=np.clip((xx-225)/35.0,0,1)*np.clip((yy-40)/35.0,0,1)
    m=(dm*rect)[...,None]
    res=np.array(base,float); res[box[1]:box[3],box[0]:box[2]]=orig*(1-m)+new*m
    out=np.clip(res,0,255).astype(np.uint8); Image.fromarray(out).save(f'v_{pref}{n}.png')
    b=np.array(base,float); chg=np.abs(out.astype(float)-b).max(axis=2)
    fuori=np.ones((H,W),bool); fuori[box[1]+40:box[3],box[0]+225:box[2]]=False
    # ciuffo: distanza massima dei pixel davvero cambiati dal punto dove iniziano le piume nella v284
    O=(1295,810)
    ys,xs=np.where(chg>40)
    dist=np.hypot(xs-O[0],ys-O[1])
    print(f'{pref}{n}: cambiati {round(100*(chg>16).mean(),1)}% | fuori zona {int((chg[fuori]>16).sum())} px | ciuffo: punta piu lontana a {int(dist.max())} px da O (v284: ~230) -> x{round(dist.max()/230,2)} | margine dx {W-1-xs.max()} px, margine basso {H-1-ys.max()} px, punta piu alta y={ys.min()}')
elif sys.argv[1] == "stringi":
    from PIL import Image
    import numpy as np, sys
    pref,n=sys.argv[2],sys.argv[3]
    C=np.array(Image.open(f'v_{pref}{n}.png').convert('RGB'),float)
    B=np.array(Image.open('base284.png').convert('RGB'),float); H,W=B.shape[:2]
    xa,xt=1300,1625            # da xa in poi si comprime; la punta piu' estesa finisce a xt
    k=(xt-xa)/(W-1-xa)
    out=C.copy()
    xs=np.arange(xa,xt+1); src=xa+(xs-xa)/k
    i0=np.floor(src).astype(int).clip(0,W-1); i1=np.minimum(i0+1,W-1); f=(src-i0)[None,:,None]
    out[:,xa:xt+1,:]=C[:,i0,:]*(1-f)+C[:,i1,:]*f
    # oltre xt: sfondo originale della v284 (li' non ci sono piume), sfumato su 30 px
    w=np.clip((np.arange(xt+1,W)-xt)/30.0,0,1)[None,:,None]
    out[:,xt+1:,:]=out[:,xt:xt+1,:]*(1-w)+B[:,xt+1:,:]*w
    res=np.clip(out,0,255).astype(np.uint8); Image.fromarray(res).save(f'w_{pref}{n}.png')
    chg=np.abs(res.astype(float)-B).max(axis=2); ys,xx=np.where(chg>40)
    O=(1295,810); d=np.hypot(xx-O[0],ys-O[1])
    print(f'{pref}{n}: compressione x{round(k,3)} | punta piu lontana a {int(d.max())} px da O -> x{round(d.max()/230,2)} | margine dx {W-1-xx.max()} px, basso {H-1-ys.max()} px')
