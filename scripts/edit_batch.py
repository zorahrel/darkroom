#!/usr/bin/env python3
"""Darkroom worker — ChatGPT web image edit/generate automation via CDP.

The Darkroom backend drives this in --single-shot (edit) or --generate
(text-to-image) mode. The legacy --limit batch mode is kept for standalone use.

Paths derive from GALLERY_ROOT (defaults to ~/Darkroom), matching server/config.ts.
"""
import asyncio
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request

try:
    import websockets
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "--break-system-packages", "-q", "websockets"], check=True)
    import websockets

ROOT = Path(os.environ.get("GALLERY_ROOT", str(Path.home() / "Darkroom")))
DATA = Path(os.environ.get("GALLERY_DATA_DIR", str(ROOT / "data")))
RAW = Path(os.environ.get("GALLERY_RAW_DIR", str(DATA / "RAW")))
EDITED = DATA / "edited_chatgpt"
TRACKER = ROOT / "photo-tracker.json"
UPLOADS = DATA / "uploads"
LOGS = Path(os.environ.get("GALLERY_LOGS_DIR", str(ROOT / "logs")))
CDP_URL = os.environ.get("CHATGPT_CDP_URL", "http://127.0.0.1:19223")

PROMPT = """Use image generation to edit this photo.

Base Rules: Use the original image as strict base. Editing only (no generation). Do NOT add/remove elements. Do NOT alter composition or structure.

Realism & Materials: Preserve textures, materials, and natural grain. Maintain full surface realism. No smoothing. No plastic effect. No artificial sharpening.

Lighting (Cinematic & Natural): Preserve original lighting direction and sources. Do NOT introduce new light or alter scene logic. Preserve original time-of-day and overall scene mood. Amplify existing light only: Increase light/shadow contrast (no detail loss). Gently boost natural highlights. Deepen shadows without crushing blacks. Add soft gradients following original light.

Bloom / Glare + White Enhancement: Apply ONLY on existing bright sources. Keep soft, diffused, physically plausible. No heavy glow or washed highlights. Subtle lens flare only if coherent. Gently lift whites ONLY where naturally illuminated. Increase brightness without clipping details. Preserve texture inside highlights. Blend whites seamlessly into bloom. Avoid flat pure white. Keep transitions soft, airy, and natural.

Color Grading: Preserve original color balance of the scene. Maintain natural greens and blues. Respect scene context (daylight, night tones, artificial lighting). Pink tones: Brighter, lighter, more airy, slightly desaturated. Slightly warm highlights. Neutral, clean shadows. Preserve smooth color transitions.

Enhancements: Remove only minor distractions. Apply subtle perspective correction. Maintain full detail fidelity.

Subject Handling: Keep subject sharp and naturally separated via light contrast. No artificial depth of field.

Motion Blur: Apply ONLY to already moving elements. Keep subtle and realistic.

Hard Constraints: No AI artifacts. No fake lighting. No inconsistent shadows. No HDR or overprocessed look.

Style: Cinematic, minimal, editorial photography. Soft atmospheric light. Delicate colors. Refined bloom. Premium editorial look with preserved texture and authentic mood.

OUTPUT THE EDITED IMAGE."""


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self._id = 0

    async def call(self, method, params=None, timeout=30):
        self._id += 1
        mid = self._id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method} -> {msg['error']}")
                return msg.get("result", {})

    async def js(self, expr, await_promise=False, timeout=30):
        r = await self.call("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        }, timeout=timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS error: {r['exceptionDetails'].get('text')} :: {expr[:100]}")
        return r.get("result", {}).get("value")


def load_tracker():
    return json.loads(TRACKER.read_text())


def save_tracker(data):
    TRACKER.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def resize(src: Path, dst: Path, max_dim=2048):
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["sips", "-Z", str(max_dim), str(src), "--out", str(dst)],
        check=True, capture_output=True,
    )


def log_line(slug, msg):
    LOGS.mkdir(exist_ok=True)
    stamp = time.strftime("%H:%M:%S")
    line = f"[{stamp}] {slug}: {msg}"
    print(line, flush=True)
    (LOGS / "batch.log").open("a").write(line + "\n")


