/**
 * Luce da studio presa da un riferimento, e la bocca vera.
 *
 * DUE DIFETTI, UNA CAUSA SOLA PER CIASCUNO.
 *
 * 1. La bocca. Misurata (`scripts/mouth_check.py`, larghezza della bocca in
 *    frazione della larghezza del viso): nelle foto VERE vale 0,236 (1.PNG) e
 *    0,264 (il selfie 56E4); in OGNI render dal v61 in poi vale 0,29-0,33 —
 *    v61 0,327, v63 0,294, v84 0,309. Sempre la stessa bocca, larga un terzo
 *    di viso invece di un quarto, e identica a quella dell'immagine generata
 *    da ChatGPT che sta in RAW/ (0,315): e' la bocca di default del modello.
 *    Il motivo e' meccanico: alla generazione viene allegata UNA SOLA foto mia,
 *    1.PNG (l'input dell'edit), e in quella la mano copre il mento e la bocca.
 *    Il prompt per giunta ordina "niente mano vicino al viso": il modello
 *    cancella la mano e ridisegna quel pezzo di faccia da zero. La bocca vera
 *    non l'ha mai vista. Il prompt inoltre DICE "le altre immagini allegate
 *    sono ancora io in scatti diversi" mentre gli altri due scatti non sono
 *    mai stati allegati: al modello quella frase indica gli occhiali e il fondo.
 *    Rimedio, lo stesso che ha risolto gli occhiali (per la FORMA le parole non
 *    pagano, l'immagine si': cella C del 05/09): si allega il secondo scatto
 *    vero e un ritaglio ravvicinato naso-bocca-mento a 404 px di bocca, e si
 *    dice "e' ESATTAMENTE quella", senza descriverla.
 *
 * 2. La luce. Richiesta: da studio, presa da un riferimento. Qui non basta
 *    cambiare il blocco: il prompt di v84 chiude con "fotografia vera scattata
 *    da un amico in un posto reale, NON IN STUDIO". Lasciarla mentre si chiede
 *    lo studio ricrea esattamente la contraddizione che il 06/09 aveva prodotto
 *    il fondale finto. Quella riga va riscritta, non aggirata.
 *
 * L'unica variabile fra le celle e' QUALE riferimento di luce si allega:
 *
 *   dura   style-bw-wet-hair-hardlight.png   una sorgente sola, dura, frontale
 *   gel    target-shield-gel-rossoverde.png  due sorgenti dure colorate
 *
 * Il riferimento di luce contiene una persona che non e' l'utente: il blocco
 * dei ruoli lo dichiara esplicitamente, perche' senza quella riga il modello
 * media i volti (visto il 06/09 con il fondo).
 *
 * Uso: bun run scripts/studio_light.ts [--celle dura,gel] [--giri N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** Da qui si copia tutto il resto: identita', 35mm, occhiali, t-shirt. */
const BASE = 84;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));
/**
 * Quale foto e' il MATERIALE dell'edit (l'input), e non solo un riferimento.
 *
 * Misurato il 07/09 sui job 256-259: allegare la bocca vera come RIFERIMENTO
 * non l'ha spostata di un millimetro (v85 0,320 · v86 0,320 · gel 0,309, contro
 * 0,309 di v84 e 0,24-0,26 nelle foto vere). Un riferimento e' un bersaglio da
 * assomigliare, l'input e' la materia da cui il risultato esce — la distinzione
 * e' scritta in worker-codex-http.ts — e l'identita' esce dalla materia. Finche'
 * la materia e' 1.PNG, cioe' la foto con la mano sulla bocca, la bocca resta
 * inventata. `--input 56E4` mette come materia il selfie in cui la bocca si
 * vede intera e larga 404 px.
 */
const inputScelto = arg("--input");

/* ---------------------------------------------------------------- i blocchi */

/** Il posto (fondo ciano) esce di scena: al suo posto la luce da studio. */
const POSTO = /IL POSTO: sono dentro il posto.*?(?=OCCHIALI DA SOLE)/s;

const LUCE_DURA =
  "LA LUCE: ritratto in STUDIO, e sono illuminato ESATTAMENTE come la persona " +
  "dell'ultima immagine allegata. Da quella immagine prendi SOLO la luce: una " +
  "sorgente sola, dura, alta e quasi frontale, che scolpisce gli zigomi e " +
  "lascia sotto la mascella un'ombra netta; il contorno della testa stacca " +
  "chiaro sul fondo; il fondo e' liscio, uniforme, da studio, senza oggetti e " +
  "senza mobili. Di quella persona non prendere il viso, i capelli, la posa " +
  "ne' l'eta': non sono io. ";

const LUCE_GEL =
  "LA LUCE: ritratto in STUDIO con i gel colorati, e sono illuminato " +
  "ESATTAMENTE come la persona dell'ultima immagine allegata. Da quella " +
  "immagine prendi SOLO la luce e i suoi colori: le sorgenti dure colorate che " +
  "arrivano di lato e da dietro, il bordo colorato sul profilo del viso e sulle " +
  "spalle, la stessa dominante sulla pelle nelle zone in ombra, il fondo scuro " +
  "con gli aloni di quel colore. Di quella persona non prendere il viso, i " +
  "capelli, la posa, gli oggetti che indossa ne' l'eta': non sono io. ";

