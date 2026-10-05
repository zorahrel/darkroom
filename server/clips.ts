import type { SQLQueryBindings } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { db } from "./db.ts";
import { dirs } from "./project.ts";

/**
 * Clip: i video nati da una versione di una foto (il primo fotogramma e' la versione).
 *
 * PERCHE' una tabella a parte e non una `version`. Una versione e' un'immagine che si
 * confronta, si sceglie e si ritocca; un clip e' un derivato di quella immagine e ha altre
 * domande (modello, durata, audio, quanto e' costato). Metterli nello stesso elenco
 * avrebbe sporcato il carosello delle versioni.
 *
 * Il file originale entra nell'archivio del progetto cosi' com'e': MAI ricodificato, e' lo
 * stesso file che si salva in Downloads. L'unica cosa che si perde ricodificando e' qualita'.
 */

export type ClipRow = {
  id: number;
  photo_id: string;
  version_number: number | null;
  file: string;
  model: string | null;
  prompt: string | null;
  params: string | null;
  remote_id: string | null;
  credits: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  fps: number | null;
  has_audio: number;
  codec: string | null;
  size: number;
  note: string | null;
  created_at: number;
};

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

/** La tabella nasce al primo uso, in ogni progetto: niente migrazione da ricordare. */
function ensure(): void {
  db().run(`CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id TEXT NOT NULL,
    version_number INTEGER,
    file TEXT NOT NULL,
    model TEXT,
    prompt TEXT,
    params TEXT,
    remote_id TEXT,
    credits INTEGER,
    width INTEGER,
    height INTEGER,
    duration REAL,
    fps REAL,
    has_audio INTEGER NOT NULL DEFAULT 0,
    codec TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL
  )`);
  db().run("CREATE INDEX IF NOT EXISTS idx_clips_photo ON clips(photo_id, created_at)");
}

export const clipsDir = (photoId: string) => join(dirs().DATA_DIR, "video", photoId);

export function listClips(photoId: string): ClipRow[] {
  ensure();
  return db()
    .query<ClipRow, [string]>("SELECT * FROM clips WHERE photo_id = ? ORDER BY created_at DESC, id DESC")
    .all(photoId);
}

export function getClip(id: number): ClipRow | null {
  ensure();
  return db().query<ClipRow, [number]>("SELECT * FROM clips WHERE id = ?").get(id) ?? null;
}

type Probe = {
  width: number | null; height: number | null; duration: number | null;
  fps: number | null; has_audio: boolean; codec: string | null;
};

/** Legge il file con ffprobe. Se non ha una traccia video, non e' un clip e si rifiuta. */
function probe(path: string): Probe {
  const r = Bun.spawnSync([
    "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path,
  ]);
  if (r.exitCode !== 0) throw new Error(`ffprobe non legge il file: ${r.stderr.toString().slice(0, 200)}`);
  const j = JSON.parse(r.stdout.toString()) as {
    streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v) throw new Error("il file non ha una traccia video");
  const [n, d] = (v.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = d ? Math.round(((n ?? 0) / d) * 100) / 100 : null;
  const dur = Number(j.format?.duration);
  return {
    width: v.width ?? null,
    height: v.height ?? null,
    duration: Number.isFinite(dur) ? Math.round(dur * 100) / 100 : null,
    fps,
    has_audio: !!j.streams?.some((s) => s.codec_type === "audio"),
    codec: v.codec_name ?? null,
  };
}

/** 1440 per un 1440x2560 verticale come per un 2560x1440 orizzontale: conta il lato corto. */
const resLabel = (w: number | null, h: number | null) => (w && h ? `${Math.min(w, h)}p` : "");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export type ImportClip = {
  path: string;
  version_number?: number | null;
  model?: string | null;
  prompt?: string | null;
  params?: unknown;
  remote_id?: string | null;
  credits?: number | null;
  note?: string | null;
};

/** Copia il file nell'archivio del progetto e registra il clip. Non sposta mai l'originale. */
export function importClip(photoId: string, input: ImportClip): ClipRow {
  ensure();
  const src = input.path;
  if (!src.startsWith("/") || !existsSync(src) || !statSync(src).isFile()) {
    throw new Error("serve il percorso assoluto di un file esistente");
  }
  const ext = extname(src).toLowerCase();
  if (!VIDEO_EXT.has(ext)) throw new Error(`estensione non video: ${ext || "(nessuna)"}`);
  const info = probe(src);

  const dir = clipsDir(photoId);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const name = [
    input.version_number != null ? `v${input.version_number}` : "clip",
    input.model ? slug(input.model) : "",
    resLabel(info.width, info.height),
    info.duration ? `${Math.round(info.duration)}s` : "",
    stamp,
  ].filter(Boolean).join("_") + ext;
  const dest = join(dir, name);
  copyFileSync(src, dest);

  const row = db()
    .query<ClipRow, SQLQueryBindings[]>(
      `INSERT INTO clips (photo_id, version_number, file, model, prompt, params, remote_id, credits,
         width, height, duration, fps, has_audio, codec, size, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    )
    .get(
      photoId, input.version_number ?? null, dest, input.model ?? null, input.prompt ?? null,
      input.params == null ? null : JSON.stringify(input.params), input.remote_id ?? null,
      input.credits ?? null, info.width, info.height, info.duration, info.fps, info.has_audio ? 1 : 0,
      info.codec, statSync(dest).size, input.note ?? null, Date.now(),
    )!;
  return row;
}

/** Toglie il clip dall'elenco. Il file resta nell'archivio: Darkroom non cancella il lavoro. */
export function forgetClip(id: number): boolean {
  ensure();
  return db().run("DELETE FROM clips WHERE id = ?", [id]).changes > 0;
}

/** Nome leggibile per chi lo riceve: foto, versione, modello, risoluzione, durata. */
export function downloadName(c: ClipRow): string {
  const ext = extname(c.file) || ".mp4";
  return [
    slug(c.photo_id),
    c.version_number != null ? `v${c.version_number}` : "",
    c.model ? slug(c.model) : "",
    resLabel(c.width, c.height),
    c.duration ? `${Math.round(c.duration)}s` : "",
  ].filter(Boolean).join("_") + ext;
}

/**
 * Copia l'originale in ~/Downloads, byte per byte (nessuna ricodifica = massima qualita').
 * Se esiste gia' un file con lo stesso nome ne crea un altro con un numero, non lo sovrascrive.
 */
export function saveToDownloads(c: ClipRow): string {
  if (!existsSync(c.file)) throw new Error("il file del clip non c'e' piu' nell'archivio");
  // `DARKROOM_DOWNLOADS_DIR` esiste per i test: senza, un collaudo scriverebbe nella Downloads vera.
  const dir = process.env.DARKROOM_DOWNLOADS_DIR ?? join(homedir(), "Downloads");
  mkdirSync(dir, { recursive: true });
  const wanted = downloadName(c);
  const ext = extname(wanted);
  const stem = basename(wanted, ext);
  let dest = join(dir, wanted);
  for (let n = 2; existsSync(dest); n++) dest = join(dir, `${stem}-${n}${ext}`);
  copyFileSync(c.file, dest);
  return dest;
}
