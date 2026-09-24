import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { dirs } from "../project.ts";
import { serveFile } from "../http.ts";

/**
 * Annotazioni: Attilio disegna sopra una versione o una reference e ci scrive
 * una nota, cosi' il punto da correggere arriva come segno e non come frase.
 *
 * PERCHE'. Sul Kaumat la striscia della nuca e' stata spiegata a parole quattro
 * volte senza uscire giusta; le corna erano uscite al primo colpo appena c'era
 * un segno rosso. Il client manda il PNG gia' composto (immagine + tratti):
 * qui lo si salva e basta, senza ricomporre niente.
 */
export const annotationRoutes = new Hono();

type AnnotationRow = {
  id: number;
  photo_id: string | null;
  version_number: number | null;
  ref_file: string | null;
  image_path: string;
  note: string;
  created_at: number;
};

const annotationsDir = () => join(dirs().DATA_DIR, "annotazioni");
const safe = (s: string) => !!s && !s.includes("/") && !s.includes("..");

function withUrl(r: AnnotationRow) {
  const [dir = "", file = ""] = r.image_path.slice(annotationsDir().length + 1).split("/");
  return { ...r, url: `/annotazioni/${encodeURIComponent(dir)}/${encodeURIComponent(file)}` };
}

annotationRoutes.get("/api/annotations", (c) => {
  const photo = c.req.query("photo_id");
  const version = c.req.query("version");
  const ref = c.req.query("ref");
  let rows: AnnotationRow[];
  if (ref) {
    rows = db()
      .query<AnnotationRow, [string]>("SELECT * FROM annotations WHERE ref_file = ? ORDER BY created_at DESC")
      .all(ref);
  } else if (photo) {
    rows = version
      ? db()
          .query<AnnotationRow, [string, number]>(
            "SELECT * FROM annotations WHERE photo_id = ? AND version_number = ? ORDER BY created_at DESC",
          )
          .all(photo, Number(version))
      : db()
          .query<AnnotationRow, [string]>("SELECT * FROM annotations WHERE photo_id = ? ORDER BY created_at DESC")
          .all(photo);
  } else {
    rows = db().query<AnnotationRow, []>("SELECT * FROM annotations ORDER BY created_at DESC LIMIT 100").all();
  }
  return c.json({ annotations: rows.map(withUrl) });
});

annotationRoutes.post("/api/annotations", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    photo_id?: string;
    version_number?: number;
    ref_file?: string;
    note?: string;
    png?: string;
  } | null;
  if (!body?.png) return c.json({ error: "png mancante" }, 400);
  const onVersion = body.photo_id != null && body.version_number != null;
  const onRef = body.ref_file != null;
  if (onVersion === onRef) return c.json({ error: "serve o photo_id+version_number o ref_file" }, 400);
  if (onVersion && !safe(body.photo_id!)) return c.json({ error: "photo_id non valido" }, 400);
  if (onRef && !safe(body.ref_file!)) return c.json({ error: "ref_file non valido" }, 400);

  const b64 = body.png.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  // Firma PNG: un corpo che non e' un'immagine non deve finire su disco come .png.
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return c.json({ error: "non e' un PNG" }, 400);

  const now = Date.now();
  const dir = onVersion ? body.photo_id! : "_references";
  const stem = onVersion
    ? `v${String(body.version_number).padStart(2, "0")}`
    : body.ref_file!.replace(/\.[^.]+$/, "");
  mkdirSync(join(annotationsDir(), dir), { recursive: true });
  const path = join(annotationsDir(), dir, `${stem}-${now}.png`);
  writeFileSync(path, buf);

  const ins = db().run(
    `INSERT INTO annotations (photo_id, version_number, ref_file, image_path, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [onVersion ? body.photo_id! : null, onVersion ? Number(body.version_number) : null, onRef ? body.ref_file! : null, path, (body.note ?? "").trim(), now],
  );
  const row = db()
    .query<AnnotationRow, [number]>("SELECT * FROM annotations WHERE id = ?")
    .get(Number(ins.lastInsertRowid))!;
  return c.json({ annotation: withUrl(row) }, 201);
});

annotationRoutes.get("/annotazioni/:dir/:file", (c) => {
  const dir = c.req.param("dir");
  const file = c.req.param("file");
  if (!safe(dir) || !safe(file)) return new Response("bad request", { status: 400 });
  return serveFile(join(annotationsDir(), dir, file), "image/png");
});
