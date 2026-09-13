import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fotogrammaUrl, thumbRawUrlDi } from "../client/src/api/urls";
import { assoluto, radiceApi } from "../client/src/api/http";

/**
 * Le immagini delle schede di `/studio` devono sapere dov'è il backend.
 *
 * Nell'applicazione la pagina arriva dal guscio (`tauri://localhost`), non dal
 * server: un indirizzo relativo come `/thumb/raw/…` finisce lì e non risponde
 * nessuno. Le altre chiamate passano da `assoluto()` e stanno a posto; queste
 * due no, ed è per questo che le schede restavano senza copertina nell'app
 * mentre nel browser si vedevano — un difetto che nessuna prova toccava perché
 * la suite gira in qualcosa che somiglia a un browser.
 */
const globale = globalThis as unknown as { window?: unknown; document?: unknown };
const salvaFinestra = globale.window;
const salvaDocumento = globale.document;

afterEach(() => {
  if (salvaFinestra === undefined) delete globale.window;
  else globale.window = salvaFinestra;
  if (salvaDocumento === undefined) delete globale.document;
  else globale.document = salvaDocumento;
});

function fingiDesktop() {
  globale.window = { __DARKROOM_GUSCIO__: "desktop" };
  globale.document = { documentElement: { dataset: { guscio: "desktop" } } };
}
function fingiBrowser() {
  globale.window = { location: { protocol: "http:" } };
  globale.document = { documentElement: { dataset: {} } };
}

describe("le copertine delle schede raggiungono il backend anche nell'applicazione", () => {
  test("nell'applicazione l'anteprima di una foto è un indirizzo assoluto", () => {
    fingiDesktop();
    expect(thumbRawUrlDi("japan", "IMG_1", 256)).toBe(
      "http://127.0.0.1:3535/thumb/raw/IMG_1?w=256&project=japan",
    );
  });

  test("nell'applicazione il fotogramma di una clip è un indirizzo assoluto", () => {
    fingiDesktop();
    const u = fotogrammaUrl("/Users/x/lungomare", "REEL.mp4", 256, 5);
    expect(u.startsWith("http://127.0.0.1:3535/api/girato/fotogramma?")).toBe(true);
    expect(u).toContain("clip=REEL.mp4");
    expect(u).toContain("t=5");
  });

  test("nel browser restano relativi: la pagina la serve già il backend", () => {
    fingiBrowser();
    expect(thumbRawUrlDi("japan", "IMG_1", 256)).toBe("/thumb/raw/IMG_1?w=256&project=japan");
    expect(fotogrammaUrl("/Users/x/lungomare", "REEL.mp4").startsWith("/api/girato/")).toBe(true);
  });
});

import { messaggioErrore } from "../client/src/api/http";

describe("gli errori del backend si leggono", () => {
  test("la frase del backend arriva senza le graffe attorno", () => {
    expect(messaggioErrore(400, "/api/sources", '{"error":"cartella inesistente: /x/y"}'))
      .toBe("cartella inesistente: /x/y");
  });

  test("quando non c'è una frase restano lo stato e la rotta, che è tutto ciò che si ha", () => {
    expect(messaggioErrore(502, "/api/sources", "<html>Bad Gateway</html>"))
      .toBe("502 /api/sources: <html>Bad Gateway</html>");
    expect(messaggioErrore(500, "/api/x", '{"altro":1}')).toBe('500 /api/x: {"altro":1}');
    expect(messaggioErrore(500, "/api/x", '{"error":"  "}')).toBe('500 /api/x: {"error":"  "}');
  });
});

describe("dentro un riquadro Tauri servito da http il backend e' chi ha servito la pagina", () => {
  /**
   * Il 13/09 Darkroom aperto in un riquadro Tauri servito da :3737 chiamava
   * :3535 — la porta scritta nel codice, di un server spento poco prima — e la
   * vista Albero restava su "Carico l'albero…" a tempo indefinito: 0 immagini,
   * nessun errore in console, nessun modo di capirlo dalla pagina.
   *
   * Le due spie erano entrambe vere: il riquadro E' Tauri, ma la pagina veniva
   * da http. Quando un'origine http c'e', e' quella la risposta giusta —
   * qualunque porta abbia — e la porta cablata serve solo a `tauri://`, dove
   * un indirizzo relativo punterebbe dentro il pacchetto.
   */
  test("protocollo http + marcatore desktop: indirizzi relativi", () => {
    globale.window = { __DARKROOM_GUSCIO__: "desktop", location: { protocol: "http:" } };
    globale.document = { documentElement: { dataset: { guscio: "desktop" } } };
    expect(radiceApi()).toBe("");
    expect(assoluto("/api/lineage")).toBe("/api/lineage");
  });

  test("protocollo tauri: resta la porta del guscio", () => {
    globale.window = { __DARKROOM_GUSCIO__: "desktop", location: { protocol: "tauri:" } };
    globale.document = { documentElement: { dataset: { guscio: "desktop" } } };
    expect(radiceApi()).toBe("http://127.0.0.1:3535");
    expect(assoluto("/api/lineage")).toBe("http://127.0.0.1:3535/api/lineage");
  });
});

describe("l'albero dice quando non si carica, invece di restare in attesa", () => {
  test("load() cattura l'errore e spegne comunque il caricamento", async () => {
    const src = await Bun.file(new URL("../client/src/pages/Tree.tsx", import.meta.url)).text();
    const load = src.slice(src.indexOf("const load = useCallback"), src.indexOf("useEffect(() => {"));
    // `finally` e non due `setLoading(false)`: e' cio' che garantisce che la
    // riga "Carico l'albero…" sparisca anche sul ramo che fallisce.
    expect(load).toContain("catch");
    expect(load).toContain("finally");
    expect(load).toContain("setErrore");
    // E il fallimento deve avere una via d'uscita a schermo, non solo in stato.
    expect(src).toContain("Riprova");
  });
});

/**
 * La navigazione in fondo esiste solo sul telefono, e lassu' non deve restare.
 *
 * Sono due barre che dicono le stesse cose: se una smettesse di nascondersi si
 * vedrebbero tutte e due, e nessun errore lo direbbe. La prova guarda la sorgente
 * perche' il guasto e' esattamente una classe dimenticata.
 */
describe("la barra in fondo", () => {
  const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

  test("si nasconde da md in su, dove la navigazione torna in cima", () => {
    const barra = /<nav[^>]*aria-label="Navigazione principale"[\s\S]{0,400}?>/.exec(app)?.[0] ?? "";
    expect(barra).toContain("md:hidden");
    expect(barra).toContain("fixed");
    // Lo spazio che il telefono si tiene sotto: senza, l'ultima voce ci finisce
    // sotto e si preme quella di sistema.
    expect(barra).toContain("env(safe-area-inset-bottom)");
  });

  test("e la navigazione in cima si nasconde sotto md, per non esserci due volte", () => {
    expect(app).toMatch(/className="hidden md:flex[^"]*"[\s\S]{0,200}?Strumenti/);
  });

  test("il contenuto lascia spazio alla barra, invece di finirci sotto", () => {
    expect(app).toMatch(/paddingBottom: "calc\([^"]*safe-area-inset-bottom[^"]*\)"/);
  });
});
