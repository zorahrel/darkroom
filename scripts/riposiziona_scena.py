"""Riposiziona la creatura in una scena 16:9 come nel riferimento, senza rigenerarla.

Uso: python3 scripts/riposiziona_scena.py <x_testa>   (default 0.34)
Legge base281.png nella cartella corrente e scrive comp.png (stessa dimensione).

La creatura viene rimpicciolita e spostata: la testa va a <x_testa> della larghezza,
la punta della coda a 0.91, i piedi a 0.91 dell'altezza. Il vuoto che si apre a sinistra
e in alto e' riempito con uno specchio ripetuto della fascia pulita del fondo, sfocato e
scurito verso il bordo (una vignettatura), cosi' nessun pixel della creatura cambia.

I limiti della creatura (bx0, bx1, by0, by1) sono letti a occhio sul quadro, in frazioni:
vanno rivisti per ogni base. A sinistra si vede una leggera righettatura verticale.
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, sys
im=Image.open('base281.png').convert('RGB'); W,H=im.size
# limiti della creatura letti a occhio (frazioni del quadro)
bx0,bx1,by0,by1=0.17,0.845,0.08,0.87
# bersaglio come nel riferimento
tx0,tx1,ty1=float(sys.argv[1]) if len(sys.argv)>1 else 0.34, 0.91, 0.91
s=(tx1-tx0)/(bx1-bx0)
offx=int(round(tx0*W - s*bx0*W)); offy=int(round(ty1*H - s*by1*H))
sw,sh=int(round(W*s)),int(round(H*s))
sc=np.array(im.resize((sw,sh),Image.LANCZOS),float)
print('scala',round(s,3),'offset',offx,offy,'immagine scalata',sw,sh,'bordo dx',offx+sw,'bordo basso',offy+sh)
def mirror_idx(n,period):
    i=np.arange(n); m=i%(2*period); return np.where(m<period,m,2*period-1-m)
Sx=min(110,int(s*bx0*W)-120); Sy=min(45,int(s*by0*H)-25)
# estensione a sinistra: specchio ripetuto della fascia pulita [0,Sx)
d=np.arange(offx)[::-1]            # distanza dalla cucitura (0 = vicino)
left=sc[:, mirror_idx(offx,Sx)[::-1] if False else mirror_idx(offx,Sx)[d] ,:] if offx>0 else sc[:, :0, :]
E=np.concatenate([left,sc],axis=1)
# estensione in alto: specchio della fascia pulita [0,Sy)
dy=np.arange(offy)[::-1]
top=E[mirror_idx(offy,Sy)[dy],:,:] if offy>0 else E[:0]
E=np.concatenate([top,E],axis=0)
Eh,Ew=E.shape[:2]
# distanza dalla cucitura (zona originale = rettangolo [offx:,offy:])
yy,xx=np.mgrid[0:Eh,0:Ew]
dx=np.clip(offx-xx,0,None); dyy=np.clip(offy-yy,0,None)
dist=np.hypot(dx,dyy)
blur=np.array(Image.fromarray(E.astype(np.uint8)).filter(ImageFilter.GaussianBlur(26)),float)
w=np.clip(dist/110.0,0,1)[...,None]
out=E*(1-w)+blur*w
dark=1-0.5*np.clip(dist/330.0,0,1)[...,None]
out=out*dark
out=np.clip(out,0,255).astype(np.uint8)[:H,:W]
Image.fromarray(out).save('comp.png'); print('salvata',out.shape)
