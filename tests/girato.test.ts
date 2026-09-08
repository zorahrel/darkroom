import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import {
  cEQualcosaDaDire,
  FILE_SCELTE,
  durataTenuta,
  elenca,
  fotogramma,
  leggiClip,
  leggiScelte,
  percorsoScelte,
  perchePerSilenzio,
  riordina,
  scelteIniziali,
  scriviScelte,
  unisci,
  type Clip,
  type Scelta,
} from "../server/girato.ts";

const dir = mkdtempSync(join(tmpdir(), "darkroom-girato-"));

/** Una clip vera, generata da ffmpeg: due secondi di colore, con o senza audio. */
async function generaClip(nome: string, secondi: number, conAudio: boolean) {
  const p = join(dir, nome);
  const cmd = [
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=teal:s=320x180:d=${secondi}:r=25`,
    ...(conAudio ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${secondi}`] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ...(conAudio ? ["-c:a", "aac", "-shortest"] : []),
    p,
  ];
  const proc = spawn({ cmd, stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    throw new Error(`ffmpeg non ha prodotto ${nome}: ${await new Response(proc.stderr).text()}`);
  }
  return p;
}

beforeAll(async () => {
  await generaClip("A001.mov", 2, true);
  await generaClip("A002.mov", 3, false);
  await generaClip("A003.mp4", 1, true);
  // Un video di Live Photo: una fotografia con lo stesso nome accanto.
  await generaClip("IMG_5000.mov", 1, false);
  writeFileSync(join(dir, "IMG_5000.HEIC"), Buffer.alloc(64, 1));
  // Un file che finge di essere un video.
  writeFileSync(join(dir, "rotta.mov"), Buffer.from("non sono un contenitore"));
  // Un file che non c'entra niente.
  writeFileSync(join(dir, "note.txt"), "ciao");
});

afterAll(() => {
  try {
    require("node:fs").rmSync(dir, { recursive: true, force: true });
  } catch {
    /* niente */
  }
});

describe("lettura della cartella", () => {
  test("trova le clip e lascia fuori quello che non lo è", async () => {
    const clip = await elenca(dir);
    const nomi = clip.map((c) => c.nome).sort();
    expect(nomi).toEqual(["A001.mov", "A002.mov", "A003.mp4", "IMG_5000.mov", "rotta.mov"]);
    expect(nomi).not.toContain("note.txt");
  });

  test("legge durata, dimensioni e fotogrammi al secondo senza decodificare", async () => {
    const c = await leggiClip(join(dir, "A001.mov"));
    expect(c.durata).toBeGreaterThan(1.9);
    expect(c.durata).toBeLessThan(2.2);
    expect(c.larghezza).toBe(320);
    expect(c.altezza).toBe(180);
    expect(c.fotogrammiAlSecondo).toBe(25);
    expect(c.illeggibile).toBeNull();
  });

  test("sa dire quale clip ha l'audio e quale no", async () => {
    expect((await leggiClip(join(dir, "A001.mov"))).conAudio).toBe(true);
    expect((await leggiClip(join(dir, "A002.mov"))).conAudio).toBe(false);
  });

  test("un contenitore che non si apre è dichiarato, non nascosto", async () => {
    const c = await leggiClip(join(dir, "rotta.mov"));
    expect(c.illeggibile).not.toBeNull();
    expect(c.durata).toBeNull();
  });

  test("il video di una Live Photo è marcato: non è girato", async () => {
    const clip = await elenca(dir);
    const live = clip.find((c) => c.nome === "IMG_5000.mov");
    const vera = clip.find((c) => c.nome === "A001.mov");
    expect(live?.livePhoto).toBe(true);
    expect(vera?.livePhoto).toBe(false);
  });
});

