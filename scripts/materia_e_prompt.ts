/**
 * Materia con la luce alta E prompt ripulito: le due meta' insieme.
 *
 * PERCHE' ESISTE: PER CORREGGERE UN MIO ERRORE DI METODO, non per provare una
 * frase nuova. Il giro di v137/v138 ha cambiato la materia dell'edit (una sua
 * foto vera gia' illuminata dall'alto, +15,3) tenendo "il prompt di v128 parola
 * per parola" — scritto nello script come garanzia che cambiasse UNA cosa sola.
 * Era una garanzia sbagliata: quel prompt ORDINA il difetto che stavo misurando.
 * Parole sue, dentro il blocco della luce:
 *
 *     "un riflesso ciano freddo che prende ... LA MASCELLA DA SOTTO"
 *     "la luce principale e' ... alta e APPENA A SINISTRA"
 *
 * Cioe' l'esperimento chiedeva luce sulla mascella dal basso e di lato, ed e'
 * esattamente quello che ho misurato in uscita. Tenere fermo un prompt che
 * contiene la variabile non e' tenere fermo niente: e' confondere l'esperimento.
 * Il risultato di v137/v138 resta valido come SEGNO (la materia da sola sposta
 * la direzione di +6,4) ma il suo valore assoluto non dice quanto vale la leva.
 *
 * DOVE SIAMO, in numeri (alto-basso: fronte meno mento, positivo = luce alta):
 *
 *     reference                 +19,8   il bersaglio
 *     io-luce-alta.jpeg         +15,3   la materia nuova, sua foto vera
 *     v128  materia vecchia, prompt sporco    -12,6
 *     v137  materia NUOVA,   prompt sporco     -8,0   +4,6
 *     v138  materia NUOVA,   prompt sporco     -6,2   +6,4   (con preambolo)
 *     ---
 *     questo giro: materia NUOVA + prompt PULITO = mai fatto
 *
 * La direzione del movimento e' giusta e monotona, il che rende questo giro
 * l'unico che vale la pena: le due meta' spingono dalla stessa parte e finora
 * non hanno mai spinto insieme.
 *
 * COSA CAMBIA ESATTAMENTE, due sostituzioni chirurgiche sul prompt di v128:
 *
 *   1. Il riflesso ciano non prende piu' la mascella DA SOTTO. Resta sulle
 *      spalle e sul collo — li' e' la firma della lampada nel fondale, e nella
 *      reference c'e' — ma il viso lo illumina solo la chiave.
 *
 *   2. La chiave non e' piu' "alta e appena a sinistra": e' DAVANTI e PIU' IN
 *      ALTO DEGLI OCCHI, detta come RELAZIONE fra due zone della faccia
 *      ("fronte e zigomi sono le parti piu' chiare, mento e sottomento le piu'
 *      scure"), che e' la forma con cui lo stacco soggetto/fondo e' passato da
 *      -1,1 a +21,5 quando gli aggettivi non lo muovevano. Un aggettivo
 *      ("frontale") il modello lo media con quello che vede; una relazione fra
 *      due parti della stessa faccia o e' vera o e' falsa.
 *
 * QUELLO CHE NON TOCCO: fondo, colore, occhiali, corporatura, maglia,
 * inquadratura, 35mm. Sono gia' a bersaglio su v128 (ciano 24,0% contro 26,7%,
 * stacco 21,0 contro 21,2) e ogni riga che cambio qui e' una variabile in piu'
 * da spiegare se il risultato peggiora.
 *
 * CANCELLO: alto-basso > 0. Non "meglio di prima": il segno deve invertirsi,
 * perche' negativo vuol dire che il mento e' piu' chiaro della fronte — la
 * faccia illuminata da sotto, che e' il difetto che l'utente vede da giorni e
 * chiama "non e' frontale". Sotto zero non consegno, qualunque sia il
 * miglioramento.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const BASE = 128;
const MATERIA = "io-luce-alta.jpeg";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const giri = Number(arg("--giri") ?? 2);

/** Le due sostituzioni. Se una non aggancia, il giro si ferma: un prompt
 *  mezzo ripulito e' peggio di nessun esperimento, perche' produce un numero
 *  che non so a cosa attribuire. */
const CHIRURGIA: Array<[string, string]> = [
  [
    "un riflesso ciano freddo che prende il bordo delle spalle, la mascella da sotto e il lato in ombra del collo.",
    "un riflesso ciano freddo che prende il bordo delle spalle e il lato in ombra del collo. " +
      "Sul VISO quel riflesso non arriva: la faccia la illumina soltanto la luce principale, da davanti.",
  ],
  [
    "La luce principale e' UNA sorgente sola, dura, alta e appena a sinistra, quasi frontale: " +
      "scolpisce gli zigomi e lascia sotto la mascella un'ombra netta e disegnata.",
    "La luce principale e' UNA sorgente sola, piazzata DAVANTI A ME e PIU' IN ALTO DEI MIEI OCCHI, " +
      "puntata dritta sulla faccia. Si riconosce da questa relazione, che deve essere vera guardando " +
      "il risultato: la FRONTE e gli ZIGOMI sono le parti PIU' CHIARE di tutto il viso, il MENTO e la " +
      "pelle SOTTO il mento sono le PIU' SCURE. Sotto il naso e sotto il labbro inferiore cade una " +
      "piccola ombra rivolta verso il BASSO. Sotto il mento NON arriva nessuna luce.",
  ],
];

async function main() {
  await withProject(PROGETTO, async () => {
    initSchema();
    const D = dirsFor(PROGETTO).DATA_DIR;
    const materia = join(D, "RAW", MATERIA);
    const refs = [
      join(D, "RAW", "1.PNG"),
      join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
      join(D, "refs", "bocca-reale.png"),
      join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    ];
    for (const p of refs) if (!existsSync(p)) throw new Error(`manca: ${p}`);
    if (!existsSync(materia)) throw new Error(`materia mancante: ${materia}`);

    const base = db()
      .query<{ prompt_used: string }, [string, number]>(
        "select prompt_used from versions where photo_id=? and version_number=?",
      )
      .get(PHOTO, BASE);
    if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

    let prompt = base.prompt_used;
    for (const [vecchio, nuovo] of CHIRURGIA) {
      if (!prompt.includes(vecchio)) {
        throw new Error(`ancora non trovata nel prompt di v${BASE}: "${vecchio.slice(0, 60)}…"`);
      }
      prompt = prompt.replace(vecchio, nuovo);
    }

    // Verifica esplicita: le frasi che ordinavano il difetto non ci sono piu'.
    for (const vietata of ["mascella da sotto", "appena a sinistra"]) {
      if (prompt.toLowerCase().includes(vietata)) throw new Error(`frase ancora presente: ${vietata}`);
    }

    for (let g = 1; g <= giri; g++) {
      const job = enqueueJob(
        PHOTO,
        prompt,
        null,
        "chatgpt",
        null,
        "edit",
        materia,
        JSON.stringify(refs),
        JSON.stringify({
          recipe: "materia+prompt-pulito",
          materia: MATERIA,
          base: `v${BASE}`,
          cambiato:
            "riflesso ciano via dalla mascella · chiave davanti e sopra gli occhi, detta come relazione",
          refs: refs.map((r) => r.split("/").pop()),
          misura: "key_direction: alto-basso SOPRA ZERO (ref +19,8 · v137 -8,0 · v138 -6,2)",
          giro: g,
        }),
        "cdp",
      );
      console.log(`[pulito] job ${job.id}  giro ${g}`);
    }
  });
}

await main();
