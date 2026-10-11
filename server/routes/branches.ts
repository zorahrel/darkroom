import { Hono } from "hono";
import { getBranches, setDiscard, setFinal, setParent } from "../branches.ts";
import { db } from "../db.ts";

/** Il flusso a rami di una foto: versioni e clip sullo stesso albero, con le foglie finali. */
export const branchRoutes = new Hono();

const photoExists = (id: string) => !!db().query("SELECT 1 FROM photos WHERE id = ?").get(id);

branchRoutes.get("/api/photos/:id/branches", (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  return c.json(getBranches(id));
});

/** `{kind: "version"|"clip", ref: number, final: boolean}` */
branchRoutes.put("/api/photos/:id/finals", async (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  const b = (await c.req.json().catch(() => null)) as { kind?: string; ref?: number; final?: boolean } | null;
  if (!b || (b.kind !== "version" && b.kind !== "clip") || !Number.isInteger(b.ref) || typeof b.final !== "boolean") {
    return c.json({ error: "servono kind (version|clip), ref (intero) e final (booleano)" }, 400);
  }
  return c.json({ final: setFinal(id, b.kind, b.ref as number, b.final) });
});

/** `{parent: number|null}`: da quale versione nasce questa. */
branchRoutes.put("/api/photos/:id/versions/:n/parent", async (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  const n = Number(c.req.param("n"));
  const b = (await c.req.json().catch(() => null)) as { parent?: number | null } | null;
  if (!Number.isInteger(n) || !b || !("parent" in b) || (b.parent !== null && !Number.isInteger(b.parent))) {
    return c.json({ error: "serve parent (intero o null)" }, 400);
  }
  try {
    setParent(id, n, b.parent ?? null);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  return c.json({ ok: true });
});

/** `{kind: "version"|"clip", ref: number, discarded: boolean}`: mette da parte o riprende. */
branchRoutes.put("/api/photos/:id/discards", async (c) => {
  const id = c.req.param("id");
  if (!photoExists(id)) return c.json({ error: "foto non trovata" }, 404);
  const b = (await c.req.json().catch(() => null)) as { kind?: string; ref?: number; discarded?: boolean } | null;
  if (!b || (b.kind !== "version" && b.kind !== "clip") || !Number.isInteger(b.ref) || typeof b.discarded !== "boolean") {
    return c.json({ error: "servono kind (version|clip), ref (intero) e discarded (booleano)" }, 400);
  }
  return c.json({ discarded: setDiscard(id, b.kind, b.ref as number, b.discarded) });
});
