/**
 * La raccolta: gli scatti tenuti finiscono in una cartella, pronti da consegnare.
 *
 * Una scelta di progetto che vale la pena spiegare, perché è diversa da come lo fa
 * l'implementazione da cui questa capability viene: **gli originali non si spostano
 * mai**. Là la raccolta li muove, e l'annullamento li rimette dov'erano; qui la
 * cartella contiene collegamenti fisici allo stesso file su disco.
 *
 * La differenza si vede quando qualcosa va storto. Uno spostamento interrotto a metà
 * lascia una cartella di lavoro incompleta e un utente che non sa dove sono le sue
 * fotografie. Un collegamento interrotto a metà lascia una cartella di raccolta
 * incompleta, e gli originali dove sono sempre stati.
 *
 * Un collegamento fisico non è una copia: non occupa spazio, e i due nomi puntano
 * agli stessi byte. Su trecento RAW da 50 MB sono quindici gigabyte che non si
 * scrivono. Dove non è possibile — un altro disco — si copia, e lo si dichiara.
 */

import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { db } from "./db.ts";
import type { PhotoRow } from "./db.ts";
import { percorsoSidecar } from "./sidecar.ts";

export const CARTELLA = "Darkroom_Selecta";
const MANIFESTO = "Darkroom_Selecta.json";

export type VoceRaccolta = {
  photoId: string;
  origine: string;
  destinazione: string;
  /** `collegamento` non occupa spazio; `copia` sì, e succede solo fra dischi diversi. */
  modo: "collegamento" | "copia";
};

export type Manifesto = {
  quando: number;
  voci: VoceRaccolta[];
};

export type PianoRaccolta = {
  cartella: string;
  voci: { photoId: string; origine: string; destinazione: string; esisteGia: boolean }[];
  /** Quanti file verranno creati davvero. */
  daCreare: number;
  /** Byte che *non* si scrivono grazie ai collegamenti. */
  byteRisparmiati: number;
};

function tenuti(): PhotoRow[] {
  return db()
    .query<PhotoRow, []>(
      `SELECT * FROM photos
       WHERE (culling_stelle > 0 OR culling_colore IS NOT NULL)
       ORDER BY id ASC`,
    )
    .all();
}

/** La cartella di raccolta sta accanto agli originali, non altrove. */
export function cartellaRaccolta(unOriginale: string): string {
  return join(dirname(unOriginale), CARTELLA);
}

/** Cosa farebbe la raccolta, senza farla. */
export function pianifica(): PianoRaccolta | null {
  const foto = tenuti();
  if (foto.length === 0) return null;
  const cartella = cartellaRaccolta(foto[0]!.original_path);

  let byteRisparmiati = 0;
  const voci = foto.map((f) => {
    const destinazione = join(cartella, basename(f.original_path));
    const esisteGia = existsSync(destinazione);
    if (!esisteGia && existsSync(f.original_path)) {
      try {
        byteRisparmiati += statSync(f.original_path).size;
      } catch {
        /* un file sparito si segnala al momento della raccolta */
      }
    }
    return { photoId: f.id, origine: f.original_path, destinazione, esisteGia };
  });

  return {
    cartella,
    voci,
    daCreare: voci.filter((v) => !v.esisteGia).length,
    byteRisparmiati,
  };
}

export type EsitoRaccolta = {
  cartella: string;
  collegati: number;
  copiati: number;
  gia: number;
  falliti: { photoId: string; errore: string }[];
  sidecarPortati: number;
};

/**
 * Raccoglie. Insieme al RAW si porta il suo sidecar, se c'è: un file di scelte
 * separato dalla fotografia che descrive non serve a chi riceve la cartella.
 */
export function raccogli(): EsitoRaccolta {
  const piano = pianifica();
  if (!piano) {
    return { cartella: "", collegati: 0, copiati: 0, gia: 0, falliti: [], sidecarPortati: 0 };
  }
  mkdirSync(piano.cartella, { recursive: true });

  const esito: EsitoRaccolta = {
    cartella: piano.cartella,
    collegati: 0,
    copiati: 0,
    gia: 0,
    falliti: [],
    sidecarPortati: 0,
  };
  const voci: VoceRaccolta[] = [];

  for (const v of piano.voci) {
    if (v.esisteGia) {
      esito.gia++;
      continue;
    }
    if (!existsSync(v.origine)) {
      esito.falliti.push({ photoId: v.photoId, errore: "l'originale non c'è più" });
      continue;
    }
    try {
      let modo: VoceRaccolta["modo"] = "collegamento";
      try {
        linkSync(v.origine, v.destinazione);
        esito.collegati++;
      } catch {
        // Dischi diversi: un collegamento fisico non li attraversa.
        copyFileSync(v.origine, v.destinazione);
        modo = "copia";
        esito.copiati++;
      }
      voci.push({ ...v, modo });

      const sidecar = percorsoSidecar(v.origine);
      const sidecarDest = join(piano.cartella, basename(sidecar));
      if (existsSync(sidecar) && !existsSync(sidecarDest)) {
        try {
          linkSync(sidecar, sidecarDest);
        } catch {
          copyFileSync(sidecar, sidecarDest);
        }
        voci.push({
          photoId: v.photoId,
          origine: sidecar,
          destinazione: sidecarDest,
          modo: "collegamento",
        });
        esito.sidecarPortati++;
      }
    } catch (e) {
      esito.falliti.push({
        photoId: v.photoId,
        errore: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Il manifesto elenca ciò che *abbiamo creato noi*, e solo quello: l'annullamento
  // non deve poter togliere un file che c'era già.
  const manifesto: Manifesto = { quando: Date.now(), voci };
  writeFileSync(
    join(piano.cartella, MANIFESTO),
    JSON.stringify(manifesto, null, 2) + "\n",
  );
  return esito;
}

export type EsitoAnnullamento = {
  tolti: number;
  cartellaRimossa: boolean;
  /** File nella cartella che non avevamo creato noi: restano dove sono. */
  lasciati: number;
};

/**
 * Annulla la raccolta.
 *
 * Toglie soltanto ciò che il manifesto dice di aver creato. Un file finito lì dentro
 * da qualcun altro non è nostro e non si tocca — e se ne resta anche uno solo, la
 * cartella non si cancella.
 */
export function annulla(cartella: string): EsitoAnnullamento {
  const percorsoManifesto = join(cartella, MANIFESTO);
  if (!existsSync(percorsoManifesto)) {
    return { tolti: 0, cartellaRimossa: false, lasciati: 0 };
  }
  const manifesto = JSON.parse(readFileSync(percorsoManifesto, "utf8")) as Manifesto;

  let tolti = 0;
  for (const v of manifesto.voci) {
    try {
      if (existsSync(v.destinazione)) {
        unlinkSync(v.destinazione);
        tolti++;
      }
    } catch {
      /* qualcuno lo sta leggendo: resta */
    }
  }
  unlinkSync(percorsoManifesto);

  // Vuota: si toglie. Non vuota: dentro c'è roba di qualcun altro, e resta.
  // `rmdirSync` e non una rimozione ricorsiva, apposta: se restasse un file che non
  // abbiamo creato noi, una ricorsiva se lo porterebbe via senza dirlo.
  const rimasti = existsSync(cartella) ? readdirSync(cartella).length : 0;
  let cartellaRimossa = false;
  if (rimasti === 0 && existsSync(cartella)) {
    rmdirSync(cartella);
    cartellaRimossa = true;
  }
  return { tolti, cartellaRimossa, lasciati: rimasti };
}
