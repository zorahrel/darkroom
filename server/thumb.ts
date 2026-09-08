import { spawn } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import * as motore from "./core.ts";
import {
  livelloPer,
  percorsoCache,
  sfrattaTutti,
  type NomeLivello,
} from "./anteprime.ts";

/**
 * I formati che il motore nativo non sa ancora aprire da solo.
 *
 * Per questi si ricade su `sips`, che è lento ma su macOS c'è sempre. Non è una
 * scorciatoia lasciata indietro: è il confine dichiarato di ciò che il motore copre
 * oggi, e si restringe man mano che il motore cresce. Sui RAW, dove la lentezza
 * costava un'ora su duemila scatti, `sips` non passa più.
 */
const FUORI_DAL_MOTORE = new Set([".heic", ".heif", ".webp", ".gif", ".bmp", ".avif"]);

/**
 * Oltre questo livello si accetta di pagare la decodifica piena di un RAW.
 *
 * Sotto, l'anteprima incorporata basta sempre, e pagare 868 ms per una cella di
 * griglia sarebbe regalare un secondo a foto su una vista che ne mostra duecento.
 */
const LIVELLI_CON_DECODIFICA: NomeLivello[] = ["visore", "nativo"];

/**
 * Ogni quante anteprime nuove si controlla il budget della cache.
 *
 * Non a ogni scrittura: contare ottomila file per scriverne uno costerebbe più
 * dell'anteprima. Non una volta all'avvio: una sessione lunga non finirebbe mai di
 * crescere. Duecento è circa una griglia piena, quindi il conto si paga una volta per
 * cartella guardata.
 */
const OGNI_QUANTE_SI_SFRATTA = 200;
let generate = 0;

/**
 * Genera un'anteprima al livello che copre la larghezza richiesta, tenuta in cache
 * su disco. Restituisce il percorso assoluto dell'anteprima.
 *
 * Il lavoro lo fa il motore nativo, che legge il JPEG già scritto dalla fotocamera
 * dentro il RAW invece di ricostruirlo: 2,1 ms per foto in parallelo contro i 1859
 * di `sips`, misurati su 85 Sony ARW da 47 MB.
 */
export async function thumbnailPath(
  source: string,
  maxDim = 480,
): Promise<string> {
  if (!existsSync(source)) throw new Error(`source missing: ${source}`);

  const livello = livelloPer(maxDim);
  const cachePath = percorsoCache(source, livello.nome);
  if (existsSync(cachePath)) return cachePath;
  mkdirSync(dirname(cachePath), { recursive: true });

  const ext = extname(source).toLowerCase();
  if (!FUORI_DAL_MOTORE.has(ext) && motore.motoreDisponibile()) {
    try {
      await motore.anteprima(source, livello.lato, cachePath, {
        consentiDecodifica: LIVELLI_CON_DECODIFICA.includes(livello.nome),
      });
      forseSfratta();
      return cachePath;
    } catch (e) {
      // Un formato che il motore non conosce non è un guasto: si prova l'altra strada.
      // Un file rotto invece è una notizia, e va detta a chi ha chiamato.
      if (!motore.formatoNonSupportato(e)) throw e;
    }
  }

  const p = await conSips(source, livello.lato, cachePath);
  forseSfratta();
  return p;
}

function forseSfratta() {
  if (++generate % OGNI_QUANTE_SI_SFRATTA === 0) {
    try {
      sfrattaTutti();
    } catch {
      // Una cache che non si riesce a potare resta grande: è un fastidio, non un guasto.
    }
  }
}

/** La vecchia strada, tenuta solo per i formati che il motore non copre. */
async function conSips(source: string, maxDim: number, cachePath: string): Promise<string> {
  const proc = spawn({
    cmd: [
      "sips",
      "-Z", String(maxDim),
      "-s", "format", "jpeg",
      "-s", "formatOptions", "high",
      source, "--out", cachePath,
    ],
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`sips failed (${code}): ${err}`);
  }
  return cachePath;
}
