import { describe, expect, test, beforeEach } from "bun:test";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";

/**
 * A tree root is the SET of sources, not the first photo in it.
 *
 * Two wrong rules sit on either side of this one: grouping by `photo_id` put
 * every variant under the first source and left the others showing "0
 * variants"; giving each contributing photo its own root would have shown the
 * same 12 variants three times over. What is checked here is that we slide
 * into neither.
 */

function photo(id: string) {
  db().run(
    "INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES (?,?,'.png',1,1)",
    [id, `/src/${id}.png`],
  );
}

function variant(n: number, sources: string[], photoId = sources[0]!) {
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
     VALUES (?,?,?,'p',NULL,?,'openai','generated',?)`,
    [
      photoId.replace(/\.png$/, ""),
      n,
      `/gen/v${n}.png`,
      JSON.stringify({ recipe: "r", refset: "rs", sources: sources }),
      Date.now(),
    ],
  );
}

async function tree(): Promise<{ photos: { photo: string; photos?: string[]; variants: number }[] }> {
  return (await (await app.request("/api/lineage")).json()) as never;
}

beforeEach(() => {
  db().run("DELETE FROM versions");
  db().run("DELETE FROM photos");
});

describe("the root is the set, not the first photo", () => {
  test("three shots used together give ONE root holding all three", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    for (let n = 1; n <= 12; n++) variant(n, ["A.png", "B.png", "C.png"]);

    const { photos } = await tree();
    const withVariants = photos.filter((p) => p.variants > 0);
    expect(withVariants).toHaveLength(1);
    expect(withVariants[0]!.photos).toHaveLength(3);
    expect(withVariants[0]!.variants).toBe(12);
    // The opposite defect: 3 roots x 12 = 36 appearances for 12 generations.
    expect(photos.reduce((a, p) => a + p.variants, 0)).toBe(12);
  });

  test("no photo of the set shows up separately with zero variants", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    variant(1, ["A.png", "B.png", "C.png"]);
    const { photos } = await tree();
    // B and C contributed: they must not appear as empty roots.
    expect(photos).toHaveLength(1);
  });

  test("a lone photo is a set of one, with no special case", async () => {
    photo("A");
    photo("B");
    variant(1, ["A.png"]);
    variant(2, ["B.png"], "B.png");
    const { photos } = await tree();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(2);
    for (const p of photos) expect(p.photos).toHaveLength(1);
  });

  test("overlapping sets stay distinct roots", async () => {
    for (const id of ["A", "B", "C"]) photo(id);
    variant(1, ["A.png", "B.png"]);
    variant(2, ["A.png", "B.png"]);
    variant(3, ["A.png", "B.png", "C.png"]);
    const { photos } = await tree();
    const roots = photos.filter((p) => p.variants > 0);
    expect(roots).toHaveLength(2);
    expect(roots.map((x) => x.variants).sort()).toEqual([1, 2]);
    // No variant counted twice: {A,B} is not a branch of {A,B,C}.
    expect(roots.reduce((a, p) => a + p.variants, 0)).toBe(3);
  });

  test("attachment order does not create two roots for the same set", async () => {
    for (const id of ["A", "B"]) photo(id);
    variant(1, ["A.png", "B.png"]);
    variant(2, ["B.png", "A.png"], "A.png");
    const { photos } = await tree();
    expect(photos.filter((p) => p.variants > 0)).toHaveLength(1);
  });

  test("photos that never generated stay visible", async () => {
    photo("A");
    photo("never-used");
    variant(1, ["A.png"]);
    const { photos } = await tree();
    expect(photos.some((p) => p.photo === "never-used" && p.variants === 0)).toBe(true);
  });
});

describe("a reference can be looked at, not only measured", () => {
  // Distance from the reference is computed (background, area, light ratio),
  // but "how much it resembles it" stays a judgement made with the eyes. For
  // it to be possible to overlay them, the file has to be served and the
  // lineage has to say WHICH file it was: the refset is a phrase for a human,
  // not a path.
  test("lineage reports the reference files, not just the refset", async () => {
    photo("A");
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('A',1,'/gen/v1.png','p',NULL,?,'openai','generated',?)`,
      [
        JSON.stringify({
          recipe: "r",
          refset: "3 sources + style",
          sources: ["A.png"],
          refs: ["style.png"],
        }),
        Date.now(),
      ],
    );
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    expect(photos[0]!.groups[0]!.refs).toEqual(["style.png"]);
  });

  test("a generation with no references does not invent any", async () => {
    photo("A");
    variant(1, ["A.png"]);
    const { photos } = (await (await app.request("/api/lineage")).json()) as {
      photos: { groups: { refs?: string[] }[] }[];
    };
    // Empty array, not undefined: the view decides whether to show the controls
    // by counting these, and an undefined would make it fail silently.
    expect(photos[0]!.groups[0]!.refs).toEqual([]);
  });

  test("the references route refuses path traversal", async () => {
    const r = await app.request("/refs/..%2f..%2fphotos.db");
    expect([400, 404]).toContain(r.status);
  });
});

/**
 * Quando gli ingressi arrivano dalla TABELLA e non dal JSON.
 *
 * Due difetti veri, trovati guardando l'albero di `profilo` dopo il passaggio a
 * `version_inputs`, ed entrambi silenziosi: una radice mostrava lo stesso scatto
 * tre volte, e un'altra restava senza nemmeno la propria unica sorgente. Il
 * secondo e' il piu' insidioso — una vista che si svuota non da' nessun errore,
 * sembra solo un progetto senza storia.
 */
