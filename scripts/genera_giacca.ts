/**
 * La giacca da indossare nella foto profilo, fatta prima come oggetto a se'.
 *
 * L'UTENTE, 25/09, allegando una felpa grigia a mezza zip: «metti questa giacca
 * ma nera con il logo Armonia. Se ti serve falla prima e taggala come
 * accessorio».
 *
 * PERCHE' PRIMA A PARTE. Chiedere nello stesso tiro «vestimi con questa felpa,
 * ma nera, e cambiale il logo» somma tre richieste sulla stessa passata che
 * deve gia' tenere viso, bocca, occhiali e luce. Una felpa gia' nera e gia'
 * col logo giusto, allegata come ACCESSORIO, e' un fatto da copiare invece di
 * una trasformazione da inventare: e' la stessa lezione degli occhiali, che
 * escono fedeli perche' allegati come sono, non descritti.
 *
 * Allegati: la felpa originale (forma, zip, costine) e il SIMBOLO Armonia
 * (la spirale, senza scritta: il logo originale e' un piccolo marchio sul
 * petto, e una scritta intera li' cambierebbe il capo).
 *
 * Esito: il risultato migliore si copia in refs/ come
 * `giacca-armonia-nera.png` con ruolo `accessorio`.
 */
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";
import { enqueueJob } from "../server/jobs.ts";

const PROMPT = `Fotografia prodotto di una felpa, con la stessa identica forma di quella nella PRIMA immagine allegata: mezza zip con collo alto a lupetto, zip con il suo cursore, maniche lunghe, polsini e orlo a costine, stessa vestibilita' e stesse proporzioni, stesse cuciture.

COLORE: NERO profondo e uniforme, cotone felpato opaco con la sua trama fine visibile. Anche la zip e' NERA OPACA, denti e cursore neri, tono su tono: il capo e' tutto nero.

LOGO: sul petto, nello stesso punto e alla stessa dimensione del piccolo logo della prima immagine, c'e' il SIMBOLO della SECONDA immagine allegata (solo la spirale, nessuna scritta), ricamato TONO SU TONO in filo nero lucido: piccolo e discreto, si legge solo per il leggero rilievo e la lucentezza del filo. Il simbolo e' DRITTO: stesso orientamento esatto della seconda immagine, nessuna rotazione, centrato orizzontalmente sotto il cursore della zip, piatto sul tessuto senza pieghe che lo deformino.

PRESENTAZIONE: la felpa e' indossata da un manichino invisibile (ghost mannequin), vista di fronte, intera dal collo all'orlo, dritta e simmetrica, con il collo leggermente aperto. Sfondo da studio grigio chiaro uniforme. Luce morbida e uniforme da still life, che mostra bene il nero del tessuto e il rilievo del ricamo.

Formato verticale 4:5.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject("profilo", () => {
  initSchema();
  const D = dirsFor("profilo").DATA_DIR;
  const refs = [join(D, "refs", "giacca-grigia-originale.png"), join(D, "refs", "logo-armonia-simbolo.png")];
  const now = Date.now();
  for (let g = 1; g <= giri; g++) {
    // Una riga in galleria come ogni generazione da zero: il risultato si
    // vede in Darkroom con i suoi allegati e il suo prompt.
    const id = `gen_${now}_giaccav3_${g}`;
    db().run(
      `INSERT INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
       VALUES (?, '', '.png', 'generated', ?, ?)`,
      [id, now, now],
    );
    const job = enqueueJob(
      id,
      PROMPT,
      null,
      "chatgpt",
      null,
      "generate",
      null,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: "giacca-armonia-nera-v2",
        refs: refs.map((r) => r.split("/").pop()),
        scopo: "felpa tutta nera: zip nera opaca e simbolo Armonia ricamato tono su tono (utente: zip bianca brutta, logo non serve che si veda)",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[giacca] job ${job.id}  foto ${id}`);
  }
});
