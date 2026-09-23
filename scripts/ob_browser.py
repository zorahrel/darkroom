"""
OpenBrowser come browser di ChatGPT, al posto di Chrome.

PERCHE' ESISTE. Dal 14/09 Chrome e Chromium non ci sono piu' su questo Mac
(regola `nochrome`), e con loro e' morto il backend `cdp`: l'unico che allega
le foto di riferimento. Codex genera senza browser ma modifica un'immagine
sola e ignora gli allegati — per questo le ultime versioni sono uscite da
passate in catena. OpenBrowser e' WebKit, ha un'API locale e, verificato il
23/09, ChatGPT ci e' gia' loggato (zorahrel@gmail.com, Pro): allegare via
DataTransfer funziona, e i byte di un'immagine tornano interi.

COSA FA. Si presenta a `edit_batch.py` con la stessa forma della classe `CDP`
(`call()` e `js()`), cosi' tutta la logica collaudata — attesa dell'immagine,
riconoscimento dei rifiuti, guasti del generatore — resta la stessa. Cambia
solo lo strato che parla col browser.

TRE VINCOLI DELL'API, e come sono aggirati:

1. `/execute` non attende le promise (evaluateJavaScript non le serializza).
   `js(await_promise=True)` salva l'esito in `window.__obR[k]` e lo interroga
   finche' non c'e'.
2. Una richiesta e' al massimo 1 MiB (`maxRequestBytes`). Gli allegati
   viaggiano a pezzi da 700 kB e si ricompongono nella pagina; le risposte
   lunghe (i byte dell'immagine generata) si leggono a fette.
3. La scheda di automazione e' un riferimento `weak`: se si chiude, i comandi
   finirebbero sulla SCHEDA ATTIVA, cioe' quella che l'utente sta usando.
   Per questo la scheda viene marcata con un contrassegno casuale in
   `window.name`, e ogni comando si rifiuta di girare se non lo trova.
   Meglio un job fallito che un clic sulla pagina sbagliata.
"""
from __future__ import annotations

import asyncio
import base64
import json
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.request import Request, urlopen

TOKEN_FILE = (
    Path.home()
    / "Library/Containers/io.armonia.openbrowser/Data/Library/Application Support"
    / "OpenBrowser/automation-token"
)
CHATGPT = "https://chatgpt.com/"
PEZZO = 700_000          # caratteri base64 per richiesta: sotto 1 MiB con margine
FETTA = 800_000          # caratteri per lettura di una risposta lunga


class OBError(RuntimeError):
    pass


def _credenziali() -> tuple[str, str]:
    if not TOKEN_FILE.exists():
        raise OBError("OpenBrowser: token assente, l'API di automazione e' spenta")
    righe = TOKEN_FILE.read_text().splitlines()
    return righe[0].strip(), righe[1].strip()


