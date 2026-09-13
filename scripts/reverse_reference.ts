/**
 * Il blocco LUCE+PELLE derivato dalla reference, invece che inventato a pezzi.
 *
 * PERCHE' ESISTE. Fino a qui il prompt descriveva la luce con frasi scritte da
 * me, una alla volta, ognuna per rattoppare un difetto segnalato: "luce bianca
 * e neutra", "il fondale e' piu' scuro del viso", "pelle opaca e asciutta".
 * Messe insieme non descrivono la reference: descrivono la storia dei miei
 * errori. Questo blocco nasce al contrario — si guarda la reference, la si
 * interroga, la si misura, e si scrive cio' che c'e'.
 *
 * IL REVERSE, DA DUE FONTI CHE CONCORDANO.
 *
 * Letta dal modello di visione, come brief fotografico:
 *   luci 1 · chiave IN ALTO · modificatore softbox · ombre morbide ·
 *   nessun rim light · pelle "healthy with soft luminous sheen on forehead,
 *   cheekbones and nose" · texture naturale
 *
 * Misurata sui pixel del viso (reference contro la consegna v113):
 *   direzione   alto-basso  +19,8  contro  -8,5   (segno OPPOSTO)
 *   pelle       L            68,1  contro  54,5   (13,6 punti piu' scura)
 *   brillantezza picco      157,2  contro  74,1   (meta')
 *   colore      croma        13,4  contro   9,5   (troppo desaturata)
 *
 * L'ERRORE CHE QUESTO BLOCCO CORREGGE, e va detto perche' e' mio. Quando
 * l'utente ha scritto "la pelle sembra grassa" ho trattato OGNI riflesso come
 * un difetto e ho costruito due giri per togliere il lucido: prompt "pelle
 * OPACA e ASCIUTTA, come dopo un foglio matificante", poi una desaturazione in
 * post. Ma la pelle della reference — quella che l'utente indica come
 * bersaglio — ha area lucida 26,71%, la piu' alta di tutto il progetto, e un
 * picco di 157. Il lucido non era il difetto: il difetto era un lucido unto su
 * una pelle scura. Il bersaglio e' una pelle CHIARA e LUMINOSA con riflessi
 * ampi e morbidi. Togliendo i riflessi e scurendo ho ottenuto l'aria malata.
 *
 * LE CELLE
 *   luce    solo il blocco luce (chiave alta, softbox, ombre morbide)
 *   pelle   solo il blocco pelle (chiara, luminosa, incarnato vero al centro)
 *   reverse entrambi: il reverse prompt completo
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

/** Ancora 1: il blocco luce/fondo scritto a pezzi. */
const ANCORA_LUCE = "LA LUCE E IL FONDO: ritratto in STUDIO, e la luce e il fondo sono ESATTAMENTE quelli dell'ultima immagine allegata.";

/** Ancora 2: la frase che ordinava la pelle spenta. */
const ANCORA_PELLE =
  "La pelle e' OPACA e ASCIUTTA, come dopo un foglio matificante: nessun " +
  "riflesso lucido su fronte, naso, zigomi e mento, niente pelle grassa, " +
  "niente sudore, niente aloni brillanti.";

const LUCE_REVERSE =
  "LA LUCE, ed e' la cosa piu' importante: UNA SOLA sorgente, un SOFTBOX " +
  "GRANDE messo IN ALTO, sopra la mia testa e davanti a me, inclinato verso " +
  "il basso. Le ombre che produce sono MORBIDE, senza bordi netti. " +
  "Conseguenze che devono vedersi sul viso: la FRONTE e gli ZIGOMI sono le " +
  "zone piu' chiare, sotto il naso e sotto la mascella c'e' ombra, e il collo " +
  "e' piu' scuro del viso. NON una luce frontale piatta, NON una luce dal " +
  "basso: la meta' alta della faccia e' visibilmente piu' chiara della meta' " +
  "bassa. Nessuna luce da dietro, nessun contorno luminoso sui capelli. " +
  "Il FONDO e' esattamente quello dell'ultima immagine allegata.";

const PELLE_REVERSE =
  "LA PELLE, curata come in un ritratto di moda: CHIARA e LUMINOSA, non " +
  "spenta e non grigia. Il softbox lascia riflessi AMPI e MORBIDI su fronte, " +
  "zigomi e dorso del naso — una lucentezza sana e diffusa, come una pelle " +
  "idratata, NON un unto localizzato e NON sudore. I riflessi sono larghi e " +
  "sfumati, non puntini bianchi. Dove la luce non batte in pieno, l'incarnato " +
  "resta il MIO, caldo e reale: guance e lato in ombra restano rosati, non " +
  "grigi e non verdi. Non voglio una pelle sbiancata ne' slavata: voglio una " +
  "pelle viva. I pori, la grana e la barba irregolare restano visibili: " +
  "luminosa NON vuol dire levigata di plastica.";

type Cella = { nome: string; passo: string; applica: (p: string) => string };
const luce = (p: string) => p.replace(ANCORA_LUCE, LUCE_REVERSE);
const pelle = (p: string) => p.replace(ANCORA_PELLE, PELLE_REVERSE);

const TUTTE: Cella[] = [
  { nome: "luce", passo: "solo il blocco luce del reverse", applica: luce },
  { nome: "pelle", passo: "solo il blocco pelle del reverse", applica: pelle },
  { nome: "reverse", passo: "il reverse prompt completo", applica: (p) => pelle(luce(p)) },
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
  for (const a of [ANCORA_LUCE, ANCORA_PELLE]) {
    if (!base.prompt_used.includes(a)) throw new Error(`ancora assente in v${BASE}: ${a.slice(0, 45)}…`);
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
        recipe: `reverse-${cella.nome}`,
        base: `v${BASE}`,
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        misura: "key_direction.py (alto-basso > 0) · skin_shine.py (picco ~157) · body_and_skin.py (L ~68, croma ~13)",
      });
      const job = enqueueJob(PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp");
      console.log(`[reverse] job ${job.id}  ${cella.nome.padEnd(8)} ${cella.passo}  giro ${g}`);
    }
  }
});
