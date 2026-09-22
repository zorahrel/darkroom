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
    // Misurava 86 px su due righe a 390. Il 14/09 e' passato da `flex-wrap` a
    // `flex-nowrap lg:flex-wrap` + `shrink`: non basta che scorra, deve anche
    // CEDERE, altrimenti 160+223+gap = 395 in 390 e l'intestazione torna a
    // tre righe (175 px). Si cerca il blocco, non la stringa intera.
    // Il 14/09 (sera) la topbar e' passata a `fila-scorre-sempre`: il ritorno a
    // capo NON torna nemmeno sopra lg. Misurato a 1100 px: con `lg:flex-wrap`
    // i tre blocchi sommavano 1160 in 1100 e l'intestazione raddoppiava a
    // 101 px; senza, resta 57 px a 691/1100/1440/1920 con overflowX 0.
    const blocco1 = /className="(fila-scorre-sempre flex [^"]*max-w-full[^"]*)"/.exec(app)?.[1] ?? "";
    expect(blocco1).toContain("flex-nowrap");
    expect(blocco1).toContain("shrink");
    // Intestazione, blocco 3: allarmi + lavori + Esporta. Misurava 96 px.
    // Si cerca il blocco, non la stringa intera: le classi attorno cambiano (la
    // riga tutta sua ora se la prende solo da `md` in su, perche' sul telefono i
    // lavori sono scesi nella barra in fondo e restava una riga quasi vuota).
    // Cio' che non deve cambiare e' che scorra.
    const blocco3 = /className="([^"]*ml-auto[^"]*)"/.exec(app)?.[1] ?? "";
    expect(blocco3).toContain("fila-scorre-sempre");
    expect(blocco3).toContain("flex-nowrap");
    // Barra dei filtri della griglia: quattro righe di chip su un telefono.
    expect(grid).toContain("fila-scorre flex flex-wrap sm:flex-nowrap items-center gap-1.5 text-xs");
  });

  test("nessuna barra resta con solo flex-nowrap e niente scorrimento", async () => {
    // La trappola gia' caduta una volta in Grid.tsx: vietare il ritorno a capo
    // senza dare dove scorrere sposta il problema sulla PAGINA, che comincia a
    // muoversi di lato. Se una barra dichiara `.fila-scorre` deve prendersi
    // tutta la regola, e la regola sta in un posto solo.
    const css = await Bun.file(new URL("../client/src/index.css", import.meta.url)).text();
    // Due utility, non una, e la differenza e' una decisione: `.fila-scorre`
    // cede il passo al ritorno a capo sopra lg (barre di pagina, dove lo spazio
    // in larghezza c'e'); `.fila-scorre-sempre` non cede mai (la topbar, che a
    // 1100 px raddoppiava di altezza proprio per quel ritorno a capo).
    // Ognuna porta le sue tre righe: selettore, ::-webkit-scrollbar, figli.
    // I commenti si tolgono prima di contare: uno dei due nomi e' citato nella
    // spiegazione dell'altro, e una citazione non e' una regola.
    const soloRegole = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const nome of [".fila-scorre-sempre", ".fila-scorre"]) {
      const regola = new RegExp(`\\${nome}(?![-\\w])`, "g");
      expect(soloRegole.match(regola)?.length ?? 0).toBe(3);
    }
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

describe("su un telefono le barre non mangiano mezzo schermo", () => {
  /**
   * MISURATO il 14/09 su un viewport 390x800, prima della correzione:
   *
   *     rotta            prima foto   schermo speso
   *     /p/profilo          329 px        41%
   *     /tree               462 px        57%
   *     /culling            514 px        64%
   *
   * Due cause, la stessa forma: `flex-wrap` su mobile moltiplica l'ALTEZZA,
   * che sul telefono e' la risorsa scarsa, mentre la larghezza si puo'
   * scorrere.
   *
   *   1. L'intestazione globale: tre file (160 + 356 + 223 px di contenuto in
   *      390) su tre righe = 175 px. Le schede di rotta prendono una riga
   *      loro (scorrendo dentro), marca e progetto cedono e stanno sopra
   *      insieme: 123 px, due righe.
   *   2. La `Toolbar` condivisa: 214 px su culling perche' un GRUPPO interno
   *      da 92 px era andato a capo dentro una barra che a sua volta andava a
   *      capo. Da qui `.barra-scorre`, che vieta il capo a tutta la
   *      discendenza e non solo alla barra.
   *
   * Dopo: 277 / 310 / 310 px (34-38%), overflow-X 0 a 390 E a 1440.
   */
  test("la Toolbar condivisa scorre sotto lg e vieta il capo ai gruppi interni", async () => {
    const ui = await Bun.file(new URL("../client/src/ui.tsx", import.meta.url)).text();
    const toolbar = /export function Toolbar[\s\S]{0,900}?\n}/.exec(ui)?.[0] ?? "";
    expect(toolbar).toContain("fila-scorre");
    expect(toolbar).toContain("barra-scorre");
    expect(toolbar).toContain("flex-nowrap lg:flex-wrap");

    // la regola che estende il divieto ai discendenti deve esistere davvero
    const css = await Bun.file(new URL("../client/src/index.css", import.meta.url)).text();
    expect(css).toMatch(/\.barra-scorre[^{]*\{[^}]*flex-wrap:\s*nowrap/);
  });

  test("nell'intestazione le schede di rotta prendono una riga loro su mobile", async () => {
    const app = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const nav = /<nav className="fila-scorre[^"]*"/.exec(app)?.[0] ?? "";
    // Il 14/09 (sera) la riga tutta sua e' stata tolta: `w-full order-last`
    // forzava una seconda riga anche quando le schede ci stavano in fila, e
    // l'intestazione misurava 101 px a 1100. Ora le schede SCORRONO nella riga
    // unica — l'obiettivo era una riga sola, non una riga dedicata.
    expect(nav).toContain("fila-scorre-sempre");
    expect(nav).toContain("min-w-0");
    expect(nav).not.toContain("order-last");
  });

  test("marca e progetto cedono invece di andare a capo", async () => {
    const app = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    // i due blocchi laterali dell'intestazione: nowrap sotto lg e riducibili,
    // altrimenti 160+223+gap = 395 in 390 e si torna a tre righe
    const laterali = [...app.matchAll(/className="fila-scorre-sempre flex [^"]*"/g)].map((m) => m[0]);
    const conNowrap = laterali.filter((c) => c.includes("flex-nowrap"));
    expect(conNowrap.length).toBeGreaterThanOrEqual(2);
    expect(conNowrap.some((c) => c.includes("shrink"))).toBe(true);
    expect(conNowrap.some((c) => c.includes("min-w-0"))).toBe(true);
  });
});

describe("un wrapper senza box non trasmette lo shrink ai bottoni", () => {
  /**
   * MISURATO nel browser il 20/09 a 1037 px, sulla barra in alto a destra:
   *
   *     bottone «Lavori»   w = 18 px   (ne servono ~109)
   *     «fermi» x=923 w=29 · «~$4.37 spesi» x=924 w=79
   *     sovrapposizione reale 28 px in x, 18 px in y
   *
   * Il testo del bottone finiva SOPRA il badge della spesa. La causa non era il
   * badge: il bottone stava dentro `<span class="hidden md:contents">`, e
   * `display: contents` non genera box — quindi il `flex-shrink: 0` che
   * `.fila-scorre-sempre > *` mette sui figli diretti cadeva nel vuoto e il
   * bottone restava a shrink 1, libero di schiacciarsi a 18 px.
   *
   * La regola CSS non puo' attraversare un `display: contents`: non esiste un
   * selettore per il display calcolato. Quindi il divieto sta qui.
   */
  test("nessun `contents` dentro le barre che scorrono", async () => {
    const src = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const codice = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(codice).not.toContain("md:contents");
    expect(codice).not.toContain("lg:contents");
  });

  test("i wrapper che nascondono un bottone hanno un box e non cedono", async () => {
    const src = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const codice = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const wrapper = [...codice.matchAll(/className="hidden (md|lg):(\w+)[^"]*"/g)];
    expect(wrapper.length).toBeGreaterThan(0);
    for (const w of wrapper) {
      // un display che genera box: flex, inline-flex, block... mai `contents`
      expect(w[2]).not.toBe("contents");
    }
    // e devono dichiarare di non stringersi, come i figli diretti della barra
    expect(codice).toContain('className="hidden md:flex shrink-0"');
  });
});

describe("la barra non offre di avviare un Chrome che non esiste", () => {
  /**
   * Il 20/09 questa macchina non ha piu' Chrome (`/Applications/Google
   * Chrome.app` assente). La barra mostrava lo stesso «Chrome non collegato —
   * avvialo»: 221 px su 778 di larghezza, il pezzo piu' grande della fila, per
   * un bottone che risponde sempre `No Chrome/Chromium found`.
   *
   * Un'azione che non puo' riuscire e' peggio di nessuna azione: manda a
   * cercare una colpa propria. Ora `/api/health` dice se il binario esiste, e
   * la UI in quel caso mostra il backend che sta davvero lavorando (79 px).
   */
  test("health distingue «non avviato» da «non installato»", async () => {
    const src = await Bun.file(new URL("../server/routes/studio.ts", import.meta.url)).text();
    expect(src).toContain("chrome_installed");
    expect(src).toContain("resolveChromeBin()");
    // il backend in uso viaggia con la diagnosi: senza, «non installato» non dice cosa sta lavorando
    expect(src).toMatch(/backend:\s*WORKER_BACKEND/);
  });

  test("il bottone «avvialo» sparisce quando Chrome non c'e'", async () => {
    const src = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const codice = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // il ramo con il bottone è condizionato a chrome_installed !== false
    expect(codice).toContain("health.chrome_installed !== false");
    // e il ramo senza Chrome non contiene la chiamata di lancio
    const senzaChrome = codice.slice(
      codice.indexOf("health.chrome_installed === false"),
      codice.indexOf("health.chrome_installed !== false"),
    );
    expect(senzaChrome.length).toBeGreaterThan(10);
    expect(senzaChrome).not.toContain("/api/browser/launch");
  });
});

describe("la barra va a capo invece di nascondere la navigazione", () => {
  /**
   * MISURATO nel browser il 20/09 a 780 px, con la barra forzata su una riga
   * sola e ogni striscia che scorreva da se':
   *
   *     striscia 1   servono 381 px, ne aveva 195
   *     striscia 2   servono 354 px, ne aveva 183
   *     striscia 3   servono 510 px, ne aveva 261
   *
   * e «Profilo», «Albero», «Riferimenti», «Esporta preferite» erano fuori dalla
   * vista: non piccoli, invisibili. Comprimere in una riga aveva scambiato
   * «alto» con «irraggiungibile», che e' peggio: l'altezza si scorre, una voce
   * nascosta dentro un nastro no.
   *
   * Dopo: tre righe, 149 px, zero elementi nascosti, overflow 0.
   */
  test("l'intestazione non vieta il ritorno a capo", async () => {
    const src = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const header = codice.slice(codice.indexOf("mx-auto max-w-none px-3"), codice.indexOf("mx-auto max-w-none px-3") + 220);
    expect(header).toContain("flex-wrap");
    expect(header).not.toContain("flex-nowrap");
  });

  test("il posto dei semafori e' un segnaposto, non padding sull'intestazione", async () => {
    const src = await Bun.file(new URL("../client/src/App.tsx", import.meta.url)).text();
    const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // Il padding rientra a OGNI riga: con la barra che va a capo costava 92 px
    // anche dove i semafori non ci sono (780 px di viewport -> 672 utili
    // invece di 748, e le prime due strisce non stavano insieme per 65 px).
    const stile = /style=\{desktop \? \{([^}]*)\}/.exec(codice);
    expect(stile).not.toBeNull();
    expect(stile![1]).not.toContain("paddingLeft");
    expect(stile![1]).toContain("minHeight");
    // il segnaposto e' un figlio del flex, quindi occupa solo la prima riga
    expect(codice).toMatch(/desktop && <div aria-hidden[\s\S]{0,120}width: 76/);
  });
});
