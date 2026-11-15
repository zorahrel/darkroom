import cv2, numpy as np, json, sys
ref=json.load(open(sys.argv[1])); src=sys.argv[2]; out=sys.argv[3]
P=np.array([float(v) for v in sys.argv[4].split(',')])   # punto da inseguire (testa) in frazioni
base=float(sys.argv[5])                                  # zoom fisso per nascondere i bordi
path=np.array(ref["path"]); T=path[:,0]
pk=np.argmax(path[:,1]); s0,_,x0,y0=path[pk,1:]
Pref=np.array([x0/(1-s0), y0/(1-s0)])                    # centro dello zoom della reference
def params(t):
    t=min(max(t,0),T[-1]); s=np.interp(t,T,path[:,1]); r=np.interp(t,T,path[:,2])
    dx=np.interp(t,T,path[:,3]); dy=np.interp(t,T,path[:,4])
    res=np.array([dx,dy])-(1-s)*Pref                      # scossa residua della camera a mano
    return s,r,res
cap=cv2.VideoCapture(src); fps=cap.get(cv2.CAP_PROP_FPS); W=int(cap.get(3)); H=int(cap.get(4))
vw=cv2.VideoWriter(out,cv2.VideoWriter_fourcc(*'mp4v'),fps,(W,H)); i=0
def mat(t):
    s,r,res=params(t); S=s*base
    c=np.array([W/2,H/2]); p=P*[W,H]
    # zoom base al centro, poi zoom della reference attorno alla testa, rotazione, scossa
    A=cv2.getRotationMatrix2D((float(p[0]),float(p[1])),float(-r),float(s))
    A=np.vstack([A,[0,0,1]])
    B=cv2.getRotationMatrix2D((float(c[0]),float(c[1])),0,base); B=np.vstack([B,[0,0,1]])
    Tm=np.array([[1,0,res[0]*W],[0,1,res[1]*H],[0,0,1]])
    return (B@Tm@A)[:2]
while True:
    ok,fr=cap.read()
    if not ok: break
    t=i/fps; acc=np.zeros_like(fr,dtype=np.float32)
    for k in range(5):                                     # otturatore a 180°: mosso vero
        tt=t-(k/4)*(0.5/fps)
        acc+=cv2.warpAffine(fr,mat(tt),(W,H),flags=cv2.INTER_LANCZOS4,borderMode=cv2.BORDER_REFLECT)
    vw.write((acc/5).astype(np.uint8)); i+=1
vw.release(); print("frame",i,"Pref",Pref.round(3))
