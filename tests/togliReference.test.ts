import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "../server/app.ts";
import { refsDir } from "../server/project.ts";

/**
 * Togliere un riferimento sbagliato dall'elenco.
 *
 * PERCHE' ESISTE. Su questo progetto i riferimenti si accumulano: ogni prova
 * ne lascia uno, e dopo venti tentativi l'elenco e' pieno di immagini che non
 * si vogliono piu' allegare — ma l'unico modo di toglierle era il Finder.
 *
 * PERCHE' UN CESTINO E NON `rm`. Il lineage di ogni versione registra i nomi
 * dei file allegati: cancellare il file lascia righe che puntano nel vuoto e
 * l'albero mostra riquadri rotti al posto degli allegati. Il file si sposta in
 * `refs/_cestino/` — sparisce dall'elenco, resta servibile, e si rimette con
 * un `mv` se era un errore.
 */
const nome = "prova-da-togliere.png";
const cestino = () => join(refsDir(), "_cestino");

beforeEach(() => {
  mkdirSync(refsDir(), { recursive: true });
  writeFileSync(join(refsDir(), nome), "x");
  rmSync(join(cestino(), nome), { force: true });
});

const togli = (file: string) =>
  app.request(`/api/references/${encodeURIComponent(file)}`, { method: "DELETE" });

describe("togliere un riferimento non lo cancella", () => {
  test("lo sposta nel cestino, e sparisce dall'elenco", async () => {
    const r = await togli(nome);
    expect(r.status).toBe(200);

    // Non e' piu' dove lo cerca l'elenco...
    expect(existsSync(join(refsDir(), nome))).toBe(false);
    // ...ma non e' distrutto.
    expect(existsSync(join(cestino(), nome))).toBe(true);

    const elenco = (await (await app.request("/api/references")).json()) as {
      references: Array<{ file: string }>;
    };
    expect(elenco.references.some((x) => x.file === nome)).toBe(false);
  });

  test("resta servibile: le varianti che lo allegavano non si rompono", async () => {
    await togli(nome);
    // E' il punto dell'intero disegno: una reference tolta dall'elenco resta
    // allegata alle varianti gia' generate, e quelle miniature devono vedersi.
    const img = await app.request(`/refs/${nome}`);
    expect(img.status).toBe(200);
  });

  test("due omonimi tolti in momenti diversi non si sovrascrivono", async () => {
    await togli(nome);
    writeFileSync(join(refsDir(), nome), "secondo");
    const r = await togli(nome);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { cestinato: string };
    // Il secondo prende un suffisso: il primo resta recuperabile.
    expect(body.cestinato).not.toBe(nome);
    expect(existsSync(join(cestino(), nome))).toBe(true);
    expect(existsSync(join(cestino(), body.cestinato))).toBe(true);
  });

  test("un nome con percorso e' rifiutato, un file assente e' 404", async () => {
    expect((await togli("../../photos.db")).status).toBe(400);
    expect((await togli("non-esiste.png")).status).toBe(404);
  });
});

describe("i riferimenti nell'albero si chiamano per nome, non per percorso", () => {
  /**
   * MISURATO il 14/09: 7 miniature rotte su /p/profilo/tree. I `source` erano
   * normalizzati con `.split("/").pop()`, i `refs` no — quindi il client
   * costruiva `/thumb/refs/%2FUsers%2F…%2Frefs%2Fbocca-reale.png`, che la rotta
   * rifiuta perche' dopo il decode contiene `/`. L'asimmetria era invisibile
   * finche' non si guardavano le immagini invece dei numeri.
   */
  test("lineage.ts riduce al basename anche i refs", async () => {
    const src = await Bun.file(new URL("../server/routes/lineage.ts", import.meta.url)).text();
    // `const versions` compare anche PRIMA (in un tipo): si cerca la sua
    // occorrenza successiva all'inizio del blocco, non la prima del file.
    const dopo = src.indexOf("const ingressiPer");
    const blocco = src.slice(dopo, src.indexOf("const versions", dopo));
    // Si legge la riga intera: `pop()` contiene parentesi, quindi un
    // `[^)]*` si fermerebbe a meta' espressione.
    const push = /e\.refs\.push\(.*/.exec(blocco);
    expect(push).not.toBeNull();
    // Deve ridurre al nome, non spingere il percorso cosi' com'e'.
    expect(push![0]).toContain('split("/").pop()');
  });

  test("nessun ref esposto dall'API e' un percorso assoluto", async () => {
    const r = await app.request("/api/lineage");
    const d = (await r.json()) as {
      photos?: Array<{ versions?: Array<{ file_refs?: string[] }> }>;
    };
    const tutti = (d.photos ?? []).flatMap((p) => (p.versions ?? []).flatMap((v) => v.file_refs ?? []));
    expect(tutti.filter((x) => x.startsWith("/"))).toEqual([]);
  });
});

describe("la griglia dei riferimenti li mostra interi", () => {
  /**
   * In un riquadro 691x651 le miniature erano rese 198x198 con `object-cover`,
   * mentre i file stanno fra 0,56 e 1,33 di rapporto: su una reference
   * verticale il quadrato ne mostrava meno della meta', tagliata al centro.
   * Una griglia che serve a RICONOSCERE i riferimenti non puo' ritagliarli.
   */
  test("usa contain su un riquadro 3/4, e ogni scheda ha il bottone per togliere", async () => {
    const src = await Bun.file(new URL("../client/src/pages/References.tsx", import.meta.url)).text();
    const img = /<img[\s\S]{0,400}?className="([^"]*)"/.exec(src);
    expect(img).not.toBeNull();
    expect(img![1]).toContain("object-contain");
    expect(img![1]).not.toContain("object-cover");
    expect(img![1]).toContain("aspect-[3/4]");
    expect(src).toContain("togliRiferimento");
    // Il gesto distruttivo su una reference gia' usata chiede conferma.
    expect(src).toContain("confirm(");
  });
});
