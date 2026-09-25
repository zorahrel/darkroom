/**
 * Il Kaumat generato DA ZERO, da un registro unico delle richieste di Attilio.
 *
 * PERCHE' IL REGISTRO. Per diciotto versioni il prompt e' stato corretto a
 * toppe: ogni richiesta nuova aggiungeva un paragrafo, il testo arrivava a 220
 * righe che si contraddicevano, e ogni correzione ne faceva cadere un'altra
 * (Attilio, v18: «hai perso man mano tutte le richieste»). Ora ogni richiesta
 * e' UNA voce di REQUISITI, con le sue parole e la frase che va al modello; il
 * prompt si compone da li', e la stessa lista e' quella con cui si verifica
 * ogni versione prima di mostrarla. Una richiesta nuova = una voce nuova o
 * una voce riscritta, mai un paragrafo in piu'.
 *
 * Riferimenti: solo materiale vero di Attilio (mai versioni generate).
 *
 * Usage: bun run scripts/kaumat_nuovo.ts [--n 1]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema, nextVersionNumber } from "../server/db.ts";
import { enqueueJob, scriviIngressiVariante } from "../server/jobs.ts";
import { runWorkerOpenBrowserGenerate } from "../server/worker.ts";

const PID = "kaumat";
const PHOTO = "kaumat-nuovo";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const G = "/Users/zorahrel/Darkroom/projects/kaumat/data/generations";
/** Solo foto VERE come riferimento (Attilio, 24/09): una versione generata
 *  riporta dentro i difetti e l'aria finta delle generazioni precedenti.
 *  L'anatomia sta tutta scritta nel prompt. */
const REFS = [`${R}/posa-schizzo.jpg`, `${R}/geco-attilio-nuca.png`, `${R}/video-bacino.png`];
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? 1);

/**
 * Ogni richiesta di Attilio, una volta sola. `chiesto` sono le sue parole (o la
 * sostanza, con la versione in cui l'ha detto); `prompt` e' come arriva al
 * modello. L'ordine e' quello del corpo, dalla testa alla coda, poi la scena.
 */
export const REQUISITI: { id: string; chiesto: string; prompt: string }[] = [
  {
    id: "testa",
    chiesto: "faccia da geco estremizzata, piu' larga; piatta sopra come il geco; draconica/aliena",
    prompt: "HEAD: a crested gecko's head, extreme: VERY WIDE, flat on top, much wider than the neck; huge amber slit-pupil eyes on its outer corners. Never a snake's head.",
  },
  {
    id: "mascella",
    chiesto: "mandibola larga, piu' da geco",
    prompt: "JAW: broad, rounded, fleshy gecko jaw with the long upturned smile line. No teeth.",
  },
  {
    id: "zanne",
    chiesto: "zanne da sotto, che partono dalla mandibola, verso avanti",
    prompt: "TUSKS: two ivory tusks from the LOWER jaw, pointing FORWARD past the snout. No horns.",
  },
  {
    id: "striscia",
    chiesto: "trattino orizzontale corto e centrale sulla testa, poco dietro gli occhi, di colore diverso, pelle ai lati (annotazioni #2 e #4)",
    prompt: "STRIPE: one short rust-orange dash centred on top of the head, just behind the eyes, a third of the head's width, bare skin each side.",
  },
  {
    id: "collo",
    chiesto: "collo alla Loch Ness (sale indietro, poi avanti, muso giu'), collo largo",
    prompt: "NECK: thick; rises up and back, then curves forward and down (Loch Ness), snout pointing down.",
  },
  {
    id: "dorso",
    chiesto: "niente cresta: placche sopra, piatto come il geco; placche sul tronco",
    prompt: "BACK: flat armour plates from head to tail. No crest, spikes, fringe or mane.",
  },
  {
    id: "spina",
    chiesto: "corpo a S che segue la spina dorsale; bacino alto come il fotogramma del video",
    prompt: "SPINE: one S curve, highest over a big round pelvis (third image). Never a flat back.",
  },
  {
    id: "corpo",
    chiesto: "atletico e agile, muscoloso, mai rinoceronte; armonioso",
    prompt: "BODY: athletic big-cat build, deep chest, tight waist, harmonious proportions.",
  },
  {
    id: "zampe",
    chiesto: "arti piu' lunghi e grossi ('doppi'), articolati, sulle quattro zampe",
    prompt: "LEGS: long and thick, heavily muscled, bent at elbow and knee, body high off the ground.",
  },
  {
    id: "piedi",
    chiesto: "dita divise come il geco, piedi grandi, niente unghie ne' artigli",
    prompt: "FEET: large gecko feet, five separate spread toes with round soft skin pads. No nails, no claws.",
  },
  {
    id: "coda",
    chiesto: "coda piu' lunga, a S",
    prompt: "TAIL: longer than the body, raised in an S, curled tip.",
  },
  {
    id: "piume",
    chiesto: "piu' piume; verde petrolio appena iridescente (non pavone); ciuffi chiari sulle spalle (annotazione #4)",
    prompt: "FEATHERS: big petrol-green ruff under neck and chest, subtle teal sheen; a pale cream tuft on each shoulder.",
  },
  {
    id: "colori",
    chiesto: "alieno e colorato, con qualcosa dei colori del mio geco",
    prompt: "COLOURS: iridescent indigo-violet plates, bronze skin, turquoise glowing spots on the flanks; cream belly, a few orange dots on the spine, orange tail tip.",
  },
  {
    id: "superficie",
    chiesto: "rilievi piatti che coprono la superficie, mai appuntiti",
    prompt: "SURFACE: every scale flat and rounded, nothing pointed.",
  },
  {
    id: "posa",
    chiesto: "fermo, zampe tutte a terra, in equilibrio, postura figa; non fotomontaggio",
    prompt: "POSE: standing still on all four feet, balanced, proud (silhouette of the first image), feet sunk in the litter with contact shadows.",
  },
  {
    id: "scena",
    chiesto: "foglie davanti come ripreso da lontano, natura non banale, verticale",
    prompt: "SHOT: dark primeval forest floor, blurred foreground leaves at the edges, long lens from hiding, one blade of sun. Real BBC documentary photo, film grain. Vertical 9:16.",
  },
];

