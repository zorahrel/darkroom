/**
 * Il culling: la fase in cui da qualche migliaio di scatti se ne scelgono qualche
 * centinaio.
 *
 * È deliberatamente separata dalla stella della versione. La stella dice quale
 * *render* di una foto è quello buono; qui si dice se lo scatto merita di essere
 * lavorato, e la domanda viene prima — spesso mesi prima, e comunque prima che
 * esista un render da confrontare.
 */

import { db } from "./db.ts";
import type { PhotoRow } from "./db.ts";
import * as motore from "./core.ts";

export const COLORI = ["rosso", "giallo", "verde", "blu", "viola"] as const;
export type Colore = (typeof COLORI)[number];

export type Giudizio = {
  /** Da 0 a 5. `null` è «non ancora giudicata», che non è «zero stelle». */
  stelle: number | null;
  colore: Colore | null;
};

export class GiudizioNonValido extends Error {}

export function validaGiudizio(g: Partial<Giudizio>): Giudizio {
  const stelle = g.stelle ?? null;
  if (stelle !== null && (!Number.isInteger(stelle) || stelle < 0 || stelle > 5)) {
    throw new GiudizioNonValido(`le stelle vanno da 0 a 5, ricevuto ${stelle}`);
  }
  const colore = (g.colore ?? null) as Colore | null;
  if (colore !== null && !COLORI.includes(colore)) {
    throw new GiudizioNonValido(`colore sconosciuto: ${colore}`);
  }
  return { stelle, colore };
}

