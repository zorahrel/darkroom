import { describe, expect, test } from "bun:test";

/**
 * Che cosa si può fermare.
 *
 * Una generazione in coda si toglieva; una **in corso** no — restava lì finché
 * non finiva o finché non scadevano i quindici minuti senza fotogrammi nuovi, e
 * intanto teneva ferma tutta la coda dietro. Succede davvero: si lancia una
 * serie di dieci, si guarda la prima e si capisce che il prompt è sbagliato.
 *
 * Qui si prova la decisione, che è la parte che si può sbagliare: su quali
 * stati agire, e quando bisogna anche dirlo a ComfyUI.
 */
export function decide(state: string | undefined, promptId: string | null) {
  if (!state || state === "done" || state === "cancelled") {
    return { cancel: false, notifyComfy: false };
  }
  return { cancel: true, notifyComfy: state === "running" && !!promptId };
}

describe("fermare una generazione", () => {
  test("in coda: si toglie e basta, la scheda non ne sa niente", () => {
    expect(decide("pending", null)).toEqual({ cancel: true, notifyComfy: false });
  });

  test("in corso: si toglie E si dice alla scheda di smettere", () => {
    expect(decide("running", "abc")).toEqual({ cancel: true, notifyComfy: true });
  });

  test("in corso ma non ancora spedita: niente da dire alla scheda", () => {
    expect(decide("running", null)).toEqual({ cancel: true, notifyComfy: false });
  });

  test("gia' finita: non si tocca — interrompere adesso fermerebbe quella di qualcun altro", () => {
    expect(decide("done", "abc")).toEqual({ cancel: false, notifyComfy: false });
  });

  test("gia' annullata: annullarla due volte non fa niente", () => {
    expect(decide("cancelled", "abc")).toEqual({ cancel: false, notifyComfy: false });
  });

  test("un id che non esiste non e' un'occasione per interrompere a caso", () => {
    expect(decide(undefined, "abc")).toEqual({ cancel: false, notifyComfy: false });
  });
});
