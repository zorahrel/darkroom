import { spawn } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { ROOT } from "./db.ts";
import * as motore from "./core.ts";

const CACHE_ROOT = join(ROOT, "dashboard", ".cache", "thumbs");

/**
 * I formati che il motore nativo non sa ancora aprire da solo.
 *
 * Per questi si ricade su `sips`, che è lento ma su macOS c'è sempre. Non è una
 * scorciatoia lasciata indietro: è il confine dichiarato di ciò che il motore copre
 * oggi, e si restringe man mano che il motore cresce. Sui RAW, dove la lentezza
 * costava un'ora su duemila scatti, `sips` non passa più.
 */
const FUORI_DAL_MOTORE = new Set([".heic", ".heif", ".webp", ".gif", ".bmp", ".avif"]);

/** Oltre questo lato lungo si accetta di pagare la decodifica piena di un RAW. */
const SOGLIA_DECODIFICA_PIENA = 1024;

function percorsoCache(source: string, maxDim: number): string {
  // La chiave contiene dimensione e data del sorgente: un file sostituito non
  // eredita l'anteprima di quello di prima.
  const st = statSync(source);
  const safe = source.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(
    CACHE_ROOT,
    String(maxDim),
    `${st.size}_${Math.floor(st.mtimeMs)}_${safe}.jpg`,
  );
}

/**
 * Genera un'anteprima al lato lungo richiesto, tenuta in cache su disco.
 * Restituisce il percorso assoluto dell'anteprima.
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

  const cachePath = percorsoCache(source, maxDim);
  if (existsSync(cachePath)) return cachePath;
  mkdirSync(dirname(cachePath), { recursive: true });

  const ext = extname(source).toLowerCase();
  if (!FUORI_DAL_MOTORE.has(ext) && motore.motoreDisponibile()) {
    try {
      await motore.anteprima(source, maxDim, cachePath, {
        // Sotto la soglia l'anteprima incorporata basta sempre, e pagare una
        // decodifica piena per una cella di griglia sarebbe regalare un secondo a foto.
        consentiDecodifica: maxDim > SOGLIA_DECODIFICA_PIENA,
      });
      return cachePath;
    } catch (e) {
      // Un formato che il motore non conosce non è un guasto: si prova l'altra strada.
      // Un file rotto invece è una notizia, e va detta a chi ha chiamato.
      if (!motore.formatoNonSupportato(e)) throw e;
    }
  }

  return await conSips(source, maxDim, cachePath);
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
