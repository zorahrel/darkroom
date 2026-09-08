import { afterEach, describe, expect, test } from "bun:test";
import { LIVELLI, livelloPer } from "../server/livelli";
import { anteprimaInProcesso, capacita, nelGuscioDesktop } from "../client/src/guscio";

// Le prove girano in un ambiente senza finestra, quindi ce ne diamo una: è l'unico
// modo per esercitare la scelta fra i due gusci senza aprire l'applicazione.
const finestra = globalThis as unknown as { window?: unknown };
const salva = finestra.window;

afterEach(() => {
  if (salva === undefined) delete finestra.window;
  else finestra.window = salva;
});

function fingiDesktop() {
  finestra.window = { __TAURI_INTERNALS__: {} };
}
function fingiBrowser() {
  finestra.window = {};
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
