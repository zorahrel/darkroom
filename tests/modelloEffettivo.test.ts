import { describe, expect, test } from "bun:test";

/**
 * Quale modello ha generato una versione era invisibile E dichiarato falso.
 *
 * Falso: il percorso CDP apriva `https://chatgpt.com/?model=gpt-5`, ma il
 * client riscrive l'URL a `https://chatgpt.com/` e il parametro sparisce —
 * verificato il 09/09 aprendo la scheda e rileggendo `location.href`. Nello
 * stesso momento la conversazione che stava generando girava su
 * `gpt-5-4-thinking` e `gpt-5-4-auto-thinking`: due slug diversi nella STESSA
 * chat, perche' il router automatico cambia modello per messaggio.
 *
 * Invisibile: la UI mostrava "· ChatGPT" e basta, mentre per Higgsfield
 * stampava gia' modello e parametri. Su un progetto che confronta una
 * variabile alla volta, il modello che cambia sotto i piedi senza comparire da
 * nessuna parte e' la variabile nascosta piu' grossa.
 *
 * Questi test guardano il sorgente: la lettura vera richiede un browser
 * loggato, che in CI non c'e'.
 */
describe("il modello che ha generato si registra, non si finge", () => {
  test("l'URL della chat non porta piu' un parametro che viene ignorato", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Solo le righe di CODICE: il commento sopra la navigazione cita l'URL
    // vecchio apposta, per spiegare perche' non si usa piu'. Cercare nel file
    // intero bocciava la spiegazione insieme al difetto.
    const codice = py
      .split("\n")
      .filter((r) => !r.trimStart().startsWith("#"))
      .join("\n");
    expect(codice).not.toContain("chatgpt.com/?model=");
    expect(codice).toContain('"url": "https://chatgpt.com/"');
  });

  test("il modello si chiede al backend, non al DOM", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    const fn = py.slice(py.indexOf("async def modello_effettivo"), py.indexOf("async def single_shot"));
    expect(fn).toContain("/backend-api/conversation/");
    expect(fn).toContain("model_slug");
    // Deve restituire TUTTI gli slug usati: con il router automatico una sola
    // conversazione ne usa piu' di uno, e tenerne solo uno nasconde il fatto.
    expect(fn).toContain("join('+')");
    // Non deve poter far fallire una generazione riuscita: e' un dato per il log.
    expect(fn).toContain("except Exception:");
    expect(fn).toContain("return None");
  });

  test("lo slug viaggia fino al server nel JSON di uscita", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    expect(py).toContain('"model": getattr(single_shot, "ultimo_modello", None)');
  });

  test("il server lo salva in provider_params anche per chatgpt", async () => {
    const ts = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    expect(ts).toContain("JSON.stringify({ model: result.model");
  });

  test("la UI lo mostra invece di dire solo ChatGPT", async () => {
    const tsx = await Bun.file(
      new URL("../client/src/components/VersionCarousel.tsx", import.meta.url),
    ).text();
    const ramo = tsx.slice(
      tsx.indexOf('version.provider === "chatgpt"'),
      tsx.indexOf('let label = "Higgsfield"'),
    );
    expect(ramo).toContain("provider_params");
    expect(ramo).toContain("modello");
    // il fallback resta: una versione vecchia non ha lo slug e non deve rompersi
    expect(ramo).toContain('modello ? ` ${modello}` : ""');
  });
});
