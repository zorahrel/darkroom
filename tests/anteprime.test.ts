import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import {
  BUDGET_TOTALE,
  LIVELLI,
  QUOTE,
  cartellaLivello,
  livelloPer,
  percorsoCache,
  sfratta,
  statoCache,
} from "../server/anteprime.ts";
import { thumbnailPath } from "../server/thumb.ts";
import * as motore from "../server/core.ts";
import { dirs } from "../server/project.ts";

afterAll(() => motore.fermaMotore());

describe("livelli", () => {
  test("sono quattro, con lati crescenti", () => {
    expect(LIVELLI.length).toBe(4);
    for (let i = 1; i < LIVELLI.length; i++) {
      expect(LIVELLI[i]!.lato).toBeGreaterThan(LIVELLI[i - 1]!.lato);
    }
  });

  test("una larghezza si arrotonda al livello che la copre, mai sotto", () => {
    // Sotto: si mostrerebbero pixel interpolati spacciandoli per letti.
    expect(livelloPer(100).nome).toBe("proxy");
    expect(livelloPer(256).nome).toBe("proxy");
    expect(livelloPer(257).nome).toBe("griglia");
    expect(livelloPer(480).nome).toBe("griglia");
    expect(livelloPer(512).nome).toBe("griglia");
    expect(livelloPer(720).nome).toBe("visore");
    expect(livelloPer(2048).nome).toBe("visore");
    expect(livelloPer(3200).nome).toBe("nativo");
  });

  test("una richiesta assurda non esce dai livelli", () => {
    expect(livelloPer(99_999).nome).toBe("nativo");
    expect(livelloPer(0).nome).toBe("proxy");
  });

  test("le quote dei quattro livelli fanno uno", () => {
    const somma = LIVELLI.reduce((a, l) => a + QUOTE[l.nome], 0);
    expect(somma).toBeCloseTo(1, 6);
  });

  test("quindici larghezze diverse collassano in quattro cartelle", () => {
    // È il difetto che i livelli chiudono: prima ogni chiamante sceglieva la sua
    // larghezza e la cache si moltiplicava — quindici cartelle, 199 MB, zero sfratti.
    const chieste = [120, 160, 300, 400, 480, 500, 512, 720, 900, 1000, 1600, 2048, 3200];
    const cartelle = new Set(chieste.map((w) => livelloPer(w).nome));
    expect(cartelle.size).toBeLessThanOrEqual(4);
  });
});

