import { describe, expect, test } from "bun:test";
import {
  patchDaTasto,
  tastoGiudica,
  unisciGiudizio,
  type Giudizio,
} from "../client/src/culling";

const vuoto: Giudizio = { stelle: null, colore: null };

describe("fusione del giudizio", () => {
  test("dare le stelle non cancella l'etichetta", () => {
    // È il difetto che ha rotto il primo giro: l'API vuole il giudizio intero,
    // quindi mandare solo le stelle cancellava il colore.
    const attuale: Giudizio = { stelle: null, colore: "verde" };
    expect(unisciGiudizio(attuale, { stelle: 3 })).toEqual({ stelle: 3, colore: "verde" });
  });

  test("dare l'etichetta non cancella le stelle", () => {
    const attuale: Giudizio = { stelle: 4, colore: null };
    expect(unisciGiudizio(attuale, { colore: "blu" })).toEqual({ stelle: 4, colore: "blu" });
  });

  test("la sequenza vera — prima le stelle, poi il colore — conserva entrambi", () => {
    let g = unisciGiudizio(vuoto, patchDaTasto("3", vuoto)!);
    g = unisciGiudizio(g, patchDaTasto("8", g)!);
    expect(g).toEqual({ stelle: 3, colore: "verde" });
  });

  test("togliere esplicitamente un valore lo toglie davvero", () => {
    const attuale: Giudizio = { stelle: 5, colore: "rosso" };
    expect(unisciGiudizio(attuale, { stelle: null })).toEqual({ stelle: null, colore: "rosso" });
    expect(unisciGiudizio(attuale, { colore: null })).toEqual({ stelle: 5, colore: null });
  });

  test("senza uno scatto di partenza non si inventa niente", () => {
    expect(unisciGiudizio(null, { stelle: 2 })).toEqual({ stelle: 2, colore: null });
  });

  test("zero stelle è un valore, non un'assenza", () => {
    const g = unisciGiudizio({ stelle: 4, colore: "blu" }, { stelle: 0 });
    expect(g.stelle).toBe(0);
    expect(g.colore).toBe("blu");
  });
});

describe("mappa dei tasti", () => {
  test("le cifre, la barra rovesciata e la x giudicano", () => {
    for (const k of ["0", "1", "5", "9", "\\", "x", "X"]) {
      expect(tastoGiudica(k)).toBe(true);
    }
  });

  test("le frecce non giudicano, e devono restare fuori dal filtro delle ripetizioni", () => {
    // Se le frecce finissero fra i tasti che giudicano, il filtro della ripetizione
    // le mangerebbe e tenendo premuto non si scorrerebbe più.
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "a"]) {
      expect(tastoGiudica(k)).toBe(false);
    }
  });

  test("da 1 a 5 sono le stelle", () => {
    expect(patchDaTasto("1", vuoto)).toEqual({ stelle: 1 });
    expect(patchDaTasto("5", vuoto)).toEqual({ stelle: 5 });
  });

  test("da 6 a 0 sono i cinque colori, nell'ordine", () => {
    expect(patchDaTasto("6", vuoto)).toEqual({ colore: "rosso" });
    expect(patchDaTasto("7", vuoto)).toEqual({ colore: "giallo" });
    expect(patchDaTasto("8", vuoto)).toEqual({ colore: "verde" });
    expect(patchDaTasto("9", vuoto)).toEqual({ colore: "blu" });
    expect(patchDaTasto("0", vuoto)).toEqual({ colore: "viola" });
  });

  test("ripremere lo stesso colore lo toglie", () => {
    const conVerde: Giudizio = { stelle: 2, colore: "verde" };
    expect(patchDaTasto("8", conVerde)).toEqual({ colore: null });
    // Un colore diverso invece sostituisce.
    expect(patchDaTasto("9", conVerde)).toEqual({ colore: "blu" });
  });

  test("la barra rovesciata riporta lo scatto a «non ancora guardato»", () => {
    expect(patchDaTasto("\\", { stelle: 5, colore: "rosso" })).toEqual({
      stelle: null,
      colore: null,
    });
  });

  test("la x segna «guardato e scartato», che non è la stessa cosa", () => {
    // Senza un tasto per lo zero, lo stato «scartata» sarebbe esistito nel
    // database e nel rendiconto senza che nessuno potesse produrlo: il filtro
    // «Scartate» non si sarebbe popolato mai.
    expect(patchDaTasto("x", { stelle: 5, colore: "rosso" })).toEqual({
      stelle: 0,
      colore: null,
    });
    expect(patchDaTasto("X", vuoto)).toEqual({ stelle: 0, colore: null });
  });

  test("saltare e scartare producono due stati distinti", () => {
    const saltata = unisciGiudizio(vuoto, patchDaTasto("\\", vuoto)!);
    const scartata = unisciGiudizio(vuoto, patchDaTasto("x", vuoto)!);
    expect(saltata.stelle).toBeNull();
    expect(scartata.stelle).toBe(0);
    expect(saltata).not.toEqual(scartata);
  });

  test("un tasto che non giudica non produce una modifica", () => {
    expect(patchDaTasto("ArrowRight", vuoto)).toBeNull();
  });
});
