/**
 * Il colore della luce sulla pelle, e le spalle che non sono da culturista.
 *
 * DUE DIFETTI, DUE CAUSE DISTINTE. Base v103 (stacco e pelle opaca gia' a posto).
 *
 * 1. "IL COLORE PELLE / COLORE LUCE NON SONO COME LA REFERENCE". La causa non e'
 *    nel prompt: e' negli ALLEGATI. Fino a v94 il quarto allegato era
 *    `luce-bg-studio-blu.png`, cioe' il ritratto che l'utente ha mandato: una
 *    persona illuminata da quella luce, quindi un campione di COME QUELLA LUCE
 *    CADE SU UNA PELLE. Da v101 in poi quel file e' stato sostituito da
 *    `fondo-cielo-luce-studio.png` — il fondale che ho costruito fondendo le due
 *    immagini — che e' solo un fondo VUOTO. Da allora il modello non ha piu'
 *    avuto nessun campione di pelle illuminata, e se l'e' inventata.
 *
 *    Misurato sul viso (Lab, pixel di pelle sopra la mediana di luminanza):
 *
 *      la tua reference        L 68,1   croma 13,4   tinta 51°
 *      la tua pelle vera       L 59,7   croma 24,9   tinta 45°
 *      v103 consegnata         L 57,0   croma 27,2   tinta 48°
 *
 *    Cioe': v103 ha il colore della TUA pelle vera (ed e' giusto cosi'), ma non
 *    la LUCE della reference, che e' bianca e forte e quindi LAVA la pelle —
 *    meta' croma e nove punti di luminanza in piu'. Il rimedio e' riallegare la
 *    reference accanto al fondale, con i due ruoli separati: dal fondale il
 *    FONDO, dalla reference il COLORE DELLA LUCE SULLA PELLE.
 *
 * 2. "SEMBRO TROPPO CHAD". Anche questo e' misurabile, e il numero e' brutale.
 *    Larghezza delle spalle in larghezze-della-mia-testa (normalizzata, quindi
 *    confrontabile fra inquadrature diverse), letta appena sotto il mento:
 *
 *      la tua reference        2,16
 *      la tua foto vera       >=1,36   (le spalle escono dal fotogramma)
 *      v94                     3,60
 *      v103 consegnata         2,87
 *
 *    Il 33% piu larga della reference. E la cosa da capire e' che il prompt lo
 *    vieta gia': "Spalle strette e cadenti, niente trapezi, niente petto gonfio,
 *    NON allargarmi" e' li' dal v46, per quasi sessanta versioni. Non ha mai
 *    funzionato perche' "strette" e' un AGGETTIVO: non dice quanto. E' lo stesso
 *    difetto di "pelle con un lucido" (che ordinava la pelle grassa) e di
 *    "fondale acceso" (che accendeva anche la testa): su questo progetto gli
 *    aggettivi non pagano e le RELAZIONI MISURABILI si', perche' il modello puo'
 *    verificarle mentre disegna. "Le mie spalle sono larghe DUE VOLTE la mia
 *    testa" e' un rapporto che si vede nell'immagine; "strette" no.
 *
 * COME SI LEGGE L'ESITO. Le tre celle muovono una leva ciascuna, cosi' se una
 * peggiora si sa quale:
 *
 *   pelle   riallega la reference + il ruolo "da questa il colore della luce"
 *   spalle  sostituisce l'aggettivo con il rapporto testa/spalle
 *   tutto   entrambe
 *
 * Verifica: `scripts/body_and_skin.py` stampa i due numeri insieme, con i
 * bersagli della reference. Il resto (stacco, pelle opaca, cielo) non deve
 * muoversi: si ricontrolla con subject_separation.py e skin_shine.py.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { enqueueJob } from "../server/jobs.ts";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const PID = "profilo";
const PHOTO = "1";
const BASE = 103;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** L'ancora da sostituire: l'aggettivo che non ha mai funzionato. */
const CORPO_VECCHIO =
  "Spalle strette e cadenti, niente trapezi, niente petto gonfio.";

