import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { finalizzaFile, workingFile } from "../server/jobs.ts";
import { versionFileName } from "../server/db.ts";
import { TEST_ROOT } from "./setup.ts";

/**
 * IL GUASTO, misurato il 05/09 sull'ablazione occhiali del progetto `profilo`.
 *
 * Tre job della stessa foto (235, 236, 237) sono stati lavorati insieme —
 * il watchdog aveva fatto ripartire il ciclo senza che il vecchio fosse morto,
 * e i cicli si erano sommati. Ognuno, entrando, calcolava il numero della
 * prossima versione e ne ricavava il file di uscita: tutti e tre `v71.png`.
 * Poi ognuno riscriveva il numero all'insert, e sono nate le versioni 71, 72 e
 * 73 — tre righe, un file solo, due render persi. Niente e' fallito: la coda
 * diceva "done" tre volte.
 *
 * L'invariante che questi test difendono: mentre genera, un job scrive su un
 * file SUO; il nome definitivo glielo si da' alla fine, quando il numero di
 * versione e' finalmente noto.
 */
function dirDiProva(nome: string): string {
  const d = join(TEST_ROOT, "collisione", nome);
  mkdirSync(d, { recursive: true });
  return d;
}

describe("il file su cui un job scrive mentre genera", () => {
  test("due job della stessa foto non condividono il file di lavoro", () => {
    const d = dirDiProva("a");
    expect(workingFile(d, 235)).not.toBe(workingFile(d, 236));
  });

  test("non porta il nome di una versione: nessuno puo' scambiarlo per un render finito", () => {
    const d = dirDiProva("b");
    expect(workingFile(d, 71)).not.toBe(join(d, versionFileName(71)));
    expect(workingFile(d, 71).endsWith("v71.png")).toBe(false);
  });
});

describe("la consegna del file al numero di versione", () => {
  test("il percorso restituito esiste ed e' quello che finisce nella riga", () => {
    const d = dirDiProva("c");
    const work = workingFile(d, 900);
    writeFileSync(work, "render");
    const finale = finalizzaFile(work, d, 71);
    expect(finale).toBe(join(d, "v71.png"));
    expect(existsSync(finale)).toBe(true);
    // Il file di lavoro non resta indietro: due copie della stessa immagine
    // farebbero sembrare piena una cartella di scarti.
    expect(existsSync(work)).toBe(false);
  });

  test("tre job in parallelo producono tre file distinti, ognuno col proprio contenuto", () => {
    // E' lo scenario esatto del 05/09, con la differenza che qui i tre job
    // scrivono davvero il proprio risultato prima di consegnarlo.
    const d = dirDiProva("d");
    const jobs = [235, 236, 237];
    const contenuti = ["controllo", "ref+parole", "solo-ref"];
    for (const [i, id] of jobs.entries()) writeFileSync(workingFile(d, id), contenuti[i]!);

    // Le consegne avvengono in ordine di arrivo, ognuna col numero calcolato
    // in quel momento — come fa `processJob`.
    const finali = jobs.map((id, i) => finalizzaFile(workingFile(d, id), d, 71 + i));

    expect(new Set(finali).size).toBe(3);
    for (const [i, f] of finali.entries()) {
      expect(existsSync(f)).toBe(true);
      expect(readFileSync(f, "utf8")).toBe(contenuti[i]!);
    }
  });
});
