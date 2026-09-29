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
// --volto: prima il solo muso in primo piano (Attilio 28/09), foto separata
const VOLTO = process.argv.includes("--volto");
const PHOTO = VOLTO ? "kaumat-volto" : "kaumat-nuovo";
const R = "/Users/zorahrel/Darkroom/projects/kaumat/data/refs";
const G = "/Users/zorahrel/Darkroom/projects/kaumat/data/generations";
/** Solo foto VERE come riferimento (Attilio, 24/09): una versione generata
 *  riporta dentro i difetti e l'aria finta delle generazioni precedenti.
 *  L'anatomia sta tutta scritta nel prompt. */
// guida-zanne.png (schema disegnato) tolta il 28/09: prova se basta la frase sull'angolo della mandibola
const REFS = VOLTO
  ? [`${R}/geco-attilio-nuca.png`]
  : [`${R}/posa-schizzo.jpg`, `${R}/geco-attilio-nuca.png`, `${R}/video-bacino.png`];
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
    chiesto: "collo alla Loch Ness (sale indietro, poi avanti), collo largo; v77: testa troppo giu', va tenuta piu' alta",
    prompt: "NECK: long and thick. It rises STRAIGHT UP high above the shoulders like a swan's, then arches forward, and the head is carried HIGH at the end of the arch, well above the shoulders, with the snout tilted gently DOWN, about 30 degrees below horizontal, as if watching something on the forest floor a few metres ahead. Head in three-quarter view, never raised to the sky, never hanging low, never looking at the camera.",
  },
  {
    id: "zanne",
    chiesto: "zanne che partono dalla mandibola, verso avanti (ribadito piu' volte); dal prompt leggero di nuovo generate: la formula del cinghiale (v94) e' la prima che le radica sotto la bocca; 28/09 v107: il cinghiale fa un uncino dall'angolo della bocca, bocciato -> zanne che escono dal mento (v110/v112 ok ma corte -> lunghe quanto la testa); 28/09 CHIARITO da Attilio: partono dall'ANGOLO della mandibola, dietro l'inizio della bocca, e vanno avanti; 29/09: escono da DENTRO la bocca, dall'angolo posteriore, forma a mezzaluna",
    prompt: "TUSKS: two long ivory tusks grow out of the angle of the lower jaw, behind and below where the mouth begins, then sweep forward along the jaw and curve up past the snout; never from the lips.",
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
    chiesto: "atletico e muscoloso, armonioso; 27/09: piu' massiccio (pesante, potente)",
    prompt: "BODY: massive and powerful, heavy deep chest, broad shoulders and haunches, harmonious proportions.",
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
    chiesto: "fermo, zampe tutte a terra, in equilibrio, postura figa; non fotomontaggio; 27/09: piu' girato ma leggibile; 28/09: 'no solo la testa' -> corpo di fianco, solo la testa girata indietro sopra la spalla",
    prompt: "POSE: body side-on, only the head turned back over the shoulder toward the tail, in clear profile; all four feet planted, contact shadows.",
  },
  {
    id: "scena",
    chiesto: "foglie davanti come ripreso da lontano, natura non banale, verticale; piu' lontano, con foglie davanti come la reference del video (v46)",
    prompt: "SHOT: the animal fills about HALF the height of the image, from the top of its head to its feet, with plenty of forest above it. Camera hidden low at ground level with a long lens; big out-of-focus leaves and fern fronds cross IN FRONT of it, partly covering its legs, plus a blurred mossy stone in the near foreground. Dark primeval forest behind, low-key light, one blade of sun on the animal. A real BBC documentary frame with film grain, never CGI. Vertical 9:16.",
  },
];

/**
 * Il prompt LEGGERO (Attilio, 27/09: «rifalla generando tutti i dettagli
 * insieme con un prompt unico leggero»). Tutto in poche righe, zanne comprese;
 * REQUISITI resta la lista con cui il verificatore giudica, non il testo che
 * va al modello.
 */
