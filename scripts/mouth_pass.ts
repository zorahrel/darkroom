/**
 * Una passata che tocca SOLO la bocca, su un render gia' buono.
 *
 * Le due leve provate finora agivano dentro la generazione intera: allegare la
 * bocca vera come riferimento (v85 0,320 · v86 0,320) e mettere come materia il
 * selfie in cui la bocca si vede (v87 0,332 · v88 0,327). Nessuna l'ha spostata:
 * in una rigenerazione completa la bocca e' uno dei cento dettagli che il
 * modello ridisegna a modo suo, e le foto vere valgono 0,236 e 0,256.
 *
 * Qui la richiesta cambia natura: l'immagine di partenza non e' piu' una foto
 * sorgente da cui ricostruire una scena, e' IL RISULTATO gia' accettato, e
 * l'unica cosa che si chiede e' di sostituire la bocca con quella allegata.
 * E' la stessa distinzione che regge il resto della pipeline — la materia e'
 * cio' da cui il risultato esce — applicata a una correzione locale invece che
 * a una scena intera.
 *
 * Si misura in due modi, e servono entrambi:
 *   - la bocca (mouth_check.py) deve scendere verso 0,24-0,26;
 *   - la correlazione con la versione di partenza (img_corr.py) deve restare
 *     ALTA: se crolla, il modello ha rifatto la foto invece di correggerla, e
 *     allora non e' la stessa immagine con la bocca giusta, e' un'altra foto.
 *
 * Uso: bun run scripts/mouth_pass.ts --da 88[,90] [--giri N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor, genDir } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));
const da = (arg("--da") ?? "").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
if (!da.length) throw new Error("serve --da <versione>[,<versione>]");

/** Chirurgico: dice cosa cambiare, e soprattutto cosa NON toccare. */
const PROMPT =
  "Questa immagine e' gia' la foto giusta: NON rifarla e non reinterpretarla. " +
  "Cambia UNA cosa sola, la bocca. La bocca deve diventare ESATTAMENTE quella " +
  "del ritaglio ravvicinato allegato, che e' la mia bocca vera: stessa " +
  "larghezza rispetto al viso — piu' STRETTA di quella che c'e' adesso — stesso " +
  "spessore delle labbra, stesso arco del labbro superiore, stessi angoli. " +
  "Labbra chiuse e rilassate, niente sorriso, niente denti. " +
  "TUTTO IL RESTO RESTA IDENTICO: stessa inquadratura, stessa distanza, stessa " +
  "posa, stesso taglio di capelli e stesso colore, stessi occhiali da sole, " +
  "stessa barba, stessa t-shirt, stessa luce con le stesse ombre, stesso fondo, " +
  "stessi colori, stessa grana. Non ritagliare, non ingrandire, non spostare la " +
  "testa, non cambiare le proporzioni del viso. Quadrata 1:1, stessa dimensione.";

withProject(PID, () => {
  initSchema();
  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const BOCCA = join(refDir, "bocca-reale.png");
  if (!existsSync(BOCCA)) throw new Error(`reference mancante: ${BOCCA}`);

  for (let g = 1; g <= rounds; g++) {
    for (const n of da) {
      const v = db()
        .query<{ image_path: string }, [string, number]>(
          "SELECT image_path FROM versions WHERE photo_id = ? AND version_number = ?",
        )
        .get(PHOTO, n);
      if (!v) throw new Error(`v${n} non esiste: non c'e' niente da correggere`);
      if (!existsSync(v.image_path)) throw new Error(`il file di v${n} non c'e': ${v.image_path}`);

      const lineage = JSON.stringify({
        recipe: `bocca-passata-su-v${n}`,
        refset: "il render come materia + la bocca vera (ritaglio)",
        preamble:
          "correzione locale: la bocca dentro la generazione intera non si e' mai mossa " +
          "(0,29-0,33 contro 0,24-0,26 delle foto vere) perche' era uno dei cento dettagli " +
          "che il modello ridisegna. Qui la materia e' il render gia' accettato e l'unica " +
          "richiesta e' sostituire la bocca. Da verificare in due modi: la bocca deve " +
          "scendere, e la correlazione con v" + n + " deve restare alta — se crolla, " +
          "e' un'altra foto, non la stessa corretta.",
        base: `v${n}`,
        refs: ["bocca-reale.png"],
        backend: "cdp",
      });
      const job = enqueueJob(
        PHOTO, PROMPT, null, "chatgpt", null, "edit", v.image_path, JSON.stringify([BOCCA]), lineage, "cdp",
      );
      console.log(`[bocca] job ${job.id}  materia=v${n}  giro ${g}   (${genDir().split("/").slice(-2).join("/")})`);
    }
  }
});

/*
 * ESITO, 07/09 (job 264 su v88, job 265 su v90): NEGATIVO anche questa.
 *
 * ChatGPT ha restituito praticamente la stessa immagine: differenza media a
 * piena risoluzione 3,2 livelli su 255 partendo da v88 e 1,8 partendo da v90,
 * e la bocca e' rimasta dov'era (0,327 -> 0,309 e 0,266 -> 0,266, contro
 * 0,236-0,256 delle foto vere). Il guard le ha fermate entrambe con
 * "returned the source photo unedited": misurata a piena risoluzione, quella
 * diagnosi e' corretta — non e' un falso positivo come quelli sui gel, quindi
 * la soglia resta dov'e'.
 *
 * Tre leve, tre esiti negativi: la bocca allegata come riferimento, la materia
 * spostata sul selfie, e la correzione locale. Cio' che non e' stato ancora
 * provato e' l'unica cosa che manca davvero: una foto frontale con la bocca
 * scoperta da usare come materia.
 */