async def get_chatgpt_tab():
    tabs = json.load(urlopen(f"{CDP_URL}/json"))
    chats = [t for t in tabs if t.get("type") == "page" and "chatgpt.com" in t.get("url", "")]
    if not chats:
        try:
            req = Request(f"{CDP_URL}/json/new?https://chatgpt.com/", method="PUT")
            t = json.load(urlopen(req))
        except Exception:
            t = json.load(urlopen(f"{CDP_URL}/json/new?https://chatgpt.com/"))
        await asyncio.sleep(4)
        return t
    return chats[0]


async def new_chat(cdp: CDP):
    # Hard-reset the DOM first so leftover generated images from a previous job
    # cannot leak into the baseline of the new one.
    await cdp.call("Page.navigate", {"url": "about:blank"})
    await asyncio.sleep(0.4)
    # Force the plain GPT-5 chat (no custom gizmo, no project sidebar state).
    await cdp.call("Page.navigate", {"url": "https://chatgpt.com/?model=gpt-5"})
    for _ in range(40):
        has_composer = await cdp.js(
            '!!document.querySelector(\'div[contenteditable="true"][id^="prompt-textarea"], div[contenteditable="true"].ProseMirror\')'
        )
        if has_composer:
            # Wait until the URL stabilises on the new-chat path (not /c/<id>) and
            # no leftover generated images are still in the DOM.
            for _ in range(20):
                stable = await cdp.js("""
                  (() => {
                    const url = location.href;
                    const onNewChat = !/\\/c\\//.test(url);
                    const leftovers = [...document.querySelectorAll('img')].some(i => {
                      const alt = (i.alt || '').toLowerCase();
                      const isGen = alt.startsWith('immagine generata')
                        || alt.startsWith('generated image')
                        || /dalle|oaiusercontent/.test(i.src)
                        || /backend-api\\/estuary\\/content\\?id=file_/.test(i.src);
                      return isGen && i.naturalWidth >= 512;
                    });
                    return { onNewChat, leftovers };
                  })()
                """)
                if stable.get("onNewChat") and not stable.get("leftovers"):
                    return
                await asyncio.sleep(0.25)
            return
        await asyncio.sleep(0.5)
    raise RuntimeError("composer not found after navigate")


async def upload_file(cdp: CDP, file_path):
    """Attach one or more files to the composer.

    `file_path` may be a single path or a list. CDP's DOM.setFileInputFiles
    takes an array, so several attachments cost one call — that is what lets a
    storyboard panel carry its character reference images alongside the shot.
    """
    paths = [file_path] if isinstance(file_path, (str, Path)) else list(file_path)
    paths = [str(p) for p in paths]
    if not paths:
        return

    has_input = await cdp.js("!!document.querySelector('input[type=file]')")
    if not has_input:
        await cdp.js("""
          (() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const attach = btns.find(b => /allega|attach|add photo|carica|upload|aggiungi/i.test(b.getAttribute('aria-label')||'') );
            if (attach) attach.click();
          })()
        """)
        await asyncio.sleep(1)

    res = await cdp.call("Runtime.evaluate", {
        "expression": "document.querySelector('input[type=file]')",
        "returnByValue": False,
    })
    obj_id = res["result"].get("objectId")
    if not obj_id:
        raise RuntimeError("input[type=file] not found")
    node = await cdp.call("DOM.describeNode", {"objectId": obj_id})
    backend_node_id = node["node"]["backendNodeId"]
    await cdp.call("DOM.setFileInputFiles", {
        "files": paths,
        "backendNodeId": backend_node_id,
    })


async def snapshot_form_thumbs(cdp: CDP) -> list:
    """Snapshot composer thumbnail srcs before an upload, so wait_image_attached
    can confirm a NEW thumb appeared (not just any leftover)."""
    return await cdp.js("""
      (() => {
        const form = document.querySelector('form') || document;
        return Array.from(form.querySelectorAll('img'))
          .filter(i => {
            const src = i.getAttribute('src') || '';
            const alt = i.getAttribute('alt') || '';
            if (/avatar|profile/i.test(src) || /avatar|profile/i.test(alt)) return false;
            const r = i.getBoundingClientRect();
            return r.width > 20 && r.height > 20;
          })
          .map(i => i.getAttribute('src') || '');
      })()
    """) or []


