import type { BranchNode } from "../../api/types";

/**
 * L'albero di una foto, calcolato una volta: chi e' figlio di chi, chi ha sorelle, qual e' la
 * strada dalla radice a una versione, e dove sta ogni nodo nella mappa.
 *
 * Tutto qui e' funzione pura: le tre viste (Foglia, Ramo, Mappa) leggono gli stessi numeri, cosi'
 * non possono raccontare storie diverse sulla stessa immagine.
 */

export type VNode = Extract<BranchNode, { kind: "version" }>;
export type CNode = Extract<BranchNode, { kind: "clip" }>;
export type Ref = { kind: "version" | "clip"; id: number };

export const keyOf = (r: Ref) => (r.kind === "version" ? `v${r.id}` : `c${r.id}`);
export const refOfKey = (k: string): Ref => ({ kind: k.startsWith("v") ? "version" : "clip", id: Number(k.slice(1)) });

export type Flow = {
  versions: Map<number, VNode>;
  clips: Map<number, CNode>;
  /** Le versioni nate da una versione (o le radici, con chiave null). */
  kids: Map<number | null, VNode[]>;
  /** I video che partono da una versione (o i riferimenti senza versione, con chiave null). */
  clipsBy: Map<number | null, CNode[]>;
};

export function buildFlow(nodes: BranchNode[]): Flow {
  const f: Flow = { versions: new Map(), clips: new Map(), kids: new Map(), clipsBy: new Map() };
  for (const n of nodes) {
    if (n.kind === "version") {
      f.versions.set(n.version_number, n);
      const l = f.kids.get(n.parent) ?? [];
      l.push(n);
      f.kids.set(n.parent, l);
    } else {
      f.clips.set(n.clip_id, n);
      const l = f.clipsBy.get(n.parent) ?? [];
      l.push(n);
      f.clipsBy.set(n.parent, l);
    }
  }
  return f;
}

export const nodeOf = (f: Flow, r: Ref): VNode | CNode | undefined =>
  r.kind === "version" ? f.versions.get(r.id) : f.clips.get(r.id);

/** Da quale versione nasce: per una versione il genitore, per un clip il suo primo fotogramma. */
export function parentOf(f: Flow, r: Ref): number | null {
  const n = nodeOf(f, r);
  return n ? n.parent : null;
}

/** Le sorelle: i nodi dello stesso tipo con lo stesso genitore, esclusa se stessa. */
export function sisters(f: Flow, r: Ref): Ref[] {
  const p = parentOf(f, r);
  if (r.kind === "clip") {
    return (f.clipsBy.get(p) ?? []).filter((c) => c.clip_id !== r.id).map((c) => ({ kind: "clip", id: c.clip_id }));
  }
  // Le radici senza genitore non sono sorelle fra loro: sono solo vecchie, senza storia dichiarata.
  if (p == null) return [];
  return (f.kids.get(p) ?? []).filter((v) => v.version_number !== r.id).map((v) => ({ kind: "version", id: v.version_number }));
}

/** Dalla radice al genitore, esclusa la versione stessa. Si ferma se trova un giro. */
export function ancestors(f: Flow, versionId: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([versionId]);
  let p = f.versions.get(versionId)?.parent ?? null;
  while (p != null && f.versions.has(p) && !seen.has(p)) {
    seen.add(p);
    out.push(p);
    p = f.versions.get(p)!.parent;
  }
  return out.reverse();
}

/** Cio' che e' nato direttamente da una versione: altre versioni e video. */
export function children(f: Flow, versionId: number): { versions: VNode[]; clips: CNode[] } {
  return { versions: f.kids.get(versionId) ?? [], clips: f.clipsBy.get(versionId) ?? [] };
}

/** Quanti nodi stanno sotto una versione, lei compresa. */
export function subtreeSize(f: Flow, versionId: number, seen = new Set<number>()): number {
  if (seen.has(versionId)) return 0;
  seen.add(versionId);
  const c = children(f, versionId);
  return 1 + c.clips.length + c.versions.reduce((s, v) => s + subtreeSize(f, v.version_number, seen), 0);
}

/**
 * La strada che continua sotto una versione: a ogni passo il figlio che ha dietro piu' storia
 * (a parita' il piu' recente). E' il "ramo principale" da mostrare quando non se ne sceglie un altro.
 */
export function mainDescendants(f: Flow, versionId: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([versionId]);
  let cur = versionId;
  for (;;) {
    const kids = (f.kids.get(cur) ?? []).filter((k) => !seen.has(k.version_number));
    if (kids.length === 0) break;
    const best = [...kids].sort(
      (a, b) =>
        subtreeSize(f, b.version_number) - subtreeSize(f, a.version_number) || b.created_at - a.created_at,
    )[0]!;
    seen.add(best.version_number);
    out.push(best.version_number);
    cur = best.version_number;
  }
  return out;
}

