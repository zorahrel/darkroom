import { describe, expect, test } from "bun:test";
import { ricevuta } from "../mcp/server.ts";

/**
 * Una scrittura non deve rispondere con lo stato del progetto. Il caso vero:
 * video_judge tornava 247.000 caratteri per confermare un giudizio, e da MCP
 * era inusabile. Questi casi girano su `ricevuta`, non su una fetch: e' la
 * funzione a dover essere giusta, il trasporto e' gia' provato altrove.
 */
describe("ricevuta", () => {
  test("gli elenchi grossi diventano un conteggio", () => {
    const r = ricevuta({ ok: true, discarded: { a: "x" }, shots: [1, 2, 3] }) as any;
    expect(r.ok).toBe(true);
    expect(r.discarded).toEqual({ a: "x" });
    expect(r.shots).toBe("3 voci — chiedile con video_shots/video_cuts");
  });

  test("non tocca quello che non e' un elenco noto", () => {
    const r = ricevuta({ ok: true, error: null, bar: 12 }) as any;
    expect(r).toEqual({ ok: true, error: null, bar: 12 });
  });

  test("un elenco piccolo ma noto si comprime lo stesso: la soglia non e' la lunghezza", () => {
    expect((ricevuta({ cuts: [] }) as any).cuts).toBe("0 voci — chiedile con video_shots/video_cuts");
  });

  test("regge quello che non e' un oggetto", () => {
    expect(ricevuta("ok")).toBe("ok");
    expect(ricevuta(null)).toBe(null);
  });
});