async def wait_image_attached(cdp: CDP, baseline=None, timeout=60, expected=1):
    """Wait until `expected` NEW composer thumbnails appear (not in baseline)
    AND no upload spinner is active. Requiring a new thumb prevents accepting a
    stale leftover and sending the prompt without an actual attachment (which
    makes ChatGPT hallucinate a wholly new image instead of editing ours).
    `expected` > 1 covers a panel uploaded together with its character refs."""
    baseline_json = json.dumps(list(baseline or []))
    expr = f"""
      (() => {{
        const baseline = new Set({baseline_json});
        const form = document.querySelector('form') || document;
        const thumbs = Array.from(form.querySelectorAll('img')).filter(i => {{
          const src = i.getAttribute('src') || '';
          const alt = i.getAttribute('alt') || '';
          if (/avatar|profile/i.test(src) || /avatar|profile/i.test(alt)) return false;
          const r = i.getBoundingClientRect();
          return r.width > 20 && r.height > 20;
        }});
        const fresh = thumbs.filter(i => !baseline.has(i.getAttribute('src') || ''));
        if (fresh.length < {int(expected)}) return {{ok: false, reason: 'no-new-thumb', fresh: fresh.length, total: thumbs.length}};
        const spinning = Array.from(form.querySelectorAll('*')).some(el => {{
          const cl = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || '');
          if (typeof cl !== 'string') return false;
          return /animate-spin|spinner|loading/i.test(cl);
        }}) || !!form.querySelector('[role="progressbar"], [data-state="loading"], svg[class*=\"animate-spin\"]');
        return {{ok: !spinning, reason: spinning ? 'spinner' : 'ready', fresh: fresh.length}};
      }})()
    """
    last = {}
    for _ in range(timeout * 2):
        r = await cdp.js(expr)
        last = r or {}
        if last.get("ok"):
            return True
        await asyncio.sleep(0.5)
    return False


async def send_prompt(cdp: CDP, prompt: str):
    escaped = json.dumps(prompt)
    await cdp.js(f"""
      (() => {{
        const ed = document.querySelector('div[contenteditable="true"][id^="prompt-textarea"], div[contenteditable="true"].ProseMirror');
        if (!ed) return false;
        ed.focus();
        while (ed.firstChild) ed.removeChild(ed.firstChild);
        const lines = {escaped}.split('\\n');
        lines.forEach((ln) => {{
          const p = document.createElement('p');
          p.textContent = ln || '\\u00A0';
          ed.appendChild(p);
        }});
        ed.dispatchEvent(new InputEvent('input', {{bubbles: true, cancelable: true}}));
        return true;
      }})()
    """)
    await asyncio.sleep(1)
    # Try to click send — retry briefly since React may re-render
    clicked = False
    for _ in range(20):
        clicked = await cdp.js("""
          (() => {
            let btn = document.querySelector('button[data-testid="send-button"], button[aria-label*="invia" i], button[aria-label*="send" i], button#composer-submit-button');
            if (!btn) {
              // fallback: find button with SVG at end of form
              const form = document.querySelector('form');
              if (form) {
                const candidates = Array.from(form.querySelectorAll('button')).filter(b => {
                  const r = b.getBoundingClientRect();
                  return r.width > 20 && r.width < 80 && r.height > 20 && r.height < 80 && b.querySelector('svg');
                });
                btn = candidates[candidates.length - 1];
              }
            }
            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); return true; }
            return false;
          })()
        """)
        if clicked:
            break
        await asyncio.sleep(0.5)
    if not clicked:
        raise RuntimeError("send button not found or disabled")


async def _detect_rate_limit(cdp: CDP) -> dict:
    """Scan the page for ChatGPT image-gen rate-limit messaging (EN + IT)."""
    return await cdp.js("""
      (() => {
        const text = document.body.innerText || '';
        // "resets in 3 hours and 36 minutes" va letto PRIMA delle regole
        // generiche, altrimenti "in 3 hour" vince e si perdono i 36 minuti:
        // ci si ripresenta troppo presto e si brucia un altro tentativo.
        const m = text.match(/(?:limit )?resets? in\\s+(\\d+)\\s*(?:hours?|ore|ora)\\s*(?:and|e)\\s*(\\d+)\\s*(?:minutes?|minuti|min)/i)
              || text.match(/(?:try again|riprova|available again|will be available)[^.]*?(?:at|alle ore|alle)\\s*(\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)?)/i)
              || text.match(/(?:in|fra|tra)\\s+(\\d+)\\s*(?:minute|minuti|min|hour|hours|ore|ora)/i)
              || text.match(/(?:limit (?:will )?reset|reset (?:in|at))[^.]*?(\\d{1,2}:\\d{2}|\\d+\\s*(?:min|hour|ore|minuti))/i);
        // "You've hit the Plus plan limit for image generations" non contiene
        // "reached": senza questo ramo il limite esplicito passava per un
        // timeout muto e la coda continuava a bussare ogni 6 minuti.
        const limitMentioned = /reached.*limit|hit the .*limit|raggiunto.*limite|image (?:gen|generation).*limit|limit.*image|plan limit|please try again later|request limit|edit request limit|unable to invoke the image/i.test(text);
        return { match: m ? m[0] : null, captured: m ? m[1] : null, limitMentioned };
      })()
    """) or {}


