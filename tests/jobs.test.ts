import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cancelPending, listJobs, looksLikePolicyRefusal, parseRefPaths } from "../server/jobs.ts";
import { db } from "../server/db.ts";
import { TEST_ROOT } from "./setup.ts";

function realFile(name: string): string {
  const dir = join(TEST_ROOT, "refs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "x");
  return path;
}

describe("parseRefPaths", () => {
  test("returns the stored paths", () => {
    const a = realFile("a.png");
    const b = realFile("b.png");
    expect(parseRefPaths(JSON.stringify([a, b]))).toEqual([a, b]);
  });

  test("drops paths whose file is gone instead of failing the job", () => {
    const a = realFile("a.png");
    expect(parseRefPaths(JSON.stringify([a, "/nope/missing.png"]))).toEqual([a]);
  });

  test("tolerates null, corrupt JSON and non-arrays", () => {
    expect(parseRefPaths(null)).toEqual([]);
    expect(parseRefPaths("")).toEqual([]);
    expect(parseRefPaths("{oops")).toEqual([]);
    expect(parseRefPaths('"a string"')).toEqual([]);
    expect(parseRefPaths("[1, 2]")).toEqual([]);
  });
});

describe("listJobs: un errore superato non è più un errore", () => {
  function job(photo: string, status: string, seen = 0): number {
    const now = Date.now();
    db().run(
      `INSERT INTO jobs (photo_id, prompt, status, seen, created_at) VALUES (?, 'p', ?, ?, ?)`,
      [photo, status, seen, now],
    );
    return Number(db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id);
  }

  beforeEach(() => {
    db().run("DELETE FROM jobs");
  });

  test("un fallimento seguito da un successo esce dalla lista", () => {
    job("a", "failed");
    job("a", "done");
    const ids = listJobs(100).map((j) => j.status);
    // La griglia legge l'ULTIMO job per decidere il badge: se il vecchio failed
    // resta in lista e il done cade fuori dal LIMIT, marca rossa una foto sana.
    expect(ids).toEqual(["done"]);
  });

  test("un fallimento seguito da un job ancora in corso esce comunque", () => {
    job("a", "failed");
    job("a", "running");
    expect(listJobs(100).map((j) => j.status)).toEqual(["running"]);
  });

  test("un fallimento che è ancora l'ultima parola resta", () => {
    job("a", "done");
    job("a", "failed");
    expect(listJobs(100).map((j) => j.status)).toContain("failed");
  });

  test("il successo di UN'ALTRA foto non nasconde questo errore", () => {
    job("a", "failed");
    job("b", "done");
    const rows = listJobs(100);
    expect(rows.find((j) => j.photo_id === "a")?.status).toBe("failed");
  });

  test("un fallimento già archiviato dall'utente resta fuori", () => {
    job("a", "failed", 1);
    expect(listJobs(100)).toHaveLength(0);
  });
});

describe("strategia anti-saturazione di ChatGPT", () => {
  test("la pausa fra job è configurabile e ha un default sensato", async () => {
    // Il valore non si legge da un test (è un modulo già caricato), ma il
    // contratto sì: deve esistere una pausa, e deve essere sovrascrivibile
    // quando l'account è già stato spremuto.
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    expect(src).toContain("JOB_GAP_MS");
    expect(src).toContain("process.env.JOB_GAP_MS");
    // Il jitter è ciò che evita il ritmo perfettamente regolare.
    expect(src).toContain("JOB_GAP_JITTER_MS");
    expect(src).toMatch(/Math\.random\(\)\s*\*\s*JOB_GAP_JITTER_MS/);
  });

  test("il watchdog fa ripartire il ciclo solo se ci sono job in attesa", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // Riavviare un ciclo sano è peggio del problema: la guardia sul pending
    // impedisce di rilanciarlo quando la coda è semplicemente vuota.
    expect(src).toMatch(/const pending = pickNextPending\(\);\s*\n\s*if \(!pending\) return;/);
    expect(src).toContain("loopBeatMs");
  });

  test("l'allegato viene ritentato prima di dichiarare fallito il job", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // "image not attached" era il 62% dei fallimenti e non è un rifiuto di
    // ChatGPT: è la miniatura lenta. Deve esserci un retry con chat nuova.
    expect(py).toContain("async def attach_with_retries");
    expect(py).toContain("attach_with_retries(cdp, [str(resized)], ref_paths, image.name)");
    // E la pausa fra i tentativi deve crescere, non essere fissa.
    expect(py).toContain("wait_s = 5 * i");
  });
});

