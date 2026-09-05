import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFile, guessMime } from "../server/http.ts";

/**
 * A video that cannot be seeked does not look like a server defect: it looks
 * like a broken player. `currentTime = 120` without `Range` takes the playhead
 * back to zero, and the click on the strip, the frame step and the drag on the
 * timeline all fail together with an error nowhere — the only trace is a 200
 * where there should have been a 206.
 */
const dir = mkdtempSync(join(tmpdir(), "dk-range-"));
const f = join(dir, "clip.mp4");
const BODY = "0123456789ABCDEF";
writeFileSync(f, BODY);

const ask = (range?: string) =>
  serveFile(f, undefined, new Request("http://x/clip.mp4", range ? { headers: { range } } : {}));

describe("serveFile and byte ranges", () => {
  test("without Range: the whole file, but it declares it can do them", async () => {
    const r = ask();
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await r.text()).toBe(BODY);
  });

  test("a chunk in the middle returns 206 with the right content-range", async () => {
    const r = ask("bytes=4-7");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe(`bytes 4-7/${BODY.length}`);
    expect(r.headers.get("content-length")).toBe("4");
    expect(await r.text()).toBe("4567");
  });

  test("with no end: from there to the bottom", async () => {
    const r = ask("bytes=12-");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("CDEF");
  });

  test("the suffix is the LAST bytes, not the first", async () => {
    const r = ask("bytes=-4");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("CDEF");
    expect(r.headers.get("content-range")).toBe(`bytes 12-15/${BODY.length}`);
  });

  test("an end beyond the file is shortened, it does not blow up", async () => {
    const r = ask("bytes=10-9999");
    expect(r.status).toBe(206);
    expect(await r.text()).toBe("ABCDEF");
  });

  test("a start beyond the file is a 416, not just any empty body", async () => {
    const r = ask("bytes=99-");
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe(`bytes */${BODY.length}`);
  });
});

describe("the types that decide whether a thing is displayed or downloaded", () => {
  test("i video hanno il loro tipo", () => {
    expect(guessMime("/a/b.mp4")).toBe("video/mp4");
    expect(guessMime("/a/b.webm")).toBe("video/webm");
    expect(guessMime("/a/b.mp3")).toBe("audio/mpeg");
  });
});
