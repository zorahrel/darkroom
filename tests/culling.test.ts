import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { dirs } from "../server/project.ts";
import * as motore from "../server/core.ts";
import {
  SOGLIE,
  correggiGruppo,
  giudica,
  raggruppa,
  rendiconto,
  validaGiudizio,
  GiudizioNonValido,
} from "../server/culling.ts";

afterAll(() => motore.fermaMotore());

const JPEG_64x48 = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAAwAEADACIAAREBAhEB/9sAQwAGBAQFBAQGBQUFBgYGBwkOCQkICAkSDQ0KDhUSFhYVEhQUFxohHBcYHxkUFB0nHR8iIyUlJRYcKSwoJCshJCUk/9sAQwEGBgYJCAkRCQkRJBgUGCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMAAAERAhEAPwD57hsunFXYrL2rSisvarsVl04r9AqYo4MHjfMzYrL2q5FZe1acVl7VdisvauCpij6vB43zMyKy9quw2XTitKKy9quxWXtXDUxR9Xg8b5mbFZe1XIrLpxWnDZdOKuxWXtXBUxR9Vg8b5nCw2XTirkVl7VpxWXtV2Gy6cV0VMUfyng8aZkNl04q7FZe1aUVl7VdisvauGpij6rB40zYrL2q5DZdOK04rL2q7FZe1cNTFH1eDxpmRWXtV2Gy6cVpxWXTirkVl7VwVMUfV4PGnCxWXTirsVl7VpxWXtVyGy6cV0VMUfylg8b5mbFZdOKuxWXtWlFZe1XYrL2rhqYo+qweN8zMisvarsVl7VpxWXtVyKy9q4KmKPq8HjfMzYrL2q7DZdOK0obLpxV2Ky9q4amKPq8HjfM//2Q==",
  "base64",
);

/** Un RAW finto: contenitore TIFF con dentro un'anteprima JPEG vera. */
function rawFinto(orientamento = 1): Buffer {
  const voci: [number, number, number][] = [
    [0x0100, 4, 6000],
    [0x0101, 4, 4000],
    [0x0112, 3, orientamento],
    [0x0201, 4, 128],
    [0x0202, 4, JPEG_64x48.length],
  ];
  const b = Buffer.alloc(128 + JPEG_64x48.length);
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
  b.writeUInt32LE(0, 10 + voci.length * 12);
  JPEG_64x48.copy(b, 128);
  return b;
}

const percorsi = new Map<string, string>();

function aggiungiFoto(id: string, quando: number) {
  const p = join(dirs().RAW_DIR, `${id}.ARW`);
  writeFileSync(p, rawFinto());
  percorsi.set(id, p);
  db().run(
    `INSERT OR REPLACE INTO photos (id, original_path, original_ext, kind, taken_at, created_at, updated_at)
     VALUES (?, ?, '.arw', 'original', ?, ?, ?)`,
    [id, p, quando, quando, quando],
  );
}

beforeAll(() => {
  mkdirSync(dirs().RAW_DIR, { recursive: true });
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  // Tre scatti a due secondi l'uno dall'altro (una raffica) e uno a un'ora di distanza.
  aggiungiFoto("cull_a", base);
  aggiungiFoto("cull_b", base + 2000);
  aggiungiFoto("cull_c", base + 4000);
  aggiungiFoto("cull_lontano", base + 3_600_000);
});