describe("le scelte stanno accanto alle clip", () => {
  const nomi = ["A001.mov", "A002.mov", "A003.mp4"];
  const base = (): Scelta[] =>
    nomi.map((nome, posizione) => ({ nome, tenuta: true, attacco: null, stacco: null, posizione, nota: null }));

  test("senza niente da dire non nasce nessun file", () => {
    const esito = scriviScelte(dir, base());
    expect(esito.scritto).toBe(false);
    expect(existsSync(percorsoScelte(dir))).toBe(false);
  });

  test("una scelta vera fa nascere il file, accanto alle clip", () => {
    const s = base();
    s[1]!.tenuta = false;
    expect(scriviScelte(dir, s).scritto).toBe(true);
    expect(existsSync(join(dir, FILE_SCELTE))).toBe(true);
  });

  test("il file contiene le decisioni, non le riprese", () => {
    const testo = readFileSync(join(dir, FILE_SCELTE), "utf8");
    expect(testo).toContain("A002.mov");
    expect(testo).toContain("tenuta");
    // Un file di sole decisioni sta in pochi kilobyte, non in megabyte.
    expect(testo.length).toBeLessThan(4096);
  });

  test("si rileggono uguali", () => {
    const lette = leggiScelte(dir);
    expect(lette.versione).toBe(1);
    expect(lette.clip.find((c) => c.nome === "A002.mov")?.tenuta).toBe(false);
  });

  test("se le scelte tornano nessuna, il file sparisce invece di mentire", () => {
    expect(scriviScelte(dir, base()).scritto).toBe(false);
    expect(existsSync(percorsoScelte(dir))).toBe(false);
  });

  test("un file di scelte illeggibile non blocca la cartella", () => {
    writeFileSync(percorsoScelte(dir), "{ questo non è JSON");
    const lette = leggiScelte(dir);
    expect(lette.clip).toEqual([]);
    // E non lo si sovrascrive senza che nessuno abbia salvato.
    expect(existsSync(percorsoScelte(dir))).toBe(true);
    unlinkSync(percorsoScelte(dir));
  });

  test("le clip non vengono mai toccate", async () => {
    const prima = Bun.hash(await Bun.file(join(dir, "A001.mov")).arrayBuffer()).toString();
    const s = base();
    s[0]!.attacco = 0.5;
    s[0]!.stacco = 1.5;
    scriviScelte(dir, s);
    const dopo = Bun.hash(await Bun.file(join(dir, "A001.mov")).arrayBuffer()).toString();
    expect(dopo).toBe(prima);
    unlinkSync(percorsoScelte(dir));
  });
});

describe("la fila", () => {
  const s = (nome: string, posizione: number): Scelta => ({
    nome, tenuta: true, attacco: null, stacco: null, posizione, nota: null,
  });

  test("riordinare sposta di un posto, non di due", () => {
    // Il difetto pagato da chi ci è passato prima: mescolare l'indice nell'array
    // «con la clip» e quello nell'array «senza» faceva saltare l'elemento di un
    // posto su un trascinamento da zero pixel.
    const fila = [s("A", 0), s("B", 1), s("C", 2), s("D", 3)];
    expect(riordina(fila, 0, 1).map((x) => x.nome)).toEqual(["B", "A", "C", "D"]);
    expect(riordina(fila, 3, 0).map((x) => x.nome)).toEqual(["D", "A", "B", "C"]);
    expect(riordina(fila, 1, 2).map((x) => x.nome)).toEqual(["A", "C", "B", "D"]);
  });

  test("spostare una clip su sé stessa non la muove", () => {
    const fila = [s("A", 0), s("B", 1), s("C", 2)];
    expect(riordina(fila, 1, 1).map((x) => x.nome)).toEqual(["A", "B", "C"]);
  });

  test("una posizione impossibile non rompe la fila", () => {
    const fila = [s("A", 0), s("B", 1)];
    expect(riordina(fila, 9, 0).map((x) => x.nome)).toEqual(["A", "B"]);
    expect(riordina(fila, 0, -3).map((x) => x.nome)).toEqual(["A", "B"]);
  });

  test("le posizioni restano consecutive dopo ogni spostamento", () => {
    const fila = [s("A", 0), s("B", 1), s("C", 2), s("D", 3)];
    const dopo = riordina(fila, 2, 0);
    expect(dopo.map((x) => x.posizione)).toEqual([0, 1, 2, 3]);
  });
});