describe("ingressi dalla tabella", () => {
  const ingresso = (
    versionId: number,
    kind: "source" | "reference",
    path: string,
    photoId: string | null,
    position: number,
    origin: "recorded" | "reconstructed" = "recorded",
  ) =>
    db().run(
      `INSERT INTO version_inputs (version_id,kind,path,photo_id,position,origin) VALUES (?,?,?,?,?,?)`,
      [versionId, kind, path, photoId, position, origin],
    );

  const albero = async () =>
    (await (await app.request("/api/lineage")).json()) as {
      photos: { photo: string; photos: string[]; variants: number; groups: { sources: string[]; refs?: string[]; ingressi_dedotti?: boolean }[] }[];
    };

  test("lo stesso scatto allegato due volte resta un ingresso solo", async () => {
    // Non e' un caso di scuola: su `profilo` una radice dichiarava sei sorgenti
    // di cui tre uguali, e oltre a ripetere la miniatura cambiava la CHIAVE
    // della radice — due gruppi con gli stessi scatti finivano separati.
    photo("a");
    photo("b");
    variant(1, ["a.png", "b.png"]);
    const vid = db().query<{ id: number }, []>("SELECT id FROM versions").get()!.id;
    ingresso(vid, "source", "/src/a.png", "a", 0);
    ingresso(vid, "source", "/src/b.png", "b", 1);
    ingresso(vid, "source", "/src/a.png", "a", 2);

    const r = (await albero()).photos;
    expect(r).toHaveLength(1);
    expect(r[0]!.photos).toEqual(["a", "b"]);
    expect(r[0]!.groups[0]!.sources).toEqual(["a", "b"]);
  });

  test("una sorgente registrata come id, e non come nome di file, non sparisce", async () => {
    // Una foto GENERATA non ha un file di partenza che si chiami come lei: gli
    // ingressi dedotti registrano l'id, e la traduzione da nome a id lo buttava.
    // La radice restava senza sorgenti e la striscia senza niente da mostrare.
    photo("gen_1");
    variant(1, [], "gen_1");
    const vid = db().query<{ id: number }, []>("SELECT id FROM versions").get()!.id;
    ingresso(vid, "source", "gen_1", "gen_1", 0, "reconstructed");

    const g = (await albero()).photos[0]!.groups[0]!;
    expect(g.sources).toEqual(["gen_1"]);
    // E si dichiara per quello che e': dedotto, non registrato.
    expect(g.ingressi_dedotti).toBe(true);
  });

  test("i riferimenti allegati davvero arrivano alla vista", async () => {
    // E' l'informazione per cui questa tabella esiste: il refset PROMETTEVA lo
    // stile e gli allegati erano zero, per dodici generazioni, senza che
    // nessuna schermata potesse dirlo.
    photo("a");
    variant(1, ["a.png"]);
    const vid = db().query<{ id: number }, []>("SELECT id FROM versions").get()!.id;
    ingresso(vid, "source", "/src/a.png", "a", 0);
    ingresso(vid, "reference", "/refs/stile.png", null, 0);

    const g = (await albero()).photos[0]!.groups[0]!;
    // Il NOME, non il percorso con cui e' stato registrato. Questo test
    // pretendeva il percorso, e cosi' facendo fissava un difetto: il client
    // costruisce `/thumb/refs/<nome>`, e con un percorso assoluto l'URL
    // diventa `/thumb/refs/%2FUsers%2F…`, che la rotta rifiuta. Misurate 7
    // miniature rotte sull'albero di profilo il 14/09.
    expect(g.refs).toEqual(["stile.png"]);
    expect(g.ingressi_dedotti).toBe(false);
  });
});

/**
 * Una versione senza lineage non sparisce dall'albero.
 *
 * E' la maggioranza dello storico: sul database del repo 2733 versioni su 3007
 * non hanno nemmeno un job collegato. Una vista che le lasciasse fuori
 * mostrerebbe un progetto quasi vuoto e non darebbe nessun errore — il modo
 * peggiore di sbagliare, perche' sembra semplicemente che non ci sia niente.
 */
describe("versioni senza origine registrata", () => {
  test("compaiono lo stesso, sotto la propria foto e dichiarate come dedotte", async () => {
    db().run(
      "INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES ('muta','/src/muta.png','.png',1,1)",
    );
    db().run(
      `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,lineage,provider,source,created_at)
       VALUES ('muta',1,'/gen/muta-v1.png','p',NULL,NULL,'openai','generated',?)`,
      [Date.now()],
    );
    const vid = db().query<{ id: number }, []>("SELECT id FROM versions WHERE photo_id='muta'").get()!.id;
    db().run(
      `INSERT INTO version_inputs (version_id,kind,path,photo_id,position,origin)
       VALUES (?, 'source', 'muta', 'muta', 0, 'reconstructed')`,
      [vid],
    );

    const d = (await (await app.request("/api/lineage")).json()) as {
      photos: { photo: string; variants: number; groups: { sources: string[]; ingressi_dedotti?: boolean }[] }[];
    };
    const r = d.photos.find((p) => p.photo === "muta");
    expect(r, "la versione senza lineage e' sparita dall'albero").toBeDefined();
    expect(r!.variants).toBe(1);
    expect(r!.groups[0]!.sources).toEqual(["muta"]);
    // E si presenta per quello che e'.
    expect(r!.groups[0]!.ingressi_dedotti).toBe(true);
  });
});