async def wait_image_generated(cdp: CDP, timeout_s=300, baseline_srcs: set | None = None):
    """Look for a new generated image anywhere on the page.

    Detects images by alt-text ('Immagine generata' / 'Generated image') or
    by URL pattern (backend-api/estuary/content with file_ id, oaiusercontent,
    dalle). Excludes thumbnails the user uploaded (those use the singleshot_
    alt-prefix in our upload helper)."""
    baseline = baseline_srcs or set()
    baseline_json = json.dumps(list(baseline))
    deadline = time.time() + timeout_s
    # Fast-fail watchdog: if ChatGPT hasn't started streaming AND hasn't produced any
    # candidate image within N seconds, bail out — likely rate-limited or stuck.
    # Configurable via NO_RESPONSE_S. Default 360s: GPT-5 image edits under load
    # routinely take 3-5 min to surface the first frame; a tighter window was
    # killing generations that actually succeed (image appears just after we bail).
    no_response_deadline = time.time() + int(os.environ.get("NO_RESPONSE_S", "360"))
    last_status = ""
    # Stale-image safety now relies on baseline exclusion + the single-runner
    # atomic claim (no two jobs share the browser). Here we track whether an
    # actual image candidate has appeared, to drive the fast-fail watchdog.
    saw_image_candidate = False
    # Early-accept: a generated image element appears fully-formed and doesn't
    # change afterwards, but ChatGPT often keeps "streaming" a trailing caption.
    # Waiting for streaming to end adds a long, pointless delay. So if the same
    # candidate image src is stable across a couple polls, accept it immediately.
    last_src = None
    stable_count = 0
    while time.time() < deadline:
        info = await cdp.js(f"""
          (() => {{
            const baseline = new Set({baseline_json});
            const imgs = [...document.querySelectorAll('img')];
            const isGen = (i) => {{
              const alt = (i.alt || '').toLowerCase();
              if (alt.startsWith('singleshot_') || alt.includes('imageinput')) return false;
              if (alt.startsWith('immagine generata') || alt.startsWith('generated image')) return true;
              if (/dalle|oaiusercontent/.test(i.src)) return true;
              // estuary content URLs with file_ id are generated outputs
              if (/backend-api\\/estuary\\/content\\?id=file_/.test(i.src)) return true;
              return false;
            }};
            // La soglia di dimensione serviva a scartare avatar e icone, ma
            // ChatGPT renderizza il risultato in un riquadro da 400px (e
            // naturalWidth resta 0 finche' il file non e' decodificato): la
            // foto giusta veniva buttata e il job girava a vuoto per 6 minuti.
            // Un alt "immagine generata" o un URL estuary/dalle e' gia' una
            // prova d'identita' sufficiente; la soglia resta solo per le
            // immagini riconosciute unicamente dall'URL.
            const strongId = (i) => {{
              const alt = (i.alt || '').toLowerCase();
              return alt.startsWith('immagine generata') || alt.startsWith('generated image');
            }};
            const bigEnough = (i) => i.naturalWidth >= 512 || i.width >= 512 || i.height >= 320;
            const candidates = imgs.filter(i => isGen(i) && !baseline.has(i.src) && (strongId(i) || bigEnough(i)));
            const stillStreaming = !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="ferma" i], button[aria-label*="stop" i]');
            const pick = candidates[candidates.length - 1];
            // Content-policy refusal (e.g. copyright / third-party likeness): ChatGPT
            // returns text instead of an image. Detect so we skip instead of retrying.
            const arts = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
            const lastTxt = arts.length ? (arts[arts.length-1].innerText || '').toLowerCase() : '';
            const refused = /misure di protezione|somiglianza con contenuti|contenuti di terzi|third[- ]party|copyright|can'?t help with|unable to (?:create|generate|help)|non posso (?:aiutarti|creare|generare)|viola(?:no|re)? (?:le|la) (?:nostre|policy)|content polic/i.test(lastTxt);
            return {{
              done: !!pick && !stillStreaming,
              src: pick ? pick.src : null,
              refused: refused && !pick && !stillStreaming,
              status: pick ? (stillStreaming ? 'img-streaming' : 'img-present') : (stillStreaming ? 'streaming' : 'waiting'),
            }};
          }})()
        """)
        status = info.get("status", "")
        if status in ("img-streaming", "img-present"):
            saw_image_candidate = True
        # Content-policy refusal → skip this photo (don't retry forever).
        if info.get("refused"):
            raise RuntimeError("content-policy refusal (copyright/likeness) — skipped")
        # A non-baseline candidate image that's finished streaming is ours.
        if info.get("done") and info.get("src"):
            return info["src"]
        # Otherwise, accept a stable candidate even while a trailing caption
        # streams: the image src unchanged across 2 polls (~4s) means it's final.
        src = info.get("src")
        if src and src == last_src:
            stable_count += 1
            if stable_count >= 2:
                return src
        else:
            stable_count = 0
        last_src = src
        if status != last_status:
            last_status = status
        # Fast-fail: if NO image candidate has appeared within 90s, bail out
        # (silent rate-limit). The generic stop button during text "thinking"
        # no longer keeps us waiting the full 5 min.
        if time.time() > no_response_deadline and not saw_image_candidate:
            rl_early = await _detect_rate_limit(cdp)
            extra = ""
            if rl_early.get("limitMentioned"):
                extra = " :: rate-limit-detected"
                if rl_early.get("match"):
                    extra += f" :: reset_hint={rl_early['match'][:80]}"
            window = int(os.environ.get("NO_RESPONSE_S", "360"))
            raise TimeoutError(f"no image in {window}s (early-exit, last status={last_status}){extra}")
        await asyncio.sleep(2)
    # Look for a rate-limit / reset-time message in the page to pass upstream
    rl = await _detect_rate_limit(cdp)
    extra = ""
    if rl and rl.get("limitMentioned"):
        extra = f" :: rate-limit-detected"
        if rl.get("match"):
            extra += f" :: reset_hint={rl['match'][:80]}"
    raise TimeoutError(f"no image in {timeout_s}s (last status={last_status}){extra}")


