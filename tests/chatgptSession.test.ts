import { describe, expect, test } from "bun:test";

/**
 * La sonda della sessione ChatGPT decide se il runner lavora o si mette in
 * pausa: quando sbaglia in negativo la coda si fermerebbe su una sessione viva,
 * e all'utente verrebbe chiesto un login che non serve. Entrambi i casi sono
 * capitati la notte dell'08/09 sui job 274-276, e sono questi due.
 */
const sorgente = await Bun.file(new URL("../server/worker.ts", import.meta.url)).text();
const funzione = sorgente.slice(
  sorgente.indexOf("export async function checkChatgptSession"),
);

describe("la sessione viva non si dichiara scaduta", () => {
  test("il verdetto positivo viene dalla rete, prima degli indizi a schermo", () => {
    // Il composer sparisce per un secondo ogni volta che il worker apre una
    // chat nuova. Se quel controllo viene prima, la sonda dice "scaduta" nel
    // mezzo di un lavoro che sta andando bene.
    const rete = funzione.indexOf("if (probe.api === 200) return { alive: true, logged_in: true }");
    const dom = funzione.indexOf("if (probe.wall || !probe.composer)");
    expect(rete).toBeGreaterThan(-1);
    expect(dom).toBeGreaterThan(-1);
    expect(rete).toBeLessThan(dom);
  });

  test("il token revocato resta distinto e viene detto per primo", () => {
    // 401 dal backend e' l'unico caso in cui il login serve davvero: deve
    // precedere qualunque altra lettura, altrimenti un composer presente su una
    // sessione morta la farebbe passare per buona.
    const revocato = funzione.indexOf("probe.api === 401");
    expect(revocato).toBeGreaterThan(-1);
    expect(revocato).toBeLessThan(funzione.indexOf("if (probe.api === 200)"));
    expect(funzione).toContain("token ChatGPT revocato");
  });
});

describe("una pagina finita altrove non e' un login scaduto", () => {
  test("la finestra viene riportata su ChatGPT invece di chiedere il login", () => {
    // Stanotte la finestra dedicata era su about:blank: la sonda cadeva sulla
    // prima pagina qualsiasi, la interrogava e concludeva "rifai il login".
    const ramo = funzione.slice(
      funzione.indexOf("if (!page?.webSocketDebuggerUrl)"),
      funzione.indexOf("if (!(await pageResponds"),
    );
    expect(ramo).toContain("location.assign('https://chatgpt.com/')");
    // Si guardano i `reason:` restituiti, non il testo del ramo: il commento
    // sopra CITA la frase sbagliata per spiegare cosa non si deve piu' dire, e
    // un `not.toContain` sul sorgente intero inciampava proprio su quella.
    const detti = [...ramo.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]!);
    expect(detti.length).toBeGreaterThan(0);
    for (const d of detti) expect(d).not.toContain("rifai il login");
  });

  test("senza nessuna pagina il browser e' dichiarato spento, non sloggato", () => {
    expect(funzione).toContain(`reason: "nessuna pagina"`);
    const nessuna = funzione.slice(funzione.indexOf(`reason: "nessuna pagina"`) - 120, funzione.indexOf(`reason: "nessuna pagina"`));
    expect(nessuna).toContain("alive: false");
  });
});
