import cv2, numpy as np, json, sys
p=sys.argv[1]; cap=cv2.VideoCapture(p); fps=cap.get(cv2.CAP_PROP_FPS)
ok,prev=cap.read(); W=prev.shape[1]; H=prev.shape[0]
pg=cv2.cvtColor(prev,cv2.COLOR_BGR2GRAY)
M=np.eye(3); path=[(0,1.0,0.0,0.0,0.0)]; i=0
while True:
    ok,fr=cap.read()
    if not ok: break
    i+=1; g=cv2.cvtColor(fr,cv2.COLOR_BGR2GRAY)
    pts=cv2.goodFeaturesToTrack(pg,600,0.01,8)
    nxt,st,_=cv2.calcOpticalFlowPyrLK(pg,g,pts,None)
    a=pts[st==1]; b=nxt[st==1]
    A,_=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=2)
    if A is None: A=np.array([[1,0,0],[0,1,0]],float)
    M=np.vstack([A,[0,0,1]])@M
    s=float(np.hypot(M[0,0],M[1,0])); r=float(np.degrees(np.arctan2(M[1,0],M[0,0])))
    path.append((i/fps,s,r,float(M[0,2])/W,float(M[1,2])/H)); pg=g
json.dump({"fps":fps,"W":W,"H":H,"path":path},open(sys.argv[2],"w"))
for t,s,r,x,y in path[::15]: print(f"{t:5.2f}s scala {s:5.3f} rot {r:+5.2f}° dx {x:+.3f} dy {y:+.3f}")
