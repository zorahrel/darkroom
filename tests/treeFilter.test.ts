import { describe, expect, test } from "bun:test";
import {
  filterTree,
  countVerdicts,
  tieneVariante,
} from "../client/src/treeFilter";

/** Un albero minimo ma della forma vera: due radici, la seconda con due
 *  gruppi, per poter osservare la potatura a tutti e tre i livelli. */
const tree = () => [
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
    const a = tree();
    expect(filterTree(a, "tutte")).toBe(a);
  });

  test("una radice che resta senza varianti sparisce", () => {
    // Il vero rischio: filtrare le foglie e lasciare in piedi intestazione e
    // miniatura di una sorgente vuota, che sembra un caricamento a meta'.
    const r = filterTree(tree(), "tieni");
    expect(r.map((n) => n.photo)).toEqual(["a"]);
    expect(r[0]!.groups).toHaveLength(1);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([1]);
  });

  test("un gruppo svuotato sparisce ma i fratelli pieni restano", () => {
    const r = filterTree(tree(), "forse");
    expect(r).toHaveLength(1);
    expect(r[0]!.photo).toBe("b");
    expect(r[0]!.groups.map((g) => g.recipe)).toEqual(["color"]);
    expect(r[0]!.groups[0]!.variants.map((v) => v.id)).toEqual([4]);
  });

  test("«scarta» tiene le scartate sparse su gruppi diversi", () => {
    const r = filterTree(tree(), "scarta");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([3, 5]);
  });

  test("«da vedere» sono quelle mai giudicate, non quelle scartate", () => {
    const r = filterTree(tree(), "da-vedere");
    expect(r.flatMap((n) => n.groups.flatMap((g) => g.variants.map((v) => v.id)))).toEqual([2]);
  });

  test("un filtro senza risultati torna vuoto invece di mostrare gusci", () => {
    const onlyDiscarded = [{ photo: "x", groups: [{ variants: [{ verdict: "scarta" }] }] }];
    expect(filterTree(onlyDiscarded, "tieni")).toEqual([]);
  });

  test("l'albero di partenza non viene modificato", () => {
    // La pagina tiene `nodes` come sorgente di verita' e ci scrive sopra i
    // verdetti: se il filtro mutasse, cambiare filtro perderebbe dei dati.
    const a = tree();
    filterTree(a, "tieni");
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
    const varianti = tree().flatMap((n) => n.groups.flatMap((g) => g.variants));
    const c = countVerdicts(varianti);
    expect(c).toEqual({ tutte: 5, tieni: 1, forse: 1, scarta: 2, "da-vedere": 1 });
    expect(c.tieni + c.forse + c.scarta + c["da-vedere"]).toBe(c.tutte);
  });

  test("un albero vuoto conta zero ovunque senza esplodere", () => {
    expect(countVerdicts([])).toEqual({
      tutte: 0,
      tieni: 0,
      forse: 0,
      scarta: 0,
      "da-vedere": 0,
    });
  });

  test("un verdetto sconosciuto finisce fra le da vedere invece di sparire", () => {
    // Meglio contarlo dove si guarda che perderlo: il totale deve tornare.
    const c = countVerdicts([{ verdict: "boh" }]);
    expect(c.tutte).toBe(1);
    expect(c["da-vedere"]).toBe(1);
  });
});

describe("la coda di scrittura sull'URL", () => {
  // Riproduce, senza React, il meccanismo di `statoVista`: due valori che
  // tornano al default nello stesso giro di rendering.
  //
  // LA REGRESSIONE: ogni hook chiamava `setSearchParams` per conto suo con
  // l'aggiornamento funzionale. Sembra sicuro, ma React Router propaga la nuova
  // location in modo asincrono: due hook svegliati nello stesso ciclo ricevono
  // lo STESSO `prev`, e il secondo sovrascrive il primo. Aprendo
  // `?zoom=180&group=scene` (entrambi default) ne spariva uno solo.
  function simulate(
    edits: [string, string | null][],
    partenza: string,
    unite: boolean,
  ): string {
    let url = new URLSearchParams(partenza);
    if (unite) {
      const next = new URLSearchParams(url);
      for (const [k, v] of edits) v === null ? next.delete(k) : next.set(k, v);
      url = next;
    } else {
      // Ognuno parte dalla stessa istantanea: e' il bug.
      const istantanea = new URLSearchParams(url);
      for (const [k, v] of edits) {
        const next = new URLSearchParams(istantanea);
        v === null ? next.delete(k) : next.set(k, v);
        url = next;
      }
    }
    return url.toString();
  }

  test("due default insieme svuotano l'URL", () => {
    expect(simulate([["zoom", null], ["group", null]], "zoom=180&group=scene", true)).toBe("");
  });

  test("senza riunirle ne sopravvive una: e' il bug che si sta prevenendo", () => {
    expect(simulate([["zoom", null], ["group", null]], "zoom=180&group=scene", false)).toBe("zoom=180");
  });

  test("scritture e cancellazioni insieme non si annullano a vicenda", () => {
    expect(simulate([["zoom", "340"], ["group", null]], "zoom=180&group=scene", true)).toBe("zoom=340");
  });

  test("le chiavi di altri (la rotta, la ricerca) non vengono toccate", () => {
    expect(simulate([["zoom", null]], "zoom=180&q=tokyo", true)).toBe("q=tokyo");
  });
});
