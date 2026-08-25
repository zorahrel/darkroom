import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFile, guessMime } from "../server/http.ts";

/**
 * Un video che non si puo' cercare non sembra un difetto del server: sembra un
 * player rotto. `currentTime = 120` senza `Range` riporta la testina a zero, e
 * il clic sulla striscia, il passo a fotogramma e il trascinamento sulla
 * timeline falliscono tutti insieme senza un errore da nessuna parte — l'unica
 * traccia e' un 200 dove doveva esserci un 206.
 */
const dir = mkdtempSync(join(tmpdir(), "dk-range-"));
const f = join(dir, "clip.mp4");
const CORPO = "0123456789ABCDEF";
writeFileSync(f, CORPO);

const chiedi = (range?: string) =>
  serveFile(f, undefined, new Request("http://x/clip.mp4", range ? { headers: { range } } : {}));

describe("serveFile e i pezzi di file", () => {
  test("senza Range: tutto il file, ma dichiara di saperli fare", async () => {
    const r = chiedi();
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await r.text()).toBe(CORPO);
  });

  test("un pezzo in mezzo torna 206 con il content-range giusto", async () => {
    const r = chiedi("bytes=4-7");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes 4-7/${CORPO.length}`);
    expect(r.headers.get("content-length")).toBe("4");
    expect(await r.text()).toBe("4567");
  });

  test("senza fine: da li' fino in fondo", async () => {
    const r = chiedi("bytes=12-");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("CDEF");
  });

  test("il suffisso sono gli ULTIMI byte, non i primi", async () => {
    const r = chiedi("bytes=-4");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("CDEF");
    expect(r.headers.get("content-range")).toBe(`bytes 12-15/${CORPO.length}`);
  });

  test("una fine oltre il file si accorcia, non esplode", async () => {
    const r = chiedi("bytes=10-9999");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("ABCDEF");
  });

  test("un inizio oltre il file e' 416, non un corpo vuoto qualsiasi", async () => {
    const r = chiedi("bytes=99-");
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe(`bytes */${CORPO.length}`);
  });
});

describe("i tipi che decidono se una cosa si vede o si scarica", () => {
  test("i video hanno il loro tipo", () => {
    expect(guessMime("/a/b.mp4")).toBe("video/mp4");
    expect(guessMime("/a/b.webm")).toBe("video/webm");
    expect(guessMime("/a/b.mp3")).toBe("audio/mpeg");
  });
});
