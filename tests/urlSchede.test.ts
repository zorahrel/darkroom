import { afterEach, describe, expect, test } from "bun:test";
import { fotogrammaUrl, thumbRawUrlDi } from "../client/src/api/urls";

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
