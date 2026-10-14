"""
Chrome for Testing headless come browser di ChatGPT, senza OpenBrowser.

PERCHE' ESISTE. Attilio, 09/10: «darkroom deve funzionare senza openbrowser».
Il WebKit di Playwright (wk_browser.py) si ferma al Turnstile di Cloudflare
e la casella va spuntata a mano. Qui il browser e' un Chrome for Testing tutto
di Darkroom: headless (non prende mai il focus), profilo suo in
~/.cache/darkroom/cft-profile, acceso solo per la durata del job. Parla CDP
vero, quindi la classe `CDP` di edit_batch.py e tutta la logica collaudata
(upload con DOM.setFileInputFiles, screenshot) restano identiche.

LA CASELLA CLOUDFLARE. Con la sessione di ChatGPT, Cloudflare mostra la
sfida managed («Ci siamo quasi…») e non passa da sola. Si clicca da qui:
scelta di Attilio del 09/10. Misurato lo stesso giorno sul CfT di OpenClaw:
la sfida managed e la pagina-sfida passano al primo click CDP.

IL LANCIATORE. Si usa ~/.openclaw/bin/agent-browser, quello del browser
agenti: toglie il --disable-gpu (senza WebGL Cloudflare vede un bot), mette
lo user agent normale al posto di "HeadlessChrome" e segue gli aggiornamenti
settimanali di Chrome for Testing. `DARKROOM_CFT_BIN` lo sostituisce.

IL LOGIN. Se nel profilo manca la sessione, i cookie di chatgpt.com si
copiano UNA volta dal Cookies.binarycookies di OpenBrowser (sola lettura, come
fa wk_browser.py); poi restano nel profilo e OpenBrowser non serve piu'.
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.request import urlopen

import websockets

from wk_browser import CHATGPT, cookie_chatgpt_da_openbrowser, ha_sessione

PROFILE = Path(os.environ.get("DARKROOM_CFT_PROFILE", str(Path.home() / ".cache/darkroom/cft-profile")))
PORT = int(os.environ.get("DARKROOM_CFT_PORT", "19225"))
LAUNCHER = os.environ.get("DARKROOM_CFT_BIN", str(Path.home() / ".openclaw/bin/agent-browser"))
COMPOSER = 'div[contenteditable="true"][id^="prompt-textarea"], div[contenteditable="true"].ProseMirror'
CHALLENGE_TITLES = ("Ci siamo quasi", "Just a moment", "Un momento")


class CFTError(RuntimeError):
    pass


# 20 s bastavano a Mac scarico; il 14/10 con load average ~100 l'avvio ne ha chiesti piu' di 20
# e ogni generazione falliva con «non risponde sulla porta». DARKROOM_CFT_WAIT_S lo regola.
WAIT_S = float(os.environ.get("DARKROOM_CFT_WAIT_S", "120"))


def _wait_cdp(timeout_s: float = WAIT_S) -> None:
    fine = time.time() + timeout_s
    while time.time() < fine:
        try:
            urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            return
        except Exception:
            time.sleep(0.3)
    raise CFTError(f"Chrome for Testing non risponde sulla porta {PORT}")


def _page_ws() -> str:
    tabs = json.load(urlopen(f"http://127.0.0.1:{PORT}/json"))
    pages = [t for t in tabs if t.get("type") == "page"]
    if not pages:
        raise CFTError("nessuna scheda nel Chrome for Testing di Darkroom")
    return pages[0]["webSocketDebuggerUrl"]


def _to_cdp_cookie(c: dict) -> dict:
    # Stessi cookie di wk_browser (formato Playwright), nel formato di Network.setCookies.
    out = {k: c[k] for k in ("name", "value", "secure", "httpOnly") if k in c}
    if "url" in c:
        out["url"] = c["url"]
    else:
        out["domain"], out["path"] = c["domain"], c.get("path", "/")
    if c.get("expires", -1) > 0:
        out["expires"] = c["expires"]
    out["sameSite"] = c.get("sameSite", "Lax")
    return out


async def _has_session(cdp) -> bool:
    r = await cdp.call("Network.getCookies", {"urls": [CHATGPT]})
    return ha_sessione(r.get("cookies", []))


async def on_challenge(cdp) -> bool:
    title = await cdp.js("document.title") or ""
    return any(t in title for t in CHALLENGE_TITLES)


async def click_turnstile(cdp) -> bool:
    """Un click sulla casella del Turnstile. False se la casella non c'e'.

    L'iframe di Cloudflare sta in uno shadow root chiuso: non si vede dal
    DOM. Si misura il contenitore dell'input `cf-turnstile-response`, che ha
    la stessa larghezza del widget; la casella e' a ~22 px dal bordo sinistro,
    a meta' altezza (misurato su nopecha.com: widget 272..572, casella a 293).
    """
    pos = await cdp.js("""
      (() => {
        const i = document.querySelector('[name=cf-turnstile-response]');
        if (!i || !i.parentElement) return null;
        const b = i.parentElement.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        return [Math.round(b.x + 22), Math.round(b.y + b.height / 2)];
      })()
    """)
    if not pos:
        return False
    x, y = pos
    await cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x - 40, "y": y - 12})
    await asyncio.sleep(0.15)
    await cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    await cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    await asyncio.sleep(0.1)
    await cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    return True


async def pass_challenge(cdp, max_clicks: int = 2, wait_s: float = 20) -> bool:
    """Se la pagina e' la sfida Cloudflare, clicca la casella (al massimo 2 volte)."""
    for _ in range(max_clicks):
        if not await on_challenge(cdp):
            return True
        # Il widget compare qualche secondo dopo il titolo.
        for _ in range(20):
            if await click_turnstile(cdp):
                print("[cft] sfida Cloudflare: click sulla casella", flush=True)
                break
            await asyncio.sleep(0.5)
        for _ in range(int(wait_s / 0.5)):
            await asyncio.sleep(0.5)
            if not await on_challenge(cdp):
                return True
    return not await on_challenge(cdp)


