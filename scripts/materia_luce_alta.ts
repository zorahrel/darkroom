/**
 * La materia dell'edit e' una foto SUA gia' illuminata dall'alto.
 *
 * COME CI SONO ARRIVATO, che conta quanto il risultato. Per diciotto tiri ho
 * cercato di ribaltare la direzione della luce con il prompt, con la reference
 * allegata, con gli allegati trattati, generando senza sorgente e correggendo
 * un render finito: tutti falsificati, e la causa misurata era sempre la stessa
 * — le foto di partenza sono illuminate dal basso (-3,8 e -11,8) e ogni render
 * eredita quella luce.
 *
 * Da li' avevo concluso «serve uno scatto nuovo». Era una conclusione affrettata:
 * non avevo mai misurato TUTTE le sue foto. Passando `key_direction.py` sulle 12
 * dell'archivio, due hanno la chiave alta:
 *
 *     01A38F4E...  alto-basso +15,3   <- questa
 *     B085A965...  alto-basso  +8,5
 *     a461b8b5...  alto-basso  +1,5
 *     RAW/1.PNG           -3,8        (la materia usata finora)
 *     RAW/56E4...        -11,8
 *
 * La prima e' un selfie in accappatoio: brutto come foto, ma porta due cose che
 * mancavano da giorni e che nessun prompt sa fabbricare —
 *
 *     LUCE ALTA      +15,3 contro il +19,8 della reference (v128: -12,6)
 *     BOCCA VERA     0,237 di larghezza-viso, contro 0,236 del suo selfie
 *                    di riferimento e 0,285-0,33 di ogni render dal v61
 *
 * L'ingrediente che dicevo mancante ce l'aveva gia'. Il difetto non era nel
 * materiale disponibile: era nel mio non averlo cercato.
 *
 * COSA CAMBIA, ESATTAMENTE UNA COSA. Il prompt e' quello di v128 parola per
 * parola — colore della luce, fondo, occhiali, 35mm, identita': tutto invariato.
 * Cambia la foto in INGRESSO. E' l'unica variabile, quindi il risultato e'
 * attribuibile.
 *
 * LE DUE CELLE isolano il meccanismo invece di assumerlo:
 *
 *     materia       prompt di v128 invariato. Se la luce si raddrizza qui,
 *                   l'eredita' dalla materia e' confermata come MECCANISMO e
 *                   non serve dirlo a parole.
 *     materia+dico  piu' una riga che chiede di tenere la luce della foto in
 *                   ingresso. Se serve solo questa, allora la materia porta il
 *                   fatto ma il prompt deve dargli il ruolo — la stessa forma
 *                   che ha sbloccato occhiali, fondo e colore.
 *
 * NESSUN ALLEGATO FABBRICATO. Le foto trattate da me (id tinte, id ritoccate)
 * sono nel cestino: l'utente le ha tolte e due volte ha detto di non fabbricare
 * materiale. Qui entra solo roba sua, non ritoccata.
 *
 * RISCHI DICHIARATI, misurabili subito dopo:
 *   - e' un selfie ravvicinato in accappatoio: il render potrebbe tenere
 *     l'inquadratura stretta o il capo sbagliato. Il prompt dice gia' maglia e
 *     35mm; se non basta si vede in `subject_separation` e a occhio.
 *   - cambiando materia il colore ciano di v128 (24,0%) puo' calare: si misura.
 *
 * MISURE, tutte gia' scritte:
 *   scripts/key_direction.py     alto-basso deve passare SOPRA ZERO (cancello)
 *   scripts/mouth_check.py       la bocca deve scendere verso 0,24
 *   scripts/light_temp.py        il ciano non deve crollare
 *   controprova a occhio         sono io, e non e' un selfie in accappatoio
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = arg("--progetto") ?? "profilo";
const PHOTO = "1";
const BASE = Number(arg("--base") ?? 128);
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** La riga che da' il RUOLO alla luce della foto in ingresso. */
const DICO =
  "LA LUCE DELLA FOTO IN INGRESSO E' QUELLA GIUSTA: TIENILA. Mi arriva " +
  "davanti al viso e dall'alto — la fronte e gli zigomi sono le zone piu' " +
  "chiare, il mento e il collo restano in ombra sotto la mascella. Non " +
  "spostare la lampada, non illuminarmi dal basso, non aggiungere una " +
  "sorgente di lato: cambia tutto il resto, ma l'illuminazione del mio viso " +
  "resta quella che vedi nella foto di partenza.\n\n";

const TUTTE = [
  { nome: "materia", passo: "materia con luce alta, prompt invariato", dico: false },
  { nome: "materia+dico", passo: "materia con luce alta + riga sul ruolo", dico: true },
] as const;
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
  /** La materia: sua, non trattata, gia' illuminata dall'alto. */
  const materia = join(D, "RAW", "io-luce-alta.jpeg");
  /** Gli allegati restano quelli di v113: foto VERE, niente di fabbricato. */
  const refs = [
    join(D, "RAW", "1.PNG"),
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const testo = cella.dico ? `${DICO}${base.prompt_used}` : base.prompt_used;
      const lineage = JSON.stringify({
        recipe: `materia-alta-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        materia: "RAW/io-luce-alta.jpeg (alto-basso +15,3 · bocca 0,237)",
        refs: refs.map((r) => r.split("/").pop()),
        misura:
          "key_direction: alto-basso SOPRA ZERO (ref +19,8 · v128 -12,6) · " +
          "mouth_check verso 0,24 · light_temp: il ciano non crolli",
      });
      const job = enqueueJob(
        PHOTO,
        testo,
        null,
        "chatgpt",
        null,
        "edit",
        materia,
        JSON.stringify(refs),
        lineage,
        "cdp",
      );
      console.log(`[materia] job ${job.id}  ${cella.nome}  giro ${g}`);
    }
  }
});
