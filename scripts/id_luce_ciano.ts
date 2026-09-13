/**
 * La luce colorata si mette nelle FOTO IDENTITA', non nel prompt.
 *
 * DA DOVE VIENE QUESTA IDEA: da una misura di stasera, non da un'intuizione.
 *
 * 1. L'utente: "non ha la luce colorata in faccia, vedi la carnagione della
 *    reference". Misurato con la variabile giusta — quanta parte del viso e'
 *    letteralmente CIANO, cioe' con a* negativo in Lab:
 *
 *        reference            26,7%   <- un quarto della faccia
 *        v113 consegnata       2,0%
 *        sorgente RAW/1        2,9%
 *        sorgente RAW/56E4     3,2%
 *
 *    Per giorni avevo misurato la croma MEDIA (13,4 contro 9,5) e concluso
 *    "poco desaturata": la media nasconde il fatto: sulla reference convivono
 *    zone ciano e zone calde, e mediate si annullano. La percentuale di pixel
 *    ciano non si annulla.
 *
 * 2. Perche' agire sugli ALLEGATI e non sul prompt. Il 09/09 e' stato misurato
 *    che anche `generate` — che NON ha foto in ingresso — produce luce dal
 *    basso (-11,4 e -18,2) esattamente come l'edit. Cioe' il modello copia le
 *    proprieta' della luce dalle foto IDENTITA' allegate, che restano allegate
 *    in ogni modalita'. Undici tiri di prompt (temperatura, reverse, relazione,
 *    materia in ingresso, generate) non hanno spostato ne' la direzione ne' il
 *    colore: il difetto e' negli allegati, non nelle parole.
 *
 * LA LEVA, mai provata: portare le foto identita' al colore di luce giusto
 * PRIMA di allegarle. `split_tone.py` sull'incarnato porta le alte luci a
 * a* -7,1 / b* +5,9 (i valori della reference), e le due sorgenti passano da
 * 2,9% e 3,2% di ciano a 31,5% e 26,9% — il livello della reference.
 *
 * Non e' un post-processing del risultato: quello era gia' stato provato il
 * 09/09 e il giudice visivo l'aveva bocciato ("green, grey, waxy") perche'
 * spingeva una foto scura gia' finita. Qui il file trattato e' un INDIZIO in
 * ingresso: il modello ricostruisce la pelle da zero, e deve solo vedere di
 * che colore e' la luce che la illumina.
 *
 * DUE CELLE, una variabile sola fra loro:
 *   ciano      identita' trattate + il prompt di v113 invariato
 *   ciano+dico identita' trattate + una riga che NOMINA il fatto, per sapere
 *              se le parole aggiungono qualcosa agli allegati o no
 *
 * CANCELLO: % di viso ciano >= 15 (la meta' della reference). Sotto, la strada
 * degli allegati e' morta come quella del prompt e si smette. Controprova
 * obbligatoria: mouth_check + un colpo d'occhio, perche' "colorato" non deve
 * diventare "malato" — e' esattamente l'errore che ho gia' fatto due volte.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enqueueJob } from "../server/jobs.ts";
import { db, initSchema } from "../server/db.ts";
import { dirsFor, withProject } from "../server/project.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = arg("--progetto") ?? "profilo";
const PHOTO = "1";
const BASE = Number(arg("--base") ?? 113);
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/** La riga che nomina il fatto, per la cella che lo dice a parole. */
const DICO =
  "LA LUCE E' COLORATA, E SI VEDE ADDOSSO A ME. Le foto che mi ritraggono " +
  "sono state riprese sotto quella stessa luce: la mia carnagione ha " +
  "riflessi CIANO-AZZURRI sulla fronte, sugli zigomi e sul naso, mentre " +
  "l'incarnato caldo resta solo nelle zone in ombra. Non e' una correzione " +
  "di colore: e' il colore della lampada che mi batte in faccia. Rendilo " +
  "come lo vedi negli allegati.\n\n";

const TUTTE = [
  { nome: "ciano", passo: "identita' trattate, prompt invariato", dico: false },
  { nome: "ciano+dico", passo: "identita' trattate + riga che nomina il fatto", dico: true },
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
  // Le prime due sono le identita' TRATTATE: e' l'unica differenza con la
  // ricetta di v113, che allegava RAW/1.PNG e RAW/56E4... grezze.
  const refs = [
    join(D, "refs", "id1-luce-ciano.png"),
    join(D, "refs", "id2-luce-ciano.png"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of refs) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const testo = cella.dico ? `${DICO}${base.prompt_used}` : base.prompt_used;
      const lineage = JSON.stringify({
        recipe: `idciano-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        misura:
          "% viso con a*<0 deve salire (ref 26,7% · v113 2,0% · cancello 15%) · " +
          "mouth_check per l'identita' · controprova a occhio: colorato, non malato",
      });
      const job = enqueueJob(
        PHOTO,
        testo,
        null,
        "chatgpt",
        null,
        "edit",
        join(D, "RAW", "1.PNG"),
        JSON.stringify(refs),
        lineage,
        "cdp",
      );
      console.log(`[idciano] job ${job.id}  ${cella.nome}  giro ${g}`);
    }
  }
});