async def snapshot_image_srcs(cdp: CDP) -> set:
    """Capture all image srcs currently on the page (used as baseline)."""
    srcs = await cdp.js("[...document.querySelectorAll('img')].map(i=>i.src).filter(Boolean)")
    return set(srcs or [])


def looks_like_same_scene(a_path, b_path, threshold=0.25) -> float:
    """Quanto il render assomiglia STRUTTURALMENTE alla foto di partenza.

    Un edit, per quanto aggressivo, conserva la disposizione delle masse chiare
    e scure: la correlazione fra le due miniature 16x16 resta alta. Un'immagine
    di un'ALTRA foto no — ed è quello che succede quando il worker scarica la
    figura già presente in pagina invece della propria (job durati 10 secondi
    invece di due minuti). Nel set ne sono passati 15 su 62 senza che nulla
    segnalasse niente: il piatto di cibo era diventato una strada di notte.

    Ritorna la correlazione (-1..1). Sotto `threshold` è quasi certamente
    un'immagine sbagliata. numpy/Pillow ci sono già per il resize."""
    try:
        import numpy as np
        from PIL import Image, ImageOps

        def sig(path):
            im = ImageOps.exif_transpose(Image.open(path)).convert("L").resize((16, 16))
            a = np.asarray(im, np.float32)
            return (a - a.mean()) / (a.std() + 1e-6)

        return float((sig(a_path) * sig(b_path)).mean())
    except Exception:
        # In caso di dubbio si lascia passare: un controllo che rompe le
        # generazioni buone è peggio del problema che risolve.
        return 1.0


async def download_image(cdp: CDP, src_url: str, dst: Path):
    b64 = await cdp.js(f"""
      (async () => {{
        const r = await fetch({json.dumps(src_url)}, {{credentials: 'include'}});
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }})()
    """, await_promise=True, timeout=120)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(base64.b64decode(b64))


