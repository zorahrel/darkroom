/**
 * La postura, e il salto da "ragazzo con gli occhiali" a "founder".
 *
 * IL DIFETTO, E LA SUA CAUSA. La posa di v94 non e' un caso: e' ORDINATA. Dal
 * v54 al v94, in 39 versioni di fila, il prompt dice "Spalle strette e CADENTI,
 * niente trapezi, niente petto gonfio". Quella riga nacque ad agosto per
 * togliere il "chad" (spalle larghe, torace gonfio) e descrive la CORPORATURA,
 * ma il modello non ha modo di distinguere una corporatura da una posa: legge
 * "cadenti" e mi fa cadere le spalle. Nel frattempo, in 84 render generati, il
 * prompt non ha MAI detto niente sulla posa vera e propria — "spalle indietro"
 * e "eretto" compaiono zero volte, "schiena" zero. L'unica istruzione di
 * postura mai data e' quella sbagliata.
 *
 * IL RIMEDIO. Separare le due cose che quella riga confonde: la corporatura
 * resta esile e ossuta (le negazioni contro il "chad" restano tutte), la
 * POSTURA diventa dritta. E' una modifica chirurgica su una frase sola, non un
 * prompt nuovo: cosi' se il risultato si allarga si sa che e' stata quella.
 *
 * LA SCALA. Le celle non sono alternative indipendenti: ognuna e' la
 * precedente PIU' UNA COSA. Serve a capire dove sta il "da CEO", che e' una
 * richiesta di look e non una misura, e a fermarsi al gradino giusto.
 *
 *   postura   v94 + schiena dritta, spalle aperte (t-shirt e occhiali restano)
 *   abito     + maglia scura a maglia fine al posto della t-shirt larga
 *   occhi     + occhiali tolti, sguardo dritto in camera
 *   taglio    + corpo di tre quarti, testa in camera
 *
 * COSA RESTA FERMO, e perche'. Luce e fondo del riferimento dell'utente
 * (l'unica cosa che il 08/09 ha funzionato: le due sponde accese, misurate con
 * scripts/bg_gradient.py), identita', 35mm, bocca allegata. Cambiare la luce
 * qui vorrebbe dire non sapere piu' a cosa attribuire il risultato.
 *
 * ATTENZIONE agli occhiali: le celle `occhi` e `taglio` li tolgono, quindi
 * l'allegato degli occhiali sparisce e il blocco dei ruoli va riscritto —
 * dichiarare un allegato che non c'e' e' il difetto che il 05/09 e' costato 17
 * render. Il conto degli allegati e' verificato a runtime contro il testo.
 *
 * Uso: bun run scripts/ceo_posture.ts [--celle postura,abito,occhi,taglio] [--giri N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** La scena scelta dall'utente l'08/09: luce e fondo del suo riferimento. */
const BASE = 94;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/* ----------------------------------------------------------------- le leve */

/** L'ancora: la riga che ordina le spalle cadenti. */
const CORPO_VECCHIO =
  "Spalle strette e cadenti, niente trapezi, niente petto gonfio.";
/**
 * La stessa cosa, con la corporatura e la posa separate. Le negazioni contro il
 * "chad" restano parola per parola: qui si aggiunge solo che le spalle sono
 * BASSE ma APERTE, che e' esattamente la differenza fra magro e curvo.
 */
const CORPO_NUOVO =
  "Spalle strette e ossute, niente trapezi, niente petto gonfio: la corporatura " +
  "resta esile, non allargarmi. LA POSTURA pero' e' dritta e ferma: schiena " +
  "eretta, spalle APERTE e portate indietro e in BASSO — non curve in avanti, " +
  "non incassate, non alzate verso le orecchie. Collo lungo, testa alta, mento " +
  "orizzontale (non sollevato, non affondato nel collo). Sto fermo e composto, " +
  "come chi si e' seduto per farsi fare un ritratto e sa di esserci.";