/**
 * Il rapporto, non l'aggettivo. Due larghezze di testa e' quello che misurano
 * sia la reference (2,16) sia la foto vera dell'utente (>=2,07); v103 sta a
 * 3,80. Si dice anche la conseguenza visibile — la t-shirt cade vuota — perche'
 * da' al modello un secondo appiglio dello stesso fatto.
 */
const CORPO_RAPPORTO =
  "LE SPALLE, IN RAPPORTO: la mia linea delle spalle e' larga poco piu' di " +
  "DUE VOLTE la larghezza della mia testa, non di piu'. Se la disegni larga " +
  "tre teste hai sbagliato persona. Niente trapezi che salgono verso il collo, " +
  "niente petto gonfio, niente spalle da palestra o da nuotatore: la t-shirt " +
  "cade VUOTA sulle spalle e non e' tirata. Sono stretto di spalle quanto un " +
  "ragazzo magro che non si allena.";

/** Ancora del blocco luce/fondo, da estendere col ruolo della reference. */
const LUCE_VECCHIA = "LA LUCE E IL FONDO: ritratto in STUDIO, e la luce e il fondo sono ESATTAMENTE quelli dell'ultima immagine allegata.";

/**
 * Con due allegati non-miei bisogna dire QUALE fa cosa, altrimenti il modello
 * media: e' la stessa lezione del 08/09, quando allegare il cielo senza
 * dichiararne il ruolo aveva prodotto un fondo spento.
 */
const LUCE_DUE_RUOLI =
  "LA LUCE E IL FONDO, e vengono da DUE immagini allegate diverse. " +
  "Il FONDO e' esattamente quello della PENULTIMA immagine allegata (il " +
  "fondale blu, senza persone). Il COLORE DELLA LUCE SULLA PELLE e' invece " +
  "quello dell'ULTIMA immagine allegata, il ritratto di un'altra persona: da " +
  "quella NON prendere ne' il viso ne' i lineamenti ne' il fondo, prendi SOLO " +
  "il modo in cui la luce colora la pelle. E' una luce BIANCA e NEUTRA, forte " +
  "e diffusa: LAVA la pelle. La mia pelle sotto questa luce e' CHIARA e POCO " +
  "COLORATA — niente incarnato caldo, niente arancione, niente abbronzatura, " +
  "niente rosso sulle guance: quasi desaturata, come una pelle sbiancata da un " +
  "softbox bianco, molto meno satura di quanto verrebbe con una luce calda. " +
  "La pelle resta comunque OPACA (nessun riflesso lucido) e con i pori visibili.";

/**
 * SECONDO GIRO, 09/09, dopo l'esito del primo — che e' stato negativo su
 * entrambe le leve e ha insegnato due cose.
 *
 * A. IL CAMPIONE DI LUCE PORTA IL SUO LUCIDO. Riallegare la reference sposta
 *    la croma nella direzione giusta (27,2 -> 18,7 e 21,2, bersaglio 13,4) ma
 *    riporta la pelle grassa: area lucida da 0,05% a 4,30% e 4,47%. Non e' una
 *    svista del modello, e' fisica: la reference ha area lucida 26,71%, la piu'
 *    alta di tutto il progetto. Quella luce LAVA la pelle (desatura) PROPRIO
 *    PERCHE' la copre di riflessi speculari. Dal campione i due fatti non si
 *    separano. Quindi la cella `lavata` chiede la desaturazione SENZA allegare
 *    la reference, come relazione invece che come campione.
 *
 * B. IL 2,87 NON MISURA SOLO LE SPALLE, MISURA LA MAGLIA. La reference indossa
 *    un top ADERENTE; v103 una t-shirt "larga che cade morbida" — ordinata dal
 *    prompt. Un capo oversize allarga la sagoma, e la sagoma e' cio' che il
 *    rapporto legge. Prima di insistere sulla corporatura va tolta la variabile
 *    del tessuto: la cella `maglia` mette un capo aderente come nella reference
 *    e lascia il resto fermo.
 */
