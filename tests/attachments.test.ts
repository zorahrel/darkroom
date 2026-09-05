import { describe, expect, test } from "bun:test";
import { prepareAttachments, preamble, sort, type Attachment } from "../server/attachments.ts";

/**
 * The fault this module prevents raises no errors: the API receives all the
 * images in a single array and knows nothing of roles, so if the prompt says
 * "the first two are me" while the first two have become references, the
 * request leaves, succeeds, and returns a face that is not yours.
 *
 * These tests watch one thing only: that the sentence and the order always say
 * the same thing.
 */
const io = (n: string): Attachment => ({ path: `/RAW/${n}`, role: "identity" });
const style = (n: string, take?: string): Attachment => ({ path: `/refs/${n}`, role: "style", take });
const object = (n: string, take?: string): Attachment => ({ path: `/refs/${n}`, role: "object", take });

describe("the order of the attachments and the sentence that describes them", () => {
  test("identita' prima, poi stile, poi oggetti", () => {
    const { sorted } = prepareAttachments([object("occhiali.jpg"), style("luce.jpg"), io("me.png")]);
    expect(sorted.map((a) => a.role)).toEqual(["identity", "style", "object"]);
  });

  test("the declared order within a role is preserved", () => {
    // The caller may have a reason to put one shot before another.
    const { files } = prepareAttachments([io("a.png"), io("b.png"), io("c.png")]);
    expect(files).toEqual(["/RAW/a.png", "/RAW/b.png", "/RAW/c.png"]);
  });

  test("the sentence names the REAL positions after the reordering", () => {
    // THE BUG: declared in this order, the sunglasses would be first in the
    // array and a hand-written prompt would say "the first two are me".
    const p = preamble(
      sort([object("occhiali.jpg"), io("a.png"), io("b.png")]),
      false,
    );
    expect(p).toContain("The first two attached images");
    expect(p.slice(0, p.indexOf("OBJECT"))).toContain("are of ME");
    // and the object is the third, not the first
    expect(p).toContain("The third attached image");
  });

  test("with the source, the sentence names it together with the identity photos", () => {
    const p = preamble(sort([io("altra.png")]), true);
    expect(p).toContain("SOURCE photograph");
    expect(p).toContain("are of ME");
  });

  test("a single source, with no identity attachments", () => {
    const p = preamble(sort([style("luce.jpg")]), true);
    expect(p).toContain("The SOURCE photograph is of ME");
  });
});

describe("it speaks only of what is attached", () => {
  test("with no style reference, it is not mentioned", () => {
    // Saying "the style photo is another person" when that file is not there
    // only confuses: it is a mistake already made in the past.
    const p = preamble(sort([io("a.png"), io("b.png")]), true);
    expect(p).not.toContain("STYLING");
    expect(p).not.toContain("OBJECT");
  });

  test("with no identity photo and no source, no face is promised", () => {
    const p = preamble(sort([style("luce.jpg")]), false);
    expect(p).not.toContain("of ME");
    expect(p).toContain("STYLING");
  });

  test("an empty list produces no sentences", () => {
    expect(preamble([], false)).toBe("");
  });
});

describe("every role says what to take and what not to", () => {
  test("the face is never copied from the style", () => {
    const p = preamble(sort([io("a.png"), style("luce.jpg")]), false);
    expect(p).toContain("never copy the face");
  });

  test("nemmeno dagli oggetti", () => {
    const p = preamble(sort([io("a.png"), object("occhiali.jpg")]), false);
    expect(p).toContain("Never copy any face");
  });

  test("the detail to take goes into the sentence", () => {
    const p = preamble(sort([object("g.jpg", "the exact shape of the sunglasses")]), false);
    expect(p).toContain("the exact shape of the sunglasses");
  });

  test("with no detail, a sensible formula remains", () => {
    const p = preamble(sort([style("luce.jpg")]), false);
    expect(p).toContain("lighting, tonality, framing and treatment");
  });
});

describe("the files sent and the positions cited match", () => {
  test("the real case of v37: 3 shots, 1 style, 2 sunglasses", () => {
    const { files, preamble: p } = prepareAttachments(
      [
        object("gascan-nero.jpg", "the exact shape of the sunglasses"),
        object("gascan-frontale.jpg"),
        io("56E417C5.JPG"),
        io("ChatGPT.png"),
        style("fondo-blu.jpg", "the deep blue background and hard top light"),
      ],
      { withSource: true },
    );
    // The order sent to the API
    expect(files).toEqual([
      "/RAW/56E417C5.JPG",
      "/RAW/ChatGPT.png",
      "/refs/fondo-blu.jpg",
      "/refs/gascan-nero.jpg",
      "/refs/gascan-frontale.jpg",
    ]);
    // The sentence must describe EXACTLY that order
    expect(p).toContain("the first two attached images");   // gli scatti
    expect(p).toContain("The third attached image");         // lo stile
    expect(p).toContain("The last two attached images");     // gli occhiali
    expect(p).toContain("the deep blue background and hard top light");
    expect(p).toContain("the exact shape of the sunglasses");
  });

  test("adding a reference does NOT move what the sentence calls identity", () => {
    // It is the silent way of getting it wrong: one extra file and the prompt
    // lies.
    const before = prepareAttachments([io("a.png"), io("b.png"), style("x.jpg")], { withSource: true });
    const after = prepareAttachments(
      [io("a.png"), io("b.png"), style("x.jpg"), object("y.jpg")],
      { withSource: true },
    );
    expect(after.files.slice(0, 2)).toEqual(before.files.slice(0, 2));
    // Lowercase: inside the sentence the position follows "The SOURCE
    // photograph and".
    expect(after.preamble).toContain("the first two attached images");
  });

  test("the number of files sent is the number declared", () => {
    const a = [io("a.png"), style("b.jpg"), object("c.jpg")];
    expect(prepareAttachments(a).files).toHaveLength(a.length);
  });

  test("a single attachment is not called 'the first of one'", () => {
    expect(preamble(sort([style("x.jpg")]), false)).toContain("The attached image");
  });
});