describe("budget e sfratto", () => {
  const livello = "proxy" as const;

  function riempi(quanti: number, byte: number, etaMs: number[] = []) {
    const dir = cartellaLivello(livello);
    mkdirSync(dir, { recursive: true });
    const creati: string[] = [];
    for (let i = 0; i < quanti; i++) {
      const p = join(dir, `finto_${i}.jpg`);
      writeFileSync(p, Buffer.alloc(byte, 7));
      const eta = etaMs[i];
      if (eta !== undefined) {
        const quando = new Date(Date.now() - eta);
        utimesSync(p, quando, quando);
      }
      creati.push(p);
    }
    return creati;
  }

  test("sotto il budget non si toglie niente", () => {
    riempi(3, 1024);
    const prima = statoCache().find((s) => s.livello === livello)!;
    expect(prima.byte).toBeLessThan(prima.budget);
    expect(sfratta(livello).tolti).toBe(0);
  });

  test("il budget di ogni livello è una quota del totale, in byte", () => {
    const s = statoCache();
    for (const l of s) {
      expect(l.budget).toBe(Math.floor(BUDGET_TOTALE * QUOTE[l.livello]));
    }
    // La somma dei budget non supera il totale: altrimenti il tetto non è un tetto.
    expect(s.reduce((a, l) => a + l.budget, 0)).toBeLessThanOrEqual(BUDGET_TOTALE);
  });

  function svuota() {
    const dir = cartellaLivello(livello);
    mkdirSync(dir, { recursive: true });
    for (const n of readdirSync(dir)) {
      try {
        unlinkSync(join(dir, n));
      } catch {
        /* niente */
      }
    }
  }

  test("sopra il budget si toglie fino a rientrare", () => {
    svuota();
    // Cinque file da 10 KB nel livello proxy, che ha il 20% del budget: con un
    // budget totale di 100 KB il livello ne ha 20, quindi tre devono uscire.
    riempi(5, 10_000, [5000, 4000, 3000, 2000, 1000]);
    const esito = sfratta(livello, 100_000);
    expect(esito.tolti).toBe(3);
    const dopo = statoCache().find((s) => s.livello === livello)!;
    expect(dopo.byte).toBeLessThanOrEqual(20_000);
  });

  test("esce il meno usato di recente, non il primo creato", () => {
    svuota();
    // Tutti creati adesso, ma visti in momenti diversi: il file 0 è il più vecchio
    // per accesso. È la differenza fra guardare `atime` e guardare `mtime`.
    const creati = riempi(3, 10_000, [3_600_000, 60_000, 0]);
    sfratta(livello, 100_000); // 20 KB al proxy: due sopravvivono
    expect(existsSync(creati[0]!)).toBe(false);
    expect(existsSync(creati[2]!)).toBe(true);
  });

  test("un budget capiente non tocca niente", () => {
    svuota();
    const creati = riempi(3, 10_000);
    expect(sfratta(livello, 10 * 1024 * 1024).tolti).toBe(0);
    for (const c of creati) expect(existsSync(c)).toBe(true);
  });
});

const conMotore = motore.motoreDisponibile() ? describe : describe.skip;

conMotore("anteprime dal motore", () => {
  const JPEG = Buffer.from(
    "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAAwAEADACIAAREBAhEB/9sAQwAGBAQFBAQGBQUFBgYGBwkOCQkICAkSDQ0KDhUSFhYVEhQUFxohHBcYHxkUFB0nHR8iIyUlJRYcKSwoJCshJCUk/9sAQwEGBgYJCAkRCQkRJBgUGCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMAAAERAhEAPwD57hsunFXYrL2rSisvarsVl04r9AqYo4MHjfMzYrL2q5FZe1acVl7VdisvauCpij6vB43zMyKy9quw2XTitKKy9quxWXtXDUxR9Xg8b5mbFZe1XIrLpxWnDZdOKuxWXtXBUxR9Vg8b5nCw2XTirkVl7VpxWXtV2Gy6cV0VMUfyng8aZkNl04q7FZe1aUVl7VdisvauGpij6rB40zYrL2q5DZdOK04rL2q7FZe1cNTFH1eDxpmRWXtV2Gy6cVpxWXTirkVl7VwVMUfV4PGnCxWXTirsVl7VpxWXtVyGy6cV0VMUfylg8b5mbFZdOKuxWXtWlFZe1XYrL2rhqYo+qweN8zMisvarsVl7VpxWXtVyKy9q4KmKPq8HjfMzYrL2q7DZdOK0obLpxV2Ky9q4amKPq8HjfM//2Q==",
    "base64",
  );

  test("due larghezze dello stesso livello riusano lo stesso file", async () => {
    const dir = dirs().RAW_DIR;
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "livelli.jpg");
    writeFileSync(p, JPEG);
    // 300 e 480 cadono entrambe in "griglia": prima erano due cartelle e due file.
    const a = await thumbnailPath(p, 300);
    const b = await thumbnailPath(p, 480);
    expect(a).toBe(b);
    expect(a).toBe(percorsoCache(p, "griglia"));
  });

  test("larghezze di livelli diversi restano file diversi", async () => {
    const p = join(dirs().RAW_DIR, "livelli.jpg");
    const griglia = await thumbnailPath(p, 480);
    const proxy = await thumbnailPath(p, 200);
    expect(proxy).not.toBe(griglia);
    expect(existsSync(proxy)).toBe(true);
  });
});
