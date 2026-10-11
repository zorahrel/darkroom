import { describe, expect, test } from "bun:test";
import {
  ancestors,
  buildFlow,
  children,
  layoutMap,
  mainDescendants,
  sisters,
  subtreeSize,
} from "../client/src/components/flow/tree.ts";
import type { BranchNode } from "../client/src/api/types.ts";

/**
 * L'albero del flusso. Si protegge cio' che le tre viste devono dire uguale:
 * chi ha sorelle, qual e' la strada dalla radice, e che le versioni senza storia non sporchino la mappa.
 *
 *   1 ── 2 ── 4 ── (video c1)
 *    └── 3
 *   9 (senza genitore e senza figli)        c2 (video senza versione)
 */
const v = (n: number, parent: number | null, created = n): BranchNode => ({
  key: `v${n}`, kind: "version", version_number: n, parent, favorite: false, final: false,
  discarded: false, refs: [], note: null, created_at: created,
});
const c = (id: number, parent: number | null): BranchNode => ({
  key: `c${id}`, kind: "clip", clip_id: id, parent, final: false, discarded: false,
  model: "M", duration: 5, has_audio: true, created_at: 100 + id,
});
const f = buildFlow([v(1, null), v(2, 1), v(3, 1), v(4, 2), v(9, null), c(1, 4), c(2, null)]);

describe("albero del flusso", () => {
  test("le sorelle sono i nodi con lo stesso genitore, e una radice non ne ha", () => {
    expect(sisters(f, { kind: "version", id: 2 })).toEqual([{ kind: "version", id: 3 }]);
    expect(sisters(f, { kind: "version", id: 3 })).toEqual([{ kind: "version", id: 2 }]);
    expect(sisters(f, { kind: "version", id: 4 })).toEqual([]);
    // v1 e v9 sono entrambe senza genitore, ma non sono sorelle: sono vecchie, non imparentate.
    expect(sisters(f, { kind: "version", id: 1 })).toEqual([]);
  });

  test("gli antenati vanno dalla radice al genitore; un giro nei dati non blocca niente", () => {
    expect(ancestors(f, 4)).toEqual([1, 2]);
    expect(ancestors(f, 1)).toEqual([]);
    const giro = buildFlow([v(1, 2), v(2, 1)]);
    expect(ancestors(giro, 1).length).toBeLessThan(3);
  });

  test("figli e dimensione del sottoalbero contano anche i video", () => {
    expect(children(f, 4).clips.map((x) => x.clip_id)).toEqual([1]);
    expect(subtreeSize(f, 1)).toBe(5); // v1, v2, v3, v4 e il video c1
    expect(subtreeSize(f, 3)).toBe(1);
  });

  test("il ramo principale sotto una versione segue il figlio con piu' storia", () => {
    expect(mainDescendants(f, 1)).toEqual([2, 4]); // v2 ha un sottoalbero piu' grande di v3
  });

  test("la mappa: una riga per foglia, i genitori alla media dei figli, gli orfani contati e non disegnati", () => {
    const m = layoutMap(f);
    expect(m.orphans).toEqual([9]);
    const at = (k: string) => m.items.find((i) => i.key === k)!;
    expect(at("v1").x).toBe(0);
    expect(at("v4").x).toBe(2);
    expect(at("c1").x).toBe(3);
    // v3 e il video c1 sono foglie: stanno su righe diverse
    expect(at("v3").y).not.toBe(at("c1").y);
    // il genitore sta fra i suoi figli
    const ys = [at("v2").y, at("v3").y].sort((a, b) => a - b);
    expect(at("v1").y).toBeGreaterThanOrEqual(ys[0]!);
    expect(at("v1").y).toBeLessThanOrEqual(ys[1]!);
    expect(m.edges).toContainEqual({ from: "v4", to: "c1" });
    // il video senza versione compare comunque, e v9 no
    expect(m.items.some((i) => i.key === "c2")).toBe(true);
    expect(m.items.some((i) => i.key === "v9")).toBe(false);
  });
});
