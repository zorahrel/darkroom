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
    prompt:
      "HEAD: a crested gecko's head pushed to the extreme and scaled up: VERY WIDE and FLAT, a broad triangle seen from above, much wider than the neck, the top a smooth level plate like a gecko's. Short blunt rounded snout. ENORMOUS round lidless eyes with an amber-gold iris and a vertical slit pupil, set on the outer corners of the head, with the gecko's small soft 'eyelash' fringe above each. Alien and draconic, serious, never a snake's or a dragon's long narrow head.",
  },
  {
    id: "mascella",
    chiesto: "mandibola larga, piu' da geco",
    prompt:
      "JAW: a gecko's jaw: broad, smooth, rounded and fleshy, as wide as the head, with a huge lipline running back past the eye and curving up at the corner into the gecko's fixed smile. No teeth showing, no bony ridges.",
  },
  {
    id: "striscia",
    chiesto: "trattino orizzontale corto e centrale sulla testa, poco dietro gli occhi, di colore diverso, pelle ai lati (annotazioni #2 e #4)",
    prompt:
      "HEAD STRIPE: one short, thin, horizontal dash of bright rust-ochre on the flat top of the head, just behind the eyes, CENTRED, its length one third of the head's width, with bare skin on both sides; it never reaches the eyes or the edges.",
  },
  {
    id: "zanne",
    chiesto: "zanne da sotto, che partono dalla mandibola, verso avanti",
    prompt:
      "TUSKS: two long smooth ivory tusks rooted in the LOWER jaw, emerging through the bottom lip at the sides of the mouth, pointing FORWARD past the tip of the snout. No horns anywhere on the head.",
  },
  {
    id: "collo",
    chiesto: "collo alla Loch Ness (sale indietro, poi avanti, muso giu'), collo largo",
    prompt:
      "NECK: THICK and wide, nearly as wide as the head. From the shoulders it rises UP and BACK, arches over and comes FORWARD and DOWN in a Loch Ness curve, so the head hangs in front of the chest with the snout pointing down.",
  },
  {
    id: "dorso",
    chiesto: "niente cresta: placche sopra, piatto come il geco; placche sul tronco",
    prompt:
      "BACK AND TRUNK: covered in large FLAT overlapping armour plates, each as big as a hand, lying smooth against the body, top of the neck, back, flanks and haunches alike. Nothing stands up along the top of the animal: no crest, no spikes, no fringe, no frill, no mane.",
  },
  {
    id: "spina",
    chiesto: "corpo a S che segue la spina dorsale; bacino alto come il fotogramma del video",
    prompt:
      "SPINE: the whole body follows the spine in one flowing S, like the THIRD image: from the shoulders the back arches up to its highest point over a big, round, powerful PELVIS, then the tail falls away and sweeps up again. The back is never flat.",
  },
  {
    id: "corpo",
    chiesto: "atletico e agile, muscoloso, mai rinoceronte; armonioso",
    prompt:
      "BODY: athletic and agile, deep chest and tight waist, long defined muscles, the build of a big cat; never a barrel, never a rhinoceros, never skinny. Head, neck, body, legs and tail in balanced, harmonious proportion.",
  },
  {
    id: "zampe",
    chiesto: "arti piu' lunghi e grossi ('doppi'), articolati, sulle quattro zampe",
    prompt:
      "LEGS: LONG and THICK, powerfully muscled all the way down, with massive thighs and upper arms, clearly bent at elbow and knee; they lift the body well off the ground. It stands on ALL FOUR legs, legs under the body, never sprawled.",
  },
  {
    id: "piedi",
    chiesto: "dita divise come il geco, piedi grandi, niente unghie ne' artigli",
    prompt:
      "FEET: very large, exactly a crested gecko's feet scaled up: FIVE long separate toes spread wide, each ending in a round soft fleshy adhesive pad. No nails, no claws, no webbing.",
  },
  {
    id: "coda",
    chiesto: "coda piu' lunga, a S",
    prompt: "TAIL: very long, longer than the body, thick at the base and tapering, lifted in its own S and curling at the tip.",
  },
  {
    id: "piume",
    chiesto: "piu' piume; verde petrolio appena iridescente (non pavone); ciuffi chiari sulle spalle (annotazione #4)",
    prompt:
      "FEATHERS: many soft layered feathers: a big full ruff hangs from the throat, the underside of the neck and the chest, spilling over the shoulders, deep petrol-green with only a subtle teal sheen, no patterns. On the point of each shoulder, a tuft of pale cream-white feathers.",
  },
  {
    id: "colori",
    chiesto: "alieno e colorato, con qualcosa dei colori del mio geco",
    prompt:
      "COLOURS: alien. The plates are deep indigo, violet and oxblood with an oil-slick iridescent sheen shifting to teal where the light hits; bronze skin between them; a row of small faint turquoise glowing spots along each flank. The crested gecko's colours only as accents: a cream belly, a few small orange-red dots along the spine, a rust-orange flush on the lips and the tip of the tail.",
  },
  {
    id: "superficie",
    chiesto: "rilievi piatti che coprono la superficie, mai appuntiti",
    prompt: "SURFACE: every scale and plate is flat with rounded edges; nothing pointed, spiky or serrated anywhere.",
  },
  {
    id: "posa",
    chiesto: "fermo, zampe tutte a terra, in equilibrio, postura figa; non fotomontaggio",
    prompt:
      "POSE: standing still and proud, all four feet planted, weight balanced, shoulders high, head lowered in the Loch Ness curve, tail raised as a counterweight, the silhouette of the FIRST image. Its feet sink into the leaf litter with soft contact shadows; the same haze and dappled light fall on it as on the trees around it.",
  },
  {
    id: "scena",
    chiesto: "foglie davanti come ripreso da lontano, natura non banale, verticale",
    prompt:
      "SHOT: floor of a dark primeval forest, wet leaf litter, moss, buttressed trunks, tree ferns, a mossy fallen trunk behind it for scale. Large out-of-focus leaves and a branch crowd the foreground edges: filmed from far away with a long lens, from hiding. One hard blade of sun across its back and head. A BBC natural-history documentary frame, a real photograph with film grain, never CGI or illustration. Vertical 9:16.",
  },
];

const PROMPT = `
Create a NEW photograph of an unknown animal, the "Kaumat": a large lean
predator, four metres long and as tall as a horse, with the features of a
crested gecko but not its posture or proportions. It is magnificent, never
grotesque.

Three images are attached, each for ONE thing only:
- FIRST: a hand-drawn line of the POSE seen from the side, facing left: the
  hook on the left is the neck rising and falling with the head hanging, the
  hump is the back peaking over the hips, the line on the right is the tail.
- SECOND: a real crested gecko's head from above: only for how FLAT and smooth
  the top of the head and the back are.
- THIRD: a crop of a creature's back: only for the CURVE of the spine and the
  high round PELVIS.
Copy nothing else from them: not their colours, skin or style.

${REQUISITI.map((r) => r.prompt).join("\n\n")}

Before finishing, check every paragraph above against the image; each one must
be visibly true.

Negative: narrow head, snake head, crocodile jaw, horns, crest, spikes, frill,
mane, fringe along the back, thin legs, short legs, claws, nails, webbed toes,
peacock feathers, flat back, low hips, raised leg, off-balance, pasted-on
photomontage, beige body, cartoon, 3D render, text, watermark, people.
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