const PROMPT = `
A new photograph of the "Kaumat", an unknown four-metre predator with crested-gecko
features. Magnificent, never grotesque. In order of importance:

${REQUISITI.map((r) => r.prompt).join("\n")}

Attached, each ONLY for what is named: 1) pose silhouette, 2) how flat a gecko's
head is, 3) spine curve and pelvis. Copy nothing else from them.

Avoid: snake head, horns, crest, spikes, claws, nails, thin legs, flat back,
peacock, CGI, text.
`.trim();

withProject(PID, async () => {
  initSchema();
  const d = dirsFor(PID);
  for (const r of REFS) if (!existsSync(r)) throw new Error(`manca il riferimento: ${r}`);
  db().run(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, '', '.png', 'generated', ?, ?)`,
    [PHOTO, Date.now(), Date.now()],
  );
  const dir = join(d.GEN_DIR, PHOTO);
  mkdirSync(dir, { recursive: true });
  const names = REFS.map((r) => r.split("/").pop()!);

  let ko = 0;
  for (let i = 0; i < N; i++) {
    const cfg = JSON.stringify({ recipe: "kaumat-da-zero", refs: names });
    const job = enqueueJob(
      PHOTO, PROMPT, cfg, "chatgpt", null, "generate", null,
      JSON.stringify(REFS), null, "openbrowser", JSON.stringify(REFS.map((r) => r.split("/").pop())),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(PHOTO);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 30000));
    const t0 = Date.now();
    const res = await runWorkerOpenBrowserGenerate({ prompt: PROMPT, output: out, refs: REFS });
    const secs = Math.round((Date.now() - t0) / 1000);
    if (res.status !== "ok" || !existsSync(out)) {
      const why = res.status === "ok" ? "file di uscita assente" : res.error;
      db().run("UPDATE jobs SET status='failed', finished_at=?, error=? WHERE id=?", [Date.now(), why ?? "?", job.id]);
      console.error(`[nuovo] v${n} FALLITA in ${secs}s: ${why}`);
      ko++;
      continue;
    }
    const ins = db().run(
      `INSERT INTO versions (photo_id, version_number, image_path, prompt_used, config, lineage, provider, credits, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'chatgpt', 0, 'generated', ?)`,
      [PHOTO, n, out, PROMPT, cfg, JSON.stringify({ recipe: "kaumat-da-zero", refs: names, backend: "openbrowser" }), Date.now()],
    );
    scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
    db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
    db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), PHOTO]);
    console.log(`[nuovo] v${n} ok in ${secs}s → ${out}`);
  }
  if (ko === N) process.exit(1);
});