async function chiama(metodo: string, percorso: string, corpo?: unknown) {
  const res = await app.request(percorso, {
    method: metodo,
    headers: corpo ? { "content-type": "application/json" } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("giudizio", () => {
  test("le stelle vanno da zero a cinque, e basta", () => {
    expect(() => validaGiudizio({ stelle: 6 })).toThrow(GiudizioNonValido);
    expect(() => validaGiudizio({ stelle: -1 })).toThrow(GiudizioNonValido);
    expect(() => validaGiudizio({ stelle: 2.5 })).toThrow(GiudizioNonValido);
    expect(validaGiudizio({ stelle: 0 }).stelle).toBe(0);
    expect(validaGiudizio({ stelle: 5 }).stelle).toBe(5);
  });

  test("nessuna stella non è zero stelle", () => {
    // È la distinzione fra «non ancora guardata» e «guardata e scartata»: chi
    // riprende il lavoro domani deve sapere dove si era fermato.
    expect(validaGiudizio({}).stelle).toBeNull();
    expect(validaGiudizio({ stelle: 0 }).stelle).toBe(0);
  });

  test("un colore inventato viene rifiutato", () => {
    expect(() => validaGiudizio({ colore: "fucsia" as never })).toThrow(GiudizioNonValido);
  });

  test("il giudizio si salva e si rilegge", () => {
    giudica("cull_a", { stelle: 4, colore: "verde" });
    const r = db()
      .query<{ s: number | null; c: string | null }, [string]>(
        "SELECT culling_stelle AS s, culling_colore AS c FROM photos WHERE id = ?",
      )
      .get("cull_a");
    expect(r?.s).toBe(4);
    expect(r?.c).toBe("verde");
  });

  test("giudicare una foto che non esiste è un errore", () => {
    expect(() => giudica("mai_vista", { stelle: 1 })).toThrow(GiudizioNonValido);
  });

  test("l'API rifiuta un giudizio fuori scala con 400", async () => {
    const r = await chiama("PUT", "/api/culling/cull_b/giudizio", { stelle: 9 });
    expect(r.status).toBe(400);
  });

  test("l'API accetta un giudizio valido", async () => {
    const r = await chiama("PUT", "/api/culling/cull_b/giudizio", { stelle: 0 });
    expect(r.status).toBe(200);
    expect(r.json.giudizio.stelle).toBe(0);
  });
});

describe("rendiconto", () => {
  test("tenuti, scartati e non giudicati fanno il totale", () => {
    const r = rendiconto();
    expect(r.tenuti + r.scartati + r.nonGiudicati).toBe(r.totale);
  });

  test("una foto a zero stelle è scartata, non non-giudicata", () => {
    giudica("cull_c", { stelle: 0, colore: null });
    const r = rendiconto();
    expect(r.perStelle["0"]).toBeGreaterThanOrEqual(1);
    expect(r.scartati).toBeGreaterThanOrEqual(1);
  });

  test("l'API risponde col rendiconto", async () => {
    const r = await chiama("GET", "/api/culling/rendiconto");
    expect(r.status).toBe(200);
    expect(r.json.tenuti + r.json.scartati + r.json.nonGiudicati).toBe(r.json.totale);
  });
});

const conMotore = motore.motoreDisponibile() ? describe : describe.skip;

conMotore("raffiche", () => {
  test("le firme si calcolano una volta e restano", async () => {
    const primo = await chiama("POST", "/api/culling/firme");
    expect(primo.status).toBe(200);
    expect(primo.json.calcolate).toBeGreaterThan(0);
    // La seconda volta non c'è più niente da calcolare.
    const secondo = await chiama("POST", "/api/culling/firme");
    expect(secondo.json.calcolate).toBe(0);
  });

  test("scatti identici e ravvicinati finiscono nello stesso gruppo", () => {
    const r = raggruppa();
    expect(r.gruppi).toBeGreaterThanOrEqual(1);
    const raffica = db()
      .query<{ id: string; g: string | null }, []>(
        `SELECT id, culling_gruppo AS g FROM photos
         WHERE id IN ('cull_a','cull_b','cull_c')`,
      )
      .all();
    expect(raffica.length).toBe(3);
    const gruppo = raffica[0]!.g;
    expect(gruppo).not.toBeNull();
    expect(raffica.every((x) => x.g === gruppo)).toBe(true);

    // E il gruppo contiene esattamente quei tre. Il raggruppamento lavora su tutta
    // la libreria, quindi una foto di un altro file di prova che finisse in mezzo
    // spezzerebbe la catena: se succede questa riga lo dice, invece di far
    // lampeggiare il verde.
    const membri = db()
      .query<{ id: string }, [string]>(
        "SELECT id FROM photos WHERE culling_gruppo = ? ORDER BY id",
      )
      .all(gruppo!)
      .map((x) => x.id);
    expect(membri).toEqual(["cull_a", "cull_b", "cull_c"]);
  });

  test("uno scatto lontano nel tempo non entra nella raffica, per quanto somigli", () => {
    // Le immagini sono identiche: a separarle è solo l'ora. Senza il tempo, un
    // archivio di scatti simili diventerebbe un gruppo solo.
    const lontano = db()
      .query<{ g: string | null }, [string]>(
        "SELECT culling_gruppo AS g FROM photos WHERE id = ?",
      )
      .get("cull_lontano");
    const primo = db()
      .query<{ g: string | null }, [string]>(
        "SELECT culling_gruppo AS g FROM photos WHERE id = ?",
      )
      .get("cull_a");
    expect(lontano?.g).not.toBe(primo?.g);
  });

  test("la primaria è una sola per gruppo", () => {
    const primarie = db()
      .query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM photos
         WHERE culling_primaria = 1 AND culling_gruppo IS NOT NULL`,
      )
      .get();
    const gruppi = db()
      .query<{ n: number }, []>(
        "SELECT COUNT(DISTINCT culling_gruppo) AS n FROM photos WHERE culling_gruppo IS NOT NULL",
      )
      .get();
    expect(primarie?.n).toBe(gruppi?.n);
  });

  test("una correzione a mano sopravvive a un nuovo giro dell'algoritmo", () => {
    correggiGruppo("cull_b", null);
    raggruppa();
    const dopo = db()
      .query<{ g: string | null; m: number }, [string]>(
        "SELECT culling_gruppo AS g, culling_gruppo_manuale AS m FROM photos WHERE id = ?",
      )
      .get("cull_b");
    expect(dopo?.m).toBe(1);
    expect(dopo?.g).toBeNull();
  });

  test("le soglie sono dichiarate in un posto solo e restano coerenti fra loro", () => {
    // Se un giorno vanno ritarate, si ritarano qui: sparse nel codice non si trovano.
    expect(SOGLIE.strutturaPasso).toBeGreaterThan(0);
    // La deriva dal primo scatto deve essere più larga del passo fra consecutivi:
    // al contrario il secondo confronto non lascerebbe passare niente e il gruppo
    // non potrebbe mai superare i due membri.
    expect(SOGLIE.strutturaDeriva).toBeGreaterThan(SOGLIE.strutturaPasso);
    expect(SOGLIE.coloreDeriva).toBeGreaterThan(SOGLIE.colorePasso);
    // Un'impronta è di 64 bit: una soglia oltre i 32 accetterebbe il caso puro.
    expect(SOGLIE.strutturaPasso).toBeLessThan(32);
    expect(SOGLIE.strutturaDeriva).toBeLessThan(32);
  });
});

conMotore("sidecar", () => {
  test("il piano dice quanti file e dove, prima di scrivere niente", async () => {
    const r = await chiama("POST", "/api/culling/sidecar/piano", { photo_ids: ["cull_a"] });
    expect(r.status).toBe(200);
    expect(r.json.righe.length).toBe(1);
    expect(r.json.righe[0].sidecar).toMatch(/cull_a\.xmp$/);
    expect(r.json.cartelle.length).toBe(1);
    // Il piano non ha scritto niente.
    expect(existsSync(r.json.righe[0].sidecar)).toBe(false);
  });

  test("la scrittura crea il sidecar accanto al RAW, col suo nome", async () => {
    const r = await chiama("POST", "/api/culling/sidecar/scrivi", { photo_ids: ["cull_a"] });
    expect(r.status).toBe(200);
    expect(r.json.scritti).toBe(1);
    const sidecar = percorsi.get("cull_a")!.replace(/\.ARW$/, ".xmp");
    expect(existsSync(sidecar)).toBe(true);
    expect(readdirSync(dirs().RAW_DIR)).toContain("cull_a.xmp");
  });

  test("l'etichetta è scritta nel vocabolario italiano, quello che Camera Raw legge", async () => {
    const sidecar = percorsi.get("cull_a")!.replace(/\.ARW$/, ".xmp");
    const testo = await Bun.file(sidecar).text();
    // "verde" nel set italiano di Camera Raw si chiama "Approvato".
    expect(testo).toContain("Approvato");
    expect(testo).not.toContain('xmp:Label="verde"');
  });

  test("rileggendo il sidecar si ritrova il giudizio", async () => {
    const r = await chiama("GET", "/api/culling/cull_a/sidecar");
    expect(r.status).toBe(200);
    expect(r.json.stelle).toBe(4);
    expect(r.json.colore).toBe("verde");
  });

  test("riscrivere lo stesso giudizio non tocca il file", async () => {
    const r = await chiama("POST", "/api/culling/sidecar/scrivi", { photo_ids: ["cull_a"] });
    expect(r.json.scritti).toBe(0);
    expect(r.json.invariati).toBe(1);
  });

  test("il file originale non viene mai toccato", async () => {
    const raw = percorsi.get("cull_a")!;
    const impronta = Bun.hash(await Bun.file(raw).arrayBuffer()).toString();
    await chiama("POST", "/api/culling/sidecar/scrivi", { photo_ids: ["cull_a"] });
    const dopo = Bun.hash(await Bun.file(raw).arrayBuffer()).toString();
    expect(dopo).toBe(impronta);
  });

  test("un secondo giudizio lascia una copia di sicurezza del primo", async () => {
    giudica("cull_a", { stelle: 1, colore: "rosso" });
    await chiama("POST", "/api/culling/sidecar/scrivi", { photo_ids: ["cull_a"] });
    const backup = join(dirs().RAW_DIR, "Darkroom_XMP_Backup");
    expect(existsSync(backup)).toBe(true);
    expect(readdirSync(backup).length).toBeGreaterThan(0);
  });
});

conMotore("diagnosi", () => {
  test("dice quanto è grande l'anteprima che la fotocamera ha lasciato dentro", async () => {
    const r = await chiama("GET", "/api/culling/cull_a/diagnosi");
    expect(r.status).toBe(200);
    expect(r.json.latoLungoIncorporata).toBe(64);
    expect(r.json.livelliServiti).toEqual([]);
  });

  test("una foto che non esiste è 404, non un errore del motore", async () => {
    const r = await chiama("GET", "/api/culling/mai_vista/diagnosi");
    expect(r.status).toBe(404);
  });
});