async def process_one(cdp: CDP, entry_key: str, entry: dict, tracker: dict):
    src = RAW / entry_key
    if not src.exists():
        log_line(entry_key, f"SKIP source missing: {src}")
        return False
    index = entry["index"]
    img_id = entry["img_id"]
    slug = f"japan_{index:03d}_{img_id}"
    log_line(slug, f"start ({index}/190)")

    resized = UPLOADS / f"{img_id}.jpeg"
    resize(src, resized)
    log_line(slug, f"resized -> {resized.stat().st_size // 1024}kb")

    await new_chat(cdp)
    log_line(slug, "new chat ready")

    form_baseline = await snapshot_form_thumbs(cdp)
    await upload_file(cdp, str(resized))
    attached = await wait_image_attached(cdp, baseline=form_baseline, timeout=25)
    log_line(slug, f"attached={attached}")
    if not attached:
        raise RuntimeError("image not attached")

    baseline = await snapshot_image_srcs(cdp)
    await send_prompt(cdp, PROMPT)
    log_line(slug, "prompt sent, waiting for image...")

    src_url = await wait_image_generated(cdp, timeout_s=300, baseline_srcs=baseline)
    log_line(slug, f"ready: {src_url[:80]}")

    out_name = f"{slug}_chatgpt.png"
    out_path = EDITED / out_name
    await download_image(cdp, src_url, out_path)
    log_line(slug, f"saved -> {out_path.stat().st_size // 1024}kb")

    entry.setdefault("edits", []).append(out_name)
    entry["edit_count"] = len(entry["edits"])
    entry["status"] = "edited"
    tracker[entry_key] = entry
    save_tracker(tracker)
    return True


async def main(limit: int, only, dry_run: bool):
    tracker = load_tracker()
    pending = [(k, v) for k, v in tracker.items() if v.get("status") == "pending"]
    if only:
        pending = [(k, v) for k, v in pending if only in k or only in v.get("img_id", "")]
    pending = pending[:limit]
    log_line("batch", f"will process {len(pending)} (dry_run={dry_run})")
    if dry_run:
        for k, v in pending:
            print(f"  #{v['index']:03d} {k}")
        return

    tab = await get_chatgpt_tab()
    async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024) as ws:
        cdp = CDP(ws)
        await cdp.call("Page.enable")
        await cdp.call("DOM.enable")
        await cdp.call("Runtime.enable")

        done = 0
        fail = 0
        for k, v in pending:
            try:
                ok = await process_one(cdp, k, v, tracker)
                if ok:
                    done += 1
            except Exception as e:
                fail += 1
                log_line(k, f"ERROR: {e}")
                try:
                    r = await cdp.call("Page.captureScreenshot", {"format": "png"})
                    LOGS.mkdir(exist_ok=True)
                    (LOGS / f"fail_{int(time.time())}_{k}.png").write_bytes(base64.b64decode(r["data"]))
                except Exception:
                    pass
                if fail >= 3:
                    log_line("batch", "3 failures -- stopping")
                    break
        log_line("batch", f"done={done} fail={fail}")


def prepare_uploads(paths, tag: str):
    """Resize every path into UPLOADS, returning (resized_paths, cleanup_list).
    A reference that fails to resize is skipped, never fatal: a panel generated
    without its reference beats a job that dies in the queue."""
    UPLOADS.mkdir(parents=True, exist_ok=True)
    out, cleanup = [], []
    stamp = int(time.time() * 1000)
    for i, src in enumerate(paths):
        src = Path(src)
        if not src.exists():
            log_line(tag, f"reference missing, skipped: {src}")
            continue
        dst = UPLOADS / f"{tag}_{stamp}_{i}_{src.stem}.jpeg"
        try:
            resize(src, dst)
        except Exception as e:
            log_line(tag, f"reference resize failed, skipped: {src} ({e})")
            continue
        out.append(str(dst))
        cleanup.append(dst)
    return out, cleanup


def cleanup_uploads(paths):
    for p in paths:
        try:
            Path(p).unlink()
        except Exception:
            pass


