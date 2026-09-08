import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as motore from "../server/core.ts";
import { scegliOriginali } from "../server/importer.ts";
import { thumbnailPath } from "../server/thumb.ts";

afterAll(() => motore.fermaMotore());

/** Un JPEG vero, 64×48. Piccolo abbastanza da stare qui, vero abbastanza da decodificarsi. */
const JPEG_64x48 = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAAwAEADACIAAREBAhEB/9sAQwAGBAQFBAQGBQUFBgYGBwkOCQkICAkSDQ0KDhUSFhYVEhQUFxohHBcYHxkUFB0nHR8iIyUlJRYcKSwoJCshJCUk/9sAQwEGBgYJCAkRCQkRJBgUGCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMAAAERAhEAPwD57hsunFXYrL2rSisvarsVl04r9AqYo4MHjfMzYrL2q5FZe1acVl7VdisvauCpij6vB43zMyKy9quw2XTitKKy9quxWXtXDUxR9Xg8b5mbFZe1XIrLpxWnDZdOKuxWXtXBUxR9Vg8b5nCw2XTirkVl7VpxWXtV2Gy6cV0VMUfyng8aZkNl04q7FZe1aUVl7VdisvauGpij6rB40zYrL2q5DZdOK04rL2q7FZe1cNTFH1eDxpmRWXtV2Gy6cVpxWXTirkVl7VwVMUfV4PGnCxWXTirsVl7VpxWXtVyGy6cV0VMUfylg8b5mbFZdOKuxWXtWlFZe1XYrL2rhqYo+qweN8zMisvarsVl7VpxWXtVyKy9q4KmKPq8HjfMzYrL2q7DZdOK0obLpxV2Ky9q4amKPq8HjfM//2Q==",
  "base64",
);

/**
 * Costruisce un RAW finto: un contenitore TIFF che dichiara un'anteprima JPEG
 * incorporata, esattamente come fa una fotocamera.
 *
 * Un RAW vero pesa 47 MB e non può stare in un repository. Questo pesa un chilobyte
 * e percorre lo stesso codice: intestazione, IFD, tag dell'anteprima, estrazione.
 */
function rawFinto(opzioni: { orientamento?: number; latoScatto?: number; jpeg?: Buffer } = {}): Buffer {
  const jpeg = opzioni.jpeg ?? JPEG_64x48;
  const lato = opzioni.latoScatto ?? 6000;
  const voci: [number, number, number][] = [
    [0x0100, 4, lato],                 // ImageWidth
    [0x0101, 4, Math.round(lato / 1.5)], // ImageLength
    [0x0112, 3, opzioni.orientamento ?? 1],
    [0x0201, 4, 128],                  // offset dell'anteprima
    [0x0202, 4, jpeg.length],          // sua lunghezza
  ];
  const b = Buffer.alloc(128 + jpeg.length);
  b.write("II", 0, "ascii");
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(voci.length, 8);
  voci.forEach(([tag, tipo, valore], i) => {
    const o = 10 + i * 12;
    b.writeUInt16LE(tag, o);
    b.writeUInt16LE(tipo, o + 2);
    b.writeUInt32LE(1, o + 4);
    if (tipo === 3) b.writeUInt16LE(valore, o + 8);
    else b.writeUInt32LE(valore, o + 8);
  });
  b.writeUInt32LE(0, 10 + voci.length * 12); // nessun IFD successivo
  jpeg.copy(b, 128);
  return b;
}

const dir = mkdtempSync(join(tmpdir(), "darkroom-core-"));
function scrivi(nome: string, dati: Buffer): string {
  const p = join(dir, nome);
  writeFileSync(p, dati);
  return p;
}

describe("scelta dell'originale fra formati", () => {
  test("il RAW vince sul JPEG, in qualunque ordine arrivino", () => {
    const a = scegliOriginali(["DSC001.JPG", "DSC001.ARW"]);
    const b = scegliOriginali(["DSC001.ARW", "DSC001.JPG"]);
    expect(a.get("DSC001")).toBe("DSC001.ARW");
    expect(b.get("DSC001")).toBe("DSC001.ARW");
  });

  test("una coppia RAW+JPEG è uno scatto, non due", () => {
    expect(scegliOriginali(["a.NEF", "a.jpg"]).size).toBe(1);
  });

  test("scatti diversi restano diversi", () => {
    expect(scegliOriginali(["a.ARW", "b.ARW", "c.jpg"]).size).toBe(3);
  });

  test("senza RAW resta quello che c'è", () => {
    expect(scegliOriginali(["solo.jpg"]).get("solo")).toBe("solo.jpg");
  });
});

// Senza il binario compilato queste prove non direbbero niente, e passare senza
// dire niente è peggio che non esserci.
const conMotore = motore.motoreDisponibile() ? describe : describe.skip;

