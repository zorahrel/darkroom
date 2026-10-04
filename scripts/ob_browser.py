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
import os
import secrets
import subprocess
import sys
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

    def _get_sync(self, path: str, timeout: float = 10) -> dict:
        req = Request(
            f"http://127.0.0.1:{self.porta}{path}",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")

    async def schede_chatgpt(self) -> set[str]:
        """Gli id delle schede ChatGPT non preferite, in questo momento."""
        try:
            tabs = (await asyncio.to_thread(self._get_sync, "/tabs")).get("tabs", [])
        except Exception:
            return set()
        return {
            t["id"] for t in tabs
            if t.get("type") != "fav" and "chatgpt.com" in (t.get("url") or "") and t.get("id")
        }

    async def scheda_attiva(self) -> str | None:
        """L'id della scheda in primo piano, qualunque sia."""
        try:
            tabs = (await asyncio.to_thread(self._get_sync, "/tabs")).get("tabs", [])
        except Exception:
            return None
        for t in tabs:
            if t.get("active"):
                return t.get("id")
        return None

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
            # Il campo DENTRO il box di scrittura, non il primo che accetta
            # immagini. Dal 24/09 ChatGPT ha cinque input file: `upload-files`
            # (accept vuoto) sta nel form, gli altri (`upload-photos`,
            # `upload-media`...) stanno fuori e un change li' non produce
            # miniature nel composer. La strada Chrome prendeva il primo del
            # documento, cioe' proprio `upload-files`.
            "var inp=document.querySelector('form input[type=file]')"
            "||ins.find(function(x){return (x.accept||'').indexOf('image')>=0})||ins[0];"
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


# ── OPENBROWSER ACCESO SOLO QUANDO SERVE ─────────────────────────────────────
#
# Prima OpenBrowser doveva restare aperto sempre: il 04/10 era su da 3 giorni e
# la scheda di automazione, riusata job dopo job con le immagini in base64,
# pesava 3,2 GB da sola (WebContent 37835, misurato con lsof). Ora il primo job
# lo apre in background se e' spento, e lo richiude dopo INATTIVO_S senza job.
#
# Tre regole, perche' e' anche il browser di Attilio:
#   - si chiude solo se l'ha aperto Darkroom (segno `avviato-da-darkroom`);
#   - mai mentre un altro processo di Darkroom lo sta usando (un file per uso,
#     con il pid: quelli di processi morti non contano);
#   - mai se c'e' aperta una scheda che non e' ChatGPT ne' una preferita: vuol
#     dire che qualcuno ci sta navigando, e allora il browser smette di essere
#     di Darkroom.
# L'attesa copre la pausa fra due job (20-35 s) con ampio margine: la coda non
# riapre il browser a ogni foto.
BUNDLE = "io.armonia.openbrowser"
STATO = Path.home() / ".cache/darkroom/openbrowser"
SEGNO = STATO / "avviato-da-darkroom"
RILASCIO = STATO / "ultimo-rilascio"
INATTIVO_S = 600
AVVIO_S = 45


def _pid_vivo(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def usi_vivi(cartella: Path = STATO) -> list[Path]:
    """I file d'uso di processi ancora vivi; quelli orfani si cancellano."""
    vivi = []
    for f in cartella.glob("uso-*"):
        try:
            pid = int(f.name.split("-")[1])
        except (IndexError, ValueError):
            continue
        if _pid_vivo(pid):
            vivi.append(f)
        else:
            f.unlink(missing_ok=True)
    return vivi


def _di_una_persona(t: dict) -> bool:
    """Una scheda che non e' ChatGPT, ne' una preferita, ne' vuota."""
    if t.get("type") == "fav":
        return False
    url = t.get("url") or ""
    return bool(url) and "chatgpt.com" not in url and not url.startswith("about:")


def da_chiudere(*, segno: bool, usi: int, fermo_da_s: float, schede: list[dict]) -> bool:
    """La decisione, pura: chiudere OpenBrowser adesso?"""
    if not segno or usi > 0 or fermo_da_s < INATTIVO_S:
        return False
    return not any(_di_una_persona(t) for t in schede)


def _richiesta(path: str, timeout: float) -> dict | None:
    try:
        porta, token = _credenziali()
        req = Request(f"http://127.0.0.1:{porta}{path}", headers={"Authorization": f"Bearer {token}"})
        with urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except Exception:
        return None


def _in_esecuzione() -> bool:
    return subprocess.run(["pgrep", "-xq", "OpenBrowser"]).returncode == 0


def _avvia_se_spento() -> None:
    if _richiesta("/tabs", 2) is not None:
        return
    # Il segno solo se il PROCESSO non c'era: un OpenBrowser aperto da Attilio
    # con l'API muta non diventa di Darkroom, e non verra' mai chiuso da qui.
    if not _in_esecuzione():
        subprocess.run(["open", "-g", "-j", "-b", BUNDLE], check=True)  # -g senza fuoco, -j nascosto
        SEGNO.touch()
    scadenza = time.monotonic() + AVVIO_S
    while time.monotonic() < scadenza:
        if _richiesta("/tabs", 2) is not None:
            return
        time.sleep(0.5)
    raise OBError(f"l'API di OpenBrowser non risponde dopo {AVVIO_S}s")


def attendi_e_chiudi() -> str:
    """Il processo staccato: aspetta che Darkroom resti ferma INATTIVO_S, poi decide.

    Uno solo alla volta (CHIUSURA): ogni fine job sposta solo l'ora
    dell'ultimo rilascio, e questo la rilegge a ogni risveglio."""
    while True:
        if not SEGNO.exists():
            return "non aperto da Darkroom"
        if usi_vivi():
            time.sleep(60)
            continue
        try:
            fermo = time.time() - RILASCIO.stat().st_mtime
        except FileNotFoundError:
            fermo = INATTIVO_S
        if fermo < INATTIVO_S:
            time.sleep(INATTIVO_S - fermo + 1)
            continue
        schede = (_richiesta("/tabs", 5) or {}).get("tabs") if _in_esecuzione() else None
        if schede is None:
            SEGNO.unlink(missing_ok=True)
            return "gia' chiuso"
        if not da_chiudere(segno=True, usi=0, fermo_da_s=fermo, schede=schede):
            SEGNO.unlink(missing_ok=True)  # ci naviga una persona: non e' piu' di Darkroom
            return "lasciato aperto: in uso"
        subprocess.run(["osascript", "-e", f'tell application id "{BUNDLE}" to quit'],
                       check=False, capture_output=True, timeout=60)
        SEGNO.unlink(missing_ok=True)
        # L'exit code di osascript non basta: una OB vecchia apriva il «Quit?» e restava viva.
        for _ in range(30):
            if not _in_esecuzione():
                return "chiuso"
            time.sleep(1)
        return "quit ignorato: OB ancora vivo"


CHIUSURA = STATO / "chiusura.pid"


def _programma_chiusura() -> None:
    RILASCIO.touch()
    if not SEGNO.exists():
        return
    try:
        if _pid_vivo(int(CHIUSURA.read_text())):
            return  # c'e' gia' chi aspetta, e rileggera' l'ora nuova
    except (FileNotFoundError, ValueError):
        pass
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--chiudi-se-inattivo"],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


@asynccontextmanager
async def open_openbrowser():
    STATO.mkdir(parents=True, exist_ok=True)
    uso = STATO / f"uso-{os.getpid()}-{secrets.token_hex(4)}"
    uso.touch()
    try:
        await asyncio.to_thread(_avvia_se_spento)
        async with _sessione() as ob:
            yield ob
    finally:
        uso.unlink(missing_ok=True)
        _programma_chiusura()


@asynccontextmanager
async def _sessione():
    ob = OBCDP()
    # Quale scheda ha aperto QUESTO giro: quella che compare fra prima e dopo
    # la navigazione. OpenBrowser ne apre una nuova solo se la scheda di
    # automazione e' andata persa; il 24/09, dopo una serata di giri interrotti,
    # ce n'erano sette accanto a quella dell'utente. Se invece riusa la scheda
    # fissata non compare niente e non c'e' niente da chiudere — e soprattutto
    # non si rischia di prendere per nostra una scheda che l'utente ha in primo
    # piano.
    # LA SCHEDA DI AUTOMAZIONE SI RIUSA, non si chiude a fine giro. Il 24/09
    # chiuderla a ogni giro faceva perdere a OpenBrowser la scheda fissata: il
    # giro dopo /navigate ne apriva una nuova e la fissava 0,4 s piu' tardi
    # prendendo QUELLA ATTIVA in quel momento. Il job 365 e' fallito cosi'
    # («la scheda di automazione non c'e' piu'»), subito dopo che il 364 era
    # riuscito. Tenuta aperta, /navigate la riusa e nessuna gara si apre.
    #
    # Gli avanzi si puliscono solo quando nasce una scheda nuova (OpenBrowser
    # riavviato, scheda chiusa a mano): allora le schede ChatGPT non preferite
    # che c'erano prima sono giri vecchi. Mai quella in primo piano, mai una
    # preferita: la sessione ChatGPT dell'utente sta in una preferita.
    prima = await ob.schede_chatgpt()
    await ob.naviga(CHATGPT)
    nuove = (await ob.schede_chatgpt()) - prima
    if nuove and prima:
        attiva = await ob.scheda_attiva()
        vecchie = [t for t in prima if t != attiva]
        if vecchie:
            try:
                await ob._post("/tabs/close", {"ids": vecchie}, timeout=10)
            except Exception:
                pass
    yield ob

if __name__ == "__main__" and sys.argv[1:] == ["--chiudi-se-inattivo"]:
    CHIUSURA.write_text(str(os.getpid()))
    try:
        esito = attendi_e_chiudi()
        (STATO / "ultima-chiusura").write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {esito}\n")
    finally:
        CHIUSURA.unlink(missing_ok=True)