async def attach_with_fallback(cdp: CDP, primary: list, refs: list, tag: str) -> list:
    """Attach primary + reference images, degrading to primary-only when the
    composer doesn't show every thumbnail in time. Returns the paths actually
    attached ([] when nothing could be attached)."""
    wanted = primary + refs
    if not wanted:
        return []
    baseline = await snapshot_form_thumbs(cdp)
    await upload_file(cdp, wanted)
    if await wait_image_attached(cdp, baseline=baseline, timeout=25, expected=len(wanted)):
        return wanted
    if not refs:
        return []
    # References are a nice-to-have; the shot itself is not.
    log_line(tag, f"{len(wanted)} attachments did not settle -- retrying without the {len(refs)} reference(s)")
    await new_chat(cdp)
    if not primary:
        return []
    baseline = await snapshot_form_thumbs(cdp)
    await upload_file(cdp, primary)
    if await wait_image_attached(cdp, baseline=baseline, timeout=25, expected=1):
        return primary
    return []


async def attach_with_retries(cdp: CDP, primary: list, refs: list, tag: str,
                              attempts: int = 3) -> list:
    """Come attach_with_fallback, ma riprova con una chat nuova prima di darsi
    per vinto.

    "image not attached" era il 62% dei fallimenti di questo set, e non è un
    rifiuto di ChatGPT: è la miniatura che non compare entro 25 secondi perché
    la pagina è lenta o la sessione è appesantita. Un job che muore qui brucia
    comunque il tempo dell'upload e viene contato come errore, quindi ritentare
    subito costa meno che rimetterlo in coda dopo. Ogni tentativo riparte da una
    chat pulita, che è ciò che di solito sblocca il composer."""
    for i in range(1, attempts + 1):
        got = await attach_with_fallback(cdp, primary, refs, tag)
        if got:
            if i > 1:
                log_line(tag, f"allegato al tentativo {i}/{attempts}")
            return got
        if i < attempts:
            # Pausa crescente: se la pagina è sotto pressione, insistere subito
            # la peggiora.
            wait_s = 5 * i
            log_line(tag, f"allegato fallito ({i}/{attempts}), riprovo fra {wait_s}s con chat nuova")
            await asyncio.sleep(wait_s)
            await new_chat(cdp)
    return []


async def single_shot(image: Path, prompt: str, output: Path, refs=None):
    """One-shot: edit a single image with a custom prompt, save to output. Used by dashboard worker.
    `refs` are extra reference images (storyboard characters) attached alongside."""
    if not image.exists():
        raise FileNotFoundError(f"input image not found: {image}")

    output.parent.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)

    resized = UPLOADS / f"singleshot_{int(time.time() * 1000)}_{image.stem}.jpeg"
    resize(image, resized)
    log_line(image.name, f"single-shot resize -> {resized.stat().st_size // 1024}kb")
    ref_paths, ref_cleanup = prepare_uploads(refs or [], "ref")
    if ref_paths:
        log_line(image.name, f"attaching {len(ref_paths)} reference image(s)")

    # The resized copies MUST be removed on the failure paths too: a generation
    # that times out (the common case when ChatGPT stalls on a photo) used to
    # leave its upload behind, and a photo retried in a loop then leaked one
    # copy per attempt.
    try:
        tab = await get_chatgpt_tab()
        async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.call("Page.enable")
            await cdp.call("DOM.enable")
            await cdp.call("Runtime.enable")

            await new_chat(cdp)
            attached = await attach_with_retries(cdp, [str(resized)], ref_paths, image.name)
            if not attached:
                raise RuntimeError("image not attached")

            baseline = await snapshot_image_srcs(cdp)
            await send_prompt(cdp, prompt)
            gen_timeout = int(os.environ.get("GEN_TIMEOUT_S", "540"))
            src_url = await wait_image_generated(cdp, timeout_s=gen_timeout, baseline_srcs=baseline)
            await download_image(cdp, src_url, output)

            # Verifica che quel che si è scaricato sia DAVVERO questa foto.
            # Il baseline esclude le immagini già viste, ma non copre il caso in
            # cui la pagina ne mostri una nuova appartenente a un altro job.
            corr = looks_like_same_scene(str(image), str(output))
            if corr < float(os.environ.get("SCENE_MIN_CORR", "0.25")):
                output.unlink(missing_ok=True)
                raise RuntimeError(
                    f"downloaded image does not match the source photo "
                    f"(correlation {corr:.2f}) — likely another job's render"
                )
    finally:
        cleanup_uploads([resized, *ref_cleanup])

    return output