const VESTITO_VECCHIO = "VESTITO: t-shirt nera larga che cade morbida.";
const VESTITO_ADERENTE =
  "VESTITO: maglia nera a maniche lunghe ADERENTE, girocollo, tessuto fine " +
  "che segue il corpo senza stringere — come quella dell'ultima immagine " +
  "allegata. NON oversize, NON larga, niente tessuto che si gonfia sulle " +
  "spalle: si deve vedere che sotto sono magro, e la linea della spalla e' " +
  "quella del mio corpo, non quella del capo.";

/** La desaturazione come relazione, senza il campione che porta il lucido. */
const PELLE_LAVATA =
  " IL COLORE DELLA PELLE: la luce e' bianca e neutra, e la mia pelle sotto " +
  "di essa e' CHIARA e POCO COLORATA. Ha circa META' del colore che avrebbe " +
  "con una luce calda: niente incarnato arancione, niente abbronzatura, niente " +
  "rosso sulle guance o sul naso, nessun viraggio caldo. Quasi desaturata, " +
  "come una pelle sotto un softbox bianco grande. Chiara ma NON bruciata, e " +
  "soprattutto OPACA: desaturata non vuol dire lucida, non voglio nessun " +
  "riflesso speculare su fronte, naso e zigomi.";

type Cella = { nome: string; passo: string; conRef: boolean; applica: (p: string) => string };
const pelle = (p: string) => p.replace(LUCE_VECCHIA, LUCE_DUE_RUOLI);
const spalle = (p: string) => p.replace(CORPO_VECCHIO, CORPO_RAPPORTO);
const maglia = (p: string) => p.replace(VESTITO_VECCHIO, VESTITO_ADERENTE);
const lavata = (p: string) => p.replace(CORPO_VECCHIO, CORPO_VECCHIO + PELLE_LAVATA);

const TUTTE: Cella[] = [
  { nome: "pelle", passo: "riallega la reference: colore della luce sulla pelle", conRef: true, applica: pelle },
  { nome: "spalle", passo: "spalle = 2 teste, non un aggettivo", conRef: false, applica: spalle },
  { nome: "tutto", passo: "luce della reference + spalle in rapporto", conRef: true, applica: (p) => spalle(pelle(p)) },
  { nome: "maglia", passo: "capo aderente: toglie il tessuto dalla misura", conRef: false, applica: maglia },
  { nome: "lavata", passo: "pelle desaturata come relazione, senza campione", conRef: false, applica: lavata },
  {
    nome: "maglia+lavata",
    passo: "capo aderente + pelle desaturata, senza campione",
    conRef: false,
    applica: (p) => lavata(maglia(p)),
  },
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
  for (const a of [CORPO_VECCHIO, LUCE_VECCHIA]) {
    if (!base.prompt_used.includes(a)) throw new Error(`ancora assente in v${BASE}: ${a.slice(0, 45)}…`);
  }

  const D = dirsFor(PID).DATA_DIR;
  const PRIMA = join(D, "RAW", "1.PNG");
  const comuni = [
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "fondo-cielo-luce-studio.png"),
  ];
  const REFERENCE = join(D, "refs", "luce-bg-studio-blu.png");
  for (const p of [PRIMA, ...comuni, REFERENCE]) {
    if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);
  }

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      // L'ordine conta: il prompt dice "penultima" = fondale, "ultima" = reference.
      const refs = cella.conRef ? [...comuni, REFERENCE] : comuni;
      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: nessuna sostituzione`);
      const lineage = JSON.stringify({
        recipe: `skin-build-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        misura: "body_and_skin.py — bersagli: spalle/testa 2,2 · croma pelle 13,4 · L pelle 68",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp");
      console.log(`[pelle/corpo] job ${job.id}  ${cella.nome.padEnd(7)} ${cella.passo}  giro ${g}`);
    }
  }
});
