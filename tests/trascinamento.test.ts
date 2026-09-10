import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ALTEZZA_BARRA } from "../client/src/barra";
import {
  destinazionePer,
  leggiTrascinamento,
  nomeDaPercorso,
} from "../client/src/trascinamento";

describe("le cartelle lasciate nella finestra", () => {
  test("dentro un progetto diventano sue, fuori diventano un progetto nuovo", () => {
    expect(destinazionePer("/p/japan")).toEqual({ tipo: "progetto", pid: "japan" });
    expect(destinazionePer("/p/japan/culling")).toEqual({ tipo: "progetto", pid: "japan" });
    expect(destinazionePer("/studio")).toEqual({ tipo: "elenco" });
    expect(destinazionePer("/")).toEqual({ tipo: "elenco" });
    expect(destinazionePer("/activity")).toEqual({ tipo: "elenco" });
  });

  test("un progetto nato da una cartella si chiama come la cartella", () => {
    expect(nomeDaPercorso("/Users/x/Pictures/Japan")).toBe("Japan");
    // Una cartella trascinata arriva col taglio finale a seconda di come e' stata presa.
    expect(nomeDaPercorso("/Users/x/Pictures/Japan/")).toBe("Japan");
    expect(nomeDaPercorso("/")).toBe("senza nome");
  });

  test("un dettaglio malformato viene ignorato invece di rompere la pagina", () => {
    // Arriva da una `eval` nel guscio: se un giorno cambia forma deve sparire
    // l'evento, non l'interfaccia.
    expect(leggiTrascinamento(null)).toBeNull();
    expect(leggiTrascinamento("entra")).toBeNull();
    expect(leggiTrascinamento({ fase: "boh", percorsi: [] })).toBeNull();
    expect(leggiTrascinamento({ fase: "lascia" })).toEqual({ fase: "lascia", percorsi: [] });
  });

  test("si tengono solo i percorsi assoluti", () => {
    const t = leggiTrascinamento({
      fase: "lascia",
      percorsi: ["/Users/x/Japan", "relativo/no", 42, null, "/Users/x/Altro"],
    });
    expect(t).toEqual({ fase: "lascia", percorsi: ["/Users/x/Japan", "/Users/x/Altro"] });
  });
});

describe("la barra e i semafori", () => {
  /**
   * La posizione dei semafori si può dare solo costruendo la finestra, quindi il
   * guscio porta con sé la misura della barra invece di leggerla. Due numeri scritti
   * a mano in due linguaggi si separano senza dare nessun errore: i semafori
   * scivolerebbero di qualche punto e lo vedrebbe solo chi guarda.
   */
  test("il guscio e la pagina misurano la stessa barra", () => {
    const rust = readFileSync("app/src/main.rs", "utf8");
    const m = /const BARRA_ALTEZZA: f64 = ([\d.]+);/.exec(rust);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(ALTEZZA_BARRA);
  });

  test("i semafori finiscono centrati sulla barra", () => {
    const rust = readFileSync("app/src/main.rs", "utf8");
    const altezza = Number(/const SEMAFORO_ALTEZZA: f64 = ([\d.]+);/.exec(rust)![1]);
    const sotto = Number(/const SEMAFORO_SOTTO: f64 = ([\d.]+);/.exec(rust)![1]);
    expect(rust).toContain("(BARRA_ALTEZZA - SEMAFORO_ALTEZZA) / 2.0 + SEMAFORO_SOTTO");
    // Lo spazio sopra il semaforo vale `y - SEMAFORO_SOTTO`: al centro, sopra e
    // sotto devono restare uguali.
    const y = (ALTEZZA_BARRA - altezza) / 2 + sotto;
    expect(y - sotto).toBeCloseTo(ALTEZZA_BARRA - (y - sotto) - altezza, 5);
  });
});
