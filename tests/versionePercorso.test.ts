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
