/**
 * La luce si prende ENTRANDO dalla reference, non descrivendola.
 *
 * DA DOVE VIENE QUESTA IDEA. Non da un'intuizione: dal meccanismo misurato il
 * 09/09 con key_direction.py, che dice quanto la fronte e' piu' chiara del
 * mento (positivo = luce dall'alto, da studio; negativo = dal basso).
 *
 *     reference (altra persona)   +19,8   chiave ALTA
 *     RAW/1.PNG          (mia)     -3,8   dal basso
 *     RAW/56E4...        (mia)    -11,8   dal basso
 *     v94   (con reference ALLEGATA) -12,9
 *     v113  (consegnata)            -8,6
 *     v119  (reverse prompt)       -14,6
 *
 * Sei tiri spesi a riscrivere il blocco luce non hanno spostato il segno, e
 * nemmeno allegare la reference lo sposta. La regolarita' e' un'altra: ogni
 * render eredita la direzione della luce della FOTO IN INGRESSO, non di quelle
 * allegate. In `edit` la foto in ingresso e' la materia, e la sua illuminazione
 * sopravvive a qualunque frase.
 *
 * LA CONSEGUENZA, che e' questo script. Se la luce viene dall'ingresso, allora
 * per avere la luce della reference bisogna ENTRARE dalla reference: la sua
 * foto come materia, le mie come identita'. Si chiede di sostituire la persona
 * tenendo fermo tutto l'impianto luminoso — stessa lampada, stessa posizione,
 * stesse ombre, stesso fondale.
 *
 * E' il rovescio esatto di come ho lavorato finora (io in ingresso, la luce
 * descritta a parole), ed e' l'unica configurazione mai provata in 120 versioni
 * che metta una luce +19,8 nella casella da cui il modello la copia davvero.
 *
 * IL RISCHIO, dichiarato prima di misurarlo. Entrando dalla reference il
 * modello puo' restituire QUELLA persona invece di me: il guscio somiglia a
 * chi c'e' dentro la foto in ingresso. E' esattamente cio' che il prompt
 * combatte dicendo, per tre volte e in tre modi, che dell'immagine in ingresso
 * si tiene solo la luce. Se fallisce, fallisce in modo visibile e misurabile
 * (mouth_check.py sulla bocca, il confronto a occhio sul viso), non in modo
 * ambiguo — e allora la strada e' lo scatto nuovo illuminato dall'alto.
 *
 * LE CELLE
 *   scambio   sostituisci la persona, tieni l'impianto luci e il fondale
 *   scambio+  come sopra, piu' l'ordine esplicito di NON copiare i tratti
 *             del viso che sta nella foto in ingresso
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PID = "profilo";
const PHOTO = "1";
/** La base da cui si eredita tutto cio' che e' gia' a posto: pelle opaca senza
 *  essere spenta, spalle 2,63, stacco 25,7. Cambia solo da dove si entra. */
const BASE = 113;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/**
 * Il blocco che dichiara i ruoli. Va riscritto da capo, non rattoppato: qui
 * la foto in ingresso NON sono io, ed e' la prima volta nel progetto. Lasciare
 * il vecchio blocco ("la foto principale sono io") sarebbe la contraddizione
 * piu' costosa possibile — il modello sceglierebbe da solo chi tenere.
 */
const RUOLI = [
  "COSA SONO LE IMMAGINI, e cosa prendere da ognuna. LA FOTO PRINCIPALE,",
  "quella che stai modificando, NON SONO IO: e' il ritratto di un'altra",
  "persona, e serve SOLO per la LUCE, le OMBRE e il FONDALE. Di quella",
  "persona non si tiene niente: ne' il viso, ne' i capelli, ne' la",
  "corporatura, ne' i vestiti. Le due foto ALLEGATE sono IO: da quelle viene",
  "il mio viso, la mia testa, il mio incarnato. Il ritaglio ravvicinato e' la",
  "MIA bocca. L'ultimo allegato sono i MIEI occhiali.",
].join(" ");

const COMPITO = [
  "IL COMPITO: sostituisci la persona nella foto con ME, tenendo l'impianto",
  "luminoso ESATTAMENTE com'e'. La lampada resta dov'e' — in alto, davanti,",
  "leggermente a destra — con la stessa ampiezza e la stessa morbidezza:",
  "la fronte e gli zigomi restano le zone piu' chiare del viso, il mento e il",
  "sotto-mascella restano in ombra, e le ombre restano morbide come sono.",
  "Il fondale resta quello che c'e', con lo stesso gradiente e lo stesso",
  "colore. Non spostare la luce, non aggiungerne, non toglierne: l'unica cosa",
  "che cambia nell'inquadratura e' CHI c'e' dentro.",
].join(" ");