describe("cap esplicito di ChatGPT", () => {
  test("un hint di ore non viene troncato a mezz'ora", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // Il caso reale: reset_hint="in 13 hour" veniva ridotto a 30 minuti, quindi
    // ci ripresentavamo 26 volte a bussare, bruciando un job ogni volta.
    expect(src).toContain("MAX_EXPLICIT_PAUSE_MS");
    expect(src).not.toMatch(/pausedUntilMs = Math\.min\(explicitReset \+ 2 \* 60 \* 1000, cap\)/);
    // E una pausa già in corso non deve essere accorciata da un hint più breve.
    expect(src).toContain("Math.max(pausedUntilMs, until)");
  });
});

describe("il render scaricato deve essere di QUESTA foto", () => {
  test("il worker confronta l'immagine scaricata con l'originale", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Nel set sono passati 116 render appartenenti ad altri job: un piatto di
    // sushi era diventato una strada di notte, e niente lo segnalava. Il
    // baseline esclude le immagini già viste, ma non una NUOVA immagine
    // generata per un altro lavoro.
    expect(py).toContain("def looks_like_same_scene");
    expect(py).toContain("does not match the source photo");
    // Il file sbagliato va cancellato, non lasciato lì a fingersi valido.
    expect(py).toContain("output.unlink(missing_ok=True)");
    // Soglia regolabile: su un set molto ricomposto potrebbe servire più bassa.
    expect(py).toContain("SCENE_MIN_CORR");
  });

  test("in caso di errore nel confronto la generazione passa", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Un controllo che boccia i render buoni perché numpy non c'è sarebbe
    // peggio del problema: il fallback restituisce 1.0 (= identiche).
    expect(py).toMatch(/except Exception:\s*\n\s*#[^\n]*\n\s*#[^\n]*\n\s*return 1\.0/);
  });
});

describe("annullare un job che sta girando", () => {
  function mk(photo: string, status: string): number {
    db().run(
      `INSERT INTO jobs (photo_id, prompt, status, seen, created_at) VALUES (?, 'p', ?, 0, ?)`,
      [photo, status, Date.now()],
    );
    return Number(db().query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id);
  }
  const statusOf = (id: number) =>
    db().query<{ status: string }, [number]>("SELECT status FROM jobs WHERE id = ?").get(id)!.status;

  beforeEach(() => db().run("DELETE FROM jobs"));

  test("un job bloccato in 'running' si puo' fermare", () => {
    // Prima si annullavano solo i 'pending': un job appeso teneva il lock del
    // browser e la coda non avanzava piu' finche' non si riavviava il server.
    const id = mk("a", "running");
    expect(cancelPending(id)).toBe(true);
    expect(statusOf(id)).toBe("cancelled");
  });

  test("un job gia' concluso non si tocca", () => {
    const id = mk("a", "done");
    expect(cancelPending(id)).toBe(false);
    expect(statusOf(id)).toBe("done");
  });

  test("il requeue del runner non resuscita un job annullato", () => {
    const id = mk("a", "running");
    cancelPending(id);
    // e' la query che il runner esegue dopo un timeout silenzioso
    db().run(
      "UPDATE jobs SET status='pending', started_at=NULL, error=? WHERE id=? AND status <> 'cancelled'",
      ["requeued: timeout", id],
    );
    expect(statusOf(id)).toBe("cancelled");
  });
});

