# Editor di immagini locale sulla 3090 — ComfyUI + FLUX.1 Kontext dev (FP8).
#
# Perche' FP8 e non BF16: il BF16 pesa 24 GB su disco e riempie la VRAM da solo,
# senza margine per un secondo modello o per le LoRA. L'FP8 scaled sta in 12 GB
# e lascia spazio per provare anche Qwen-Image-Edit senza reinstallare tutto.
# Perche' non InstantID: e' un modulo SDXL, con Kontext il condizionamento
# sull'immagine e' nativo (e' proprio cio' che chiamiamo "reference").
#
# Da lanciare sul PC:  powershell -ExecutionPolicy Bypass -File setup_local_editor.ps1
$ErrorActionPreference = "Stop"
$root = "C:\ComfyUI"

# --- controlli che devono MORDERE prima di scaricare 18 GB -------------------
$free = [math]::Round((Get-PSDrive C).Free / 1GB)
if ($free -lt 40) { throw "Servono almeno 40 GB liberi su C:, ce ne sono $free. Libera spazio (XboxGames ne tiene 76) e rilancia." }

$vram = (nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits) -as [int]
$used = (nvidia-smi --query-gpu=memory.used  --format=csv,noheader,nounits) -as [int]
if (($vram - $used) -lt 14000) {
  throw "VRAM libera insufficiente: $($vram-$used) MiB su $vram. Ollama tiene un modello pinnato: 'ollama stop qwen2.5:14b-instruct' oppure imposta OLLAMA_KEEP_ALIVE=5m."
}
python -c "import torch; assert torch.cuda.is_available()" ; if ($LASTEXITCODE -ne 0) { throw "torch senza CUDA" }
Write-Host "OK: $free GB liberi, $($vram-$used) MiB di VRAM disponibili"

# --- ComfyUI ----------------------------------------------------------------
if (-not (Test-Path $root)) { git clone https://github.com/comfyanonymous/ComfyUI $root }
Set-Location $root
python -m pip install -q -r requirements.txt

# --- modelli ----------------------------------------------------------------
# Un file gia' presente non si riscarica: un riavvio a meta' download non deve
# costare di nuovo 12 GB.
function Fetch($url, $dest) {
  if (Test-Path $dest) { Write-Host "gia' presente: $(Split-Path $dest -Leaf)"; return }
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  Write-Host "scarico $(Split-Path $dest -Leaf) ..."
  curl.exe -L --fail --retry 3 -o "$dest.part" $url
  Move-Item "$dest.part" $dest
}
$hf = "https://huggingface.co"
Fetch "$hf/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors" "$root\models\diffusion_models\flux1-dev-kontext_fp8_scaled.safetensors"
Fetch "$hf/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors" "$root\models\vae\ae.safetensors"
Fetch "$hf/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" "$root\models\text_encoders\clip_l.safetensors"
Fetch "$hf/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors" "$root\models\text_encoders\t5xxl_fp8_e4m3fn_scaled.safetensors"

Write-Host ""
Write-Host "Fatto. Avvia con:  python main.py --listen 0.0.0.0 --port 8188"
Write-Host "Dal Mac: http://<indirizzo-di-questo-PC>:8188 — mettilo in COMFY_HOST nel .env di Darkroom"
