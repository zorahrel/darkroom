import { describe, expect, test } from "bun:test";

/**
 * Le barre di Darkroom su un telefono: scorrono, non vanno a capo.
 *
 * MISURATO il 09/09 su un viewport 390x780 (iPhone), prima della correzione:
 * l'intestazione era alta 269 px in tre blocchi che andavano a capo a cascata,
 * e sommata alla barra dei filtri della griglia la PRIMA FOTO cominciava a
 * 523 px — il 67% dello schermo speso in comandi. Dopo: intestazione 181 px,
 * prima foto a 335 px (43%). Sono 188 px recuperati, quasi una fila di foto.
 *
 * Perche' un test sul sorgente e non sul browser. Il numero vero (l'altezza in
 * pixel) si misura solo con un browser vero a quella larghezza, e qui non c'e'
 * una suite che lo faccia: un test che finge di misurarlo sarebbe peggio di
 * nessun test. Questo blocca invece la DECISIONE — quelle tre barre scorrono —
 * che e' cio' che una modifica distratta toglierebbe.
 */
describe("le barre non vanno a capo sotto i 1024 px", () => {
  test("la regola .fila-scorre esiste e fa scorrere invece di impilare", async () => {
    const css = await Bun.file(new URL("../client/src/index.css", import.meta.url)).text();
    const i = css.indexOf(".fila-scorre");
    expect(i).toBeGreaterThan(-1);

    // La regola vive dentro un media query che si spegne sul desktop: sopra i
    // 1024 px andare a capo va bene, e' sul telefono che moltiplica l'altezza.
    const prima = css.slice(0, i);
    expect(prima).toContain("@media (max-width: 1023px)");

    const blocco = css.slice(i, i + 700);
    // Le due meta' della stessa decisione: non andare a capo E poter scorrere.
    // `nowrap` da solo era gia' stato provato in Grid.tsx e sfondava la pagina
    // (390 px di viewport, 744 px di documento: la griglia scorreva di lato).
    expect(blocco).toContain("flex-wrap: nowrap");
    expect(blocco).toContain("overflow-x: auto");
    // I figli non si schiacciano, altrimenti "scorrere" non serve a niente.
    expect(blocco).toContain("flex-shrink: 0");
  });

  test("le tre barre che andavano a capo la usano", async () => {
    const app = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const grid = await Bun.file(new URL("../client/src/pages/Grid.tsx", import.meta.url)).text();

    // Intestazione, blocco 1: marca + Strumenti/Progetti + progetto attivo.
    // Misurava 86 px su due righe a 390.
    expect(app).toContain('"fila-scorre flex flex-wrap items-center gap-2 min-w-0 max-w-full"');
    // Intestazione, blocco 3: allarmi + lavori + Esporta. Misurava 96 px.
    // Si cerca il blocco, non la stringa intera: le classi attorno cambiano (la
    // riga tutta sua ora se la prende solo da `md` in su, perche' sul telefono i
    // lavori sono scesi nella barra in fondo e restava una riga quasi vuota).
    // Cio' che non deve cambiare e' che scorra.
    const blocco3 = /className="([^"]*lg:ml-auto[^"]*)"/.exec(app)?.[1] ?? "";
    expect(blocco3).toContain("fila-scorre");
    expect(blocco3).toContain("lg:w-auto");
    // Barra dei filtri della griglia: quattro righe di chip su un telefono.
    expect(grid).toContain("fila-scorre flex flex-wrap sm:flex-nowrap items-center gap-1.5 text-xs");
  });

  test("nessuna barra resta con solo flex-nowrap e niente scorrimento", async () => {
    // La trappola gia' caduta una volta in Grid.tsx: vietare il ritorno a capo
    // senza dare dove scorrere sposta il problema sulla PAGINA, che comincia a
    // muoversi di lato. Se una barra dichiara `.fila-scorre` deve prendersi
    // tutta la regola, e la regola sta in un posto solo.
    const css = await Bun.file(new URL("../client/src/index.css", import.meta.url)).text();
    const occorrenze = css.split(".fila-scorre").length - 1;
    // 3: il selettore, il suo ::-webkit-scrollbar, e la regola sui figli.
    expect(occorrenze).toBe(3);
  });
});

