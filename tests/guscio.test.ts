import { afterEach, describe, expect, test } from "bun:test";
import { LIVELLI, livelloPer } from "../server/livelli";
import { anteprimaInProcesso, capacita, nelGuscioDesktop } from "../client/src/guscio";

// Le prove girano in un ambiente senza finestra, quindi ce ne diamo una: è l'unico
// modo per esercitare la scelta fra i due gusci senza aprire l'applicazione.
const globale = globalThis as unknown as { window?: unknown; document?: unknown };
const salvaFinestra = globale.window;
const salvaDocumento = globale.document;

afterEach(() => {
  if (salvaFinestra === undefined) delete globale.window;
  else globale.window = salvaFinestra;
  if (salvaDocumento === undefined) delete globale.document;
  else globale.document = salvaDocumento;
});

function documentoCon(guscio?: string) {
  globale.document = { documentElement: { dataset: guscio ? { guscio } : {} } };
}
function fingiDesktop() {
  globale.window = { __DARKROOM_GUSCIO__: "desktop" };
  documentoCon("desktop");
}
function fingiBrowser() {
  globale.window = { location: { protocol: "http:" } };
  documentoCon();
}

describe("il guscio", () => {
  test("nel browser non ci sono né anteprime in processo né cartelle locali", () => {
    fingiBrowser();
    expect(nelGuscioDesktop()).toBe(false);
    expect(capacita()).toEqual({ anteprimeInProcesso: false, cartellaLocale: false });
  });

  test("nell'applicazione ci sono entrambe", () => {
    fingiDesktop();
    expect(nelGuscioDesktop()).toBe(true);
    expect(capacita()).toEqual({ anteprimeInProcesso: true, cartellaLocale: true });
  });

  test("il marcatore del guscio basta da solo, anche senza nessuna variabile globale", () => {
    // È la spia che conta: la mette il guscio con uno script eseguito prima che la
    // pagina carichi, quindi c'è già al primo disegno. Le variabili globali di Tauri
    // dipendono da versione e configurazione, e fidarsi solo di quelle dava
    // un'applicazione che si comportava da browser — col nome sotto i semafori.
    globale.window = { location: { protocol: "tauri:" } };
    documentoCon("desktop");
    expect(nelGuscioDesktop()).toBe(true);
  });

  test("la variabile basta anche a documento vuoto", () => {
    // Lo script del guscio gira prima che il documento esista: se il marcatore
    // fosse solo un attributo sul documento, non verrebbe mai scritto.
    globale.window = { __DARKROOM_GUSCIO__: "desktop" };
    globale.document = undefined;
    expect(nelGuscioDesktop()).toBe(true);
  });

  test("si riconosce da tre spie diverse, perché ognuna può mancare", () => {
    // `__TAURI__` c'è solo con `withGlobalTauri`; `__TAURI_INTERNALS__` cambia fra
    // le versioni; il protocollo della pagina non dipende da nessuna iniezione.
    // Bastarsi su una sola dava un'applicazione che si comportava da browser: il
    // nome finiva sotto i semafori.
    documentoCon();
    globale.window = { __TAURI__: {} };
    expect(nelGuscioDesktop()).toBe(true);
    globale.window = { __TAURI_INTERNALS__: {} };
    expect(nelGuscioDesktop()).toBe(true);
    globale.window = { location: { protocol: "tauri:" } };
    expect(nelGuscioDesktop()).toBe(true);
  });
});

describe("anteprime senza rete", () => {
  test("nell'applicazione l'indirizzo è il protocollo del motore, non HTTP", () => {
    fingiDesktop();
    const u = anteprimaInProcesso("/foto/DSC1.ARW", 512);
    expect(u).toBe("anteprima://griglia/%2Ffoto%2FDSC1.ARW");
    expect(u).not.toContain("http");
  });

  test("la larghezza sceglie il livello, e il livello finisce nell'indirizzo", () => {
    fingiDesktop();
    expect(anteprimaInProcesso("/a.ARW", 200)).toContain("anteprima://proxy/");
    expect(anteprimaInProcesso("/a.ARW", 480)).toContain("anteprima://griglia/");
    expect(anteprimaInProcesso("/a.ARW", 2048)).toContain("anteprima://visore/");
    expect(anteprimaInProcesso("/a.ARW", 3000)).toContain("anteprima://nativo/");
  });

  test("un percorso con spazi e accenti resta leggibile dall'altra parte", () => {
    fingiDesktop();
    const u = anteprimaInProcesso("/Foto/Viaggio in Città/DSC 1.ARW", 512)!;
    const codificato = u.slice("anteprima://griglia/".length);
    expect(decodeURIComponent(codificato)).toBe("/Foto/Viaggio in Città/DSC 1.ARW");
  });

  test("nel browser non c'è nessuna strada in processo, e non se ne inventa una", () => {
    fingiBrowser();
    expect(anteprimaInProcesso("/foto/DSC1.ARW", 512)).toBeNull();
  });

  test("senza percorso non si costruisce niente, nemmeno nell'applicazione", () => {
    fingiDesktop();
    expect(anteprimaInProcesso(null, 512)).toBeNull();
    expect(anteprimaInProcesso(undefined, 512)).toBeNull();
    expect(anteprimaInProcesso("", 512)).toBeNull();
  });
});

describe("i livelli sono una tabella sola", () => {
  test("sono quattro e i nomi sono quelli che il motore conosce", () => {
    expect(LIVELLI.map((l) => l.nome)).toEqual(["proxy", "griglia", "visore", "nativo"]);
  });

  test("i lati sono quelli dichiarati, e il motore ha una prova che glielo impone", () => {
    expect(LIVELLI.map((l) => l.lato)).toEqual([256, 512, 2048, 3840]);
  });

  test("si arrotonda sempre al livello che copre, mai sotto", () => {
    for (const l of LIVELLI) {
      expect(livelloPer(l.lato).lato).toBeGreaterThanOrEqual(l.lato);
      expect(livelloPer(l.lato - 1).lato).toBeGreaterThanOrEqual(l.lato - 1);
    }
  });
});
