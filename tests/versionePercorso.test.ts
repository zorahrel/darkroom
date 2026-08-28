import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { withProject, genDir } from "../server/project.ts";
import { versionFileName, versionPath, percorsoFuoriConvenzione } from "../server/db.ts";

/**
 * Il 27/08 due cover generate non comparivano nell'albero. La riga nel database
 * c'era, l'API la restituiva, la variante si vedeva in pagina: mancava solo
 * l'immagine, perche' `image_path` puntava a
 * `generations/cover-scena-gel-high.png` mentre il client chiede la miniatura
 * all'indirizzo che ricostruisce da solo, `generations/1/v30.png`.
 *
 * E' il tipo di guasto peggiore: niente si rompe, tutto sembra a posto, e il
 * dato e' invisibile finche' qualcuno non va a cercare proprio quello.
 */
describe("il nome di file di una versione", () => {
  test("sotto il dieci si riempie con uno zero", () => {
    expect(versionFileName(1)).toBe("v01.png");
    expect(versionFileName(9)).toBe("v09.png");
  });

  test("da dieci in su resta com'e'", () => {
    expect(versionFileName(10)).toBe("v10.png");
    expect(versionFileName(30)).toBe("v30.png");
  });

  test("oltre il centesimo NON si tronca a due cifre", () => {
    // Japan ha versioni oltre la centesima: un padding che tronca le
    // spacciherebbe per fuori convenzione, ed e' esattamente l'errore che ho
    // fatto scrivendo il censimento (159 falsi positivi con substr(-2)).
    expect(versionFileName(100)).toBe("v100.png");
    expect(versionFileName(3007)).toBe("v3007.png");
  });
});

describe("dove deve stare il file di una versione", () => {
  test("sotto la cartella della SUA foto, non nella radice", () => {
    withProject("conv-a", () => {
      expect(versionPath("foto1", 30)).toBe(join(genDir(), "foto1", "v30.png"));
    });
  });

  test("due foto non condividono lo stesso file", () => {
    withProject("conv-b", () => {
      expect(versionPath("a", 1)).not.toBe(versionPath("b", 1));
    });
  });
});

describe("il controllo sulla convenzione", () => {
  test("un percorso giusto non ha niente da dire", () => {
    withProject("conv-c", () => {
      expect(percorsoFuoriConvenzione("f", 3, versionPath("f", 3))).toBeNull();
    });
  });

  test("il file nella radice invece che nella cartella della foto viene visto", () => {
    withProject("conv-d", () => {
      const sbagliato = join(genDir(), "cover-scena-gel-high.png");
      const msg = percorsoFuoriConvenzione("1", 30, sbagliato);
      expect(msg).not.toBeNull();
      // Il messaggio deve dire cosa succedera', non solo che e' diverso: e'
      // l'unica cosa che collega la causa al sintomo osservato (un 500).
      expect(msg).toContain("500");
      expect(msg).toContain("v30.png");
    });
  });

  test("il numero senza zero davanti e' comunque fuori convenzione", () => {
    // `v3.png` invece di `v03.png`: il file esiste, la miniatura no.
    withProject("conv-e", () => {
      expect(percorsoFuoriConvenzione("f", 3, join(genDir(), "f", "v3.png"))).not.toBeNull();
    });
  });

  test("la cartella di un'ALTRA foto e' fuori convenzione", () => {
    withProject("conv-f", () => {
      expect(percorsoFuoriConvenzione("a", 1, versionPath("b", 1))).not.toBeNull();
    });
  });

  test("il numero di versione sbagliato nella cartella giusta e' fuori convenzione", () => {
    withProject("conv-g", () => {
      expect(percorsoFuoriConvenzione("a", 2, versionPath("a", 1))).not.toBeNull();
    });
  });
});