async def generate_only(prompt: str, output: Path, refs=None):
    """Text-to-image: send a prompt with NO source image, save the result.

    Same pipeline as single_shot minus the source upload. `refs` (storyboard
    character references) are still attached when given — that is what keeps a
    character recognisable from one generated panel to the next."""
    output.parent.mkdir(parents=True, exist_ok=True)
    ref_paths, ref_cleanup = prepare_uploads(refs or [], "ref")

    try:
        tab = await get_chatgpt_tab()
        async with websockets.connect(tab["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.call("Page.enable")
            await cdp.call("DOM.enable")
            await cdp.call("Runtime.enable")

            await new_chat(cdp)
            if ref_paths:
                log_line("generate", f"attaching {len(ref_paths)} reference image(s)")
                if not await attach_with_fallback(cdp, [], ref_paths, "generate"):
                    # No references attached: generate anyway, just without them
                    # (attach_with_fallback already reset the chat).
                    log_line("generate", "references did not attach -- generating without them")
            baseline = await snapshot_image_srcs(cdp)
            await send_prompt(cdp, prompt)
            gen_timeout = int(os.environ.get("GEN_TIMEOUT_S", "540"))
            src_url = await wait_image_generated(cdp, timeout_s=gen_timeout, baseline_srcs=baseline)
            await download_image(cdp, src_url, output)
    finally:
        # Same as single_shot: references must not survive a failed generation.
        cleanup_uploads(ref_cleanup)

    return output


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()

    # Default batch mode (preserved as the implicit default)
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--only")
    ap.add_argument("--dry-run", action="store_true")

    # Single-shot mode (used by the dashboard worker)
    ap.add_argument("--single-shot", action="store_true",
                    help="One image -> one output. Reads prompt from stdin (or --prompt-stdin).")
    ap.add_argument("--generate", action="store_true",
                    help="Text-to-image: no input image. Reads prompt from stdin (or --prompt-stdin).")
    ap.add_argument("--image", help="Input image path (single-shot)")
    ap.add_argument("--output", help="Output PNG path (single-shot / generate)")
    ap.add_argument("--ref", action="append", default=[],
                    help="Extra reference image attached to the same message "
                         "(repeatable; storyboard character references)")
    ap.add_argument("--prompt-stdin", action="store_true",
                    help="Read prompt from stdin instead of using the hardcoded default")

    args = ap.parse_args()

    if args.generate:
        if not args.output:
            print(json.dumps({"status": "error", "error": "generate requires --output"}),
                  flush=True)
            sys.exit(2)
        prompt = sys.stdin.read().strip() if args.prompt_stdin else PROMPT
        if not prompt:
            print(json.dumps({"status": "error", "error": "generate requires a non-empty prompt"}),
                  flush=True)
            sys.exit(2)
        t0 = time.time()
        try:
            out = asyncio.run(generate_only(prompt, Path(args.output), refs=args.ref))
            elapsed = round(time.time() - t0, 2)
            print(json.dumps({
                "status": "ok",
                "output": str(out),
                "duration_s": elapsed,
                "size_kb": out.stat().st_size // 1024,
            }), flush=True)
            sys.exit(0)
        except Exception as e:
            elapsed = round(time.time() - t0, 2)
            print(json.dumps({
                "status": "error",
                "error": str(e),
                "duration_s": elapsed,
            }), flush=True)
            sys.exit(1)

    if args.single_shot:
        if not args.image or not args.output:
            print(json.dumps({"status": "error", "error": "single-shot requires --image and --output"}),
                  flush=True)
            sys.exit(2)
        prompt = sys.stdin.read().strip() if args.prompt_stdin else PROMPT
        if not prompt:
            prompt = PROMPT
        t0 = time.time()
        try:
            out = asyncio.run(single_shot(Path(args.image), prompt, Path(args.output), refs=args.ref))
            elapsed = round(time.time() - t0, 2)
            print(json.dumps({
                "status": "ok",
                "output": str(out),
                "duration_s": elapsed,
                "size_kb": out.stat().st_size // 1024,
            }), flush=True)
            sys.exit(0)
        except Exception as e:
            elapsed = round(time.time() - t0, 2)
            print(json.dumps({
                "status": "error",
                "error": str(e),
                "duration_s": elapsed,
            }), flush=True)
            sys.exit(1)

    asyncio.run(main(args.limit, args.only, args.dry_run))
