#!/usr/bin/env python3
"""
Fa descrivere a ChatGPT la luce di un'immagine, con le parole che lui stesso
usa per generarla.

PERCHE'. Sei giri di prompt scritti da me (gel, beauty, faretto) non hanno
tenuto insieme colore e direzione della reference: ogni volta che uno saliva
l'altro calava. Le descrizioni erano mie, misurate sui pixel, tradotte in
parole che il generatore interpreta a modo suo ("verde" ne e' la prova). Qui
la traduzione la fa lo stesso modello che poi genera: guarda la reference e
scrive il blocco luce come lo scriverebbe per riprodurla.

Nessuna immagine viene generata: e' un turno di chat con un allegato, e la
risposta testuale finisce su stdout (e in un file, se passato).

Uso: DARKROOM_BROWSER=openbrowser python3 scripts/deprompt_chatgpt.py \
        <immagine> "<domanda>" [output.txt]
"""
import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import edit_batch as eb  # noqa: E402
from ob_browser import open_openbrowser  # noqa: E402

LOCK = Path.home() / ".cache/darkroom/chatgpt-worker.lock"

# La risposta si legge dall'API della conversazione, non dal DOM: la scheda di
# automazione sta in secondo piano e WebKit li' rallenta il rendering del testo
# che scorre. Misurato due volte: il DOM restava fermo su «Ritratto editoriale
# da» per piu' di 12 secondi mentre la risposta era gia' completa.
LEGGI_RISPOSTA = """(() => {
  const id = (location.pathname.match(/\\/c\\/([\\w-]+)/) || [])[1];
  if (!id) return JSON.stringify({id: null});
  const s = new XMLHttpRequest(); s.open('GET', '/api/auth/session', false); s.send();
  const tok = (JSON.parse(s.responseText) || {}).accessToken;
  const x = new XMLHttpRequest(); x.open('GET', '/backend-api/conversation/' + id, false);
  x.setRequestHeader('Authorization', 'Bearer ' + tok); x.send();
  if (x.status !== 200) return JSON.stringify({id, http: x.status});
  const j = JSON.parse(x.responseText);
  let n = j.mapping[j.current_node], out = null;
  while (n) {
    const m = n.message;
    if (m && m.author && m.author.role === 'assistant' && m.content && m.content.content_type === 'text') { out = m; break; }
    n = n.parent ? j.mapping[n.parent] : null;
  }
  if (!out) return JSON.stringify({id, t: ''});
  return JSON.stringify({id, t: (out.content.parts || []).join('\\n'), fine: out.status === 'finished_successfully' && !!out.end_turn});
})()"""


def prendi_lucchetto() -> None:
    # Stesso formato del server («pid ms»): il server lo rispetta e, se questo
    # processo muore, lo considera morto e lo riprende (proprietarioMorto).
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(120):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {int(time.time()*1000)}".encode())
            os.close(fd)
            return
        except FileExistsError:
            time.sleep(5)
    raise SystemExit("browser occupato da 10 minuti")


def lascia_lucchetto() -> None:
    try:
        if LOCK.read_text().split()[0] == str(os.getpid()):
            LOCK.unlink()
    except FileNotFoundError:
        pass


async def main(img: str, domanda: str, out: str | None) -> None:
    import json
    async with open_openbrowser() as ob:
        await eb.new_chat(ob)
        base = await eb.snapshot_form_thumbs(ob)
        up, _ = eb.prepare_uploads([img], "deprompt")
        await eb.upload_file(ob, up[0])
        if not await eb.wait_image_attached(ob, baseline=base, timeout=60, expected=1):
            raise SystemExit("allegato non agganciato")
        await eb.send_prompt(ob, domanda)
        testo, t0 = "", time.time()
        while time.time() - t0 < 300:
            await asyncio.sleep(5)
            r = json.loads(await ob.js(LEGGI_RISPOSTA))
            testo = r.get("t") or ""
            if r.get("fine") and testo:
                break
        if not testo:
            raise SystemExit("nessuna risposta")
        print(testo)
        if out:
            Path(out).write_text(testo)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    prendi_lucchetto()
    try:
        asyncio.run(main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    finally:
        lascia_lucchetto()
