import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { db } from "../server/db.ts";
import { refsDir } from "../server/project.ts";

/**
 * Archiviare una configurazione sbagliata: si sposta, non si cancella.
 *
 * Una passata scartata oggi e' la prova di cio' che NON funziona, e rifarla
 * costa quello che e' costata. Finora si poteva fare solo da terminale, e per
 * farlo bisognava sapere a memoria il nome esatto del refset — cioe' proprio il
 * dato che l'albero mostra sullo schermo.
 */
function variante(n: number, refset: string): { id: number; file: string } {
  const dir = join(refsDir(), "..", "gen");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `arch-v${n}.png`);
  writeFileSync(file, "x");
  db().run(
    "INSERT INTO photos (id,original_path,original_ext,created_at,updated_at) VALUES (?,?,'.png',1,1)",
    [`ph${n}`, `/src/ph${n}.png`],
  );
  db().run(
    `INSERT INTO versions (photo_id,version_number,image_path,prompt_used,config,provider,source,created_at)
     VALUES (?,?,?,'p',?,'openai','generated',?)`,
    [`ph${n}`, n, file, JSON.stringify({ recipe: "r", refset }), Date.now()],
  );
  return { id: db().query<{ id: number }, []>("SELECT last_insert_rowid() id").get()!.id, file };
}

const archivia = (refset: string) =>
  app.request("/api/lineage/archive", { method: "POST", body: JSON.stringify({ refset }) });

describe("archivia una configurazione", () => {
  test("le varianti escono dal progetto e i file restano su disco", async () => {
    const buona = variante(1, "3 rif: id");
    const cattiva = variante(2, "3 rif: id+stile");

    const r = await archivia("3 rif: id+stile");
    expect(r.status).toBe(200);
    const esito = (await r.json()) as { archiviate: number; spostate: number; dove: string };
    expect(esito).toMatchObject({ archiviate: 1, spostate: 1 });

    // La riga esce. Si guardano le DUE righe di questa prova e non l'elenco
    // intero: il database e' condiviso con le altre prove, e pretendere di
    // essere soli dentro fa fallire una prova corretta per colpa di un'altra.
    const presente = (id: number) =>
      !!db().query<{ id: number }, [number]>("SELECT id FROM versions WHERE id = ?").get(id);
    expect(presente(cattiva.id)).toBe(false);
    expect(presente(buona.id)).toBe(true);
    // ...ma il file no: e' SPOSTATO, e va verificato dove e' arrivato.
    // Controllare solo che non sia piu' al suo posto lascia passare una
    // cancellazione — misurato: mutando `renameSync` in `unlinkSync` la prova
    // restava verde.
    expect(existsSync(cattiva.file)).toBe(false);
    expect(existsSync(join(esito.dove, "arch-v2.png"))).toBe(true);
    expect(existsSync(buona.file)).toBe(true);
  });

  test("un refset che non esiste non tocca niente", async () => {
    variante(3, "3 rif: id");
    const r = await archivia("mai vista");
    expect(r.status).toBe(404);
    expect(
      db().query<{ n: number }, []>("SELECT COUNT(*) n FROM versions WHERE source='generated'").get()!.n,
    ).toBeGreaterThan(0);
  });

  test("senza refset si rifiuta, invece di archiviare tutto", async () => {
    // E' il tipo di richiesta vuota che, interpretata come «tutti», svuota un
    // progetto senza che nessuno l'abbia chiesto.
    variante(4, "3 rif: id");
    const r = await app.request("/api/lineage/archive", { method: "POST", body: "{}" });
    expect(r.status).toBe(400);
    expect(
      db().query<{ n: number }, []>("SELECT COUNT(*) n FROM versions WHERE source='generated'").get()!.n,
    ).toBeGreaterThan(0);
  });
});
