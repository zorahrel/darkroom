import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, out = sys.argv[1], sys.argv[2]
W = float(sys.argv[3]) if len(sys.argv)>3 else 6.0
im = Image.open(src).convert('RGB'); a = np.array(im).astype(float)/255
H,Wd = a.shape[:2]
pts = [(646,306),(668,304),(688,300),(708,296),(728,293.5),(748,293.5),(768,293.5),(788,295),(796,296.5)]
S=4
m = Image.new('L',(Wd*S,H*S),0); d = ImageDraw.Draw(m)
# spessore con punte affusolate
n=len(pts)
for i in range(n-1):
    t=(i+0.5)/(n-1); w = W*(0.35+0.65*np.sin(np.pi*t)**0.5)
    d.line([(pts[i][0]*S,pts[i][1]*S),(pts[i+1][0]*S,pts[i+1][1]*S)], fill=255, width=int(w*S))
    for p in (pts[i],pts[i+1]):
        r=w*S/2; d.ellipse([p[0]*S-r,p[1]*S-r,p[0]*S+r,p[1]*S+r],fill=255)
m = m.resize((Wd,H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
mk = np.array(m).astype(float)/255
# texture: luminanza locale rispetto alla sua sfocatura
lum = a.mean(axis=2); bl = np.array(Image.fromarray((lum*255).astype('uint8')).filter(ImageFilter.GaussianBlur(4))).astype(float)/255+1e-3
tex = np.clip(lum/bl, 0.7, 1.35)[...,None]
orange = np.array([0.80,0.36,0.11])
col = np.clip(orange*tex*1.0,0,1)
res = a*(1-mk[...,None]*0.93) + col*(mk[...,None]*0.93)
Image.fromarray((res*255).astype('uint8')).save(out)
