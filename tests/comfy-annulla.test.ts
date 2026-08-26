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
export function decidi(stato: string | undefined, promptId: string | null) {
  if (!stato || stato === "done" || stato === "cancelled") {
    return { annulla: false, avvisaComfy: false };
  }
  return { annulla: true, avvisaComfy: stato === "running" && !!promptId };
}

describe("fermare una generazione", () => {
  test("in coda: si toglie e basta, la scheda non ne sa niente", () => {
    expect(decidi("pending", null)).toEqual({ annulla: true, avvisaComfy: false });
  });

  test("in corso: si toglie E si dice alla scheda di smettere", () => {
    expect(decidi("running", "abc")).toEqual({ annulla: true, avvisaComfy: true });
  });

  test("in corso ma non ancora spedita: niente da dire alla scheda", () => {
    expect(decidi("running", null)).toEqual({ annulla: true, avvisaComfy: false });
  });

  test("gia' finita: non si tocca — interrompere adesso fermerebbe quella di qualcun altro", () => {
    expect(decidi("done", "abc")).toEqual({ annulla: false, avvisaComfy: false });
  });

  test("gia' annullata: annullarla due volte non fa niente", () => {
    expect(decidi("cancelled", "abc")).toEqual({ annulla: false, avvisaComfy: false });
  });

  test("un id che non esiste non e' un'occasione per interrompere a caso", () => {
    expect(decidi(undefined, "abc")).toEqual({ annulla: false, avvisaComfy: false });
  });
});