describe("clip aggiunte e tolte dopo", () => {
  const clip = (nome: string): Clip => ({
    nome, percorso: "/x/" + nome, byte: 1, durata: 2, larghezza: 1920, altezza: 1080,
    fotogrammiAlSecondo: 25, conAudio: true, illeggibile: null, livePhoto: false,
  });

  test("una clip nuova entra tenuta e in fondo, senza spostare l'ordine deciso", () => {
    const salvate: Scelta[] = [
      { nome: "B.mov", tenuta: true, attacco: null, stacco: null, posizione: 0, nota: null },
      { nome: "A.mov", tenuta: false, attacco: null, stacco: null, posizione: 1, nota: null },
    ];
    const fuori = unisci([clip("A.mov"), clip("B.mov"), clip("C.mov")], salvate);
    expect(fuori.map((s) => s.nome)).toEqual(["B.mov", "A.mov", "C.mov"]);
    expect(fuori.find((s) => s.nome === "A.mov")?.tenuta).toBe(false);
    expect(fuori.find((s) => s.nome === "C.mov")?.tenuta).toBe(true);
  });

  test("una scelta rimasta senza la sua clip sparisce", () => {
    const salvate: Scelta[] = [
      { nome: "A.mov", tenuta: false, attacco: null, stacco: null, posizione: 0, nota: null },
      { nome: "sparita.mov", tenuta: true, attacco: null, stacco: null, posizione: 1, nota: null },
    ];
    expect(unisci([clip("A.mov")], salvate).map((s) => s.nome)).toEqual(["A.mov"]);
  });
});

describe("quanto dura, e perché tace", () => {
  const clip: Clip[] = [
    { nome: "A", percorso: "/A", byte: 1, durata: 10, larghezza: 1, altezza: 1, fotogrammiAlSecondo: 25, conAudio: true, illeggibile: null, livePhoto: false },
    { nome: "B", percorso: "/B", byte: 1, durata: 6, larghezza: 1, altezza: 1, fotogrammiAlSecondo: 25, conAudio: false, illeggibile: null, livePhoto: false },
  ];
  const s = (nome: string, tenuta: boolean, attacco: number | null, stacco: number | null): Scelta =>
    ({ nome, tenuta, attacco, stacco, posizione: 0, nota: null });

  test("la durata è la somma dei tratti tenuti, non delle clip", () => {
    expect(durataTenuta(clip, [s("A", true, null, null), s("B", true, null, null)])).toBe(16);
    expect(durataTenuta(clip, [s("A", true, 2, 5), s("B", false, null, null)])).toBe(3);
  });

  test("un taglio oltre la fine non allunga niente", () => {
    expect(durataTenuta(clip, [s("A", true, 0, 999)])).toBe(10);
    expect(durataTenuta(clip, [s("A", true, -5, 4)])).toBe(4);
  });

  test("una fila muta dice perché", () => {
    // Silenzio spiegato invece di silenzio e basta: senza, si va a cercare un
    // guasto dove non ce n'è.
    expect(perchePerSilenzio(clip, [s("B", true, null, null)])).toMatch(/traccia audio/);
    expect(perchePerSilenzio(clip, [])).toMatch(/nessuna clip/);
    expect(perchePerSilenzio(clip, [s("A", true, null, null)])).toBeNull();
  });
});

describe("fotogrammi", () => {
  test("si estrae un fotogramma a un secondo scelto", async () => {
    const uscita = join(dir, "frame.jpg");
    expect(await fotogramma(join(dir, "A002.mov"), 1.5, 320, uscita)).toBe(true);
    expect(existsSync(uscita)).toBe(true);
    const testa = new Uint8Array(await Bun.file(uscita).arrayBuffer()).slice(0, 2);
    expect([testa[0], testa[1]]).toEqual([0xff, 0xd8]);
  });

  test("da una clip illeggibile non esce un fotogramma, ed è un no non un crash", async () => {
    expect(await fotogramma(join(dir, "rotta.mov"), 0, 320, join(dir, "no.jpg"))).toBe(false);
  });
});

describe("le scelte di partenza", () => {
  test("tutto tenuto, intero, nell'ordine dei nomi", async () => {
    const clip = await elenca(dir);
    const s = scelteIniziali(clip);
    expect(s.every((x) => x.tenuta && x.attacco === null && x.stacco === null)).toBe(true);
    expect(s.map((x) => x.posizione)).toEqual(clip.map((_, i) => i));
  });
});