export type MapItem = { key: string; ref: Ref; x: number; y: number };
export type MapEdge = { from: string; to: string };
export type MapLayout = {
  items: MapItem[];
  edges: MapEdge[];
  cols: number;
  rows: number;
  /** Versioni senza genitore e senza figli: troppo vecchie per avere una storia dichiarata. */
  orphans: number[];
};

/**
 * Impianto della mappa: la profondita' e' la colonna, ogni foglia (versione senza figli o video)
 * ha la sua riga e un genitore sta alla media delle righe dei figli. Solo le radici che hanno una
 * storia entrano: le altre restano un numero, non 170 puntini sparsi.
 */
export function layoutMap(f: Flow): MapLayout {
  const items: MapItem[] = [];
  const edges: MapEdge[] = [];
  const orphans: number[] = [];
  let row = 0;
  let cols = 0;
  const seen = new Set<number>();

  const place = (vid: number, depth: number): number => {
    seen.add(vid);
    cols = Math.max(cols, depth + 1);
    const c = children(f, vid);
    const ys: number[] = [];
    for (const v of c.versions) {
      if (seen.has(v.version_number)) continue;
      const y = place(v.version_number, depth + 1);
      edges.push({ from: `v${vid}`, to: `v${v.version_number}` });
      ys.push(y);
    }
    for (const cl of c.clips) {
      cols = Math.max(cols, depth + 2);
      items.push({ key: `c${cl.clip_id}`, ref: { kind: "clip", id: cl.clip_id }, x: depth + 1, y: row });
      edges.push({ from: `v${vid}`, to: `c${cl.clip_id}` });
      ys.push(row);
      row += 1;
    }
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : row++;
    items.push({ key: `v${vid}`, ref: { kind: "version", id: vid }, x: depth, y });
    return y;
  };

  for (const r of f.kids.get(null) ?? []) {
    const hasHistory = (f.kids.get(r.version_number)?.length ?? 0) + (f.clipsBy.get(r.version_number)?.length ?? 0) > 0;
    if (!hasHistory) {
      orphans.push(r.version_number);
      continue;
    }
    place(r.version_number, 0);
    row += 0.5; // un respiro fra una radice e la successiva
  }
  // I video senza versione (i riferimenti) stanno in fondo, in colonna 0.
  for (const cl of f.clipsBy.get(null) ?? []) {
    items.push({ key: `c${cl.clip_id}`, ref: { kind: "clip", id: cl.clip_id }, x: 0, y: row });
    row += 1;
    cols = Math.max(cols, 1);
  }
  return { items, edges, cols, rows: Math.max(1, Math.ceil(row)), orphans };
}

export type RunItem<T> = { kind: "row"; row: T } | { kind: "run"; start: number; rows: T[] };

/**
 * Piega le tratte dritte: una serie di righe di fila senza niente da dire, da `min` in su, diventa un
 * solo elemento «⋯ N passi». Una tratta aperta (`open` contiene l'id della sua prima riga) resta in chiaro.
 */
export function groupRuns<T>(
  rows: T[],
  interesting: (row: T, index: number) => boolean,
  idOf: (row: T) => number,
  open: Set<number>,
  min = 3,
): RunItem<T>[] {
  const out: RunItem<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= min && !open.has(idOf(run[0]!))) out.push({ kind: "run", start: idOf(run[0]!), rows: run });
    else for (const row of run) out.push({ kind: "row", row });
    run = [];
  };
  rows.forEach((row, i) => {
    if (interesting(row, i)) {
      flush();
      out.push({ kind: "row", row });
    } else run.push(row);
  });
  flush();
  return out;
}

export type Step = "up" | "down" | "prev" | "next";

/**
 * Un passo con le frecce, lo stesso in tutte e tre le viste:
 *   su      al genitore            giu'      al figlio sul ramo principale (prima una versione, poi un video)
 *   sinistra/destra  alla sorella precedente/successiva (in cerchio, per numero)
 * Restituisce null quando il passo non porta da nessuna parte: la selezione non si muove.
 */
export function stepSelection(f: Flow, r: Ref, step: Step): Ref | null {
  const n = nodeOf(f, r);
  if (!n) return null;
  if (step === "up") return n.parent != null && f.versions.has(n.parent) ? { kind: "version", id: n.parent } : null;
  if (step === "down") {
    if (r.kind !== "version") return null;
    const main = mainDescendants(f, r.id)[0];
    if (main != null) return { kind: "version", id: main };
    const clip = (f.clipsBy.get(r.id) ?? [])[0];
    return clip ? { kind: "clip", id: clip.clip_id } : null;
  }
  const ring = [r, ...sisters(f, r)].sort((a, b) => a.id - b.id);
  if (ring.length < 2) return null;
  const i = ring.findIndex((x) => x.kind === r.kind && x.id === r.id);
  return ring[(i + (step === "next" ? 1 : -1) + ring.length) % ring.length]!;
}