describe("riconoscere il render quando ChatGPT lo mostra piccolo", () => {
  test("un alt 'immagine generata' vale quanto la dimensione", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Caso reale su IMG_2906: ChatGPT rendeva il risultato in un riquadro da
    // 400px con naturalWidth ancora 0, la soglia >=512 lo scartava e il job
    // girava a vuoto per 6 minuti prima di riaccodarsi.
    expect(py).toContain("const strongId = (i) =>");
    expect(py).toContain("alt.startsWith('immagine generata')");
    expect(py).toContain("strongId(i) || bigEnough(i)");
    // La soglia secca non deve tornare da sola.
    expect(py).not.toContain("(i.naturalWidth >= 512 || i.width >= 512));");
  });
});

describe("lo script del worker deve almeno compilare", () => {
  test("edit_batch.py e' Python valido", async () => {
    // Una graffa non raddoppiata dentro una f-string ha fatto uscire il worker
    // con exit 1 a ogni tentativo: la coda si e' riaccodata all'infinito e
    // nessun test se ne accorgeva, perche' controllavano solo il TESTO del file.
    const proc = Bun.spawnSync(["python3", "-c",
      "import ast,sys;ast.parse(open('scripts/edit_batch.py').read())"]);
    expect(new TextDecoder().decode(proc.stderr)).toBe("");
    expect(proc.exitCode).toBe(0);
  });

  test("color_grade.py e' Python valido", () => {
    const proc = Bun.spawnSync(["python3", "-c",
      "import ast;ast.parse(open('scripts/color_grade.py').read())"]);
    expect(proc.exitCode).toBe(0);
  });
});

describe("il limite immagini di ChatGPT va letto per intero", () => {
  test("il worker riconosce 'You've hit the Plus plan limit'", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Messaggio reale: "You've hit the Plus plan limit for image generations
    // requests... resets in 3 hours and 36 minutes." Non contiene "reached",
    // quindi passava per un timeout muto e la coda continuava a bussare.
    expect(py).toContain("hit the .*limit");
    expect(py).toContain("plan limit");
    expect(py).toContain("unable to invoke the image");
    // E "3 hours and 36 minutes" va catturato intero, non solo le ore.
    expect(py).toContain("resets? in");
  });

  test("'3 hours and 36 minutes' non diventa 3 ore secche", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    // Perdere i 36 minuti significa ripresentarsi prima del reset e bruciare
    // un altro tentativo: e' lo stesso difetto gia' corretto per "13 hour".
    expect(src).toContain("(?:hours?|ore|ora)\\s*(?:and|e)");
    expect(src).toContain("(Number(hm[1]) * 60 + Number(hm[2])) * 60 * 1000");
  });
});

describe("il rifiuto di ChatGPT non e' un guasto", () => {
  test("si distingue un no di policy da un errore transitorio", () => {
    // Un guasto passa riprovando, un "no" di policy no: senza distinguerli la
    // foto tornava in coda a ogni giro a raccogliere lo stesso rifiuto.
    expect(looksLikePolicyRefusal("content-policy refusal (copyright/likeness) — skipped")).toBe(true);
    expect(looksLikePolicyRefusal("no image in 360s (early-exit)")).toBe(false);
    expect(looksLikePolicyRefusal("Connection refused")).toBe(false);
  });

  test("il runner marca la foto quando arriva il rifiuto", async () => {
    const src = await Bun.file(new URL("../server/jobs.ts", import.meta.url)).text();
    expect(src).toContain("if (looksLikePolicyRefusal(err)) {");
    expect(src).toContain("markSkipped(job.photo_id, err)");
    expect(src).toContain("UPDATE photos SET skipped = 1, skip_reason = ?");
  });
});