async def composer_ready(cdp, wait_s: float = 40) -> bool:
    for _ in range(int(wait_s / 0.5)):
        if await cdp.js(f"!!document.querySelector({COMPOSER!r})"):
            return True
        if await on_challenge(cdp):
            await pass_challenge(cdp)
        await asyncio.sleep(0.5)
    return False


@asynccontextmanager
async def open_cft():
    from edit_batch import CDP

    PROFILE.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [LAUNCHER, "--headless=new", f"--remote-debugging-port={PORT}",
         "--remote-debugging-address=127.0.0.1", f"--user-data-dir={PROFILE}",
         "--no-first-run", "--no-default-browser-check", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        _wait_cdp()
        async with websockets.connect(_page_ws(), max_size=100 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.call("Network.enable")
            if not await _has_session(cdp):
                imported = cookie_chatgpt_da_openbrowser()
                if not ha_sessione(imported):
                    raise CFTError("Chrome for Testing di Darkroom: ChatGPT non e' loggato e "
                                   "non c'e' una sessione da copiare da OpenBrowser")
                await cdp.call("Network.setCookies", {"cookies": [_to_cdp_cookie(c) for c in imported]})
            await cdp.call("Page.navigate", {"url": CHATGPT})
            if not await composer_ready(cdp, wait_s=60):
                raise CFTError("Chrome for Testing di Darkroom: composer di ChatGPT assente "
                               "dopo 60 s (sfida Cloudflare non superata?)")
            yield cdp
            try:
                await cdp.call("Browser.close", timeout=5)
            except Exception:
                pass
    finally:
        # Chiuso a fine job sempre, anche su errore: regola browser del Mac.
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


async def _probe() -> None:
    t0 = time.time()
    async with open_cft() as cdp:
        title = await cdp.js("document.title")
        guest = await cdp.js("[...document.querySelectorAll('button')].some(b => /^(Accedi|Log in)$/.test(b.innerText.trim()))")
        print(f"ok: composer pronto in {time.time() - t0:.1f}s, titolo={title!r}, loggato={not guest}", flush=True)


if __name__ == "__main__":
    asyncio.run(_probe())
