/**
 * Una passata che cambia SOLO da dove viene la luce, su un render finito.
 *
 * PERCHE' QUESTA E' DIVERSA DALLE ALTRE SEDICI, e non un'altra frase.
 *
 * La causa del difetto e' misurata e non e' opinabile. `key_direction.py` legge
 * quanto la fronte e' piu' chiara del mento:
 *
 *     reference (studio)      +19,8   lampada in alto, davanti
 *     RAW/1.PNG (lui)          -3,8   dal basso
 *     RAW/56E4… (lui)         -11,8   dal basso
 *     ogni render dal v94      -8 … -18
 *
 * Le sue due foto sono illuminate dal basso, e OGNI generazione finora ha
 * avuto almeno una di quelle due allegata: e' da li' che il modello prende la
 * luce, non dal prompt. Sedici tiri su sei meccanismi diversi (descriverla,
 * temperatura, reverse prompt, reference come materia, togliere le frasi
 * colpevoli, reference col ruolo di campione) non hanno mosso quel numero di
 * un punto, e nessuno poteva: la fonte del difetto era allegata ogni volta.
 *
 * L'unica via che lo toglie e' generare senza quelle foto — e li' si perde la
 * somiglianza (v124 e v126, `generate` senza sorgente: capelli ricci, occhiali
 * diversi, "non sei tu").
 *
 * QUI LA SOMIGLIANZA NON VIENE DA UN ALLEGATO: viene dall'immagine di
 * PARTENZA, che e' gia' lui. v128 ha identita', occhiali, fondo, colore e
 * stacco giusti — l'unica cosa sbagliata e' la luce. Quindi:
 *
 *     materia   = v128, il render finito (porta l'identita')
 *     allegati  = SOLO la reference (porta la direzione della luce)
 *     prompt    = una cosa sola, cambia da dove viene la luce
 *
 * Nessuna foto illuminata dal basso entra nel giro. E' la prima volta.
 *
 * IL RISCHIO, detto prima: un edit che tiene la faccia e rifa' la luce puo'
 * anche non fare niente. E' gia' successo: `mouth_pass.ts` (una passata locale
 * sulla bocca di un render finito) si e' presa indietro la stessa immagine,
 * differenza media 3,2 livelli su 255 — il guard l'ha chiamata "unedited" e
 * aveva ragione. La differenza e' che li' la modifica era minuscola (una
 * bocca), qui e' l'illuminazione di tutto il viso: se anche stavolta torna
 * identica, il meccanismo "correggere un render finito" e' falsificato per
 * qualunque cosa, e lo scatto resta l'unica strada.
 *
 * CANCELLO: alto-basso > 0 sul viso. Non +19,8 — il bersaglio letterale della
 * reference su questo progetto ha gia' prodotto due volte un risultato
 * misurato-giusto e visibilmente sbagliato (la pelle a croma 13,4 esce
 * verdastra; le alte luci a a* -7,1 escono da cadavere). Sopra zero vuol dire
 * che la fronte e' piu' chiara del mento: il segno, che e' cio' che l'occhio
 * legge come "faretto dall'alto". Se il segno non si inverte, e' negativo.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** Il render di partenza: identita', occhiali, fondo e colore gia' giusti. */
const BASE = 128;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Math.max(1, Number(arg("--giri") ?? 2));

/**
 * Il prompt dice UNA cosa. Ogni riga in piu' e' una variabile che non sto
 * misurando, e su questo progetto le righe di contorno hanno gia' ordinato
 * tre volte il difetto che stavo inseguendo ("pelle OPACA" -> pallido, "la
 * mascella da sotto" -> luce dal basso, "spalle cadenti" -> postura curva).
 *
 * La direzione e' detta come RELAZIONE fra due parti del viso, non con un
 * aggettivo: e' la forma che ha funzionato per lo stacco viso/fondo (da -1,1 a
 * +21,5) quando "fondo piu' scuro" da solo non muoveva niente. Un aggettivo
 * lo interpreta, una relazione fra due zone la puo' verificare da solo.
 */
const PROMPT = [
  "Questa fotografia sono io e va tenuta identica: stesso viso, stessi",
  "occhiali da sole, stessi capelli, stesso capo, stesso fondo, stessa",
  "inquadratura, stessi colori. NON ridisegnare la faccia.",
  "",
  "CAMBIA SOLO DA DOVE ARRIVA LA LUCE. Adesso la sorgente e' bassa e mi",
  "illumina il mento e la mascella da sotto. Deve stare IN ALTO e DAVANTI a",
  "me, come nella seconda immagine allegata: un softbox appeso sopra la",
  "macchina, puntato giu' verso il viso.",
  "",
  "Come si vede che e' cosi', e sono le uniche due cose da controllare:",
  "1. la FRONTE e' la zona piu' chiara del viso, nettamente piu' chiara del",
  "   mento — non il contrario;",
  "2. sotto il naso, sotto il labbro e sotto il mento c'e' una piccola ombra",
  "   che cade VERSO IL BASSO, perche' la luce viene da sopra.",
  "",
  "La seconda immagine allegata serve SOLO per questo: guarda come le cade",
  "la luce in faccia e mettila uguale sulla mia. Non e' il mio viso, non e'",
  "il mio fondo, non e' il mio colore: di quella immagine si prende la",
  "direzione della luce e nient'altro.",
].join("\n");

await withProject(PID, async () => {
  initSchema(db());
  const { DATA_DIR } = dirsFor(PID);
  const materia = join(DATA_DIR, "generations", "1", `v${BASE}.png`);
  const luce = join(DATA_DIR, "refs", "luce-bg-studio-blu.png");

  for (const p of [materia, luce]) {
    if (!existsSync(p)) throw new Error(`manca: ${p}`);
  }

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      PHOTO,
      PROMPT,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify([luce]),
      JSON.stringify({
        recipe: "relight-pass",
        materia: `v${BASE}`,
        refs: ["luce-bg-studio-blu.png"],
        nota: "nessuna foto illuminata dal basso nel giro: l'identita' viene dalla materia",
      }),
      "cdp",
    );
    console.log(`[relight] job ${job.id}  da v${BASE}  giro ${g}`);
  }
});
