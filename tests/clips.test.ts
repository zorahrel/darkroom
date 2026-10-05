import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";

/**
 * Clip: i video nati da una versione. Cio' che si protegge qui e' che l'originale arrivi
 * intatto (download, Downloads, Range) e che un intervallo `bytes=0-99` restituisca 100 byte
 * e non l'intero file, come faceva `serveFile` dentro l'app.
 */
const dir = mkdtempSync(join(tmpdir(), "clips-"));
const SRC = join(dir, "sorgente.mp4");
const DOWNLOADS = join(dir, "Downloads");
const PHOTO = "clip_photo";
let clipId = 0;

const req = (path: string, init?: RequestInit) => app.request(path, init);

beforeAll(() => {
  // 1 secondo, 144x256 verticale, con audio: abbastanza per leggere larghezza, altezza e audio.
  const r = Bun.spawnSync([
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=144x256:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", SRC,
  ]);
  if (r.exitCode !== 0) throw new Error(`ffmpeg: ${r.stderr.toString()}`);
  mkdirSync(DOWNLOADS, { recursive: true });
  process.env.DARKROOM_DOWNLOADS_DIR = DOWNLOADS;
  const now = Date.now();
  db().run(
    "INSERT OR IGNORE INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES (?, '', '.jpg', ?, ?)",
    [PHOTO, now, now],
  );
});

describe("clip", () => {
  test("si importa: dati letti dal file, copia nell'archivio, originale intatto", async () => {
    const res = await req(`/api/photos/${PHOTO}/clips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: SRC, version_number: 240, model: "MiniMax H3", credits: 20, prompt: "p" }),
    });
    expect(res.status).toBe(200);
    const { clip } = await res.json();
    clipId = clip.id;
    expect([clip.width, clip.height]).toEqual([144, 256]);
    expect(clip.has_audio).toBe(true);
    expect(clip.size).toBe(statSync(SRC).size);
    // Un verticale 144x256 e' «144p»: conta il lato corto, non l'altezza.
    expect(clip.download_name).toBe("clip-photo_v240_minimax-h3_144p_1s.mp4");
    expect(existsSync(SRC)).toBe(true);
  });

  test("l'elenco lo restituisce e una foto sconosciuta e' un 404", async () => {
    const list = await (await req(`/api/photos/${PHOTO}/clips`)).json();
    expect(list.clips.map((c: { id: number }) => c.id)).toContain(clipId);
    expect((await req("/api/photos/non_esiste/clips")).status).toBe(404);
  });

  test("rifiuta cio' che non e' un video o non esiste", async () => {
    const post = (path: string) =>
      req(`/api/photos/${PHOTO}/clips`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    expect((await post(join(dir, "manca.mp4"))).status).toBe(400);
    expect((await post("relativo.mp4")).status).toBe(400);
    expect((await post(join(dir, "Downloads"))).status).toBe(400);
  });

  test("Range: bytes=0-99 restituisce 100 byte, non l'intero file", async () => {
    const whole = readFileSync(SRC);
    const get = async (range: string) => {
      const r = await req(`/api/clips/${clipId}/file`, { headers: { range } });
      return { r, body: Buffer.from(await r.arrayBuffer()) };
    };
    const a = await get("bytes=0-99");
    expect(a.r.status).toBe(206);
    expect(a.r.headers.get("content-range")).toBe(`bytes 0-99/${whole.length}`);
    expect(a.body.length).toBe(100);
    expect(a.body.equals(whole.subarray(0, 100))).toBe(true);

    const b = await get("bytes=200-299");
    expect(b.body.equals(whole.subarray(200, 300))).toBe(true);

    const tail = await get("bytes=-500");
    expect(tail.body.equals(whole.subarray(whole.length - 500))).toBe(true);

    expect((await get(`bytes=${whole.length + 10}-`)).r.status).toBe(416);
  });

  test("il download e' l'originale byte per byte, con un nome leggibile", async () => {
    const r = await req(`/api/clips/${clipId}/download`);
    expect(r.headers.get("content-disposition")).toContain('filename="clip-photo_v240_minimax-h3_144p_1s.mp4"');
    expect(Buffer.from(await r.arrayBuffer()).equals(readFileSync(SRC))).toBe(true);
  });

  test("il tasto rapido copia l'originale in Downloads e non sovrascrive", async () => {
    const save = async () => (await (await req(`/api/clips/${clipId}/save-to-downloads`, { method: "POST" })).json()) as { path: string; size: number };
    const one = await save();
    expect(one.path.startsWith(DOWNLOADS)).toBe(true);
    expect(readFileSync(one.path).equals(readFileSync(SRC))).toBe(true);
    const two = await save();
    expect(two.path).not.toBe(one.path);
    expect(two.path.endsWith("-2.mp4")).toBe(true);
    expect(readFileSync(one.path).equals(readFileSync(SRC))).toBe(true);
  });

  test("togliere un clip dall'elenco non cancella il file dall'archivio", async () => {
    const before = (await (await req(`/api/photos/${PHOTO}/clips`)).json()).clips[0];
    const row = db().query<{ file: string }, [number]>("SELECT file FROM clips WHERE id = ?").get(before.id)!;
    expect((await req(`/api/clips/${clipId}`, { method: "DELETE" })).status).toBe(200);
    expect((await req(`/api/clips/${clipId}/file`)).status).toBe(404);
    expect(existsSync(row.file)).toBe(true);
  });
});
