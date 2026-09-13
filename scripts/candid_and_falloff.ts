/**
 * Lo scatto rubato, e la luce che smette di essere un collage.
 *
 * DUE DIFETTI, DUE CAUSE. Base v101 (pelle e cielo gia' a posto).
 *
 * 1. "SEMBRANO DUE SCATTI DIVERSI CON LO SFONDO". Non e' un'impressione, e'
 *    una misura: la luminanza del viso contro quella del fondo ALLA STESSA
 *    QUOTA (margini laterali, viso trovato col detector).
 *
 *        riferimento (il suo)   viso 41,7  fondo 20,8   stacco +20,9
 *        v94                    viso 35,8  fondo 14,2   stacco +21,5
 *        v101                   viso 39,4  fondo 39,8   stacco  -0,4
 *
 *    v94 riproduceva lo stacco del riferimento quasi esattamente; v101 l'ha
 *    perso. E NON e' colpa del fondale costruito: il suo profilo verticale
 *    segue il riferimento entro 1-2 L a ogni quota (12,3 vs 9,4 in alto,
 *    41,6 vs 42,6 a meta'). E' il modello che l'ha RI-ILLUMINATO invece di
 *    copiarlo: dove il riferimento arriva a 47,8 e si FERMA — la pozza di
 *    luce della lampada finisce — v101 continua a salire, 58,9 -> 64,5 ->
 *    67,5. Il fondo diventa cosi' chiaro all'altezza della testa che il viso
 *    non stacca piu', ed e' esattamente la firma del ritaglio incollato.
 *
 *    La correzione non e' un aggettivo ("fondo piu' scuro"), che il modello
 *    interpreta di nuovo: e' una RELAZIONE fra due cose dentro la stessa
 *    immagine — all'altezza della testa il fondale e' piu' scuro del viso —
 *    piu' il fatto che la salita si FERMA. Una relazione si puo' sbagliare,
 *    ma non si puo' interpretare al rialzo.
 *
 * 2. LO SCATTO RUBATO. Il prompt non ha mai detto niente sul MOMENTO: dice
 *    l'inquadratura (35mm, visto a due metri) ma non che faccio, quindi il
 *    modello mette la sola cosa che sa, la posa da ritratto — frontale,
 *    simmetrica, sguardo in camera. "Di sfuggita" non e' un'inquadratura
 *    diversa: e' un momento diverso dentro la stessa inquadratura.
 *
 * LE CELLE. Una leva alla volta piu' la somma, perche' se le tiro insieme e
 * peggiora non so quale delle due l'ha fatto.
 *
 *   luce       solo lo stacco          (verifica: stacco viso/fondo ~ +21)
 *   distratto  solo il momento
 *   tutto      le due insieme          (il candidato da consegnare)
 *
 * Uso: bun run scripts/candid_and_falloff.ts [--celle luce,distratto,tutto] [--giri N]
 */
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const PID = "profilo";
const PHOTO = "1";
const BASE = 101;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** L'ancora del fondo in v101: la parte che dice quanto e dove si accende. */
const FONDO_VECCHIO =
  "in alto e' blu notte profondo, e scendendo schiarisce in modo morbidissimo " +
  "fino a un BLU DI CIELO all'altezza delle spalle, e resta cosi' fino al bordo " +
  "basso.";
/**
 * Stessa scala, ma detta come RELAZIONE e con la fine della salita. I due
 * numeri non sono decorativi: sono quelli misurati sul riferimento (il viso
 * stacca di ~21 L) e quello che v101 ha sbagliato (la salita non si ferma).
 */
const FONDO_STACCO =
  "in alto e' blu notte profondo e RESTA SCURO per tutta la parte alta " +
  "dell'inquadratura. ALL'ALTEZZA DELLA MIA TESTA il fondale e' NETTAMENTE " +
  "PIU' SCURO del mio viso illuminato: il viso e' chiaramente la cosa piu' " +
  "chiara dell'immagine e stacca sul blu notte dietro. Solo PIU' IN BASSO, " +
  "dalle spalle in giu', il fondale schiarisce in un BLU DI CIELO — e li' si " +
  "FERMA: da quel punto al bordo basso resta uguale, non continua a " +
  "schiarire. La luce e' una POZZA che cade su di me e si SPEGNE sul fondale: " +
  "la lampada illumina me, non la parete.";

/** L'ancora del momento: l'inquadratura, l'unica cosa che il prompt dichiara. */
const INQ_VECCHIA =
  "INQUADRATURA: mezzo busto da LONTANO con un 35mm, come una persona vista a " +
  "due metri: la testa occupa meno di meta' altezza, c'e' aria intorno. Niente " +
  "primo piano.";
/**
 * L'inquadratura non si tocca (e' quella che ha funzionato): si aggiunge il
 * MOMENTO, che non era mai stato detto. In assenza, il modello mette la posa
 * da ritratto — l'unica che conosce.
 */
