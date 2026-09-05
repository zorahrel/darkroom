/**
 * La potatura dell'albero per giudizio.
 *
 * Sta qui e non dentro la pagina perche' e' l'unico pezzo del filtro che puo'
 * sbagliare in silenzio: filtrare le foglie e' facile, ricordarsi di togliere
 * i rami e le radici rimaste vuote no. Una sorgente con la sua intestazione,
 * la miniatura e nessuna variante sotto non sembra "filtrata", sembra rotta.
 */

/** Il minimo che serve per potare: la pagina passa i suoi tipi veri. */
type WithVerdict = { verdict: string | null };
type WithVariants<V> = { variants: V[] };
type WithGroups<G> = { groups: G[] };

export const VERDICTS = ["all", "keep", "maybe", "discard", "unseen"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** `unseen` = mai giudicata. E' il filtro che serve per riprendere in mano
 *  un lavoro lasciato a meta', ed e' diverso da "scartata". */
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

/** Quante varianti per giudizio. Serve sulle pastiglie: un filtro che porta a
 *  una pagina vuota va saputo prima di cliccarlo. */
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