conMotore("motore nativo", () => {
  test("dichiara i formati che sa aprire, RAW compresi", async () => {
    const f = await motore.formati();
    for (const e of ["nef", "cr2", "cr3", "arw", "dng", "raf", "orf", "rw2"]) {
      expect(f.raw).toContain(e);
    }
  });

  test("l'anteprima incorporata si legge, e la diagnosi la misura", async () => {
    const p = scrivi("buono.ARW", rawFinto());
    const d = await motore.diagnosi(p);
    expect(d.latoLungoIncorporata).toBe(64);
    expect(d.latoLungoScatto).toBe(6000);
    expect(d.anteprimeTrovate).toBeGreaterThan(0);
  });

  test("la diagnosi dice quali livelli l'anteprima incorporata riesce a servire", async () => {
    // 64 px non arriva nemmeno al proxy: il numero da leggere prima di ogni soglia.
    const piccolo = await motore.diagnosi(scrivi("piccolo.ARW", rawFinto()));
    expect(piccolo.livelliServiti).toEqual([]);
  });

  test("un'anteprima richiesta più grande di quella disponibile è dichiarata troncata", async () => {
    const p = scrivi("troncabile.ARW", rawFinto());
    const uscita = join(dir, "troncata.jpg");
    const e = await motore.anteprima(p, 2048, uscita);
    expect(e.troncata).toBe(true);
    expect(e.larghezza).toBe(64); // non ingrandisce: 64 px restano 64
    expect(existsSync(uscita)).toBe(true);
  });

  test("un'anteprima che ci sta tutta non è troncata", async () => {
    const p = scrivi("comodo.ARW", rawFinto());
    const e = await motore.anteprima(p, 32, join(dir, "comoda.jpg"));
    expect(e.troncata).toBe(false);
    expect(e.larghezza).toBe(32);
  });

  test("l'orientamento EXIF viene applicato: a 90 gradi i lati si scambiano", async () => {
    const dritto = await motore.anteprima(
      scrivi("dritto.ARW", rawFinto({ orientamento: 1 })),
      64,
      join(dir, "dritto.jpg"),
    );
    const ruotato = await motore.anteprima(
      scrivi("ruotato.ARW", rawFinto({ orientamento: 6 })),
      64,
      join(dir, "ruotato.jpg"),
    );
    expect([dritto.larghezza, dritto.altezza]).toEqual([64, 48]);
    expect([ruotato.larghezza, ruotato.altezza]).toEqual([48, 64]);
  });

  test("un file che non è una fotografia produce un errore col suo codice", async () => {
    const p = scrivi("finto.ARW", Buffer.from("questo non è un RAW"));
    await expect(motore.diagnosi(p)).rejects.toThrow(/non è un contenitore TIFF|non e' un contenitore TIFF/);
  });

  test("un offset che punta oltre la fine non legge fuori dai limiti", async () => {
    const b = rawFinto();
    b.writeUInt32LE(900_000, 10 + 3 * 12 + 8); // l'anteprima è "altrove"
    const p = scrivi("bugiardo.ARW", b);
    await expect(motore.diagnosi(p)).rejects.toThrow();
  });

  test("un file troncato non fa cadere il motore", async () => {
    const intero = rawFinto();
    for (const taglio of [10, 40, 100, 300]) {
      const p = scrivi(`troncato_${taglio}.ARW`, intero.subarray(0, taglio));
      await motore.diagnosi(p).catch(() => null);
    }
    // Il motore deve essere ancora lì a rispondere.
    const d = await motore.diagnosi(scrivi("dopo.ARW", rawFinto()));
    expect(d.latoLungoIncorporata).toBe(64);
  });

  test("un file illeggibile non restituisce mai l'immagine di quello di prima", async () => {
    // È il difetto peggiore del catalogo: a pipeline calda un decodificatore riusato
    // restituisce l'immagine precedente, e non ha l'aspetto di un guasto — si giudica
    // uno scatto guardandone un altro.
    const buono = scrivi("primo.ARW", rawFinto());
    const uscita = join(dir, "primo.jpg");
    await motore.anteprima(buono, 64, uscita);
    expect(existsSync(uscita)).toBe(true);

    const rotto = scrivi("secondo.ARW", Buffer.from("non sono un RAW"));
    const uscitaRotto = join(dir, "secondo.jpg");
    await expect(motore.anteprima(rotto, 64, uscitaRotto)).rejects.toThrow();
    expect(existsSync(uscitaRotto)).toBe(false);
  });

  test("la firma percettiva è stabile e ha i suoi tre numeri", async () => {
    const p = scrivi("firmato.ARW", rawFinto());
    const a = await motore.firma(p);
    const b = await motore.firma(p);
    expect(a.struttura).toBe(b.struttura);
    expect(a.colore.length).toBe(48);
    expect(a.nitidezza).toBeGreaterThanOrEqual(0);
  });
});

conMotore("anteprime del backend", () => {
  test("un RAW passa dal motore e produce un JPEG in cache", async () => {
    const p = scrivi("cache.ARW", rawFinto());
    const t = await thumbnailPath(p, 48);
    expect(existsSync(t)).toBe(true);
    const testa = Buffer.alloc(2);
    const fd = await Bun.file(t).arrayBuffer();
    new Uint8Array(fd).slice(0, 2).forEach((v, i) => (testa[i] = v));
    expect([testa[0], testa[1]]).toEqual([0xff, 0xd8]);
  });

  test("la seconda richiesta riusa la cache invece di rifare il lavoro", async () => {
    const p = scrivi("riuso.ARW", rawFinto());
    const primo = await thumbnailPath(p, 48);
    const quando = statSync(primo).mtimeMs;
    const secondo = await thumbnailPath(p, 48);
    expect(secondo).toBe(primo);
    expect(statSync(secondo).mtimeMs).toBe(quando);
  });

  test("un sorgente sostituito non eredita l'anteprima di quello di prima", async () => {
    const p = scrivi("sostituito.ARW", rawFinto());
    const primo = await thumbnailPath(p, 48);
    // Stesso nome, contenuto e data diversi.
    writeFileSync(p, rawFinto({ orientamento: 6 }));
    const dopo = new Date(Date.now() + 5000);
    utimesSync(p, dopo, dopo);
    const secondo = await thumbnailPath(p, 48);
    expect(secondo).not.toBe(primo);
  });

  test("un sorgente che non esiste è un errore, non un'anteprima vuota", async () => {
    await expect(thumbnailPath(join(dir, "mai-esistito.ARW"), 48)).rejects.toThrow(/source missing/);
  });
});
