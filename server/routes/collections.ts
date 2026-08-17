import { Hono } from "hono";
import { db, type CollageMode, type CollectionRow } from "../db.ts";
import { COLLAGE_MODES, collageFile, getCollage, modeCapacity } from "../collage.ts";
import { serveFile } from "../http.ts";

/**
 * Collections — the publishing unit. A gallery is what you shot; a collection
 * is what goes out as one post/carousel. Membership is exclusive (a photo sits
 * in at most one collection) and ordered, so the API is deliberately small:
 * list, create/rename, set the members of one collection, move photos between
 * collections, delete.
 */
export const collectionRoutes = new Hono();

type CollectionWithCount = CollectionRow & { photo_count: number };

function listCollections(): CollectionWithCount[] {
  return db()
    .query<CollectionWithCount, []>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM collection_photos cp WHERE cp.collection_id = c.id) AS photo_count
         FROM collections c
        ORDER BY c.position ASC, c.created_at ASC`,
    )
    .all();
}

/** Every collection with its photo ids in order, plus its collages — one
 *  payload the grid can group by. */
collectionRoutes.get("/api/collections", (c) => {
  const collections = listCollections();
  const members = db()
    .query<{ collection_id: string; photo_id: string }, []>(
      `SELECT collection_id, photo_id FROM collection_photos ORDER BY collection_id, position ASC`,
    )
    .all();
  const photosByCollection: Record<string, string[]> = {};
  for (const m of members) {
    (photosByCollection[m.collection_id] ??= []).push(m.photo_id);
  }
  const collageRows = db()
    .query<
      {
        id: string;
        collection_id: string;
        mode: CollageMode;
        layout: string;
        position: number;
        created_at: number;
      },
      []
    >("SELECT * FROM collages ORDER BY collection_id, position ASC")
    .all();
  const collageMembers = db()
    .query<{ collage_id: string; photo_id: string }, []>(
      "SELECT collage_id, photo_id FROM collage_photos ORDER BY collage_id, position ASC",
    )
    .all();
  const idsByCollage: Record<string, string[]> = {};
  for (const m of collageMembers) (idsByCollage[m.collage_id] ??= []).push(m.photo_id);
  const collages = collageRows.map((r) => ({ ...r, photo_ids: idsByCollage[r.id] ?? [] }));
  return c.json({ collections, photos: photosByCollection, collages });
});

collectionRoutes.post("/api/collections", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    title?: string;
    caption?: string;
    photo_ids?: string[];
  };
  const title = body.title?.trim();
  if (!title) return c.json({ error: "title required" }, 400);
  // A caller-supplied id keeps seeds/imports idempotent; otherwise slugify the
  // title and disambiguate, so ids stay readable in URLs and exports.
  const base =
    body.id?.trim() ||
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    "post";
  let id = base;
  for (let n = 2; db().query("SELECT 1 FROM collections WHERE id = ?").get(id); n++) {
    id = `${base}-${n}`;
  }
  const maxPos =
    (db().query<{ m: number | null }, []>("SELECT MAX(position) AS m FROM collections").get()?.m ?? -1) + 1;
  db().run(
    "INSERT INTO collections (id, title, caption, position, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, title, body.caption?.trim() || null, maxPos, Date.now()],
  );
  if (body.photo_ids?.length) setMembers(id, body.photo_ids);
  return c.json({ ok: true, id });
});

collectionRoutes.patch("/api/collections/:id", async (c) => {
  const id = c.req.param("id");
  const row = db().query<CollectionRow, [string]>("SELECT * FROM collections WHERE id = ?").get(id);
  if (!row) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    caption?: string | null;
    position?: number;
    reference_photo_id?: string | null;
  };
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return c.json({ error: "title cannot be empty" }, 400);
    db().run("UPDATE collections SET title = ? WHERE id = ?", [t, id]);
  }
  if (body.caption !== undefined) {
    db().run("UPDATE collections SET caption = ? WHERE id = ?", [body.caption?.trim() || null, id]);
  }
  if (body.position !== undefined) {
    db().run("UPDATE collections SET position = ? WHERE id = ?", [body.position, id]);
  }
  if (body.reference_photo_id !== undefined) {
    const ref = body.reference_photo_id;
    if (ref) {
      // Il riferimento deve stare NEL post: una foto di un altro gruppo
      // porterebbe dentro il colore sbagliato senza che si veda perché.
      const inPost = db()
        .query("SELECT 1 FROM collection_photos WHERE collection_id = ? AND photo_id = ?")
        .get(id, ref);
      if (!inPost) return c.json({ error: "la foto di riferimento non è in questo post" }, 400);
    }
    db().run("UPDATE collections SET reference_photo_id = ? WHERE id = ?", [ref, id]);
  }
  return c.json({ ok: true });
});

collectionRoutes.delete("/api/collections/:id", (c) => {
  // Membership rows go with it (ON DELETE CASCADE): the photos themselves are
  // untouched and simply return to "Non assegnate".
  db().run("DELETE FROM collections WHERE id = ?", [c.req.param("id")]);
  return c.json({ ok: true });
});

/** Replace a collection's members, in the given order. */
function setMembers(collectionId: string, photoIds: string[]): void {
  const d = db();
  const tx = d.transaction((ids: string[]) => {
    d.run("DELETE FROM collection_photos WHERE collection_id = ?", [collectionId]);
    const ins = d.prepare(
      "INSERT INTO collection_photos (photo_id, collection_id, position) VALUES (?, ?, ?)",
    );
    ids.forEach((pid, i) => {
      // Exclusive membership: adding a photo here removes it from wherever it was.
      d.run("DELETE FROM collection_photos WHERE photo_id = ?", [pid]);
      ins.run(pid, collectionId, i);
    });
  });
  tx(photoIds);
}

collectionRoutes.put("/api/collections/:id/photos", async (c) => {
  const id = c.req.param("id");
  if (!db().query("SELECT 1 FROM collections WHERE id = ?").get(id)) {
    return c.json({ error: "not found" }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as { photo_ids?: string[] };
  if (!Array.isArray(body.photo_ids)) return c.json({ error: "photo_ids required" }, 400);
  setMembers(id, body.photo_ids);
  return c.json({ ok: true, count: body.photo_ids.length });
});

/**
 * Move photos into a collection (append at the end), or out of every
 * collection when `collection_id` is null. This is what the grid's bulk
 * "assegna a" uses, so it must not disturb the collection's existing order.
 */
collectionRoutes.post("/api/collections/assign", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    photo_ids?: string[];
    collection_id?: string | null;
  };
  const ids = body.photo_ids ?? [];
  if (!ids.length) return c.json({ error: "photo_ids required" }, 400);
  const target = body.collection_id ?? null;
  const d = db();
  if (target === null) {
    const tx = d.transaction((xs: string[]) => {
      for (const pid of xs) d.run("DELETE FROM collection_photos WHERE photo_id = ?", [pid]);
    });
    tx(ids);
    return c.json({ ok: true, moved: ids.length, collection_id: null });
  }
  if (!d.query("SELECT 1 FROM collections WHERE id = ?").get(target)) {
    return c.json({ error: "collection not found" }, 404);
  }
  let pos =
    (d
      .query<{ m: number | null }, [string]>(
        "SELECT MAX(position) AS m FROM collection_photos WHERE collection_id = ?",
      )
      .get(target)?.m ?? -1) + 1;
  const tx = d.transaction((xs: string[]) => {
    for (const pid of xs) {
      d.run("DELETE FROM collection_photos WHERE photo_id = ?", [pid]);
      d.run(
        "INSERT INTO collection_photos (photo_id, collection_id, position) VALUES (?, ?, ?)",
        [pid, target, pos++],
      );
    }
  });
  tx(ids);
  return c.json({ ok: true, moved: ids.length, collection_id: target });
});

// ---- Collage: una slide del carosello fatta di più foto --------------------

/**
 * Rende il JPG del collage in background, gradato e no.
 *
 * Comporre costa secondi (decodifica + grade di ogni sorgente), quindi farlo
 * alla prima richiesta del browser significa una cella vuota per tutto quel
 * tempo. Farlo qui, appena il collage cambia, sposta l'attesa dove nessuno la
 * guarda. Gli errori si ingoiano: è una cache, non un risultato — se fallisce,
 * la rotta immagine ci riproverà e riporterà l'errore vero.
 */
function warmCollage(id: string): void {
  queueMicrotask(() => {
    const row = getCollage(id);
    if (!row) return;
    for (const graded of [true, false]) {
      try {
        collageFile(row, { graded });
      } catch {
        /* la rotta immagine riproverà e mostrerà l'errore vero */
      }
    }
  });
}

/**
 * Crea un collage con le foto date. Le foto devono già stare nel post: un
 * collage raggruppa quel che hai scelto, non lo aggiunge di straforo. Non le
 * toglie da `collection_photos` — così scioglierlo le rimette in fila dov'erano
 * senza dover ricordare niente.
 */
collectionRoutes.post("/api/collections/:id/collages", async (c) => {
  const collectionId = c.req.param("id");
  if (!db().query("SELECT 1 FROM collections WHERE id = ?").get(collectionId)) {
    return c.json({ error: "not found" }, 404);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    photo_ids?: string[];
    mode?: CollageMode;
    layout?: string;
  };
  const ids = body.photo_ids ?? [];
  if (ids.length < 2) return c.json({ error: "servono almeno 2 foto" }, 400);

  const inPost = new Set(
    db()
      .query<{ photo_id: string }, [string]>(
        "SELECT photo_id FROM collection_photos WHERE collection_id = ?",
      )
      .all(collectionId)
      .map((r) => r.photo_id),
  );
  const outside = ids.filter((x) => !inPost.has(x));
  if (outside.length) {
    return c.json({ error: `foto non in questo post: ${outside.join(", ")}` }, 400);
  }
  // Una foto in due collage renderebbe ambiguo l'ordine delle slide.
  const taken = db()
    .query<{ photo_id: string }, []>("SELECT photo_id FROM collage_photos")
    .all()
    .map((r) => r.photo_id);
  const dup = ids.filter((x) => taken.includes(x));
  if (dup.length) return c.json({ error: `già in un collage: ${dup.join(", ")}` }, 400);

  const mode = (body.mode ?? "hero") as CollageMode;
  if (!COLLAGE_MODES.includes(mode)) return c.json({ error: "composizione non valida" }, 400);
  const layout = (body.layout ?? "2x2").trim().toLowerCase();
  if (!/^[1-6]x[1-6]$/.test(layout)) return c.json({ error: "layout non valido" }, 400);
  const cap = modeCapacity(mode, layout);
  if (ids.length > cap) {
    return c.json({ error: `«${mode}» tiene ${cap} foto, qui ce ne sono ${ids.length}` }, 400);
  }

  const id = `cg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  // La slide prende il posto della PRIMA foto che assorbe: il collage resta
  // dov'era il gruppo, invece di saltare in fondo al carosello.
  const first =
    db()
      .query<{ position: number }, [string, string]>(
        "SELECT position FROM collection_photos WHERE collection_id = ? AND photo_id = ?",
      )
      .get(collectionId, ids[0]!)?.position ?? 0;

  const d = db();
  const tx = d.transaction(() => {
    d.run(
      "INSERT INTO collages (id, collection_id, mode, layout, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, collectionId, mode, layout, first, Date.now()],
    );
    ids.forEach((pid, i) =>
      d.run("INSERT INTO collage_photos (photo_id, collage_id, position) VALUES (?, ?, ?)", [
        pid,
        id,
        i,
      ]),
    );
  });
  tx();
  // Compone subito, senza far aspettare la risposta: quando la griglia si
  // ridisegna il JPG è già su disco e la slide appare piena invece che vuota.
  warmCollage(id);
  return c.json({ ok: true, id });
});

