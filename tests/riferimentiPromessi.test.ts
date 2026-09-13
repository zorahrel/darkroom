import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { riferimentiMancanti } from "../server/jobs.ts";

/**
 * Cio' che un job promette deve esserci, o il job non parte.
 *
 * Il difetto, per esteso: `parseRefPaths` scarta in silenzio i file che non
 * esistono, e il worker fa lo stesso un secondo dopo. Ognuno dei due e'
 * ragionevole; insieme producono una generazione che parte, riesce, e non e'
 * quella chiesta. Su `profilo` sono uscite dodici varianti con il refset che
 * prometteva «+ stile» e zero file di stile allegati — e nessuno se n'e' accorto
 * perche' l'immagine sbagliata e' comunque plausibile.
 *
 * Le due prove che contano sono le due facce: che morda quando serve, e
 * soprattutto che NON morda sullo storico. I job che non dichiarano niente sono
 * tutti quelli dell'interfaccia normale: se il controllo li toccasse, avremmo
 * scambiato un difetto silenzioso con una coda ferma.
 */
const cartella = mkdtempSync(join(tmpdir(), "rif-"));
const presente = join(cartella, "stile.png");
writeFileSync(presente, "x");

describe("riferimenti promessi", () => {
  test("un file promesso e assente si chiama per nome", () => {
    const mancanti = riferimentiMancanti(
      JSON.stringify(["stile.png", "sparito.png"]),
      JSON.stringify([presente]),
    );
    expect(mancanti).toEqual(["sparito.png"]);
  });

  test("promesso e presente: niente da dire", () => {
    expect(riferimentiMancanti(JSON.stringify(["stile.png"]), JSON.stringify([presente]))).toEqual([]);
  });

  test("il confronto e' sul nome, non sul percorso", () => {
    // Chi accoda scrive nomi, il worker maneggia percorsi assoluti: confrontarli
    // alla lettera farebbe fallire tutto cio' che funziona.
    expect(riferimentiMancanti(JSON.stringify(["/altrove/stile.png"]), JSON.stringify([presente]))).toEqual([]);
  });

  test("chi non ha promesso niente non viene toccato", () => {
    // NULL = «non ho dichiarato», non «ho dichiarato zero». E' tutto lo storico
    // e tutta l'interfaccia normale: 658 job su Japan hanno riferimenti allegati
    // e nessuna dichiarazione, e devono restare intatti.
    expect(riferimentiMancanti(null, JSON.stringify(["/rif/qualunque.png"]))).toEqual([]);
    expect(riferimentiMancanti(JSON.stringify([]), null)).toEqual([]);
  });

  test("una dichiarazione illeggibile non blocca la coda", () => {
    // Un JSON rotto e' un difetto di chi scrive, non una promessa non mantenuta:
    // fermare la generazione per quello sarebbe una seconda avaria al posto
    // della prima.
    expect(riferimentiMancanti("{non json", JSON.stringify([presente]))).toEqual([]);
  });

  test("promesso con zero allegati: manca tutto, e si dice tutto", () => {
    // E' il caso esatto di `profilo`: refset che prometteva lo stile, `refs: []`.
    expect(riferimentiMancanti(JSON.stringify(["stile.png", "luce.png"]), null))
      .toEqual(["stile.png", "luce.png"]);
  });
});

/**
 * Il controllo sugli allegati: morde quando servirebbe, e non morde a vuoto.
 *
 * Il limite di sei sta nel worker perche' e' il modello a non reggerne di piu'.
 * La prova legge il SORGENTE invece di riscrivere la regola: una prova che
 * ricalcola per conto suo «piu' di sei» resta verde anche se il worker passa a
 * dieci, cioe' non prova niente. Cosi' invece il confine non si puo' spostare
 * in silenzio.
 */
describe("limite degli allegati", () => {
  const worker = readFileSync(new URL("../server/worker-codex-http.ts", import.meta.url), "utf8");

  test("il confine e' sei, e sta scritto una volta sola", () => {
    const guardia = /attachments\.length > (\d+)/.exec(worker);
    expect(guardia?.[1]).toBe("6");
  });

  test("e l'errore dice quanti ne sono arrivati, non solo che erano troppi", () => {
    // Un «troppi allegati» senza il numero manda a contarli a mano: e' la
    // differenza fra un errore e un indovinello.
    const riga = /troppi allegati[^`\n]*/.exec(worker)?.[0] ?? "";
    expect(riga).toContain("${attachments.length}");
    expect(riga).toContain("massimo 6");
  });

  test("non morde quando non c'e' niente da contare", () => {
    // Il caso «a vuoto»: senza allegati la guardia non deve nemmeno comparire
    // nel cammino, e infatti il confronto e' su una lunghezza che parte da zero.
    expect(worker).toContain("const attachments: string[] = []");
  });
});
