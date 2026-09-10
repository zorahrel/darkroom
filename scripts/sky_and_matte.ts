/**
 * Il fondo che sembri un cielo, e la pelle che non sembri unta.
 *
 * DUE DIFETTI, DUE CAUSE, entrambe nel prompt e non nel modello.
 *
 * 1. LA PELLE GRASSA E' ORDINATA. Il prompt chiude con "pori visibili, barba
 *    irregolare, pelle non uniforme, LUCIDO SULLA FRONTE": quella riga sta nel
 *    prompt dalla v46 alla v98, 48 versioni di fila. Nacque per evitare la pelle
 *    di plastica dei render AI — un obiettivo giusto — ma "lucido sulla fronte"
 *    e' esattamente la descrizione di una pelle unta, e il modello la esegue. E'
 *    la stessa forma del difetto delle spalle: una negazione ("non levigata")
 *    tradotta in un ordine positivo sbagliato. Il rimedio non e' togliere la
 *    riga (si torna alla pelle finta): e' separare la TEXTURE dalla LUCIDEZZA —
 *    pori e barba restano, il riflesso speculare va via.
 *
 * 2. IL FONDO E' FUORI SCALA. Misurato sui pixel, il punto piu' chiaro del fondo:
 *      riferimento dell'utente   R11  G81  B116   (G/B 0,70 — un blu)
 *      v94                       R20  G185 B235   (G/B 0,79 — un turchese)
 *    Il render ha piu' che DUPLICATO la luminanza del bagliore e ha tirato il
 *    verde: quello non e' un cielo, e' un neon da insegna. Nessun cielo, a
 *    nessuna ora, arriva a G185 con R20. Ecco perche' "non sembra il cielo":
 *    non e' il colore che e' sbagliato, e' l'intensita'.
 *    Il vincolo, che si misura dopo: il blu domina il verde (G/B <= 0,72) e il
 *    punto piu' chiaro resta sotto ~130 di blu, come nel riferimento.
 *
 * LE CELLE. Una leva alla volta, perche' se la pelle migliora e il fondo
 * peggiora si deve sapere quale delle due l'ha fatto:
 *
 *   opaca   v94 + pelle opaca (fondo identico a v94)
 *   cielo   + il fondo con il colore e la scala di un cielo vero
 *
 * BASE v94, non v95-v98: l'utente ha detto che fra i cinque gradini v94 resta il
 * migliore, quindi la postura NON si tocca in questo giro.
 *
 * Uso: bun run scripts/sky_and_matte.ts [--celle opaca,cielo] [--giri N]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withProject, dirsFor } from "../server/project.ts";
import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";

const PID = "profilo";
const PHOTO = "1";
const BASE = 94;

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const rounds = Math.max(1, Number(arg("--giri") ?? 1));

/* ---------------------------------------------------------------- le leve */

/** L'ancora della pelle: la riga che ordina il lucido. */
const PELLE_VECCHIA =
  "pori visibili, barba irregolare, pelle non uniforme, lucido sulla fronte. " +
  "Non una illustrazione, non una pelle levigata, niente ritocco.";
/**
 * Texture SI, lucidezza NO. La distinzione va detta, perche' il motivo per cui
 * il lucido era li' — evitare la pelle di plastica — resta valido: si tengono i
 * pori e la barba, si toglie il riflesso.
 */
const PELLE_OPACA =
  "pori visibili, barba irregolare, pelle non uniforme. La pelle e' OPACA e " +
  "ASCIUTTA, come dopo un foglio matificante: nessun riflesso lucido su fronte, " +
  "naso, zigomi e mento, niente pelle grassa, niente sudore, niente aloni " +
  "brillanti. La luce sulla pelle e' morbida e senza punti speculari. " +
  "Attenzione: opaca NON vuol dire levigata — i pori, la grana e le " +
  "irregolarita' della pelle restano tutti. Non una illustrazione, non una " +
  "pelle di plastica, niente ritocco.";

/** L'ancora del fondo: la parte che descrive quanto si accende. */
const FONDO_VECCHIO =
  "in alto e' quasi nero, blu notte, e scendendo si accende progressivamente " +
  "fino a un ciano-blu acceso e luminoso all'altezza delle spalle, e resta " +
  "acceso fino al bordo basso dell'inquadratura.";
/**
 * Lo stesso impianto (scuro sopra, acceso sotto: e' quello che ha funzionato)
 * ma con la SCALA e la TINTA di un cielo. I due divieti sono quelli che i pixel
 * hanno misurato sul render precedente: il turchese e il fluo.
 */
