/**
 * The attachments of a generation, and the sentence that describes them to the
 * model.
 *
 * The image API knows nothing about roles: the photos all travel together in a
 * single `image[]` array, and whoever looks sees N indistinguishable images.
 * The difference between "this is me" and "this is the style to copy" exists
 * only because the prompt declares it — by POSITION.
 *
 * As long as the array and the sentence are written in two different places,
 * that correspondence is a promise nobody checks: add one reference in the
 * middle, or reorder the list, and the prompt still says "the first two are me"
 * while the first two have become something else. The model obeys the sentence,
 * so it takes the identity from the wrong image and the result is a person who
 * does not exist — a failure that raises no error and is found only by looking
 * at the face that came out wrong.
 *
 * Here the two sides are born from the SAME list: every file is declared with
 * its role, and from that list come both the order of the attachments and the
 * words describing it. They can no longer diverge.
 */

/** What an image is, to the model. */
export type Role =
  /** La persona: viso, ossatura, identita' da conservare. */
  | "identity"
  /** Luce, tonalita', inquadratura. Mai il volto. */
  | "style"
  /** Un oggetto da riprodurre nella forma: occhiali, capo, accessorio. */
  | "object";

export type Attachment = {
  /** Path of the file to send. */
  path: string;
  role: Role;
  /** What to take from this image, in your own words. It goes into the prompt:
   *  "the shape of the sunglasses", "the coloured gel lighting". */
  take?: string;
};

/** How a position is said in English, for the prompt. */
function position(indici: number[], total: number): string {
  if (total === 1) return "The attached image";
  if (indici.length === 1) {
    const ord = [
      "first", "second", "third", "fourth", "fifth",
      "sixth", "seventh", "eighth", "ninth", "tenth",
    ][indici[0]!];
    return ord ? `The ${ord} attached image` : `Attached image ${indici[0]! + 1}`;
  }
  if (indici.length === total) return "The attached images";
  // A contiguous block is spelled out: "the first two", "the last three".
  const contiguo = indici.every((n, i) => i === 0 || n === indici[i - 1]! + 1);
  const howMany = ["", "one", "two", "three", "four", "five", "six"][indici.length] ?? String(indici.length);
  if (contiguo && indici[0] === 0) return `The first ${howMany} attached images`;
  if (contiguo && indici[indici.length - 1] === total - 1) return `The last ${howMany} attached images`;
  return `Attached images ${indici.map((n) => n + 1).join(", ")}`;
}

/**
 * The preamble that tells the model what it is looking at.
 *
 * Each role appears only if there are images carrying it: saying "the black and
 * white photo is another person" when that file is not attached only confuses,
 * and that mistake has already been made.
 */
export function preamble(attachments: Attachment[], withSource: boolean): string {
  const tot = attachments.length;
  const per = (r: Role) =>
    attachments.map((a, i) => ({ a, i })).filter((x) => x.a.role === r);

  const phrases: string[] = [];

  const ident = per("identity");
  if (ident.length > 0 || withSource) {
    const who = withSource
      ? ident.length > 0
        ? `The SOURCE photograph and ${position(ident.map((x) => x.i), tot).toLowerCase()}`
        : "The SOURCE photograph"
      : position(ident.map((x) => x.i), tot);
    // The verb follows HOW MANY images are really named, not the fact that a
    // source exists: with the source alone and no identity attachment it came
    // out as "The SOURCE photograph are of ME", and an ungrammatical sentence
    // is paid for by the model, which reads it worse.
    const quante = (withSource ? 1 : 0) + ident.length;
    phrases.push(
      `${who} ${quante > 1 ? "are" : "is"} of ME, the same person: ` +
        `use them only to keep my face, bone structure and identity exactly as they show it. ` +
        `Ignore their pose, hands, framing, background and lighting.`,
    );
  }

  for (const { a, i } of per("style")) {
    phrases.push(
      `${position([i], tot)} is a STYLING reference: never copy the face in it. ` +
        `Take from it ${a.take ?? "the lighting, tonality, framing and treatment"}.`,
    );
  }

  const ogg = per("object");
  if (ogg.length > 0) {
    const what = ogg[0]!.a.take ?? "the object shown";
    phrases.push(
      `${position(ogg.map((x) => x.i), tot)} ${ogg.length > 1 ? "show" : "shows"} an OBJECT to reproduce: ` +
        `copy ${what} exactly as pictured. Never copy any face from them.`,
    );
  }

  return phrases.join(" ");
}

/**
 * The order the attachments have to be sent in.
 *
 * Grouped by role, so the preamble can talk about contiguous blocks ("the first
 * two") instead of listing scattered positions — which the model follows worse.
 * The order inside each group stays the one the caller declared.
 */
export function sort(attachments: Attachment[]): Attachment[] {
  const weight: Record<Role, number> = { identity: 0, style: 1, object: 2 };
  return [...attachments].sort((a, b) => weight[a.role] - weight[b.role]);
}

/**
 * Attachments and preamble from the same list, guaranteed consistent.
 *
 * `withSource` says whether a starting image also exists (the one being
 * edited): it is not among the attachments but the preamble has to name it,
 * because to the model it is one of the incoming images all the same.
 */
export function prepareAttachments(
  attachments: Attachment[],
  options: { withSource?: boolean } = {},
): { files: string[]; preamble: string; sorted: Attachment[] } {
  const sorted = sort(attachments);
  return {
    files: sorted.map((a) => a.path),
    preamble: preamble(sorted, options.withSource ?? false),
    sorted,
  };
}