/** La bocca: si allega, non si descrive. Va accanto al blocco anatomico. */
const ANCORA_BOCCA = "IGNORA la posa e le mani delle foto: niente mano vicino al viso.";
const BOCCA =
  ANCORA_BOCCA +
  " LA MIA BOCCA: e' ESATTAMENTE quella del ritaglio ravvicinato allegato " +
  "(naso, bocca e mento, senza occhi). Labbra chiuse e rilassate, niente " +
  "sorriso, niente denti. E' una bocca STRETTA: non allargarmela. " +
  // Il riferimento di luce e' il ritratto di un'altra persona, e il 07/09 il
  // gel rosso-verde le ha passato i capelli: "curly RED hair" nel render del
  // job 257, mentre i miei sono castani. Dichiarare il colore costa una riga
  // e vale in tutte le celle, cosi' la luce resta l'unica variabile.
  "I miei capelli sono CASTANI SCURI e ricci: nessuna immagine allegata puo' " +
  "cambiarmene il colore.";

/** La riga che vietava lo studio, e che ora lo contraddirebbe. */
const NON_IN_STUDIO =
  "Fotografia vera scattata da un amico in un posto reale, non in studio: pori visibili, barba irregolare, pelle non uniforme, lucido sulla fronte.";
const IN_STUDIO =
  "Fotografia vera scattata con una reflex in uno studio: pori visibili, barba " +
  "irregolare, pelle non uniforme, lucido sulla fronte. Non una illustrazione, " +
  "non una pelle levigata, niente ritocco.";

/** I ruoli degli allegati: ora sono cinque, e uno contiene un'altra persona. */
const RUOLI_VECCHI =
  /Due delle immagini allegate NON sono io.*$/s;
const RUOLI =
  "LE IMMAGINI ALLEGATE, e cosa prendere da ognuna. La foto principale e il " +
  "secondo scatto sono IO: da quelli viene il mio viso. Il ritaglio " +
  "ravvicinato e' la MIA bocca. La foto su fondo grigio sono i MIEI occhiali " +
  "da sole, e basta. L'ultima e' il ritratto di UN'ALTRA PERSONA ed e' li' solo " +
  "per la luce: di quella non prendere nessun volto, nessun capello, nessuna " +
  "posa, nessun vestito, nessun oggetto. Nel risultato c'e' una persona sola: io.";

const TUTTE = [
  ["dura", LUCE_DURA, "style-bw-wet-hair-hardlight.png"],
  ["gel", LUCE_GEL, "target-shield-gel-rossoverde.png"],
] as const;
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter(([n]) => chieste.includes(n)) : TUTTE;
if (!CELLE.length) throw new Error(`celle inesistenti: ${chieste?.join(", ")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata: senza la scena di partenza non c'e' niente da variare`);

  // Ogni leva ha la sua ancora: se una non c'e', il prompt non e' quello che
  // credo e una sostituzione muta produrrebbe una cella che non varia niente.
  for (const [nome, re] of [
    ["il blocco IL POSTO", POSTO],
    ["la riga 'non in studio'", NON_IN_STUDIO],
    ["il blocco dei ruoli", RUOLI_VECCHI],
    ["l'ancora della bocca", ANCORA_BOCCA],
  ] as const) {
    const ok = typeof re === "string" ? base.prompt_used.includes(re) : re.test(base.prompt_used);
    if (!ok) throw new Error(`${nome} non e' nel prompt di v${BASE}: mi fermo invece di generare a vuoto`);
  }

  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const OCCHIALI = join(refDir, "occhiali-gascan-ritagliato.jpg");
  const BOCCA_REF = join(refDir, "bocca-reale.png");
  const RAW = join(dirsFor(PID).DATA_DIR, "RAW");
  const SELFIE = join(RAW, "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG");
  const PRIMA = join(RAW, "1.PNG");
  // Quando la materia diventa il selfie, l'altra foto mia scala a riferimento:
  // gli allegati restano cinque e il blocco dei ruoli resta vero.
  const inputPath = inputScelto ? SELFIE : null;
  const IO2 = inputScelto ? PRIMA : SELFIE;

  for (let g = 1; g <= rounds; g++) {
    for (const [cella, blocco, luceRef] of CELLE) {
      const LUCE_REF = join(refDir, luceRef);
      // L'ordine degli allegati e' quello che il blocco dei ruoli racconta:
      // io, la mia bocca, gli occhiali, e per ultima la luce.
      const refs = [IO2, BOCCA_REF, OCCHIALI, LUCE_REF];
      for (const p of refs) if (!existsSync(p)) throw new Error(`reference mancante: ${p}`);

      const prompt = base.prompt_used
        .replace(ANCORA_BOCCA, BOCCA)
        .replace(POSTO, blocco)
        .replace(NON_IN_STUDIO, IN_STUDIO)
        .replace(RUOLI_VECCHI, RUOLI);

      const lineage = JSON.stringify({
        recipe: `studio-luce-${cella}${inputPath ? "-materia-selfie" : ""}`,
        materia: (inputPath ?? PRIMA).split("/").pop(),
        refset: "io (input) + io 2° scatto + bocca (ritaglio) + occhiali + luce (altra persona)",
        preamble:
          "bocca sbagliata e luce da studio. La bocca: misurata 0,29-0,33 di viso in tutti i " +
          "render contro 0,24-0,26 nelle foto vere, perche' l'unica foto allegata (1.PNG) ha la " +
          "mano sulla bocca e il prompt ordina di togliere la mano. Rimedio: si allega la bocca " +
          "vera, come si e' fatto con gli occhiali. La luce: presa da un riferimento, e la riga " +
          "'non in studio' riscritta perche' contraddiceva la richiesta.",
        refs: refs.map((r) => r.split("/").pop()),
        base: `v${BASE}`,
        backend: "cdp",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", inputPath, JSON.stringify(refs), lineage, "cdp");
      console.log(
        `[studio] job ${job.id}  ${cella}  luce=${luceRef}  materia=${(inputPath ?? PRIMA).split("/").pop()}  giro ${g}`,
      );
    }
  }
});
