"""
WebKit di Playwright come browser di ChatGPT, al posto di OpenBrowser.

PERCHE' ESISTE. Dall'08/10 Darkroom non guida piu' ChatGPT dentro OpenBrowser:
OpenBrowser e' il browser di Attilio, e ogni job gli occupava una scheda (e
fino a 3 GB di memoria). Questo e' un WebKit tutto di Darkroom: headless, con
un suo profilo persistente in ~/.cache/darkroom/webkit-profile, che vive solo
per la durata del job. Niente Chromium (regola browser del Mac), niente API a
pagamento: e' la stessa chat web del piano Pro.

COSA FA. Si presenta a `edit_batch.py` con la stessa forma della classe `CDP`
(`call()`, `js()`) e, come `OBCDP`, con `allega()` per gli allegati. Il resto
della logica collaudata non cambia.

IL LOGIN. Al primo avvio il profilo e' vuoto: i cookie di ChatGPT si copiano
dal profilo di OpenBrowser leggendo il suo Cookies.binarycookies (in sola
lettura, OpenBrowser non se ne accorge). `cf_clearance` e `__cf_bm` restano
fuori: sono legati all'impronta del browser d'origine e qui darebbero 403
permanenti (HANDOFF di OpenBrowser, punto 5). Se la copia non basta:
`python3 scripts/wk_browser.py --login` apre la finestra e ci si logga a mano.
"""
from __future__ import annotations

import asyncio
import base64
import os
import shutil
import struct
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

CHATGPT = "https://chatgpt.com/"
PROFILO = Path(os.environ.get("DARKROOM_WEBKIT_PROFILE", str(Path.home() / ".cache/darkroom/webkit-profile")))
# Il container "principale" di OpenBrowser: e' quello in cui ChatGPT e' loggato.
OB_COOKIES = (
    Path.home()
    / "Library/Containers/io.armonia.openbrowser/Data/Library/WebKit/WebsiteDataStore"
    / "f3157ef7-d787-44c4-acf8-442405f8a7e0/Cookies/Cookies.binarycookies"
)
SESSIONE = "__Secure-next-auth.session-token"
LEGATI_AL_BROWSER = {"cf_clearance", "__cf_bm", "_cfuvid"}
# Headless di default; `DARKROOM_WEBKIT_HEADLESS=0` apre la finestra (non
# basta contro il Turnstile: vedi `_composer_pronto`).
HEADLESS = os.environ.get("DARKROOM_WEBKIT_HEADLESS", "1") != "0"
MAC_EPOCH = 978307200


class WKError(RuntimeError):
    pass


# ── cookie di OpenBrowser ─────────────────────────────────────────────────────
def leggi_binarycookies(dati: bytes) -> list[dict]:
    """Il formato Cookies.binarycookies di WebKit, valori interi.

    Pagine big-endian, record little-endian; le stringhe stanno a offset
    relativi all'inizio del record, terminate da zero.
    """
    if dati[:4] != b"cook":
        raise WKError("Cookies.binarycookies: intestazione sconosciuta")
    n = struct.unpack(">i", dati[4:8])[0]
    misure = struct.unpack(f">{n}i", dati[8:8 + 4 * n])
    pos = 8 + 4 * n
    out = []
    for m in misure:
        pagina = dati[pos:pos + m]
        pos += m
        quanti = struct.unpack("<i", pagina[4:8])[0]
        offs = struct.unpack(f"<{quanti}i", pagina[8:8 + 4 * quanti])
        for o in offs:
            rec = pagina[o:]
            flags = struct.unpack("<i", rec[8:12])[0]
            uo, no, po, vo = struct.unpack("<4i", rec[16:32])
            scade = struct.unpack("<d", rec[40:48])[0]

            def s(a: int) -> str:
                return rec[a:rec.index(b"\0", a)].decode("utf-8", "replace")

            out.append({
                "domain": s(uo), "name": s(no), "path": s(po), "value": s(vo),
                "secure": bool(flags & 1), "httpOnly": bool(flags & 4),
                "expires": scade + MAC_EPOCH,
            })
    return out


def cookie_chatgpt_da_openbrowser(sorgente: Path = OB_COOKIES) -> list[dict]:
    """I cookie di chatgpt.com, pronti per `context.add_cookies`."""
    if not sorgente.exists():
        return []
    # Copia prima di leggere: OpenBrowser riscrive il file mentre gira.
    with tempfile.TemporaryDirectory() as d:
        copia = Path(d) / "c.binarycookies"
        shutil.copyfile(sorgente, copia)
        tutti = leggi_binarycookies(copia.read_bytes())
    out = []
    for c in tutti:
        dom = c["domain"]
        if not (dom == "chatgpt.com" or dom.endswith(".chatgpt.com")):
            continue
        if c["name"] in LEGATI_AL_BROWSER:
            continue
        dove = ({"url": CHATGPT} if c["name"].startswith("__Host-")  # __Host- vieta Domain
                else {"domain": dom, "path": c["path"] or "/"})
        out.append({
            "name": c["name"], "value": c["value"], **dove,
            "expires": c["expires"], "secure": c["secure"], "httpOnly": c["httpOnly"],
            "sameSite": "Lax",
        })
    return out


