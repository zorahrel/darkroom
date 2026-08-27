import { describe, expect, test } from "bun:test";
import {
  filtraAlbero,
  conteggiaVerdetti,
  tieneVariante,
} from "../client/src/alberoFiltro";

/** Un albero minimo ma della forma vera: due radici, la seconda con due
 *  gruppi, per poter osservare la potatura a tutti e tre i livelli. */
const albero = () => [
  {
    photo: "a",
    groups: [
      {
        recipe: "bw-hard",
        variants: [
          { id: 1, verdict: "tieni" },
          { id: 2, verdict: null },
        ],
      },
    ],
  },
  {
    photo: "b",
    groups: [
      { recipe: "bw-soft", variants: [{ id: 3, verdict: "scarta" }] },
      {
        recipe: "color",
        variants: [
          { id: 4, verdict: "forse" },
          { id: 5, verdict: "scarta" },
        ],
      },
    ],
  },
];

describe("filtro dell'albero per giudizio", () => {
  test("«tutte» restituisce esattamente l'oggetto ricevuto", () => {
    // Identita', non uguaglianza: se ricostruisse l'albero a ogni resa,
    // React rifarebbe da capo tutte le miniature a ogni click.
    const a = albero();
    expect(filtraAlbero(a, "tutte")).toBe(a);
  });

  test("una radice che resta senza varianti sparisce", () => {
    // Il vero rischio: filtrare le foglie e lasciare in piedi intestazione e
    // miniatura di una sorgente vuota, che sembra un caricamento a meta'.
    const r = filtraAlbero(albero(), "tieni");
    expect(r.map((n) => n.photo)).toEqual(["a"]);
    expect(r[0]!.groups).toHaveLength(1);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([1]);
  });

  test("un gruppo svuotato sparisce ma i fratelli pieni restano", () => {
    const r = filtraAlbero(albero(), "forse");
    expect(r).toHaveLength(1);
    expect(r[0]!.photo).toBe("b");
    expect(r[0]!.groups.map((g) => g.recipe)).toEqual(["color"]);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([4]);
  });

  test("«scarta» tiene le scartate sparse su gruppi diversi", () => {
    const r = filtraAlbero(albero(), "scarta");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([3, 5]);
  });

  test("«da vedere» sono quelle mai giudicate, non quelle scartate", () => {
    const r = filtraAlbero(albero(), "da-vedere");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([2]);
  });

  test("un filtro senza risultati torna vuoto invece di mostrare gusci", () => {
    const soloScartate = [{ photo: "x", groups: [{ variants: [{ verdict: "scarta" }] }] }];
    expect(filtraAlbero(soloScartate, "tieni")).toEqual([]);
  });

  test("l'albero di partenza non viene modificato", () => {
    // La pagina tiene `nodes` come sorgente di verita' e ci scrive sopra i
    // verdetti: se il filtro mutasse, cambiare filtro perderebbe dei dati.
    const a = albero();
    filtraAlbero(a, "tieni");
    expect(a[1]!.groups).toHaveLength(2);
    expect(a[1]!.groups[1]!.variants).toHaveLength(2);
  });

  test("stringa vuota conta come da vedere, non come giudizio", () => {
    // Il DB puo' avere "" dove il codice si aspetta null.
    expect(tieneVariante({ verdict: "" }, "da-vedere")).toBe(true);
    expect(tieneVariante({ verdict: "" }, "scarta")).toBe(false);
  });
});

describe("conteggi sulle pastiglie", () => {
  test("ogni variante cade in una casella sola e «tutte» e' il totale", () => {
    const varianti = albero().flatMap((n) => n.groups.flatMap((g) => g.variants));
    const c = conteggiaVerdetti(varianti);
    expect(c).toEqual({ tutte: 5, tieni: 1, forse: 1, scarta: 2, "da-vedere": 1 });
    expect(c.tieni + c.forse + c.scarta + c["da-vedere"]).toBe(c.tutte);
  });

  test("un albero vuoto conta zero ovunque senza esplodere", () => {
    expect(conteggiaVerdetti([])).toEqual({
      tutte: 0,
      tieni: 0,
      forse: 0,
      scarta: 0,
      "da-vedere": 0,
    });
  });

  test("un verdetto sconosciuto finisce fra le da vedere invece di sparire", () => {
    // Meglio contarlo dove si guarda che perderlo: il totale deve tornare.
    const c = conteggiaVerdetti([{ verdict: "boh" }]);
    expect(c.tutte).toBe(1);
    expect(c["da-vedere"]).toBe(1);
  });
});