/** Assegna un giudizio a uno scatto. Il file originale non viene toccato. */
export function giudica(photoId: string, g: Partial<Giudizio>): Giudizio {
  const v = validaGiudizio(g);
  const d = db();
  const r = d
    .prepare(
      `UPDATE photos SET culling_stelle = ?, culling_colore = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(v.stelle, v.colore, Date.now(), photoId);
  if (r.changes === 0) throw new GiudizioNonValido(`foto sconosciuta: ${photoId}`);
  return v;
}

export type Rendiconto = {
  totale: number;
  tenuti: number;
  scartati: number;
  nonGiudicati: number;
  perColore: Record<string, number>;
  perStelle: Record<string, number>;
};

/**
 * Il conto di fine lavoro.
 *
 * «Tenuto» è uno scatto con almeno una stella o un'etichetta; «scartato» è uno
 * guardato e messo a zero stelle. I tre numeri più i non giudicati fanno il totale,
 * sempre: un rendiconto che non torna non è un rendiconto.
 */
export function rendiconto(): Rendiconto {
  const d = db();
  const righe = d
    .query<{ stelle: number | null; colore: string | null; n: number }, []>(
      `SELECT culling_stelle AS stelle, culling_colore AS colore, COUNT(*) AS n
       FROM photos GROUP BY culling_stelle, culling_colore`,
    )
    .all();

  const r: Rendiconto = {
    totale: 0,
    tenuti: 0,
    scartati: 0,
    nonGiudicati: 0,
    perColore: {},
    perStelle: {},
  };
  for (const riga of righe) {
    r.totale += riga.n;
    const giudicata = riga.stelle !== null || riga.colore !== null;
    if (!giudicata) r.nonGiudicati += riga.n;
    else if ((riga.stelle ?? 0) > 0 || riga.colore !== null) r.tenuti += riga.n;
    else r.scartati += riga.n;

    if (riga.colore) r.perColore[riga.colore] = (r.perColore[riga.colore] ?? 0) + riga.n;
    const chiave = riga.stelle === null ? "nessuna" : String(riga.stelle);
    r.perStelle[chiave] = (r.perStelle[chiave] ?? 0) + riga.n;
  }
  return r;
}

// ---- Sidecar -------------------------------------------------------------

export type RigaPiano = {
  photoId: string;
  file: string;
  sidecar: string;
  esisteva: boolean;
  cambia: boolean;
  errore?: string;
};

export type PianoSidecar = {
  righe: RigaPiano[];
  /** Quanti file verranno scritti davvero. */
  daScrivere: number;
  /** Le cartelle toccate: si dichiarano prima, non dopo. */
  cartelle: string[];
};

function fotoGiudicate(photoIds?: string[]): PhotoRow[] {
  const d = db();
  if (photoIds?.length) {
    const segni = photoIds.map(() => "?").join(",");
    return d
      .query<PhotoRow, string[]>(`SELECT * FROM photos WHERE id IN (${segni})`)
      .all(...photoIds);
  }
  return d
    .query<PhotoRow, []>(
      `SELECT * FROM photos
       WHERE culling_stelle IS NOT NULL OR culling_colore IS NOT NULL`,
    )
    .all();
}

/**
 * Cosa farebbe la scrittura dei sidecar, senza farla.
 *
 * Va chiamata prima di `scriviSidecar` e mostrata a chi decide: i sidecar finiscono
 * nella cartella di lavoro di un cliente, accanto ai suoi RAW, e quante volte e dove
 * non è una cosa da scoprire dopo.
 */
export async function pianificaSidecar(
  photoIds?: string[],
  vocabolario = "it",
): Promise<PianoSidecar> {
  const foto = fotoGiudicate(photoIds);
  const righe: RigaPiano[] = [];
  const cartelle = new Set<string>();

  for (const f of foto) {
    try {
      const p = await motore.xmpPianifica(
        f.original_path,
        { stelle: f.culling_stelle, colore: f.culling_colore },
        vocabolario,
      );
      righe.push({
        photoId: f.id,
        file: f.original_path,
        sidecar: p.sidecar,
        esisteva: p.esisteva,
        cambia: p.cambia,
      });
      if (p.cambia) cartelle.add(p.sidecar.replace(/\/[^/]*$/, ""));
    } catch (e) {
      righe.push({
        photoId: f.id,
        file: f.original_path,
        sidecar: "",
        esisteva: false,
        cambia: false,
        errore: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return {
    righe,
    daScrivere: righe.filter((r) => r.cambia).length,
    cartelle: [...cartelle].sort(),
  };
}

export type EsitoSidecar = {
  scritti: number;
  invariati: number;
  falliti: { photoId: string; errore: string }[];
};

/**
 * Scrive i sidecar. Per ciascuno: copia di sicurezza, modifica del solo campo che ci
 * riguarda, sostituzione atomica. Un file che direbbe già quello che stiamo per
 * scrivergli non viene riscritto, così la sua data non mente a chi guarda la cartella.
 */
export async function scriviSidecar(
  photoIds?: string[],
  vocabolario = "it",
): Promise<EsitoSidecar> {
  const foto = fotoGiudicate(photoIds);
  const esito: EsitoSidecar = { scritti: 0, invariati: 0, falliti: [] };

  for (const f of foto) {
    try {
      const p = await motore.xmpScrivi(
        f.original_path,
        { stelle: f.culling_stelle, colore: f.culling_colore },
        vocabolario,
      );
      if (p.cambia) esito.scritti++;
      else esito.invariati++;
    } catch (e) {
      esito.falliti.push({
        photoId: f.id,
        errore: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return esito;
}

// ---- Raffiche ------------------------------------------------------------

/**
 * Le soglie del raggruppamento.
 *
 * Sono valori di partenza, **non tarati su un materiale reale**: chi li ha misurati
 * prima di noi lo ha fatto su un archivio da 706 scatti che non abbiamo. Vanno
 * verificati con `rendicontoGruppi` su una cartella vera prima di fidarsene, ed è il
 * motivo per cui stanno qui in chiaro e non sparsi nel codice.
 */
export const SOGLIE = {
  /** Bit di differenza fra due impronte consecutive perché siano la stessa scena. */
  strutturaPasso: 10,
  /** Scarto massimo su un canale della griglia colore, fra consecutive. */
  colorePasso: 14,
  /** Deriva massima accumulata rispetto al primo scatto del gruppo. */
  strutturaDeriva: 18,
  coloreDeriva: 26,
  /** Oltre questo intervallo due scatti non sono una raffica, per quanto simili. */
  secondiMassimi: 8,
};

function distanzaBit(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function distanzaColore(a: number[], b: number[]): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (d > max) max = d;
  }
  return max;
}

type ConFirma = {
  id: string;
  path: string;
  quando: number;
  struttura: bigint;
  colore: number[];
  nitidezza: number;
};

/** Calcola e memorizza le firme mancanti. È il passo caro, e si fa una volta sola. */
export async function calcolaFirme(): Promise<{ calcolate: number; fallite: number }> {
  const d = db();
  const mancanti = d
    .query<{ id: string; original_path: string }, []>(
      `SELECT id, original_path FROM photos WHERE firma_struttura IS NULL`,
    )
    .all();

  const aggiorna = d.prepare(
    `UPDATE photos SET firma_struttura = ?, firma_colore = ?, firma_nitidezza = ?
     WHERE id = ?`,
  );
  let calcolate = 0;
  let fallite = 0;
  for (const f of mancanti) {
    try {
      const s = await motore.firma(f.original_path);
      aggiorna.run(s.struttura.toString(), JSON.stringify(s.colore), s.nitidezza, f.id);
      calcolate++;
    } catch {
      // Uno scatto illeggibile non ferma gli altri: verrà segnalato dalla griglia.
      fallite++;
    }
  }
  return { calcolate, fallite };
}

/**
 * Raggruppa gli scatti consecutivi della stessa raffica.
 *
 * Due confronti e non uno: quello col precedente dice se la scena è la stessa adesso,
 * quello col primo del gruppo dice se ci si è allontanati camminando. Senza il secondo
 * una panoramica lenta diventa un gruppo solo, perché ogni passo somiglia al passo
 * prima.
 *
 * Le correzioni fatte a mano non vengono toccate: l'algoritmo può sbagliare, chi
 * guarda no.
 */
export function raggruppa(): { gruppi: number; scatti: number; manualiRispettate: number } {
  const d = db();
  const foto = d
    .query<
      {
        id: string;
        original_path: string;
        taken_at: number | null;
        created_at: number;
        firma_struttura: string | null;
        firma_colore: string | null;
        firma_nitidezza: number | null;
        culling_gruppo_manuale: number;
      },
      []
    >(
      `SELECT id, original_path, taken_at, created_at, firma_struttura, firma_colore,
              firma_nitidezza, culling_gruppo_manuale
       FROM photos WHERE firma_struttura IS NOT NULL
       ORDER BY COALESCE(taken_at, created_at), id`,
    )
    .all();

  const conFirma: ConFirma[] = foto
    .filter((f) => !f.culling_gruppo_manuale)
    .map((f) => ({
      id: f.id,
      path: f.original_path,
      quando: (f.taken_at ?? f.created_at) / 1000,
      struttura: BigInt(f.firma_struttura!),
      colore: JSON.parse(f.firma_colore ?? "[]") as number[],
      nitidezza: f.firma_nitidezza ?? 0,
    }));
  const manualiRispettate = foto.length - conFirma.length;

  const aggiorna = d.prepare(
    `UPDATE photos SET culling_gruppo = ?, culling_primaria = ? WHERE id = ?`,
  );

  let gruppi = 0;
  d.run("BEGIN");
  try {
    let i = 0;
    while (i < conFirma.length) {
      const testa = conFirma[i]!;
      const membri = [testa];
      let j = i + 1;
      while (j < conFirma.length) {
        const prec = conFirma[j - 1]!;
        const corr = conFirma[j]!;
        const vicini = Math.abs(corr.quando - prec.quando) <= SOGLIE.secondiMassimi;
        const passo =
          distanzaBit(corr.struttura, prec.struttura) <= SOGLIE.strutturaPasso &&
          distanzaColore(corr.colore, prec.colore) <= SOGLIE.colorePasso;
        const deriva =
          distanzaBit(corr.struttura, testa.struttura) <= SOGLIE.strutturaDeriva &&
          distanzaColore(corr.colore, testa.colore) <= SOGLIE.coloreDeriva;
        if (!vicini || !passo || !deriva) break;
        membri.push(corr);
        j++;
      }

      // Un gruppo di uno non è un gruppo: non merita un identificatore.
      const idGruppo = membri.length > 1 ? `g_${testa.id}` : null;
      if (idGruppo) gruppi++;
      for (const m of membri) {
        // La primaria è la prima della catena. È stato provato un criterio più
        // intelligente — la più nitida, il volto migliore — e misurato peggio del
        // caso: indovinava lo scatto scelto dal fotografo nel 32% dei casi contro
        // il 34% di una scelta a sorte.
        aggiorna.run(idGruppo, m === testa && idGruppo ? 1 : 0, m.id);
      }
      i = j;
    }
    d.run("COMMIT");
  } catch (e) {
    d.run("ROLLBACK");
    throw e;
  }
  return { gruppi, scatti: conFirma.length, manualiRispettate };
}

/**
 * Sposta uno scatto fuori dal suo gruppo, o dentro un altro, e marca la decisione
 * come umana perché un nuovo giro dell'algoritmo non la cancelli.
 */
export function correggiGruppo(photoId: string, gruppo: string | null): void {
  const d = db();
  const r = d
    .prepare(
      `UPDATE photos SET culling_gruppo = ?, culling_gruppo_manuale = 1, updated_at = ?
       WHERE id = ?`,
    )
    .run(gruppo, Date.now(), photoId);
  if (r.changes === 0) throw new GiudizioNonValido(`foto sconosciuta: ${photoId}`);
}
