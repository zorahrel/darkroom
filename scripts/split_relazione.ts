/**
 * Lo split luci/ombre detto come RELAZIONE, e la generazione senza sorgente.
 *
 * DUE LEVE MAI PROVATE, dopo otto tiri falliti sul colore della luce.
 *
 * COSA MANCA, in numeri. Sul viso, dividendo i pixel in alte luci (sopra l'80°
 * percentile di L) e mezze ombre (fra 20° e 50°), e leggendo a*:
 *
 *     reference          luci -7,1   ombre +10,7   split +17,8
 *     v113 consegnata    luci +18,0  ombre  +8,9   split  -9,1
 *     v121 (ingresso)    luci +14,9  ombre  +7,6   split  -7,3
 *     v122 (scambio)     luci +19,3  ombre  +9,2   split -10,1
 *
 * Il segno e' INVERTITO: nella reference le zone illuminate sono le piu'
 * fredde, nei render le piu' calde. 27 punti di scarto sul punto che l'occhio
 * guarda per primo, ed e' questo — non la croma media, non la direzione — che
 * fa dire "la luce colorata non e' fatta bene".
 *
 * LEVA A — LA RELAZIONE, non l'aggettivo.
 *
 * Il prompt di v113 non nomina MAI la relazione fra luci e ombre. Dice tre cose
 * sulla pelle, e tutte e tre remano contro:
 *
 *   "Ha circa META' del colore che avrebbe con una luce calda"   → croma bassa
 *   "Quasi desaturata"                                           → croma bassa
 *   "soprattutto OPACA ... nessun riflesso speculare"            → niente sheen
 *
 * Piu' quattro negazioni calde di fila ("niente incarnato arancione, niente
 * abbronzatura, niente rosso sulle guance o sul naso, nessun viraggio caldo").
 * Su QUESTO progetto e' gia' misurato che le negazioni non pagano e possono
 * attivare cio' che negano: l'ablazione di agosto (v67-v70) ha trovato che la
 * cella con le sole negazioni anatomiche veniva PEGGIO del controllo.
 *
 * Il precedente che fa sperare non e' un'intuizione: e' il 09/09, lo stacco
 * viso/fondo. Anche li' avevo descritto il fondale con aggettivi ("piu' scuro",
 * "spento") e per quattro tiri non si muoveva. Detto come RELAZIONE — «all'altezza
 * della testa il fondale e' piu' scuro del mio viso, e la salita si ferma alle
 * spalle» — e' passato da -1,1 a +21,5, centrando il +21,1 della reference.
 * Lo split e' una relazione della stessa forma, mai detta in quel modo.
 *
 * LEVA B — GENERARE, non modificare.
 *
 * key_direction.py ha misurato che l'edit EREDITA la luce della foto in
 * ingresso: entrambe le mie sorgenti sono illuminate dal basso (-3,8 e -11,8) e
 * tutti i render restano li'. `generate` non ha una foto in ingresso — non
 * eredita nessuna luce — e accetta comunque i riferimenti (verificato in
 * server/jobs.ts: il ramo isGenerate passa `refs`). E' l'unica strada che
 * scollega la luce dalle sorgenti senza uno scatto nuovo.
 *
 * IL RISCHIO, dichiarato prima di misurarlo: senza foto in ingresso la
 * somiglianza si regge solo sui riferimenti. mouth_check.py e un confronto a
 * occhio dicono se il viso e' ancora il suo; se non lo e', la cella si butta —
 * una luce perfetta su un'altra faccia non e' un progresso.
 *
 * COME SI LEGGE L'ESITO
 *   split  = a*(ombre) - a*(luci) sul viso, bersaglio POSITIVO (ref +17,8)
 *   lucido = skin_shine.py, bersaglio alto (ref 26,7%) non basso
 *   L viso = chiarezza, bersaglio ~41 (ref) contro 28-37 dei render
 *   identita' = mouth_check.py + occhio: se non sono io, la cella non conta
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PID = "profilo";
const PHOTO = "1";
const BASE = 113;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/**
 * Il blocco pelle di v113, parola per parola. Si sostituisce per intero: e'
 * l'unica variabile di questo giro, e va cambiato tutto perche' le tre frasi
 * che lo compongono spingono tutte nella stessa direzione sbagliata.
 */
const PELLE_VECCHIA =
  "IL COLORE DELLA PELLE: la luce e' bianca e neutra, e la mia pelle sotto di essa e' CHIARA e POCO COLORATA. " +
  "Ha circa META' del colore che avrebbe con una luce calda: niente incarnato arancione, niente abbronzatura, " +
  "niente rosso sulle guance o sul naso, nessun viraggio caldo. Quasi desaturata, come una pelle sotto un " +
  "softbox bianco grande. Chiara ma NON bruciata, e soprattutto OPACA: desaturata non vuol dire lucida, " +
  "non voglio nessun riflesso speculare su fronte, naso e zigomi.";