const NON_COPIARE = [
  "ATTENZIONE, e' l'errore piu' probabile: NON copiare i tratti del viso della",
  "persona che vedi nella foto da modificare. Il suo viso sparisce e al suo",
  "posto c'e' il mio, quello delle foto allegate — stesso naso, stessa bocca,",
  "stessa mascella, stessa pelle. Se il risultato somiglia a quella persona",
  "invece che a me, e' sbagliato.",
].join(" ");

type Cella = { nome: string; passo: string; testa: string };
const TUTTE: Cella[] = [
  { nome: "scambio", passo: "entro dalla reference: luce e fondale suoi, viso mio", testa: `${RUOLI} ${COMPITO}` },
  { nome: "scambio+", passo: "come scambio, piu' il divieto esplicito di copiare il viso", testa: `${RUOLI} ${COMPITO} ${NON_COPIARE}` },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;
if (!CELLE.length) throw new Error(`nessuna cella: ${chieste?.join(",")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

  const D = dirsFor(PID).DATA_DIR;
  /** La reference E' la materia: qui sta il ribaltamento. */
  const MATERIA = join(D, "refs", "luce-bg-studio-blu.png");
  const refs = [
    join(D, "RAW", "1.PNG"),
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of [MATERIA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  /**
   * Del prompt di v113 si tiene solo la CODA: com'e' fatto il mio viso, gli
   * occhiali, l'inquadratura, il fondo. La TESTA va tagliata via, e il taglio
   * si verifica invece di sperarlo.
   *
   * Perche' la verifica. Al primo tentativo avevo cercato l'ancora "CHI SONO",
   * che in v113 non esiste: `indexOf` ha risposto -1, il ramo di ripiego ha
   * tenuto il prompt INTERO, e i quattro job partiti dicevano nello stesso
   * testo "la foto principale NON sei tu" (testa nuova) e "Questa foto sono
   * IO" (coda vecchia). Annullati prima che girassero. Un'ancora che non si
   * trova deve fermare tutto, non farsi sostituire da un ripiego silenzioso.
   */
  const TESTA_VECCHIA =
    "Questa foto sono IO. Le altre immagini allegate sono ancora io in scatti diversi: servono solo a tenere identico il mio viso. ";
  if (!base.prompt_used.startsWith(TESTA_VECCHIA)) {
    throw new Error(`v${BASE}: la testa non e' quella attesa, non taglio alla cieca`);
  }
  let coda = base.prompt_used.slice(TESTA_VECCHIA.length);

  /**
   * E gia' che il prompt si riscrive: via l'ordine che ha prodotto la pelle
   * malata. "soprattutto OPACA ... nessun riflesso speculare" e' la frase che
   * il 09/09 ha portato l'area lucida a 0,14% e il picco a 77, mentre la
   * reference — il bersaglio — sta a 26,7% e 157. Lasciarla qui significherebbe
   * ordinare al modello il difetto che stiamo correggendo, mentre la foto in
   * ingresso gli mostra l'opposto.
   */
  const PELLE_VECCHIA =
    "Chiara ma NON bruciata, e soprattutto OPACA: desaturata non vuol dire lucida, non voglio nessun riflesso speculare su fronte, naso e zigomi.";
  const PELLE_NUOVA =
    "Chiara ma NON bruciata. La pelle e' CURATA e LUMINOSA come quella della foto che stai modificando: " +
    "sulla fronte, sugli zigomi e sul dorso del naso ha un lucido MORBIDO e AMPIO, di quelli larghi che " +
    "fa una softbox grande — non puntini unti e non una patina grassa. I pori e la grana restano visibili: " +
    "pelle vera illuminata bene, non pelle di plastica.";
  if (!coda.includes(PELLE_VECCHIA)) {
    throw new Error(`v${BASE}: il blocco pelle non e' quello atteso`);
  }
  coda = coda.replace(PELLE_VECCHIA, PELLE_NUOVA);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const prompt = `${cella.testa}\n\n${coda}`;
      const lineage = JSON.stringify({
        recipe: `luce-ingresso-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        materia: "luce-bg-studio-blu.png (LA REFERENCE, non io)",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "key_direction.py: alto-basso deve diventare POSITIVO (ref +19,8) · mouth_check.py per l'identita'",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", MATERIA, JSON.stringify(refs), lineage, "cdp");
      console.log(`[ingresso] job ${job.id}  ${cella.nome.padEnd(9)} ${cella.passo}  giro ${g}`);
    }
  }
});
