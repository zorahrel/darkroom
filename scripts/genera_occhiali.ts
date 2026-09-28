/**
 * Gli occhiali da indossare nella foto profilo, fatti prima come oggetto a se'.
 *
 * L'UTENTE, 28/09, su v238: «facciamo prima gli occhiali? quelli prima andavano
 * bene, solo dovevano essere un po' piu' curvi sul volto». Quelli di prima sono
 * i Gascan neri lucidi (refs/occhiali-gascan-nero.jpg): lenti rettangolari
 * fumé, aste spesse, cerniera a incastro. Il difetto e' il frontale quasi
 * dritto, mentre nella reference la maschera gira attorno al viso.
 *
 * Quindi: stesso design dei Gascan, cambia SOLO la curvatura. Il ritaglio
 * degli occhiali della reference e' allegato solo per mostrare quanto devono
 * avvolgere, non per la forma, il colore o lo spessore.
 *
 * Esito: il risultato migliore si copia in refs/ come
 * `occhiali-gascan-curvi.png` con ruolo `accessorio`.
 */
import { join } from "node:path";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";
import { enqueueJob } from "../server/jobs.ts";

const PROMPT = `Fotografia prodotto di un paio di occhiali da sole con lo STESSO IDENTICO design di quelli nella PRIMA immagine allegata: montatura in acetato NERO LUCIDO, lenti rettangolari fumé scure, frontale spesso e squadrato, aste larghe e piatte, stessa cerniera a incastro, stessi spessori. Nessun logo, nessuna scritta.

L'UNICA DIFFERENZA e' la CURVATURA: questi sono molto piu' AVVOLGENTI. Il frontale non e' dritto ma curvato attorno al viso come una maschera: visto dall'alto disegna un arco a C, e le estremita' esterne delle lenti girano all'indietro verso le tempie, fin quasi di lato. Anche le lenti sono curve, seguono lo stesso arco. Le aste partono piu' indietro, gia' di lato, cosi' l'occhiale fascia il volto da tempia a tempia. La SECONDA immagine allegata serve SOLO a mostrare quanto avvolge una maschera: prendi da li' la curvatura, NON il colore, NON la forma delle lenti, NON lo spessore.

PRESENTAZIONE: gli occhiali sono aperti, appoggiati su una superficie bianca, visti di tre quarti dal davanti e un poco dall'alto, cosi' si legge bene quanto il frontale curva. Sfondo da studio bianco uniforme, luce morbida da still life che fa brillare il nero lucido con riflessi lunghi sulla montatura.

Formato quadrato 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject("profilo", () => {
  initSchema();
  const D = dirsFor("profilo").DATA_DIR;
  const refs = [join(D, "refs", "occhiali-gascan-nero.jpg"), join(D, "refs", "occhiali-forma-reference.png")];
  const now = Date.now();
  for (let g = 1; g <= giri; g++) {
    // Una riga in galleria come ogni generazione da zero: il risultato si
    // vede in Darkroom con i suoi allegati e il suo prompt.
    const id = `gen_${now}_occhiali_${g}`;
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
        recipe: "occhiali-gascan-curvi",
        refs: refs.map((r) => r.split("/").pop()),
        scopo: "Gascan neri lucidi con piu' curvatura avvolgente (utente: quelli di prima andavano bene, solo piu' curvi sul volto)",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[occhiali] job ${job.id}  foto ${id}`);
  }
});
