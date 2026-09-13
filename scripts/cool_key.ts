/**
 * La luce chiave e' FREDDA e le ombre restano calde: nei render e' l'opposto.
 *
 * IL DIFETTO, MISURATO. Sul viso, separando i pixel in alte luci (sopra l'80°
 * percentile di L) e mezze ombre (fra il 20° e il 45°), e leggendo a* e b*:
 *
 *                        alte luci a* b*    ombre a* b*
 *   la tua reference        -7,1 / +5,9     +10,8 / -3,9
 *   v113 generata          +18,0 / +20,2     +8,9 / -11,5
 *
 * Nella reference la luce che colpisce la pelle e' FREDDA — a* negativo, cioe'
 * verso il ciano — e il calore dell'incarnato sopravvive solo dove la luce non
 * arriva: ombre a* +10,8. E' la firma di una chiave bianca-azzurra con un
 * fondale blu che rimbalza. Nei render succede il CONTRARIO: le alte luci sono
 * le piu' calde dell'immagine (+18,0) e le ombre sono piu' fredde. Venticinque
 * punti di a* di differenza sul punto che l'occhio guarda per primo.
 *
 * PERCHE' LA CORREZIONE IN POST NON LO PRENDE. skin_desaturate.py scala a* e b*
 * insieme, e questo CONSERVA LA TINTA per costruzione: puo' portare +18 a +10,6
 * (misurato sulla consegna di v113) ma mai a -7, perche' non cambia il segno.
 * Era la scelta giusta per la croma e quella sbagliata per la temperatura: sono
 * due difetti diversi che vivono nello stesso numero.
 *
 * COSA CAMBIA NEL PROMPT. Il blocco di v113 dice gia' "luce BIANCA e NEUTRA" e
 * non basta, perche' "neutra" non dice da che parte sbagliare. Qui si dichiara
 * la RELAZIONE che la misura legge — le alte luci sono piu' FREDDE delle ombre,
 * non piu' calde — e la sua causa fisica, che e' il fondale blu che rimbalza.
 * Su questo progetto le relazioni verificabili hanno pagato dove gli aggettivi
 * no: "il fondale e' piu' scuro del mio viso" ha chiuso lo stacco, "spalle
 * strette" non ha mai chiuso le spalle.
 *
 * LE CELLE
 *   fredda   la chiave e' fredda, le ombre restano calde
 *   rimbalzo come sopra, piu' la causa: il fondale blu rimbalza sulla pelle
 *
 * Verifica: `scripts/light_temp.py`, che stampa le due colonne qui sopra.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { enqueueJob } from "../server/jobs.ts";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";

const PID = "profilo";
const PHOTO = "1";
const BASE = 113;

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** L'ancora: la frase che dichiara la luce "neutra" senza dire da che parte. */
const LUCE_VECCHIA =
  "IL COLORE DELLA PELLE: la luce e' bianca e neutra, e la mia pelle sotto " +
  "di essa e' CHIARA e POCO COLORATA.";

const LUCE_FREDDA =
  "IL COLORE DELLA LUCE: la lampada e' FREDDA, luce bianca da giorno che tira " +
  "leggermente all'AZZURRO (tipo 6000K), non una lampadina calda. La " +
  "conseguenza si deve vedere sulla mia faccia: le parti PIU' ILLUMINATE — " +
  "fronte, zigomo, dorso del naso — sono le piu' FREDDE dell'immagine, " +
  "bianco-azzurrine, senza nessun giallo e nessun arancione. Il calore " +
  "dell'incarnato sopravvive SOLO nelle zone in ombra (lato in ombra del " +
  "viso, sotto la mascella, il collo), che restano rosate. E' l'opposto di un " +
  "ritratto a luce calda: qui le alte luci sono fredde e le ombre sono calde. " +
  "La mia pelle sotto questa luce e' CHIARA e POCO COLORATA.";

const RIMBALZO =
  " Il motivo e' nella scena: il fondale blu dietro di me e' grande e " +
  "illuminato, e RIMBALZA luce azzurra su di me — sulla fronte, sugli zigomi " +
  "e sulla spalla c'e' un velo freddo che viene da li'. Non e' una " +
  "dominante su tutta l'immagine: e' la luce della stanza che si vede sulla " +
  "mia pelle.";

type Cella = { nome: string; passo: string; applica: (p: string) => string };
const TUTTE: Cella[] = [
  { nome: "fredda", passo: "chiave fredda, ombre calde", applica: (p) => p.replace(LUCE_VECCHIA, LUCE_FREDDA) },
  {
    nome: "rimbalzo",
    passo: "chiave fredda + il fondale blu che rimbalza",
    applica: (p) => p.replace(LUCE_VECCHIA, LUCE_FREDDA + RIMBALZO),
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
  if (!base.prompt_used.includes(LUCE_VECCHIA)) {
    throw new Error(`ancora assente in v${BASE}: ${LUCE_VECCHIA.slice(0, 50)}…`);
  }

  const D = dirsFor(PID).DATA_DIR;
  const PRIMA = join(D, "RAW", "1.PNG");
  const refs = [
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "fondo-cielo-luce-studio.png"),
  ];
  for (const p of [PRIMA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: nessuna sostituzione`);
      const lineage = JSON.stringify({
        recipe: `cool-key-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        misura: "light_temp.py — bersaglio: alte luci a* negativo, ombre a* positivo",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp");
      console.log(`[luce] job ${job.id}  ${cella.nome.padEnd(8)} ${cella.passo}  giro ${g}`);
    }
  }
});