collectionRoutes.patch("/api/collages/:id", async (c) => {
  const id = c.req.param("id");
  const row = getCollage(id);
  if (!row) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: CollageMode;
    layout?: string;
    photo_ids?: string[];
  };
  const n = body.photo_ids?.length ?? row.photo_ids.length;
  const nextLayout = (body.layout ?? row.layout).trim().toLowerCase();
  if (!/^[1-6]x[1-6]$/.test(nextLayout)) return c.json({ error: "layout non valido" }, 400);
  const nextMode = (body.mode ?? row.mode) as CollageMode;
  if (!COLLAGE_MODES.includes(nextMode)) return c.json({ error: "composizione non valida" }, 400);
  // La capienza si controlla sulla combinazione FINALE: cambiare modo e numero
  // di foto insieme non deve poter far sparire uno scatto.
  const cap = modeCapacity(nextMode, nextLayout);
  if (n > cap) {
    return c.json({ error: `«${nextMode}» tiene ${cap} foto, qui ce ne sono ${n}` }, 400);
  }
  if (body.mode !== undefined) {
    db().run("UPDATE collages SET mode = ? WHERE id = ?", [nextMode, id]);
  }
  if (body.layout !== undefined) {
    db().run("UPDATE collages SET layout = ? WHERE id = ?", [nextLayout, id]);
  }
  if (body.photo_ids) {
    const d = db();
    const tx = d.transaction((xs: string[]) => {
      d.run("DELETE FROM collage_photos WHERE collage_id = ?", [id]);
      xs.forEach((pid, i) =>
        d.run("INSERT INTO collage_photos (photo_id, collage_id, position) VALUES (?, ?, ?)", [
          pid,
          id,
          i,
        ]),
      );
    });
    tx(body.photo_ids);
  }
  warmCollage(id);
  return c.json({ ok: true });
});

/** Scioglie il collage: le foto tornano slide singole, esattamente dov'erano. */
collectionRoutes.delete("/api/collages/:id", (c) => {
  db().run("DELETE FROM collages WHERE id = ?", [c.req.param("id")]);
  return c.json({ ok: true });
});

/** Il JPG composto. `graded=0` per vederlo senza color grade. */
collectionRoutes.get("/api/collages/:id/image", (c) => {
  const row = getCollage(c.req.param("id"));
  if (!row) return new Response("not found", { status: 404 });
  const graded = c.req.query("graded") !== "0";
  const size = c.req.query("size") ?? "1080x1350";
  if (!/^\d{2,4}x\d{2,4}$/.test(size)) return new Response("bad size", { status: 400 });
  try {
    return serveFile(collageFile(row, { graded, size }), "image/jpeg");
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
});