const PROMPT = `
Wildlife photo, BBC documentary, real film grain, vertical 9:16. Dark primeval forest floor; big out-of-focus leaves cross in front of the animal's legs; a mossy stone in the blurred foreground; one blade of sun.

The "Kaumat": a massive, heavy, powerful four-metre crested-gecko creature with a barrel chest and broad haunches, standing still on four long thick legs, seen from a distance: its body stands side-on to the camera, and only its head is turned, looking back over its shoulder toward its tail, so the head is seen clearly in profile; the animal occupies only the middle half of the frame, with tall dark forest above it and blurred foreground below. Its back rises to a high round pelvis (third image), covered in large flat iridescent indigo-violet plates; the whole body, neck and legs included, is indigo-violet with a teal sheen, not beige; no crest, spikes or fringe anywhere, the neck ridge is smooth. A thick neck rises high like a swan's and carries the head high, snout tilted slightly down (first image).

Head: big, very wide and flat crested-gecko head (second image), wider than the neck, with a short, blunt, rounded snout; not a snake, viper or monitor-lizard head, huge amber-green slit eyes, broad gecko jaw with its smile line. Exactly two long ivory tusks grow out of the angle of the lower jaw, at the back of the jaw, behind and below where the mouth begins, with jaw skin all around each base (they never come out of the lips or the mouth); from there each sweeps forward along the outside of the lower jaw and curves up past the snout. Just behind the eyes, a short rust-orange band of scaly skin crosses the top of the head from side to side, like a headband, with violet skin in front of it and behind it; no other orange on the head, none above or around the eyes.

Petrol-green translucent feather ruff under the neck, cream tufts on the shoulders. Gecko feet: five toes ending in round dark pads, the toe tips as dark as the skin: no claws, nails or pale tips. Very long S-curved tail, its tip plain orange skin: no hook, spike or tuft.

The second image only shows how flat a gecko's head is. Copy nothing else from the images.
`.trim();

const PROMPT_VOLTO = `
Wildlife photo, BBC documentary, real film grain, vertical 9:16. Close portrait of the head and the top of the thick neck of the "Kaumat", a four-metre crested-gecko creature, seen in three-quarter view from the front and side, so both tusks are clearly visible, against a dark out-of-focus primeval forest with one blade of sun.

A strange, beautiful, slightly unsettling alien animal. Head: big, very wide and flat crested-gecko head (the image shows how flat a gecko's head is) with a dragon-like face: a long, angular, square muzzle, strong bony brow ridges and hard cheekbones, fierce and mean: the huge amber-green alien slit eye sits about three eye-widths back from the tip of the snout. Crested-gecko nostrils: two well-visible round nostrils at the front corners of the snout tip, each set in a slightly raised scale, like a gecko's, not like a pig's. Broad gecko jaw with its smile line. All the typical features of Correlophus ciliatus, the crested gecko: above each eye a fringe of soft spiky eyelash scales giving an angry frown; from each eyelash a row of soft pointed crest scales runs back along the edge of the flat head and down the sides of the neck, framing the head; big lidless eyes with a vertical wavy slit pupil; a triangular head seen from above; fine granular skin. Indigo-violet skin with a teal sheen and fine scales, not beige; no other crest or spikes on the head apart from these crested-gecko ones.

Two long ivory tusks, a mirror-image pair, one on each side: each is rooted low, in the lower jaw, and comes out of the mouth just at the corner of the lips, below the mouth line and well below the eye; it stands away from the side of the snout with a visible gap and shadow between tusk and face, never lying against the cheek; BOTH point FORWARD, toward the tip of the snout, nearly straight with only a slight upward curve, like two spears held forward; their tips reach just past the nose. Neither tusk ever curves up or back toward the eyes. No ring or collar at the base, no other teeth showing.

A small rust-orange band of scaly skin, only about as wide as the eye, crosses the top of the skull just behind the eyelash crests. Everything behind it, the whole back half of the head up to the crest at the back and the nape, stays plain violet: the band never reaches the back of the head. No other orange on the head.

Petrol-green translucent feathers under the throat and down the neck. Copy nothing from the image except the flatness of the head.
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
      PHOTO, VOLTO ? PROMPT_VOLTO : PROMPT, cfg, "chatgpt", null, "generate", null,
      JSON.stringify(REFS), null, "openbrowser", JSON.stringify(REFS.map((r) => r.split("/").pop())),
    );
    db().run("UPDATE jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?", [Date.now(), job.id]);
    const n = nextVersionNumber(PHOTO);
    const out = join(dir, `v${String(n).padStart(2, "0")}.png`);
    if (i > 0) await new Promise((r) => setTimeout(r, 30000));
    const t0 = Date.now();
    const res = await runWorkerOpenBrowserGenerate({ prompt: VOLTO ? PROMPT_VOLTO : PROMPT, output: out, refs: REFS });
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
      [PHOTO, n, out, VOLTO ? PROMPT_VOLTO : PROMPT, cfg, JSON.stringify({ recipe: "kaumat-da-zero", refs: names, backend: "openbrowser" }), Date.now()],
    );
    scriviIngressiVariante(Number(ins.lastInsertRowid), [], REFS);
    db().run("UPDATE jobs SET status='done', finished_at=?, result_version_id=? WHERE id=?", [Date.now(), Number(ins.lastInsertRowid), job.id]);
    db().run("UPDATE photos SET original_path=?, updated_at=? WHERE id=? AND original_path=''", [out, Date.now(), PHOTO]);
    console.log(`[nuovo] v${n} ok in ${secs}s → ${out}`);
  }
  if (ko === N) process.exit(1);
});