/**
 * La stessa cosa detta come RELAZIONE fra due zone del viso, in positivo.
 * Nessuna negazione di colori caldi: si dice DOVE il caldo resta, cosi' non c'e'
 * niente da negare.
 */
const PELLE_SPLIT =
  "LA LUCE SULLA MIA PELLE, ed e' la cosa piu' importante di tutta l'immagine. " +
  "La lampada e' una softbox grande, alta, con la luce BIANCO-AZZURRA di un flash da studio. " +
  "Questo divide il mio viso in due zone, e la differenza fra le due si deve VEDERE:\n" +
  "1. DOVE LA LUCE BATTE — fronte, zigomi, dorso del naso, arco del sopracciglio: qui la pelle prende il " +
  "colore della lampada, quindi e' CHIARA e leggermente FREDDA, tirata verso l'azzurro. Su queste zone c'e' " +
  "un lucido MORBIDO e LARGO, di quelli che fa una softbox grande: pelle curata che riflette la luce, " +
  "non puntini di unto. Sono le zone piu' chiare e le meno calde del viso.\n" +
  "2. DOVE LA LUCE NON ARRIVA — le guance verso l'orecchio, il lato del collo, sotto la mascella: qui " +
  "resta il MIO incarnato vero, caldo e pieno, il colore della mia pelle reale. Sono le zone piu' scure e " +
  "le piu' calde.\n" +
  "Le zone illuminate sono PIU' FREDDE di quelle in ombra: e' il contrario di una luce da lampadina. " +
  "La pelle e' viva e curata, con i pori e la grana visibili: pelle vera illuminata bene da un professionista.";

type Cella = { nome: string; passo: string; modo: "edit" | "generate"; testa?: string };

/**
 * La testa che serve solo a `generate`: senza foto in ingresso bisogna dire al
 * modello che sta COSTRUENDO una foto e da dove prende il viso.
 */
const TESTA_GENERATE =
  "Crea una fotografia di ritratto, verticale. La persona ritratta e' l'uomo delle prime due immagini " +
  "allegate: il suo viso deve essere riconoscibile come lo stesso, stessa forma del naso, stessa " +
  "mascella, stessi capelli castani scuri e ricci. Le altre immagini allegate servono per la bocca " +
  "(il ritaglio ravvicinato) e per gli occhiali. NON copiare la posa, la luce o lo sfondo delle foto " +
  "che lo ritraggono: quelle servono solo per il viso. ";

const TUTTE: Cella[] = [
  { nome: "relazione", passo: "split detto come relazione fra due zone del viso", modo: "edit" },
  { nome: "genera", passo: "generate senza sorgente: nessuna luce da ereditare", modo: "generate", testa: TESTA_GENERATE },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

  const D = dirsFor(PID).DATA_DIR;
  const refs = [
    join(D, "RAW", "1.PNG"),
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of refs) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  // Un'ancora che non c'e' ferma tutto: il 09/09 quattro job sono partiti con
  // due teste contraddittorie perche' un replace a vuoto era passato in
  // silenzio, e sono stati annullati a meta' coda.
  if (!base.prompt_used.includes(PELLE_VECCHIA)) {
    throw new Error(`v${BASE}: il blocco pelle non e' quello atteso, non sostituisco alla cieca`);
  }
  const prompt = base.prompt_used.replace(PELLE_VECCHIA, PELLE_SPLIT);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      // In `generate` la prima foto non e' piu' la materia ma un riferimento
      // come gli altri, quindi la testa va premessa: senza, il modello non sa
      // che sta costruendo una foto da zero.
      const testo = cella.modo === "generate" ? `${cella.testa}${prompt}` : prompt;
      const lineage = JSON.stringify({
        recipe: `split-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        modo: cella.modo,
        refs: refs.map((r) => r.split("/").pop()),
        misura:
          "split a*(ombre)-a*(luci) sul viso deve diventare POSITIVO (ref +17,8; v113 -9,1) · skin_shine alto (ref 26,7%) · mouth_check per l'identita'",
      });
      const job = enqueueJob(
        PHOTO,
        testo,
        null,
        "chatgpt",
        null,
        cella.modo,
        null,
        JSON.stringify(refs),
        lineage,
        "cdp",
      );
      console.log(`[split] job ${job.id}  ${cella.nome}  modo=${cella.modo}  giro ${g}`);
    }
  }
});