def ha_sessione(cookies: list[dict]) -> bool:
    return any(c["name"].startswith(SESSIONE) for c in cookies)


# ── la stessa forma di CDP ────────────────────────────────────────────────────
class WKCDP:
    """Stessa forma di `edit_batch.CDP`, sopra una pagina Playwright WebKit."""

    def __init__(self, page) -> None:
        self.page = page

    async def call(self, method: str, params: dict | None = None, timeout: float = 30):
        params = params or {}
        if method in ("Runtime.enable", "Page.enable", "DOM.enable"):
            return {}
        if method == "Page.navigate":
            await self.page.goto(params.get("url", "about:blank"), timeout=timeout * 1000,
                                 wait_until="domcontentloaded")
            return {}
        if method == "Page.captureScreenshot":
            png = await self.page.screenshot(timeout=timeout * 1000)
            return {"data": base64.b64encode(png).decode()}
        raise WKError(f"WebKit: {method} non e' disponibile (serve solo a Chrome)")

    async def js(self, expr: str, await_promise: bool = False, timeout: float = 30):
        # Playwright attende comunque le promise: `await_promise` serve solo a
        # non cambiare la firma di CDP.
        try:
            return await asyncio.wait_for(self.page.evaluate(expr), timeout)
        except asyncio.TimeoutError:
            raise
        except Exception as e:
            raise RuntimeError(f"JS error: {e} :: {expr[:100]}") from e

    async def allega(self, paths: list[str]) -> int:
        """Mette i file nell'input del composer e verifica che le miniature salgano."""
        # Il campo DENTRO il form, come in OBCDP: ChatGPT ha piu' input file e
        # solo quello del composer produce miniature.
        conta = ("(() => { const f = document.querySelector('form') || document;"
                 " return f.querySelectorAll('img').length })()")
        for _ in range(6):
            inp = self.page.locator("form input[type=file]").first
            if not await inp.count():
                inp = self.page.locator("input[type=file]").first
            if not await inp.count():
                raise RuntimeError("input[type=file] non trovato")
            prima = await self.page.evaluate(conta)
            await inp.set_input_files(paths)
            for _ in range(10):
                await asyncio.sleep(0.5)
                if await self.page.evaluate(conta) >= prima + len(paths):
                    return len(paths)
            await asyncio.sleep(1.5)
        return 0


@asynccontextmanager
async def _contesto(headless: bool):
    from playwright.async_api import async_playwright

    PROFILO.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        ctx = await pw.webkit.launch_persistent_context(
            str(PROFILO), headless=headless, viewport={"width": 1280, "height": 900},
            accept_downloads=True,
        )
        try:
            yield ctx
        finally:
            await ctx.close()


@asynccontextmanager
async def open_webkit():
    async with _contesto(HEADLESS) as ctx:
        if not ha_sessione(await ctx.cookies(CHATGPT)):
            importati = cookie_chatgpt_da_openbrowser()
            if not ha_sessione(importati):
                raise WKError(
                    "WebKit di Darkroom: ChatGPT non e' loggato e OpenBrowser non ha una "
                    "sessione da copiare — esegui `python3 scripts/wk_browser.py --login`"
                )
            await ctx.add_cookies(importati)
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(CHATGPT, wait_until="domcontentloaded", timeout=60_000)
        if not await _composer_pronto(page):
            raise WKError(
                "WebKit di Darkroom: Cloudflare chiede di cliccare «non sono un robot» "
                "— esegui `python3 scripts/wk_browser.py --login` e clicca tu"
            )
        yield WKCDP(page)


async def _composer_pronto(page, attesa_s: float = 20) -> bool:
    """Il composer di ChatGPT e' comparso, o siamo fermi alla sfida Cloudflare?

    Misurato l'08/10: al WebKit di Playwright, headless E con finestra,
    Cloudflare a volte mostra il Turnstile con la casella da cliccare («Ci
    siamo quasi…»), e non passa da solo. La casella NON si clicca da qui: e'
    un controllo anti-bot, lo supera una persona con `--login`, e il
    cf_clearance resta nel profilo.
    """
    composer = 'div[contenteditable="true"][id^="prompt-textarea"], div[contenteditable="true"].ProseMirror'
    for _ in range(int(attesa_s / 0.5)):
        if await page.evaluate(f"!!document.querySelector({composer!r})"):
            return True
        await asyncio.sleep(0.5)
    return False


async def _login() -> None:
    async with _contesto(headless=False) as ctx:
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto(CHATGPT)
        print("Supera il controllo Cloudflare e fai il login se serve, poi chiudi la finestra.",
              flush=True)
        await page.wait_for_event("close", timeout=0)


if __name__ == "__main__" and sys.argv[1:] == ["--login"]:
    asyncio.run(_login())