describe("gli istanti si scrivono in millisecondi", () => {
  test("adesso() e' in millisecondi, come Date.now()", async () => {
    const { adesso } = await import("../server/db.ts");
    const t = adesso();
    // Un valore in secondi sarebbe ~1.7e9, uno in millisecondi ~1.7e12.
    expect(t).toBeGreaterThan(1_000_000_000_000);
    expect(Math.abs(t - Date.now())).toBeLessThan(1000);
  });

  test("riconosce un istante scritto in secondi", async () => {
    // IL BUG: tre versioni registrate a mano con Date.now()/1000 finivano in
    // fondo all'ordine cronologico, sembrando vecchie di decenni.
    const { istanteSospetto } = await import("../server/db.ts");
    expect(istanteSospetto(1787854707)).toBe(true); // v31, come era scritta
    expect(istanteSospetto(1787854707000)).toBe(false); // come deve essere
  });

  test("zero non e' sospetto: e' assente, non sbagliato", async () => {
    const { istanteSospetto } = await import("../server/db.ts");
    expect(istanteSospetto(0)).toBe(false);
  });
});

describe("il lineage viaggia dal job alla versione", () => {
  // Prima la coda non lo scriveva: le generazioni fatte per la via corretta
  // finivano sotto "origine non registrata" nell'albero, mentre quelle lanciate
  // a mano da uno script avevano il raggruppamento giusto. L'effetto perverso e'
  // che conveniva scrivere INSERT a mano — ed e' cosi' che in un giorno sono
  // nati un percorso fuori convenzione e dei timestamp in secondi.
  test("enqueueJob accetta e conserva il lineage", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("lin-test", () => {
      initSchema();
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p1','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const lin = JSON.stringify({ recipe: "prova", refset: "1 sorgente", sources: ["x.png"], refs: [] });
      const job = enqueueJob("p1", "prompt", null, "chatgpt", null, "edit", null, null, lin);
      const riletto = db()
        .query<{ lineage: string | null }, [number]>("SELECT lineage FROM jobs WHERE id = ?")
        .get(job.id);
      expect(riletto?.lineage).toBe(lin);
      expect(JSON.parse(riletto!.lineage!).recipe).toBe("prova");
    });
  });

  test("senza lineage il job resta valido: le chiamate vecchie non cambiano", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("lin-test2", () => {
      initSchema();
      // Id diverso dal test precedente: i due condividono il database, e
      // riusare 'p1' viola la chiave primaria.
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p2','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const job = enqueueJob("p2", "prompt");
      expect(job.status).toBe("pending");
      const riletto = db()
        .query<{ lineage: string | null }, [number]>("SELECT lineage FROM jobs WHERE id = ?")
        .get(job.id);
      expect(riletto?.lineage).toBeNull();
    });
  });
});

describe("il canale si sceglie per job, non per processo", () => {
  // Era una costante calcolata all'import: per generare con un backend diverso
  // bisognava riavviare il servizio, e il riavvio cambia il comportamento di
  // OGNI progetto invece che della singola generazione.
  test("senza indicazione si usa quello di sistema", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: null })).toBe("cdp"); // default di WORKER_BACKEND
    expect(backendDi(undefined)).toBe("cdp");
  });

  test("il job puo' portarsi il proprio canale", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "openai" })).toBe("openai");
    expect(backendDi({ backend: "codex-http" })).toBe("codex-http");
    expect(backendDi({ backend: "codex" })).toBe("codex");
  });

  test("un canale sconosciuto non rompe la coda: si torna al browser", async () => {
    // Un valore storto in una colonna di testo non deve far fallire il job.
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "banana" })).toBe("cdp");
    expect(backendDi({ backend: "" })).toBe("cdp");
  });

  test("il canale e' insensibile alle maiuscole", async () => {
    const { backendDi } = await import("../server/jobs.ts");
    expect(backendDi({ backend: "OpenAI" })).toBe("openai");
  });

  test("enqueueJob conserva il canale scelto", async () => {
    const { withProject } = await import("../server/project.ts");
    const { initSchema, db } = await import("../server/db.ts");
    const { enqueueJob } = await import("../server/jobs.ts");
    withProject("backend-test", () => {
      initSchema();
      // Id unico: i test condividono il database e riusare 'p1' violerebbe la
      // chiave primaria.
      db().run(
        "INSERT INTO photos (id, original_path, original_ext, created_at, updated_at) VALUES ('p3','/tmp/x.png','.png',?,?)",
        [Date.now(), Date.now()],
      );
      const job = enqueueJob("p3", "prompt", null, "chatgpt", null, "edit", null, null, null, "openai");
      const riletto = db()
        .query<{ backend: string | null }, [number]>("SELECT backend FROM jobs WHERE id = ?")
        .get(job.id);
      expect(riletto?.backend).toBe("openai");
    });
  });
});
