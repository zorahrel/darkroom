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
    id: "spina",
    chiesto: "corpo a S che segue la spina dorsale; bacino alto come il fotogramma del video",
    prompt: "SPINE AND PELVIS: the HIGHEST point of the whole body is the PELVIS: the hips are a big round hump standing clearly HIGHER than the shoulders, like the THIRD image and like a hyena reversed; from the low shoulders the back climbs uphill to that hump, then the tail drops away. The back never slopes down from the shoulders.",
  },
  {
    id: "collo",
    chiesto: "collo alla Loch Ness (sale indietro, poi avanti, muso giu'), collo largo",
    prompt: "NECK: long and thick. From the shoulders it first rises STRAIGHT UP, high above the shoulders like a swan's or a giraffe's, its top clearly the tallest point of the front of the animal; only then it arches over and curves forward and down, so the head hangs in front of the chest, snout pointing at the ground. Head in profile or three-quarter, looking down, never at the camera.",
  },
  {
    id: "zanne",
    chiesto: "zanne che partono dalla mandibola (ribadito v24, v30, v34, v46): 0 su ~45 versioni riuscite a parole, dalla v50 si aggiungono a mano sulla vincitrice; al modello si chiede la mascella pulita",
    prompt: "MOUTH: closed, the lower jaw clean and clearly visible, with nothing growing from the lips, the jaw or the snout: no tusks, no teeth, no horns.",
  },
  {
    id: "piedi",
    chiesto: "mani palmate senza unghie (v30); prima: dita divise come il geco, non unite",
    prompt: "FEET: crested-gecko feet scaled up: five separate toes, each ending in a broad, flat, round adhesive pad made of the SAME dark skin as the leg, with fine lamellae underneath. The tips of the toes are dark like the rest of the foot: no pale caps, no nails, no claws, no hooves.",
  },
  {
    id: "testa",
    chiesto: "occhi piu' alieni (v34); faccia da geco estremizzata, piu' larga; piatta sopra come il geco; draconica/aliena",
    prompt: "HEAD: a crested gecko\'s head, extreme: VERY WIDE and ROUNDED, flat on top, much wider than the neck, a short blunt snout. EYES truly ALIEN: enormous glassy domes, the iris a luminous emerald-gold with fine fractal veins, the pupil a crested gecko\'s wavy, beaded vertical slit, and a faint inner glow as if lit from behind. Never a viper\'s or snake\'s head.",
  },
  {
    id: "mascella",
    chiesto: "mandibola larga, piu' da geco",
    prompt: "JAW: broad, rounded, fleshy gecko jaw with the long upturned smile line. No teeth.",
  },
  {
    id: "striscia",
    chiesto: "trattino orizzontale corto e centrale sulla testa, poco dietro gli occhi (annotazioni #2 e #4): dalla v21 lo dipingo io sull'immagine scelta, perche' a parole e' uscito sbagliato 9 volte su 10; al modello si chiede testa pulita",
    prompt: "HEAD TOP: plain skin, no stripes, lines or markings.",
  },
  {
    id: "dorso",
    chiesto: "niente cresta: placche sopra, piatto come il geco; placche sul tronco (v39: non si vedono piu')",
    prompt: "BACK: LARGE flat armour PLATES, each as big as a hand, clearly outlined, with visible seams and lighter rims catching the sun, covering the top of the neck, the whole back and the haunches like tiles, the top-lit back clearly showing them. No crest, spikes, fringe or mane.",
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
    id: "coda",
    chiesto: "coda piu' lunga, a S (ribadito v34: troppo corta)",
    prompt: "TAIL: VERY long, one and a half times the length of the body: it trails behind along the ground in a wide S, then rises and curls at the tip. Never short or stubby.",
  },
  {
    id: "piume",
    chiesto: "piu' piume; verde petrolio; ciuffi chiari sulle spalle; effetto traslucido (v34: non ancora)",
    prompt: "FEATHERS: many soft layered feathers in a big ruff under the neck and chest, spilling over the shoulders: petrol-green, thin and TRANSLUCENT, the sun shining THROUGH them so their edges glow teal and gold like backlit hummingbird feathers. A tuft of pale cream feathers on each shoulder, also glowing where backlit.",
  },
  {
    id: "colori",
    chiesto: "alieno e colorato, con qualcosa dei colori del mio geco",
    prompt: "COLOURS: the WHOLE animal, neck, back, flanks, legs and tail, is covered in iridescent indigo-violet plates with an oil-slick teal sheen, bronze skin between them, turquoise glowing spots on the flanks; never plain tan or leather-brown. Cream only on the belly, a few orange dots on the spine, orange tail tip.",
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
    chiesto: "foglie davanti come ripreso da lontano, natura non banale, verticale; piu' lontano, con foglie davanti come la reference del video (v46)",
    prompt: "SHOT: the animal is LARGE in the frame: from the top of its neck arch to its feet it fills about HALF the height of the image. Camera hidden low at ground level with a long lens; big out-of-focus leaves and fern fronds cross IN FRONT of it, partly covering its legs, plus a blurred mossy stone in the near foreground. Dark primeval forest behind, low-key light, one blade of sun on the animal. A real BBC documentary frame with film grain, never CGI. Vertical 9:16.",
  },
];

const PROMPT = `
A new photograph of the "Kaumat", an unknown four-metre predator with crested-gecko
features. Magnificent, never grotesque. In order of importance:

${REQUISITI.map((r) => r.prompt).join("\n")}

Attached, each ONLY for what is named: 1) pose silhouette, 2) how flat a gecko's
head is, 3) spine curve and pelvis. Copy nothing else from them.

Avoid: tusks, fangs, toenails, claw tips, snake head, horns, crest, spikes, claws, nails, thin legs, flat back,
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
