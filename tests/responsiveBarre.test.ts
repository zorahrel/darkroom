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
