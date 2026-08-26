import { describe, expect, test } from "bun:test";

/**
 * Riagganciarsi a una generazione, invece di rifarla.
 *
 * Un prompt gia' mandato sta in tre posti: finito (cronologia), ancora vivo
 * (coda), o da nessuna parte. Solo il terzo va rimandato — ma il ramo "ancora
 * vivo" non esisteva, e ogni riavvio del server durante una generazione ne
 * pubblicava una copia nuova sulla scheda. Misurato: tre riavvii in una
 * sessione, tre copie identiche dello stesso piano in coda sulla 3090.
 *
 * Qui si prova il pezzo che quel ramo decide: leggere la coda di ComfyUI.
 */
export function inCoda(q: any, promptId: string): boolean {
  if (!q) return false;
  const dentro = (v: unknown[]) => v.some((x) => Array.isArray(x) && x[1] === promptId);
  return dentro(q.queue_running ?? []) || dentro(q.queue_pending ?? []);
}

// La forma vera di /queue: [numero, prompt_id, grafo, extra, uscite].
const voce = (id: string) => [7, id, {}, {}, ["10"]];

describe("un prompt vivo si riconosce", () => {
  test("mentre gira", () => {
    expect(inCoda({ queue_running: [voce("abc")], queue_pending: [] }, "abc")).toBe(true);
  });
  test("mentre aspetta il suo turno", () => {
    expect(inCoda({ queue_running: [], queue_pending: [voce("abc"), voce("def")] }, "def")).toBe(true);
  });
  test("e uno che non c'e' non c'e'", () => {
    expect(inCoda({ queue_running: [voce("abc")], queue_pending: [voce("def")] }, "zzz")).toBe(false);
  });
  test("coda vuota: non c'e'", () => {
    expect(inCoda({ queue_running: [], queue_pending: [] }, "abc")).toBe(false);
  });
  test("ComfyUI muto non e' 'e' vivo': meglio rimandarlo che aspettare per sempre", () => {
    expect(inCoda(null, "abc")).toBe(false);
  });
  test("campi assenti non fanno esplodere niente", () => {
    expect(inCoda({}, "abc")).toBe(false);
  });
});