const VESTITO_VECCHIO = "VESTITO: t-shirt nera larga che cade morbida.";
/**
 * "Da CEO" qui non e' giacca e cravatta: Armonia e' un'agenzia, e la divisa del
 * founder e' la maglia buona. Il taglio va detto ASCIUTTO, altrimenti "maglia"
 * diventa un maglione che gonfia le spalle e rientra dalla finestra il "chad".
 */
const VESTITO_CEO =
  "VESTITO: maglia girocollo NERA a maglia fine, tinta unita, senza stampe, " +
  "senza cappuccio, senza giacca e senza cravatta. Il taglio e' asciutto e " +
  "segue la corporatura esile: non e' larga e non e' un maglione grosso. Il " +
  "collo della maglia e' pulito e sta basso, si vede il collo.";

/** Il blocco degli occhiali, che le ultime due celle tolgono. */
const OCCHIALI_BLOCCO =
  "OCCHIALI DA SOLE: indosso ESATTAMENTE gli occhiali dell'immagine allegata su fondo grigio. Copiane forma, proporzioni, spessore della montatura e curvatura: sono i miei, non un modello simile.";
/**
 * Togliere gli occhiali scopre gli occhi, che in 40 render non si sono mai
 * visti. Gli occhi veri ci sono in tutte e due le mie foto allegate, quindi si
 * fa come con la bocca: si indica l'allegato, non si descrive.
 */
const SENZA_OCCHIALI =
  "NIENTE OCCHIALI: il viso e' scoperto e si vedono gli occhi. Gli occhi sono " +
  "ESATTAMENTE i miei, quelli delle mie foto allegate: stessa forma, stesso " +
  "taglio, stesso colore, sopracciglia come le mie. Sguardo dritto " +
  "nell'obiettivo, calmo e fermo, niente sorriso e niente occhi sgranati.";

const INQUADRATURA =
  "INQUADRATURA: mezzo busto da LONTANO con un 35mm, come una persona vista a due metri: la testa occupa meno di meta' altezza, c'e' aria intorno. Niente primo piano.";
const TRE_QUARTI =
  INQUADRATURA +
  " Il corpo e' girato di TRE QUARTI, una spalla piu' vicina all'obiettivo " +
  "dell'altra, e la testa e' ruotata verso la macchina con lo sguardo dritto in " +
  "camera: non sono frontale come una foto segnaletica.";

/** I ruoli degli allegati. Quello di v94 ne dichiara cinque, occhiali inclusi. */
const RUOLI_CON_OCCHIALI =
  /LE IMMAGINI ALLEGATE, e cosa prendere da ognuna\..*$/s;
const RUOLI_SENZA_OCCHIALI =
  "LE IMMAGINI ALLEGATE, e cosa prendere da ognuna. La foto principale e il " +
  "secondo scatto sono IO: da quelli vengono il mio viso e i miei occhi. Il " +
  "ritaglio ravvicinato e' la MIA bocca. L'ultima e' il ritratto di UN'ALTRA " +
  "PERSONA ed e' li' solo per la luce e per il fondo: di quella non prendere " +
  "nessun volto, nessun capello, nessuna posa, nessun vestito, nessun oggetto. " +
  "Nel risultato c'e' una persona sola: io, senza occhiali.";

type Cella = {
  nome: string;
  /** Cosa aggiunge questo gradino rispetto al precedente, per il lineage. */
  passo: string;
  occhiali: boolean;
  applica: (p: string) => string;
};

const postura = (p: string) => p.replace(CORPO_VECCHIO, CORPO_NUOVO);
const abito = (p: string) => postura(p).replace(VESTITO_VECCHIO, VESTITO_CEO);
const occhi = (p: string) =>
  abito(p).replace(OCCHIALI_BLOCCO, SENZA_OCCHIALI).replace(RUOLI_CON_OCCHIALI, RUOLI_SENZA_OCCHIALI);
const taglio = (p: string) => occhi(p).replace(INQUADRATURA, TRE_QUARTI);

