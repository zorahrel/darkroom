/**
 * Pruning the tree by verdict.
 *
 * It lives here and not inside the page because it is the only part of the
 * filter that can go wrong silently: filtering the leaves is easy, remembering
 * to remove the branches and roots left empty is not. A source with its header,
 * its thumbnail and no variants underneath does not look "filtered", it looks
 * broken.
 */

/** The minimum needed in order to prune: the page passes its real types. */
type WithVerdict = { verdict: string | null };
type WithVariants<V> = { variants: V[] };
type WithGroups<G> = { groups: G[] };

export const VERDICTS = ["all", "keep", "maybe", "discard", "unseen"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** `unseen` = never judged. It is the filter needed to pick up a job left
 *  half-done, and it is different from "discarded". */
export function keepsVariant(v: WithVerdict, verdict: Verdict): boolean {
  if (verdict === "all") return true;
  if (verdict === "unseen") return !v.verdict;
  return v.verdict === verdict;
}

export function filterTree<
  V extends WithVerdict,
  G extends WithVariants<V>,
  N extends WithGroups<G>,
>(nodes: N[], verdict: Verdict): N[] {
  if (verdict === "all") return nodes;
  return nodes
    .map((n) => ({
      ...n,
      groups: n.groups
        .map((g) => ({ ...g, variants: g.variants.filter((v) => keepsVariant(v, verdict)) }))
        .filter((g) => g.variants.length > 0),
    }))
    .filter((n) => n.groups.length > 0);
}

/** How many variants per verdict. Needed on the pills: a filter leading to
 *  an empty page should be known before clicking it. */
export function countVerdicts(variants: WithVerdict[]): Record<Verdict, number> {
  const c: Record<Verdict, number> = {
    all: variants.length,
    keep: 0,
    maybe: 0,
    discard: 0,
    unseen: 0,
  };
  for (const v of variants) {
    if (v.verdict === "keep") c.keep++;
    else if (v.verdict === "maybe") c.maybe++;
    else if (v.verdict === "discard") c.discard++;
    else c.unseen++;
  }
  return c;
}