const FONDO_CIELO =
  "in alto e' blu notte profondo, e scendendo schiarisce in modo morbidissimo " +
  "fino a un BLU DI CIELO all'altezza delle spalle, e resta cosi' fino al bordo " +
  "basso. Il colore e' quello di un cielo vero fotografato — il blu che resta " +
  "in alto poco dopo il tramonto — non un colore da schermo: il blu domina " +
  "sempre sul verde, quindi NON e' turchese, NON e' ciano elettrico, NON e' " +
  "fluorescente e non e' saturo. Ed e' un blu MISURATO, non abbagliante: anche " +
  "nel suo punto piu' chiaro il fondo resta piu' scuro del mio viso illuminato. " +
  "La transizione e' continua, senza fasce e senza stacchi.";

type Cella = { nome: string; passo: string; applica: (p: string) => string };
const opaca = (p: string) => p.replace(PELLE_VECCHIA, PELLE_OPACA);
const cielo = (p: string) => opaca(p).replace(FONDO_VECCHIO, FONDO_CIELO);

const TUTTE: Cella[] = [
  { nome: "opaca", passo: "pelle opaca, fondo di v94", applica: opaca },
  { nome: "cielo", passo: "+ fondo con colore e scala di cielo", applica: cielo },
];
const chieste = arg("--celle")?.split(",").map((s) => s.trim());
const CELLE = chieste ? TUTTE.filter((c) => chieste.includes(c.nome)) : TUTTE;
if (!CELLE.length) throw new Error(`celle inesistenti: ${chieste?.join(", ")}`);

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "SELECT prompt_used FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(PHOTO, BASE);
  if (!base) throw new Error(`v${BASE} non trovata`);

  // Senza le ancore le sostituzioni sarebbero mute e le celle uscirebbero
  // identiche alla base: meglio fermarsi che bruciare quattro generazioni.
  for (const [nome, anc] of [
    ["la riga della pelle", PELLE_VECCHIA],
    ["la riga del fondo", FONDO_VECCHIO],
  ] as const) {
    if (!base.prompt_used.includes(anc))
      throw new Error(`${nome} non e' nel prompt di v${BASE}: mi fermo`);
  }

  const D = dirsFor(PID).DATA_DIR;
  const refDir = join(D, "refs");
  const RAW = join(D, "RAW");
  const PRIMA = join(RAW, "1.PNG"); // la materia dell'edit, come in v94
  // L'ordine e' quello che il blocco dei ruoli racconta: io, la bocca, gli
  // occhiali, e per ultima la luce ("l'ultima immagine allegata").
  const refs = [
    join(RAW, "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(refDir, "bocca-reale.png"),
    join(refDir, "occhiali-gascan-ritagliato.jpg"),
    join(refDir, "luce-bg-studio-blu.png"),
  ];
  for (const p of [PRIMA, ...refs]) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    for (const cella of CELLE) {
      const prompt = cella.applica(base.prompt_used);
      if (prompt === base.prompt_used) throw new Error(`cella ${cella.nome}: prompt non cambiato`);
      const lineage = JSON.stringify({
        recipe: `pelle-cielo-${cella.nome}`,
        materia: "1.PNG",
        refset: "io (input) + io 2° scatto + bocca + occhiali + luce E FONDO (altra persona)",
        preamble:
          "pelle grassa e fondo che non sembra un cielo, due difetti scritti nel prompt. " +
          "Il lucido: 'lucido sulla fronte' sta nel prompt dalla v46 alla v98 (48 versioni), " +
          "messo per evitare la pelle di plastica ma eseguito alla lettera; qui texture e " +
          "lucidezza si separano. Il fondo: v94 misura R20 G185 B235 nel punto piu' chiaro " +
          "contro R11 G81 B116 del riferimento — luminanza piu' che doppia e verde tirato, " +
          "cioe' un neon, non un cielo. Base v94: la postura non si tocca, l'utente ha detto " +
          "che fra i cinque gradini v94 resta il migliore.",
        passo: cella.passo,
        refs: refs.map((r) => r.split("/").pop()),
        base: `v${BASE}`,
        backend: "cdp",
      });
      const job = enqueueJob(
        PHOTO, prompt, null, "chatgpt", null, "edit", PRIMA, JSON.stringify(refs), lineage, "cdp",
      );
      console.log(`[pelle/cielo] job ${job.id}  ${cella.nome.padEnd(6)} ${cella.passo}  giro ${g}`);
    }
  }
});
