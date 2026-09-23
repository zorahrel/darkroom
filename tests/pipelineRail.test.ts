import { describe, expect, test } from "bun:test";

/**
 * La lista della pipeline separa strumenti, passi e uscita.
 *
 * MISURATO il 24/09 a 1135x651, prima della correzione: i sei strumenti
 * (Versioni, Preset, Genera, Prompt, Qualita', Info) erano righe a tutta
 * larghezza da 40 px, 246 px in tutto, nella stessa lista e con lo stesso
 * aspetto dei passi. Il primo passo cominciava a 335 px, il sesto ed Esporta
 * finivano sotto il bordo, e il riassunto della LUT era tagliato a una riga.
 * Dopo: strumenti in una griglia 3x2 (70 px), passi sotto «Pipeline · N passi»,
 * primo passo a 205 px, tutto visibile senza scorrere, riassunto su due righe.
 */
const src = await Bun.file(new URL("../client/src/components/mobile/EditorRail.tsx", import.meta.url)).text();
const codice = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("PipelineList", () => {
  test("strumenti, passi e uscita sono tre liste distinte", () => {
    expect(codice).toContain('groups.filter((g) => g.step)');
    expect(codice).toContain('groups.filter((g) => !g.step && g.id !== "export")');
    expect(codice).toContain('groups.filter((g) => g.id === "export")');
  });

  test("gli strumenti stanno in una griglia, non in righe a tutta larghezza", () => {
    expect(codice).toMatch(/grid grid-cols-3[^"]*"[\s\S]{0,200}strumenti\.map/);
  });

  test("i passi hanno un titolo che li conta", () => {
    expect(codice).toContain("Pipeline · {passi.length}");
  });

  test("il riassunto di un passo va su due righe, non viene tagliato a una", () => {
    const riassunto = /\{step\.summary\}/.exec(codice);
    expect(riassunto).not.toBeNull();
    const intorno = codice.slice(Math.max(0, riassunto!.index - 260), riassunto!.index);
    expect(intorno).toContain("line-clamp-2");
    expect(intorno).not.toMatch(/text-neutral-400 truncate"/);
  });
});
