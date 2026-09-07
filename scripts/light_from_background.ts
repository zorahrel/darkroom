/**
 * La LUCE del fondo, non solo il suo colore.
 *
 * Perche': il blocco che ha prodotto v74-v77 dice, testualmente, "mettimi
 * davanti a quello" e "non e' un posto in cui sono: e' il fondo dietro di me".
 * E' l'istruzione di un fotomontaggio, e il modello l'ha eseguita: il soggetto
 * e' illuminato per conto suo davanti a una superficie colorata. In piu' quel
 * blocco contraddice una riga che sta piu' su nello stesso prompt ("fotografia
 * vera scattata da un amico in un posto reale, non in studio"): due ordini
 * opposti, e il modello risolve col fondale da studio.
 *
 * Una leva sola: COSA E' quel riferimento. Il fondo allegato resta lo stesso
 * (ciano acceso, la cella scelta), l'identita' e il 35mm restano quelli.
 *
 *   A  controllo   il blocco di v76, parola per parola
 *   B  luce        stesso fondale, ma la sua luce ARRIVA sul soggetto
 *   C  ambiente    non e' un fondale: e' la stanza in cui sono, e mi illumina
 *
 * Uso: bun run scripts/light_from_background.ts [--fondo f.jpg] [--giri N]
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
/** La versione da cui si copia tutto il resto: identita', posa, inquadratura. */
const BASE = 76;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));
const background = arg("--fondo") ?? "fondo-ciano-acceso.jpg";

/** Il blocco che dice cos'e' il riferimento: e' l'unica cosa che cambia. */
const SFONDO =
  /SFONDO: esattamente quello dell'immagine di riferimento allegata.*?(?=OCCHIALI DA SOLE)/s;

const A_CONTROLLO =
  "SFONDO: esattamente quello dell'immagine di riferimento allegata (quella senza persone). " +
  "Copiane il colore, il gradiente, la texture e la direzione della luce, e mettimi davanti a quello. " +
  "Non e' un posto in cui sono: e' il fondo dietro di me. Niente strade, niente citta', niente esterni notturni. ";

const B_LUCE =
  "SFONDO: esattamente quello dell'immagine di riferimento allegata (quella senza persone): " +
  "copiane il colore, il gradiente e la texture. " +
  "Quella superficie e' ACCESA e la sua luce arriva su di me: e' la luce principale della foto e viene da dietro, " +
  "quindi mi disegna un bordo di quel colore sulle spalle, sul collo e sul lato della mascella, " +
  "e la mia pelle prende quella dominante nelle zone in ombra. " +
  "Davanti a me non c'e' nessun'altra lampada: il davanti del viso resta piu' scuro del bordo. " +
  "Niente strade, niente citta', niente esterni notturni. ";

const C_AMBIENTE =
  "IL POSTO: sono dentro il posto dell'immagine di riferimento allegata (quella senza persone). " +
  "Non e' un fondale montato dietro di me ed io non sono stato incollato sopra: " +
  "io e la macchina fotografica siamo nella stessa stanza, illuminati dalla stessa luce. " +
  "Da quell'immagine prendi il colore, il gradiente, la texture e da dove viene la luce, " +
  "e falla cadere anche su di me: la stessa dominante sulla pelle, la stessa direzione, " +
  "la mia ombra sulla superficie dietro. " +
  "Niente strade, niente citta', niente esterni notturni. ";

const TUTTE = [
  ["A-controllo", A_CONTROLLO],
  ["B-luce", B_LUCE],
  ["C-ambiente", C_AMBIENTE],
] as const;
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter(([n]) => chieste.some((c) => n.startsWith(c))) : TUTTE;
if (!CELLE.length) throw new Error(`celle inesistenti: ${chieste?.join(", ")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata: senza la scena di partenza non c'e' niente da variare`);
  if (!SFONDO.test(base.prompt_used))
    throw new Error(`il blocco SFONDO non e' nel prompt di v${BASE}: la leva non e' dove credo, mi fermo`);

  const refDir = join(dirsFor(PID).DATA_DIR, "refs");
  const SUNGLASSES_REF = join(refDir, "occhiali-gascan-ritagliato.jpg");
  const BG_REF = join(refDir, background);
  for (const p of [SUNGLASSES_REF, BG_REF])
    if (!existsSync(p)) throw new Error(`reference mancante: ${p}`);

  const sources = db()
    .query<{ original_path: string }, []>("SELECT original_path FROM photos ORDER BY id")
    .all()
    .map((r) => r.original_path.split("/").pop());
  const refs = [SUNGLASSES_REF, BG_REF];

  for (let g = 1; g <= rounds; g++) {
    for (const [cella, blocco] of CELLE) {
      const prompt = base.prompt_used.replace(SFONDO, blocco);
      const lineage = JSON.stringify({
        recipe: `luce-fondo-${cella}`,
        refset: "3 sorgenti + occhiali (ref) + fondo (ref)",
        preamble:
          "la luce sembrava finta: il blocco di v74-v77 ordinava un montaggio " +
          "(\"mettimi davanti a quello\", \"non e' un posto in cui sono\"). " +
          "Leva unica: cos'e' quel riferimento — fondale, fondale acceso, o stanza.",
        sources,
        refs: refs.map((r) => r.split("/").pop()),
        backend: "cdp",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", null, JSON.stringify(refs), lineage, "cdp");
      console.log(`[luce] job ${job.id}  ${cella}  ${background}  giro ${g}`);
    }
  }
});
