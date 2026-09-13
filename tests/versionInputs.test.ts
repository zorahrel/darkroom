import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchemaOn, type VersionInputRow } from "../server/db.ts";

/**
 * Gli ingressi di una versione, come righe invece che come JSON.
 *
 * Lo schema diceva «una versione appartiene a una foto» e il lavoro vero lo
 * smentiva: su `profilo` dodici versioni su dodici nascevano da TRE scatti, e
 * quelle trentasei relazioni vivevano tutte dentro una colonna TEXT. Niente le
 * vincolava, niente le sapeva interrogare, e soprattutto nessuno si accorgeva
 * quando restavano vuote — e' cosi' che dodici generazioni sono uscite senza la
 * reference di stile che il refset prometteva.
 *
 * Queste prove tengono ferme le tre cose che rendono la tabella utile: che si
 * possa rieseguire la migrazione senza duplicare, che distingua cio' che e'
 * stato registrato da cio' che e' stato dedotto, e che cancellare una foto non
 * cancelli la prova che ha contribuito.
 */

/** Un database con lo schema completo e qualche foto dentro. */
function conFoto(...nomi: string[]): Database {
  const d = new Database(":memory:");
  initSchemaOn(d);
  const ora = Date.now();
  for (const [i, n] of nomi.entries()) {
    d.run(
      `INSERT INTO photos (id, original_path, original_ext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [`p${i + 1}`, `/scatti/${n}`, ".jpg", ora, ora],
    );
  }
  return d;
}

function versione(d: Database, photoId: string, n: number, lineage: string | null): number {
  d.run(
    `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, source, created_at, lineage)
     VALUES (?, ?, ?, '', 'generated', ?, ?)`,
    [photoId, n, `/v/${photoId}-${n}.png`, Date.now(), lineage],
  );
  return d.query<{ id: number }, []>("SELECT last_insert_rowid() id").get()!.id;
}

const ingressi = (d: Database, v: number) =>
  d
    .query<VersionInputRow, [number]>(
      "SELECT * FROM version_inputs WHERE version_id = ? ORDER BY kind, position",
    )
    .all(v);

describe("version_inputs", () => {
  test("le tre sorgenti del lineage diventano tre righe, in ordine", () => {
    const d = conFoto("1.PNG", "2.PNG", "3.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG", "2.PNG", "3.PNG"], refs: [] }));
    initSchemaOn(d);

    const righe = ingressi(d, v);
    expect(righe.map((r) => r.path)).toEqual(["1.PNG", "2.PNG", "3.PNG"]);
    expect(righe.map((r) => r.position)).toEqual([0, 1, 2]);
    // Registrate, non dedotte: il lineage lo diceva.
    expect(righe.every((r) => r.origin === "recorded")).toBe(true);
    // E i nomi si riconducono alle foto del progetto.
    expect(righe.map((r) => r.photo_id)).toEqual(["p1", "p2", "p3"]);
  });

  test("una sorgente che non e' una foto del progetto si scrive lo stesso, senza id", () => {
    // Buttarla sarebbe lo stesso silenzio che questa tabella corregge: un
    // ingresso mezzo noto resta un ingresso.
    const d = conFoto("1.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG", "sparita.png"] }));
    initSchemaOn(d);

    const righe = ingressi(d, v);
    expect(righe.map((r) => r.path)).toEqual(["1.PNG", "sparita.png"]);
    expect(righe.map((r) => r.photo_id)).toEqual(["p1", null]);
  });

  test("senza lineage la sorgente si deduce, e lo dichiara", () => {
    const d = conFoto("1.PNG");
    const v = versione(d, "p1", 1, null);
    initSchemaOn(d);

    const righe = ingressi(d, v);
    expect(righe).toHaveLength(1);
    expect(righe[0]!.photo_id).toBe("p1");
    // E' il caso maggioritario dello storico, e va detto: nessun job, nessun
    // lineage, solo `versions.photo_id`. E' un'inferenza, non un fatto.
    expect(righe[0]!.origin).toBe("reconstructed");
  });

  test("i riferimenti allegati dal job entrano quando il lineage tace", () => {
    const d = conFoto("1.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG"] }));
    d.run(
      `INSERT INTO jobs (photo_id, prompt, status, result_version_id, ref_paths, created_at)
       VALUES ('p1', '', 'done', ?, ?, ?)`,
      [v, JSON.stringify(["/rif/stile.png"]), Date.now()],
    );
    initSchemaOn(d);

    const rif = ingressi(d, v).filter((r) => r.kind === "reference");
    expect(rif.map((r) => r.path)).toEqual(["/rif/stile.png"]);
    // Il job quel file lo ha allegato davvero: e' una registrazione.
    expect(rif[0]!.origin).toBe("recorded");
    // Un riferimento non e' una foto del progetto, e il DB lo impone.
    expect(rif[0]!.photo_id).toBeNull();
  });

  test("una versione gia' migrata non viene riguardata", () => {
    // Il comportamento, non il meccanismo: a proteggerlo ci sono due cose (il
    // filtro sulle versioni gia' fatte e la chiave composta) e misurandole si e'
    // visto che basta una delle due. La prova guarda quindi cio' che conta —
    // che un secondo giro non tocchi niente — e resta verde finche' ne
    // sopravvive almeno una.
    const d = conFoto("1.PNG", "2.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG", "2.PNG"] }));
    initSchemaOn(d);
    // Qualcuno ha corretto a mano una riga: il secondo giro non deve rimetterla
    // com'era, ne' aggiungerne una terza.
    d.run("UPDATE version_inputs SET path = 'corretto.PNG' WHERE version_id = ? AND position = 1", [v]);
    initSchemaOn(d);
    expect(ingressi(d, v).map((r) => r.path)).toEqual(["1.PNG", "corretto.PNG"]);
  });

  test("rieseguirla tre volte non scrive una riga in piu'", () => {
    // E' cio' che permette di non avere una tabella di stato delle migrazioni:
    // ogni avvio del server rilancia `initSchemaOn`.
    const d = conFoto("1.PNG", "2.PNG");
    versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG", "2.PNG"] }));
    initSchemaOn(d);
    const dopoUno = d.query<{ c: number }, []>("SELECT COUNT(*) c FROM version_inputs").get()!.c;
    initSchemaOn(d);
    initSchemaOn(d);
    const dopoTre = d.query<{ c: number }, []>("SELECT COUNT(*) c FROM version_inputs").get()!.c;
    expect(dopoTre).toBe(dopoUno);
    expect(dopoUno).toBe(2);
  });

  test("cancellare una foto non cancella la prova che ha contribuito", () => {
    // La prima stesura dello schema falliva proprio qui: `ON DELETE SET NULL`
    // azzerava l'unico campo che identificava la riga, e la cancellazione della
    // foto moriva su un CHECK. Con il percorso sempre scritto, resta una riga
    // valida che dice ancora QUALE file e' entrato.
    const d = conFoto("1.PNG", "2.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG", "2.PNG"] }));
    initSchemaOn(d);

    d.run("PRAGMA foreign_keys = ON");
    expect(() => d.run("DELETE FROM photos WHERE id = 'p2'")).not.toThrow();

    const righe = ingressi(d, v);
    expect(righe.map((r) => r.path)).toEqual(["1.PNG", "2.PNG"]);
    expect(righe.map((r) => r.photo_id)).toEqual(["p1", null]);
  });

  test("cancellare una versione porta via i suoi ingressi, che non sono dati", () => {
    const d = conFoto("1.PNG");
    const v = versione(d, "p1", 1, JSON.stringify({ sources: ["1.PNG"] }));
    initSchemaOn(d);
    d.run("PRAGMA foreign_keys = ON");
    d.run("DELETE FROM versions WHERE id = ?", [v]);
    expect(ingressi(d, v)).toHaveLength(0);
  });

  test("un riferimento con un id foto e' rifiutato dal database, non dal codice", () => {
    const d = conFoto("1.PNG");
    const v = versione(d, "p1", 1, null);
    initSchemaOn(d);
    expect(() =>
      d.run(
        `INSERT INTO version_inputs (version_id, kind, path, photo_id, position, origin)
         VALUES (?, 'reference', '/rif/x.png', 'p1', 9, 'recorded')`,
        [v],
      ),
    ).toThrow();
  });
});