describe("un render che non ha modificato niente non e' un render", () => {
  test("il worker rifiuta anche l'immagine IDENTICA all'originale", async () => {
    const py = await Bun.file(new URL("../scripts/edit_batch.py", import.meta.url)).text();
    // Caso reale su 19A084A4: ChatGPT ha restituito la foto di partenza
    // ridimensionata (correlazione 1.000). Il controllo guardava solo il lato
    // "troppo diversa", quindi e' entrata in libreria come versione nuova: il
    // difetto d'ambra che si voleva togliere e' rimasto identico.
    expect(py).toContain("SCENE_MAX_CORR");
    expect(py).toContain("returned the source photo unedited");
    // La soglia bassa (render di un altro job) deve restare.
    expect(py).toContain("SCENE_MIN_CORR");
    expect(py).toContain("does not match the source photo");
  });
});

describe("gli script di audit devono compilare", () => {
  // Stessa lezione della f-string rotta in edit_batch.py: un test che controlla
  // solo il TESTO di un file non si accorge che non gira.
  for (const f of ["scripts/audit_set.py", "scripts/pick_favorites.py"]) {
    test(`${f} e' Python valido`, () => {
      const proc = Bun.spawnSync(["python3", "-c", `import ast;ast.parse(open('${f}').read())`]);
      expect(proc.exitCode).toBe(0);
    });
  }
});

describe("la soglia dell'audit non e' inventata", () => {
  test("e' tarata sui giudizi reali, non su un numero tondo a caso", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    // v83 misurava +23 ed era stata bocciata a occhio ("ancora troppo
    // gialla"), v93 +16.8 accettata: una soglia a 25 avrebbe promosso proprio
    // la versione gia' rifiutata.
    expect(py).toContain("AMBRA_SOGLIA = 20.0");
    expect(py).toContain('v83 = +23.0');
    expect(py).toContain('v93 = +16.8');
  });

  test("le eccezioni sono nominate una per una, non una regola che copre tutto", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    expect(py).toContain("AMBRA_ACCETTATA");
    // ogni eccezione porta con se' il motivo
    expect(py).toMatch(/"IMG_2913": "[^"]{20,}"/);
  });

  test("l'audit NON confronta col proprio originale", async () => {
    const py = await Bun.file(new URL("../scripts/audit_set.py", import.meta.url)).text();
    // Provato due volte, sbagliato due volte, e la seconda con i numeri in
    // mano: il confronto mette a paragone il file GRADED (raffreddato dalla
    // pipeline) con lo scatto originale (caldo di lampade). Su 19A084A4
    // l'originale misura +114 e ogni render sta sotto, quindi la differenza e'
    // quasi sempre negativa e non discrimina. Misurato: la prova del veleno
    // passava da 3/3 a 1/3 — l'audit diventava cieco proprio sui casi che
    // erano gia' stati bocciati a occhio.
    expect(py).not.toContain("def originale_ambra");
    expect(py).toContain("AMBRA_SOGLIA = 20.0");
    // Le scene davvero calde restano gestite a mano, una per una col motivo.
    expect(py).toContain("AMBRA_ACCETTATA");
  });
});

describe("le misure dell'audit non devono degenerare in silenzio", () => {
  test("una superficie uniforme non produce NaN", () => {
    // Con ">" stretto, su un'immagine uniforme il filtro sul percentile non
    // seleziona nessun pixel: media di array vuoto = NaN, e un NaN fallisce
    // OGNI confronto senza dire niente. Il caso piu' degenere sarebbe stato
    // anche l'unico invisibile.
    const py = Bun.spawnSync(["python3", "-c", `
import numpy as np, sys, importlib.util
from PIL import Image
spec = importlib.util.spec_from_file_location("aud", "scripts/audit_set.py")
aud = importlib.util.module_from_spec(spec); sys.argv = ["audit"]
spec.loader.exec_module(aud)
m = aud.misura(Image.fromarray(np.full((80, 80, 3), 128, np.uint8)))
assert m["ambra"] == m["ambra"], "NaN"
assert m["piattezza"] < aud.PIATTO_SOGLIA, "una superficie piatta deve essere rilevata"
print("ok")
`]);
    expect(new TextDecoder().decode(py.stdout).trim()).toBe("ok");
    expect(py.exitCode).toBe(0);
  });
});