describe("l'API del girato", () => {
  async function chiama(metodo: string, percorso: string, corpo?: unknown) {
    const { app } = await import("../server/app.ts");
    const res = await app.request(percorso, {
      method: metodo,
      headers: corpo ? { "content-type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null), res };
  }
  const q = (extra = "") => `/api/girato?cartella=${encodeURIComponent(dir)}${extra}`;

  test("una cartella che non esiste è un 400, non un elenco vuoto", async () => {
    // Un elenco vuoto direbbe «non c'è niente da fare»; un errore dice «non ho
    // guardato», e sono due cose diverse per chi ha appena scelto la cartella.
    expect((await chiama("GET", "/api/girato?cartella=/non/esiste/mai")).status).toBe(400);
    expect((await chiama("GET", "/api/girato")).status).toBe(400);
  });

  test("un percorso relativo non viene aperto", async () => {
    expect((await chiama("GET", "/api/girato?cartella=..%2F..%2Fetc")).status).toBe(400);
  });

  test("elenca le clip con le scelte già unite", async () => {
    const r = await chiama("GET", q());
    expect(r.status).toBe(200);
    expect(r.json.clip.length).toBeGreaterThan(0);
    expect(r.json.scelte.length).toBe(r.json.clip.length);
    expect(r.json.livePhoto).toBe(1);
    expect(r.json.illeggibili).toBe(1);
  });

  test("dice quanto dura il tenuto e perché eventualmente tace", async () => {
    const r = await chiama("GET", q());
    expect(typeof r.json.durataTenuta).toBe("number");
    // Qui c'è almeno una clip con audio, quindi nessuna spiegazione da dare.
    expect(r.json.perchePerSilenzio).toBeNull();
  });

  test("il riordino si salva subito, senza aspettare un salvataggio a parte", async () => {
    const prima = (await chiama("GET", q())).json.scelte.map((s: Scelta) => s.nome);
    const r = await chiama("POST", `/api/girato/riordina?cartella=${encodeURIComponent(dir)}`, { da: 0, a: 2 });
    expect(r.status).toBe(200);
    const dopo = r.json.scelte.map((s: Scelta) => s.nome);
    expect(dopo[2]).toBe(prima[0]);
    // Ed è già sul disco: una scelta persa perché la scrittura era rimandata è un
    // difetto documentato, e qui non si può ripetere.
    const rilette = leggiScelte(dir).clip.map((s) => s.nome);
    expect(rilette[2]).toBe(prima[0]);
    unlinkSync(percorsoScelte(dir));
  });

  test("un fotogramma esce come JPEG", async () => {
    const r = await chiama(
      "GET",
      `/api/girato/fotogramma?cartella=${encodeURIComponent(dir)}&clip=A002.mov&t=1&w=240`,
    );
    expect(r.res.status).toBe(200);
    expect(r.res.headers.get("content-type")).toContain("image/jpeg");
  });

  test("una clip fuori dalla cartella non si serve", async () => {
    const r = await chiama(
      "GET",
      `/api/girato/fotogramma?cartella=${encodeURIComponent(dir)}&clip=..%2F..%2Fetc%2Fpasswd`,
    );
    expect(r.status).toBe(400);
  });
});

describe("cosa conta come «qualcosa da dire»", () => {
  const s = (nome: string, posizione: number): Scelta => ({
    nome, tenuta: true, attacco: null, stacco: null, posizione, nota: null,
  });

  test("tutto tenuto e in ordine alfabetico non dice niente", () => {
    expect(cEQualcosaDaDire([s("A.mov", 0), s("B.mov", 1), s("C.mov", 2)])).toBe(false);
  });

  test("un riordino dice qualcosa, anche se le posizioni sono 0,1,2", () => {
    // `riordina` rinumera da zero, quindi confrontare `posizione` con l'indice
    // dell'array non vedeva mai uno spostamento: il file non nasceva e la fila al
    // riapri tornava com'era.
    expect(cEQualcosaDaDire([s("C.mov", 0), s("A.mov", 1), s("B.mov", 2)])).toBe(true);
  });

  test("uno scarto, un taglio o una nota dicono qualcosa", () => {
    const base = [s("A.mov", 0), s("B.mov", 1)];
    expect(cEQualcosaDaDire([{ ...base[0]!, tenuta: false }, base[1]!])).toBe(true);
    expect(cEQualcosaDaDire([{ ...base[0]!, attacco: 1 }, base[1]!])).toBe(true);
    expect(cEQualcosaDaDire([{ ...base[0]!, stacco: 4 }, base[1]!])).toBe(true);
    expect(cEQualcosaDaDire([{ ...base[0]!, nota: "sfocata" }, base[1]!])).toBe(true);
  });
});
