"""Ricostruzione 3D (FaceLift, ICCV 2025, Space gratuito su Hugging Face) delle foto
che Attilio ha evidenziato nel progetto profilo. Salva viste, giro a 360 e modello .ply
in ~/Darkroom/projects/profilo/data/3d/. La quota anonima ZeroGPU basta per ~1 foto al
giorno: si salta chi e' gia' fatto e ci si ferma al primo errore di quota."""
import shutil, sys, os
from gradio_client import Client, handle_file
P = os.path.expanduser("~/Darkroom/projects/profilo/data")
OUT = f"{P}/3d"; os.makedirs(OUT, exist_ok=True)
foto = sys.argv[1:] or ["io-rasato-2023-06-23-p13.jpg", "io-felpa-mano-1.png",
                        "io-occhiali-vista-632DC4E9.jpeg", "io-selfie-barba-vicino.jpg"]
c = Client("wlyu/FaceLift", verbose=False)
fatte = 0
for name in foto:
    stem = name.rsplit(".", 1)[0]
    if os.path.exists(f"{OUT}/facelift_{stem}.ply"):
        continue
    try:
        html, views, turn, ply = c.predict(handle_file(f"{P}/refs/{name}"), True, 3.0, 4, 50,
                                           api_name="/_generate_and_filter_outputs")
    except Exception as e:
        print("fermo:", name, str(e)[:200]); break
    shutil.copy(views if isinstance(views, str) else views["path"], f"{OUT}/facelift_{stem}_views.png")
    v = turn.get("video") if isinstance(turn, dict) else turn
    if v: shutil.copy(v, f"{OUT}/facelift_{stem}_360.mp4")
    shutil.copy(ply, f"{OUT}/facelift_{stem}.ply")
    print("fatta:", name); fatte += 1
print("fatte oggi:", fatte)