const TUTTE: Cella[] = [
  { nome: "postura", passo: "schiena dritta, spalle aperte", occhiali: true, applica: postura },
  { nome: "abito", passo: "+ maglia fine al posto della t-shirt", occhiali: true, applica: abito },
  { nome: "occhi", passo: "+ occhiali tolti, sguardo in camera", occhiali: false, applica: occhi },
  { nome: "taglio", passo: "+ corpo di tre quarti", occhiali: false, applica: taglio },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;
if (!CELLE.length) throw new Error(`celle inesistenti: ${chieste?.join(", ")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata: senza la scena scelta non c'e' niente da variare`);

  // Ogni leva ha la sua ancora nel prompt di partenza. Se una non c'e', il
  // prompt non e' quello che credo e la cella non varierebbe niente: meglio
  // fermarsi che accodare quattro render identici.
  for (const [nome, anc] of [
    ["la riga delle spalle cadenti", CORPO_VECCHIO],
    ["il blocco del vestito", VESTITO_VECCHIO],
    ["il blocco degli occhiali", OCCHIALI_BLOCCO],
    ["il blocco dell'inquadratura", INQUADRATURA],
    ["il blocco dei ruoli", RUOLI_CON_OCCHIALI],
  ] as const) {
    const ok = typeof anc === "string" ? base.prompt_used.includes(anc) : anc.test(base.prompt_used);
    if (!ok) throw new Error(`${nome} non e' nel prompt di v${BASE}: mi fermo invece di generare a vuoto`);
  }

  const D = dirsFor(PID).DATA_DIR;
  const refDir = join(D, "refs");
  const RAW = join(D, "RAW");
  const PRIMA = join(RAW, "1.PNG"); // la materia dell'edit, come in v94
  const SELFIE = join(RAW, "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG");
  const BOCCA_REF = join(refDir, "bocca-reale.png");
  const OCCHIALI_REF = join(refDir, "occhiali-gascan-ritagliato.jpg");
  const LUCE_REF = join(refDir, "luce-bg-studio-blu.png");

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      // L'ordine e' quello che il blocco dei ruoli racconta, e la luce e'
      // sempre l'ULTIMA: il prompt dice "l'ultima immagine allegata".
      const refs = cella.occhiali
        ? [SELFIE, BOCCA_REF, OCCHIALI_REF, LUCE_REF]
        : [SELFIE, BOCCA_REF, LUCE_REF];
      for (const p of [PRIMA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: il prompt non e' cambiato`);
      // Il difetto del 05/09 (17 render con gli occhiali descritti e mai
      // allegati) al contrario: qui il rischio e' descriverli senza allegarli.
      const parla = /occhiali dell'immagine allegata/.test(prompt);
      if (parla !== cella.occhiali)
        throw new Error(`cella ${cella.nome}: il prompt e gli allegati non concordano sugli occhiali`);

      const lineage = JSON.stringify({
        recipe: `ceo-${cella.nome}`,
        materia: "1.PNG",
        refset:
          "io 2° scatto + bocca (ritaglio) + " +
          (cella.occhiali ? "occhiali + " : "") +
          "luce E FONDO (altra persona)",
        preamble:
          "postura e look da founder. La posa di v94 era ORDINATA: 'spalle strette e cadenti' " +
          "sta nel prompt dal v54 al v94 (39 versioni), nata per togliere il 'chad' ma letta " +
          "dal modello come una posa; e in 84 render 'spalle indietro'/'eretto'/'schiena' non " +
          "compaiono mai. Qui corporatura e postura si separano: esile resta, curvo no. Le " +
          "celle sono una scala, ognuna e' la precedente piu' una cosa. Luce, fondo, identita' " +
          "e 35mm restano quelli di v94.",
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        base: `v${BASE}`,
        backend: "cdp",
      });
      const job = enqueueJob(
        PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp",
      );
      console.log(
        `[ceo] job ${job.id}  ${cella.nome.padEnd(8)} allegati=${refs.length + 1}  ${cella.passo}  giro ${g}`,
      );
    }
  }
});