describe("quale versione sto guardando si legge dal titolo", () => {
  /**
   * Il 13/09 l'utente: "nella tab aperta non vedo l'id o il numero".
   * Due difetti sovrapposti, entrambi misurati su un riquadro da 438 px:
   *
   *  1. il titolo diceva `1 · 1/7` — id della FOTO e sua posizione nella
   *     cartella: due numeri che non cambiano mai mentre si sfogliano le
   *     versioni. Il numero di versione stava solo dentro il carosello, che
   *     sotto i 1024 px e' una scheda dell'editor: due tocchi per sapere
   *     cosa hai davanti.
   *  2. quel titolo era comunque largo 3 PIXEL. Le due barre di azioni
   *     occupavano 136 e 259 px senza cedere, e `flex-wrap` faceva andare a
   *     capo prima di stringere: header da 61 a 113 px, oppure titolo
   *     schiacciato a un trattino.
   *
   * Le costanti qui sotto sono cio' che tiene: senza `flex-nowrap` il wrap
   * torna a costare 52 px di altezza, senza `min-w-[6rem]` il titolo torna a
   * 3 px, senza `fila-scorre` sulla barra destra i bottoni si schiacciano.
   */
  test("il titolo dell'editor contiene il numero di versione", async () => {
    const src = await Bun.file(
      new URL("../client/src/components/detail/PhotoPipeline.tsx", import.meta.url),
    ).text();
    // Solo il codice: i commenti citano apposta il vecchio titolo per
    // spiegare cosa e' cambiato, e leggerli farebbe fallire il test sul
    // testo che il test stesso vieta.
    const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // ancorato a <EditorRail: in questo file ci sono altri `title={` (i
    // tooltip dei bottoni), e il primo che capita non e' quello giusto.
    const rail = codice.slice(codice.indexOf("<EditorRail"));
    const titolo = /title=\{([\s\S]{0,400}?)\n\s*\}/.exec(rail)?.[1] ?? "";
    expect(titolo).toContain("versionNumber");
    expect(titolo).toContain("`v${versionNumber}`");
    // e resta il contesto utile: quale foto, e dove sta nella cartella
    expect(titolo).toContain("photoId");
    expect(titolo).toContain("photoNav");
  });

  test("il titolo ha una larghezza minima e la riga non va a capo", async () => {
    const rail = await Bun.file(
      new URL("../client/src/components/mobile/EditorRail.tsx", import.meta.url),
    ).text();
    const codice = rail.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    // `min-w-0` sul titolo significa "cedi tutto": era esattamente il bug.
    expect(codice).toContain('<Title className="min-w-[6rem] flex-1 truncate">');
    expect(codice).not.toContain('<Title className="min-w-0 flex-1 truncate">');

    // Senza nowrap il wrap scatta prima della riduzione e costa una riga.
    const header = /className="(flex[^"]*border-b border-neutral-800[^"]*)"/.exec(codice)?.[1] ?? "";
    expect(header).toContain("flex-nowrap");
    expect(header).toContain("lg:flex-wrap");

    // La barra destra cede spazio scorrendo, non schiacciando i bottoni.
    const destra = /className="(ml-auto[^"]*)"/.exec(codice)?.[1] ?? "";
    expect(destra).toContain("fila-scorre");
    expect(destra).toContain("min-w-0");
  });

  test("anche le schede di rotta scorrono", async () => {
    // Erano l'unica delle tre file dell'intestazione senza `fila-scorre`:
    // a 438 px sforavano di 10 px e la pagina si trascinava di lato.
    const app = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const nav = /<nav className="([^"]*rounded-md bg-neutral-900[^"]*)"/g;
    const classi = [...app.matchAll(nav)].map((m) => m[1] ?? "");
    const visibili = classi.filter((c) => !c.includes("hidden md:flex"));
    expect(visibili.length).toBeGreaterThan(0);
    for (const c of visibili) expect(c).toContain("fila-scorre");
  });
});
