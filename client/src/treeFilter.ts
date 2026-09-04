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

export const VERDICTS = ["tutte", "tieni", "forse", "scarta", "da-vedere"] as const;
export type Verdetto = (typeof VERDICTS)[number];

/** `da-vedere` = mai giudicata. E' il filtro che serve per riprendere in mano
 *  un lavoro lasciato a meta', ed e' diverso da "scartata". */
export function tieneVariante(v: WithVerdict, verdetto: Verdetto): boolean {
  if (verdetto === "tutte") return true;
  if (verdetto === "da-vedere") return !v.verdict;
  return v.verdict === verdetto;
}

export function filterTree<
  V extends WithVerdict,
  G extends WithVariants<V>,
  N extends WithGroups<G>,
>(nodi: N[], verdetto: Verdetto): N[] {
  if (verdetto === "tutte") return nodi;
  return nodi
    .map((n) => ({
      ...n,
      groups: n.groups
        .map((g) => ({ ...g, variants: g.variants.filter((v) => tieneVariante(v, verdetto)) }))
        .filter((g) => g.variants.length > 0),
    }))
    .filter((n) => n.groups.length > 0);
}

/** Quante varianti per giudizio. Serve sulle pastiglie: un filtro che porta a
 *  una pagina vuota va saputo prima di cliccarlo. */
export function countVerdicts(varianti: WithVerdict[]): Record<Verdetto, number> {
  const c: Record<Verdetto, number> = {
    tutte: varianti.length,
    tieni: 0,
    forse: 0,
    scarta: 0,
    "da-vedere": 0,
  };
  for (const v of varianti) {
    if (v.verdict === "tieni") c.tieni++;
    else if (v.verdict === "forse") c.forse++;
    else if (v.verdict === "scarta") c.scarta++;
    else c["da-vedere"]++;
  }
  return c;
}
