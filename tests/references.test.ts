import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { refsDir } from "../server/project.ts";

/**
 * La sezione Riferimenti mostrava zero immagini: chiedeva di incollare un
 * percorso per un file che stava già dentro il progetto.
 *
 * Il costo non è l'attrito, è quello che l'attrito nasconde. Su `profilo` una
 * reference è rimasta inutilizzata su 12 generazioni su 12 mentre il refset
 * continuava a promettere "+ stile", e non c'era nessun posto dove quel numero
 * si potesse leggere: dodici immagini pagate hanno preso la direzione
 * sbagliata prima che qualcuno se ne accorgesse guardandole.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function put(name: string): void {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), name), PNG);
}

function variant(n: number, refs: string[]): void {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES ('p',?,?,'x',NULL,?,'openai','generated',?)`,
    [n, `/gen/v${n}.png`, JSON.stringify({ recipe: "r", refset: "rs", sources: ["p.png"], refs }), Date.now()],
  );
}

async function list(): Promise<{ file: string; usata_in: number }[]> {
  const r = (await (await app.request("/api/references")).json()) as {
    references: { file: string; usata_in: number }[];
  };
  return r.references;
}

beforeEach(() => {
  // La cartella dei riferimenti e' condivisa fra i test: senza svuotarla, i
  // file di un test precedente entrano nell'elenco del successivo e
  // l'ordinamento si giudica su dati che nessuno ha messo li' apposta.
  rmSync(refsDir(), { recursive: true, force: true });
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
  db().run("INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES ('p','/p.png','.png',1,1)");
});

describe("i riferimenti del progetto si vedono", () => {
  test("l'elenco mostra i file che stanno nella cartella", async () => {
    put("stile.png");
    const refs = await list();
    expect(refs.some((r) => r.file === "stile.png")).toBe(true);
  });

  test("i file che non sono immagini restano fuori", async () => {
    put("stile.png");
    mkdirSync(refsDir(), { recursive: true });
    writeFileSync(join(refsDir(), "appunti.txt"), "non sono un'immagine");
    const refs = await list();
    expect(refs.some((r) => r.file === "appunti.txt")).toBe(false);
  });
});

describe("una reference mai usata si vede che è mai usata", () => {
  test("zero varianti quando nessuna generazione l'ha allegata", async () => {
    put("mai-usata.png");
    variant(1, []);
    variant(2, []);
    const r = (await list()).find((x) => x.file === "mai-usata.png");
    expect(r!.usata_in).toBe(0);
  });

  test("il conteggio segue le varianti che l'hanno davvero allegata", async () => {
    put("usata.png");
    variant(1, ["usata.png"]);
    variant(2, ["usata.png"]);
    variant(3, []);
    const r = (await list()).find((x) => x.file === "usata.png");
    expect(r!.usata_in).toBe(2);
  });

  test("il caso di profilo: promessa nel refset, assente nei file", async () => {
    // Dodici varianti che dichiarano uno stile e non allegano niente. Prima di
    // questa vista il numero non esisteva da nessuna parte.
    put("stile-promesso.png");
    for (let n = 1; n <= 12; n++) variant(n, []);
    const r = (await list()).find((x) => x.file === "stile-promesso.png");
    expect(r!.usata_in).toBe(0);
  });

  test("le mai usate stanno in cima: sono quelle su cui decidere", async () => {
    // I nomi sono scelti perche' l'ordine alfabetico dia il risultato
    // OPPOSTO: se l'ordinamento per uso sparisse, 'a-mai-usata' verrebbe
    // comunque prima e il test passerebbe senza controllare niente.
    put("a-usata-tanto.png");
    put("z-mai-usata.png");
    variant(1, ["a-usata-tanto.png"]);
    const refs = await list();
    expect(refs.map((r) => r.file)).toEqual(["z-mai-usata.png", "a-usata-tanto.png"]);
  });

  test("un lineage illeggibile non fa sparire l'elenco", async () => {
    put("stile.png");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('p',9,'/gen/v9.png','x',NULL,'{rotto',  'openai','generated',?)`,
      [Date.now()],
    );
    const refs = await list();
    expect(refs.some((r) => r.file === "stile.png")).toBe(true);
  });
});

describe("dalla galleria si estrae senza ricostruire il percorso", () => {
  test("un nome nudo si risolve dentro i riferimenti del progetto", async () => {
    put("stile.png");
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "stile.png" }),
    });
    // Il file esiste: qualunque sia l'esito dell'estrazione, NON deve essere
    // "immagine non trovata".
    const body = (await r.json()) as { error?: string };
    expect(body.error ?? "").not.toBe("immagine non trovata");
    // Timeout generoso: questa rotta interroga il modello di visione, che gira
    // fuori dal processo. Con i 5s di default la suite falliva a intermittenza
    // -- un test rosso che non dice niente sul codice insegna a ignorare il
    // rosso, che e' peggio del test mancante.
  }, 60_000);

  test("un nome che non esiste resta un errore", async () => {
    const r = await app.request("/api/reference/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "non-esiste-affatto.png" }),
    });
    expect(r.status).toBe(400);
  });
});

describe("una reference si carica da dentro Darkroom", () => {
  // Prima un file entrava in data/refs solo copiandocelo dal Finder: la
  // galleria mostrava i riferimenti ma non c'era modo di aggiungerne uno.
  async function load(name: string, bytes: Buffer, contentType = "image/png") {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(bytes)], name, { type: contentType }));
    return app.request("/api/references", { method: "POST", body: fd });
  }

  test("un png caricato compare nell'elenco", async () => {
    const r = await load("nuovo.png", PNG);
    expect(r.status).toBe(200);
    expect((await list()).some((x) => x.file === "nuovo.png")).toBe(true);
  });

  test("un formato non ammesso viene rifiutato", async () => {
    const r = await load("appunti.txt", Buffer.from("ciao"), "text/plain");
    expect(r.status).toBe(400);
    // E non deve restare niente sul disco.
    expect((await list()).some((x) => x.file === "appunti.txt")).toBe(false);
  });

  test("un file vuoto viene rifiutato", async () => {
    const r = await load("vuoto.png", Buffer.alloc(0));
    expect(r.status).toBe(400);
  });

  test("un nome con separatori non esce dalla cartella", async () => {
    const r = await load("../../fuga.png", PNG);
    expect(r.status).toBe(200);
    const refs = await list();
    // Il file c'e', ma col nome bonificato: nessuna risalita di directory.
    expect(refs.some((x) => x.file.includes("/") || x.file.includes(".."))).toBe(false);
    expect(refs.some((x) => x.file.endsWith("fuga.png"))).toBe(true);
  });

  test("un nome piu' lungo del filesystem viene accorciato, non fa esplodere", async () => {
    // 300 caratteri: oltre i 255 byte che i filesystem accettano. Prima la
    // scrittura falliva con ENAMETOOLONG e la rotta moriva invece di
    // rispondere.
    const r = await load("a".repeat(300) + ".png", PNG);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { file: string };
    expect(body.file.length).toBeLessThanOrEqual(200);
    expect(body.file.endsWith(".png")).toBe(true);
  });

  test("un doppio suffisso non aggira il controllo sul formato", async () => {
    // "x.png.exe" ha .png nel nome ma l'estensione vera e' .exe.
    const r = await load("x.png.exe", PNG, "image/png");
    expect(r.status).toBe(400);
  });

  test("un nome già preso non sovrascrive la reference esistente", async () => {
    // Sovrascrivere cambierebbe il significato del lineage delle varianti già
    // generate con quel file, senza dirlo a nessuno.
    await load("stile.png", PNG);
    variant(1, ["stile.png"]);
    const r = await load("stile.png", PNG);
    const body = (await r.json()) as { file: string; rinominato: boolean };
    expect(body.rinominato).toBe(true);
    expect(body.file).toBe("stile-2.png");
    // L'originale conserva il suo conteggio.
    const orig = (await list()).find((x) => x.file === "stile.png");
    expect(orig!.usata_in).toBe(1);
  });
});

describe("quanto una variante si discosta dalla reference", () => {
  // La misura esisteva come script ma restava fuori dalla pagina dove si
  // guardano le varianti: la domanda "mi sto avvicinando?" si poteva porre solo
  // da terminale, e le calibrazioni sono andate avanti tre giri su un'ipotesi
  // sbagliata proprio per quello.
  function version(n: number, refs: string[], imagePath: string): number {
    const r = db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('p',?,?,'x',NULL,?,'openai','generated',?)`,
      [n, imagePath, JSON.stringify({ recipe: "r", refset: "rs", sources: ["p.png"], refs }), Date.now()],
    );
    return Number(r.lastInsertRowid);
  }

  test("una variante senza reference lo dichiara invece di inventare un numero", async () => {
    const id = version(1, [], join(refsDir(), "qualsiasi.png"));
    put("qualsiasi.png");
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      reference: string | null;
      gap: unknown;
    };
    // È il caso che è costato 12 generazioni su profilo: nessun bersaglio.
    expect(r.reference).toBeNull();
    expect(r.gap).toBeNull();
  });

  test("una reference sparita non fa passare la misura per riuscita", async () => {
    const id = version(2, ["mai-esistita.png"], join(refsDir(), "x.png"));
    put("x.png");
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      reference: string;
      gap: unknown;
      error?: string;
    };
    expect(r.reference).toBe("mai-esistita.png");
    expect(r.gap).toBeNull();
    // Il messaggio deve dire CHE COSA manca: senza il controllo esplicito
    // l'errore arriva comunque, ma come sputo di uno stack python che non
    // spiega niente a chi legge la pagina.
    expect(r.error).toBe("reference mancante");
  });

  test("una versione inesistente è un 404, non un errore di misura", async () => {
    const r = await app.request("/api/versions/999999/gap");
    expect(r.status).toBe(404);
  });

  test("un id non numerico viene rifiutato", async () => {
    const r = await app.request("/api/versions/pippo/gap");
    expect(r.status).toBe(400);
  });

  test("misurare un'immagine contro se stessa dà distanza zero", async () => {
    // Il controllo che la misura sia una misura: se una cosa non dista da sé
    // stessa, la scala ha un punto fisso e i numeri sopra vogliono dire qualcosa.
    put("uguale.png");
    const p = join(refsDir(), "uguale.png");
    const id = version(3, ["uguale.png"], p);
    const r = (await (await app.request(`/api/versions/${id}/gap`)).json()) as {
      gap: { distance: number } | null;
    };
    expect(r.gap).not.toBeNull();
    expect(r.gap!.distance).toBe(0);
  }, 30_000);
});

describe("la distanza si comporta come una distanza", () => {
  // Un numero che sale ordina; un numero che a volte scende quando le cose
  // peggiorano non ordina niente, e sarebbe peggio di nessun numero perche'
  // sembra un giudizio.
  const py = (a: string, b: string) => {
    const r = Bun.spawnSync(["python3", "scripts/ref_match.py", a, b], { cwd: process.cwd() });
    return JSON.parse(new TextDecoder().decode(r.stdout)) as {
      distance: number;
      saturated: boolean;
    };
  };

  test("degradare progressivamente non fa MAI scendere la distanza", async () => {
    const src = join(refsDir(), "base.png");
    put("base.png");
    // Si degrada la reference contro se stessa: ogni passo e' piu' lontano.
    const steps = [1.0, 0.85, 0.7, 0.55];
    const done: string[] = [];
    for (const f of steps) {
      const out = `/tmp/darkroom-degrado-${f}.png`;
      const r = Bun.spawnSync([
        "python3",
        "-c",
        `from PIL import Image, ImageEnhance; ImageEnhance.Contrast(Image.open(${JSON.stringify(src)}).convert("RGB")).enhance(${f}).save(${JSON.stringify(out)})`,
      ]);
      expect(r.exitCode).toBe(0);
      done.push(out);
    }
    let prec = -1;
    for (const f of done) {
      const d = py(f, src).distance;
      expect(d).toBeGreaterThanOrEqual(prec);
      prec = d;
    }
  }, 60_000);

  test("un'immagine dista zero da se stessa", () => {
    put("identica.png");
    const p = join(refsDir(), "identica.png");
    expect(py(p, p).distance).toBe(0);
  }, 30_000);

  test("quando la sagoma sparisce nel fondo, la misura lo dichiara", async () => {
    const src = join(refsDir(), "sat.png");
    put("sat.png");
    const out = "/tmp/darkroom-saturo.png";
    Bun.spawnSync([
      "python3",
      "-c",
      `from PIL import Image, ImageEnhance; ImageEnhance.Contrast(Image.open(${JSON.stringify(src)}).convert("RGB")).enhance(0.3).save(${JSON.stringify(out)})`,
    ]);
    const r = py(out, src);
    // Oltre questa soglia la distanza e' un limite inferiore, non il valore
    // esatto: senza il flag due degradi diversi leggerebbero uguale.
    expect(r.saturated).toBe(true);
  }, 30_000);
});
