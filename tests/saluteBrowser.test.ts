import { describe, expect, test } from "bun:test";
import { creaSaluteBrowser } from "../server/saluteBrowser";

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("la salute di Chrome non fa aspettare le pagine", () => {
  test("un controllo lento non trattiene la risposta oltre il budget", async () => {
    // Il controllo vero può metterci sette secondi: due per aprire il CDP e cinque
    // per farsi calcolare 1+1 da una pagina impallata.
    const salute = creaSaluteBrowser(async () => { await attesa(3000); return true; }, { budgetMs: 120 });
    const inizio = Date.now();
    expect(await salute()).toBe(false);
    expect(Date.now() - inizio).toBeLessThan(400);
  });

  test("dalla seconda volta si risponde con quello che si sa, senza aspettare niente", async () => {
    let chiamate = 0;
    const salute = creaSaluteBrowser(async () => { chiamate++; await attesa(30); return true; },
                                     { budgetMs: 500, validitaMs: 10_000 });
    expect(await salute()).toBe(true);
    const inizio = Date.now();
    expect(await salute()).toBe(true);
    expect(await salute()).toBe(true);
    expect(Date.now() - inizio).toBeLessThan(20);
    // Finché la nota è fresca il controllo non si rifà.
    expect(chiamate).toBe(1);
  });

  test("la risposta invecchia e il controllo riparte, ma dietro", async () => {
    let valore = true;
    let chiamate = 0;
    const salute = creaSaluteBrowser(async () => { chiamate++; await attesa(40); return valore; },
                                     { budgetMs: 500, validitaMs: 60 });
    expect(await salute()).toBe(true);
    valore = false;
    await attesa(80);
    // Scaduta: risponde ancora com'era, e intanto rifà il controllo.
    const inizio = Date.now();
    expect(await salute()).toBe(true);
    expect(Date.now() - inizio).toBeLessThan(20);
    await attesa(80);
    expect(await salute()).toBe(false);
    expect(chiamate).toBe(2);
  });

  test("un controllo che esplode vale «non collegato», non un errore in faccia", async () => {
    const salute = creaSaluteBrowser(async () => { throw new Error("CDP morto"); }, { budgetMs: 300 });
    expect(await salute()).toBe(false);
  });
});