class OBCDP:
    """Stessa forma di `edit_batch.CDP`, sopra l'API di OpenBrowser."""

    def __init__(self) -> None:
        self.porta, self.token = _credenziali()
        self.segno = "darkroom-" + secrets.token_hex(8)
        self._k = 0

    # -- trasporto ---------------------------------------------------------
    def _post_sync(self, path: str, corpo: dict, timeout: float) -> dict:
        dati = json.dumps(corpo).encode()
        if len(dati) > (1 << 20):
            raise OBError(f"richiesta di {len(dati)} byte: oltre il limite di OpenBrowser")
        req = Request(
            f"http://127.0.0.1:{self.porta}{path}",
            data=dati,
            method="POST",
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")

    async def _post(self, path: str, corpo: dict, timeout: float = 60) -> dict:
        return await asyncio.to_thread(self._post_sync, path, corpo, timeout)

    async def _esegui(self, script: str, timeout: float = 60) -> str:
        """Esegue nella scheda marcata; solleva se il contrassegno non c'e'."""
        # La guardia RESTITUISCE un segnale invece di lanciare: WebKit rende
        # ogni eccezione anonima («A JavaScript exception occurred»), e una
        # guardia che fallisce deve dirlo per nome.
        guardia = f"if(window.name!=={json.dumps(self.segno)})return '__OB_GUARD__';"
        r = await self._post("/execute", {"script": f"(function(){{{guardia}{script}}})()"}, timeout)
        val = r.get("result", "")
        if val == "__OB_GUARD__":
            raise OBError(
                "OpenBrowser: la scheda di automazione non c'e' piu' — mi fermo "
                "invece di agire sulla scheda che stai usando"
            )
        if isinstance(val, str) and val.startswith("error:"):
            raise RuntimeError(f"JS error: {val}")
        return val

    # -- apertura della scheda --------------------------------------------
    async def naviga(self, url: str) -> None:
        # newTab false: se una scheda di automazione esiste si riusa, altrimenti
        # OpenBrowser ne apre una NUOVA (non dirotta mai quella dell'utente).
        r = await self._post("/navigate", {"url": url, "newTab": False}, timeout=40)
        if not r.get("ok"):
            raise OBError(f"OpenBrowser non e' arrivato a {url}: {r.get('failure')}")
        # Il contrassegno si rimette dopo ogni navigazione. Qui e' sicuro farlo
        # senza guardia: /navigate ha appena fissato la scheda di automazione, e
        # `/execute` gira su quella finche' esiste.
        await self._post(
            "/execute",
            {"script": f"window.name={json.dumps(self.segno)};location.host"},
        )

    # -- la stessa forma di CDP ---------------------------------------------
    async def call(self, method: str, params: dict | None = None, timeout: float = 30):
        params = params or {}
        if method in ("Runtime.enable", "Page.enable", "DOM.enable"):
            return {}
        if method == "Page.navigate":
            url = params.get("url", "")
            if url.startswith("about:"):
                # Chrome passava da about:blank per svuotare il DOM. Qui la
                # navigazione successiva a chatgpt.com lo svuota comunque, e
                # about:blank farebbe perdere il contrassegno.
                return {}
            await self.naviga(url)
            return {}
        if method == "Page.captureScreenshot":
            return {"data": ""}
        raise OBError(f"OpenBrowser: {method} non e' disponibile (serve solo a Chrome)")

    async def js(self, expr: str, await_promise: bool = False, timeout: float = 30):
        # L'espressione va nel TESTO dello script, non dentro un eval: la pagina
        # di ChatGPT ha una Content-Security-Policy senza 'unsafe-eval', e ogni
        # eval lanciava. Tutte le chiamate di edit_batch passano un'espressione
        # singola (una funzione invocata subito o un'espressione semplice), per
        # questo racchiuderla tra parentesi e' sicuro.
        corpo = expr.strip().rstrip(";")
        if not await_promise:
            s = await self._esegui(
                f"var __v=(\n{corpo}\n);"
                "return JSON.stringify({v:__v===undefined?null:__v});",
                timeout=max(timeout, 30),
            )
            return json.loads(s)["v"] if s else None

        self._k += 1
        k = json.dumps(f"r{self._k}")
        await self._esegui(
            "window.__obR=window.__obR||{};"
            f"window.__obR[{k}]=null;"
            f"Promise.resolve((\n{corpo}\n)).then("
            f"function(v){{window.__obR[{k}]=JSON.stringify({{ok:1,v:v===undefined?null:v}})}},"
            f"function(e){{window.__obR[{k}]=JSON.stringify({{ok:0,e:String(e&&e.message||e)}})}});"
            "return 'avviato';"
        )
        scadenza = time.monotonic() + timeout
        while True:
            n = await self._esegui(
                f"var s=window.__obR[{k}];return s===null?'-1':String(s.length);"
            )
            if n != "-1":
                break
            if time.monotonic() > scadenza:
                raise asyncio.TimeoutError(f"promise non risolta in {timeout}s")
            await asyncio.sleep(0.5)
        totale = int(n)
        parti = []
        for a in range(0, totale, FETTA):
            parti.append(
                await self._esegui(f"return window.__obR[{k}].slice({a},{a + FETTA});", timeout=120)
            )
        await self._esegui(f"delete window.__obR[{k}];return '';")
        esito = json.loads("".join(parti))
        if not esito.get("ok"):
            raise RuntimeError(f"JS error: {esito.get('e')} :: {expr[:100]}")
        return esito.get("v")

    # -- allegati -------------------------------------------------------------
    async def allega(self, paths: list[str]) -> int:
        """Mette i file nell'input del composer, come DOM.setFileInputFiles."""
        await self._esegui("window.__obUp=[];return '';")
        tipi = []
        for i, p in enumerate(paths):
            b64 = base64.b64encode(Path(p).read_bytes()).decode()
            await self._esegui(f"window.__obUp[{i}]='';return '';")
            for a in range(0, len(b64), PEZZO):
                await self._esegui(
                    f"window.__obUp[{i}]+={json.dumps(b64[a:a + PEZZO])};return '';", timeout=120
                )
            est = Path(p).suffix.lower()
            tipi.append("image/png" if est == ".png" else "image/webp" if est == ".webp" else "image/jpeg")
        nomi = [Path(p).name for p in paths]
        await self._esegui(
            f"var tipi={json.dumps(tipi)},nomi={json.dumps(nomi)};"
            "window.__obFiles=[];"
            "for(var i=0;i<window.__obUp.length;i++){"
            " var b=atob(window.__obUp[i]),u=new Uint8Array(b.length);"
            " for(var j=0;j<b.length;j++)u[j]=b.charCodeAt(j);"
            " window.__obFiles.push(new File([u],nomi[i],{type:tipi[i]}));}"
            "window.__obUp=null;return '';",
            timeout=120,
        )
        # CONSEGNA VERIFICATA, non un'attesa fissa. Misurato il 23/09: un file
        # consegnato appena dopo l'apertura della chat viene ignorato (0
        # miniature), lo stesso file 3 s dopo entra (1). La pagina non ha ancora
        # collegato i suoi gestori. Chrome non lo mostrava perche'
        # DOM.setFileInputFiles arriva per un'altra strada. Qui si consegna, si
        # controlla che le miniature siano comparse, e se no si riconsegna.
        conta = ("(function(){var f=document.querySelector('form')||document;"
                 "return [].slice.call(f.querySelectorAll('img')).length})()")
        consegna = (
            "var dt=new DataTransfer();window.__obFiles.forEach(function(f){dt.items.add(f)});"
            "var ins=[].slice.call(document.querySelectorAll('input[type=file]'));"
            "var inp=ins.find(function(x){return (x.accept||'').indexOf('image')>=0})||ins[0];"
            "if(!inp)return 'NOINPUT';"
            "inp.files=dt.files;"
            "inp.dispatchEvent(new Event('change',{bubbles:true}));"
            "return 'ok';"
        )
        for tentativo in range(6):
            prima = int(await self._esegui(f"return String({conta});") or 0)
            esito = await self._esegui(consegna)
            if esito == "NOINPUT":
                raise RuntimeError("input[type=file] non trovato")
            for _ in range(10):
                await asyncio.sleep(0.5)
                ora = int(await self._esegui(f"return String({conta});") or 0)
                if ora >= prima + len(paths):
                    await self._esegui("window.__obFiles=null;return '';")
                    return len(paths)
            await asyncio.sleep(1.5)
        await self._esegui("window.__obFiles=null;return '';")
        return 0


@asynccontextmanager
async def open_openbrowser():
    ob = OBCDP()
    await ob.naviga(CHATGPT)
    yield ob