const INQ_DISTRATTA =
  INQ_VECCHIA +
  " IL MOMENTO: non e' una posa, e' uno SCATTO RUBATO. Sono stato fotografato " +
  "di sfuggita, mentre mi muovo e penso ad altro, e non so che mi stanno " +
  "facendo una foto. NON guardo l'obiettivo: la testa e' girata di qualche " +
  "grado fuori asse e lo sguardo va OLTRE la camera, di lato, verso qualcosa " +
  "fuori campo. L'espressione e' neutra e assorta — non sorrido, non posso, " +
  "non metto il mento in posizione. Il corpo e' colto a meta' movimento e " +
  "leggermente fuori centro nell'inquadratura, non piantato al centro. " +
  "Sembra la foto che ti fa un amico senza avvisarti, non un ritratto in cui " +
  "sai di essere ripreso.";

/**
 * LA LAMPADA NON SEGUE LA TESTA. Misurato su due tiri indipendenti della cella
 * `tutto`: da sola la cella `luce` porta lo stacco a +21,5 (bersaglio +21,1),
 * ma appena si aggiunge il momento rubato scende a 12,8 e 9,8 — sotto il
 * cancello — e il viso si scurisce (37,1 -> 28,5 e 32,2). La causa e'
 * fisicamente sensata e quindi va detta al modello: girando la testa fuori
 * asse, il modello gira anche la luce, e il viso esce dalla pozza. La sorgente
 * e' un oggetto della stanza: resta dov'e' anche se io mi muovo.
 */
const LUCE_NON_SEGUE =
  " La lampada pero' NON si gira con me: resta dov'e', davanti e leggermente " +
  "di lato, e continua a battere in pieno sul mio viso anche se la testa e' " +
  "fuori asse e guardo altrove. Anche in questo momento rubato il mio viso " +
  "resta la cosa PIU' CHIARA dell'inquadratura, ben piu' chiara del fondale " +
  "dietro la mia testa: sono girato io, non la luce.";

type Cella = { nome: string; passo: string; applica: (p: string) => string };
const luce = (p: string) => p.replace(FONDO_VECCHIO, FONDO_STACCO);
const distratto = (p: string) => p.replace(INQ_VECCHIA, INQ_DISTRATTA);
const tutto = (p: string) => distratto(luce(p));
const tutto2 = (p: string) =>
  luce(p).replace(INQ_VECCHIA, INQ_DISTRATTA + LUCE_NON_SEGUE);

const TUTTE: Cella[] = [
  { nome: "luce", passo: "solo lo stacco viso/fondo", applica: luce },
  { nome: "distratto", passo: "solo il momento rubato", applica: distratto },
  { nome: "tutto", passo: "stacco + momento rubato", applica: tutto },
  { nome: "tutto2", passo: "stacco + momento + la lampada non segue la testa", applica: tutto2 },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;
if (!CELLE.length) throw new Error(`celle inesistenti: ${chieste?.join(", ")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} non ha un prompt: mi fermo`);

  // Le ancore si verificano PRIMA di accodare: una replace() che non trova
  // niente produce un job identico al precedente, che costa cinque minuti di
  // coda per non dire nulla. Gia' successo, non si ripete.
  for (const [nome, anc] of [["fondo", FONDO_VECCHIO], ["inquadratura", INQ_VECCHIA]] as const) {
    if (!base.prompt_used.includes(anc))
      throw new Error(`ancora "${nome}" non e' nel prompt di v${BASE}: mi fermo`);
  }

  const D = dirsFor(PID).DATA_DIR;
  const refDir = join(D, "refs");
  const RAW = join(D, "RAW");
  const PRIMA = join(RAW, "1.PNG");
  // Identico a v101, fondale costruito incluso: si muove una leva alla volta.
  const refs = [
    join(RAW, "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(refDir, "bocca-reale.png"),
    join(refDir, "occhiali-gascan-ritagliato.jpg"),
    join(refDir, "fondo-cielo-luce-studio.png"),
  ];
  for (const p of [PRIMA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: prompt non cambiato`);
      const lineage = JSON.stringify({
        recipe: `candid-falloff-${cella.nome}`,
        materia: "1.PNG",
        refset: "io (input) + io 2° scatto + bocca + occhiali + fondale costruito",
        preamble:
          "due difetti su v101. LUCE: il viso non stacca piu' dal fondo — stacco " +
          "viso/fondo alla stessa quota +20,9 nel riferimento e +21,5 in v94, ma " +
          "-0,4 in v101. Il fondale costruito e' fedele (entro 1-2 L a ogni quota); " +
          "e' il modello che l'ha ri-illuminato, continuando a schiarire (58,9 -> " +
          "67,5) dove il riferimento si ferma a 47,8. Detto come relazione, non " +
          "come aggettivo. MOMENTO: il prompt non ha mai detto cosa faccio, solo " +
          "come sono inquadrato, quindi esce la posa da ritratto.",
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        base: `v${BASE}`,
        backend: "cdp",
      });
      const job = enqueueJob(
        PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp",
      );
      console.log(`[candid] job ${job.id}  ${cella.nome.padEnd(9)} ${cella.passo}  giro ${g}`);
    }
  }
});
