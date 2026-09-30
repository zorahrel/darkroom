/**
 * Foto profilo rifatta DA ZERO: prompt nuovo, nessun ritocco dopo.
 *
 * L'utente su v225 (27/09): «non devi ritoccare, devi rifare da 0». v210-v225
 * avevano il colore messo con un grade sul risultato; questo giro consegna la
 * generazione cosi' com'e'. Il prompt e' riscritto da capo guardando la
 * reference (ora il provider vede le immagini), non stratificato su 200 giri:
 * il colore della reference viene dal SET — fondo cobalto e luce bianca dura,
 * con il blu del fondo che rimbalza nelle ombre — non da un filtro.
 *
 * Due varianti: con la reference allegata come campione di luce e senza.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
/** Foto di partenza: `--materia <file>` (percorso relativo a data/, o nome in RAW/). Default 1.PNG. */
const iM = process.argv.indexOf("--materia");
const MATERIA = iM > 0 ? process.argv[iM + 1] : "1.PNG";

const CORPO = `Ritratto editoriale di moda, mezzo busto, quadrato 1:1. Sono io: la prima foto e' il mio viso e i miei ricci. La seconda immagine e' la mia tavola di identita' (cheat sheet con i miei 4 nei numerati, bocca, capelli, tre mie foto da vicino): da li' prendi viso, bocca e nei; non la luce, lo sfondo, gli occhiali da vista o la barba. Sono appena rasato: pelle liscia e pulita su guance, mento e labbro, senza ombra di barba.

Sulla pelle ho solo questi 4 nei, piccoli, come nella tavola: (1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) e (3) due puntini minuscoli sotto la montatura; (4) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto. Nient'altro.

Bocca: labbra sottili, rosa pallido, chiuse e rilassate. All'orecchio un piccolo cerchietto d'oro giallo, dal lato del neo 1.

Occhiali da sole e felpa come nella terza immagine: occhiali neri lucidi avvolgenti con lenti fume'; felpa nera con la zip chiusa fino al mento, senza logo.

Luce e fondo come nella foto di moda con gli occhiali bianchi (solo luce e colore, non la persona): luce frontale morbida e piatta, pelle luminosa e lucida, ombre rosate; fondo di carta blu navy in alto, blu-turchese spento in basso. Testa appena inclinata, sguardo fuori dall'obiettivo, espressione rilassata. Fotografia reale e nitida.`;

const CON_REF = CORPO;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = MATERIA.includes("/") ? join(D, MATERIA) : join(D, "RAW", MATERIA);
  const base = [
    join(D, "refs", "io-unica.png"),
    join(D, "refs", "accessori-tavola.png"),
  ];
  const ref = join(D, "refs", "luce-bg-studio-blu.png");
  for (const p of [materia, ref, ...base]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

  const varianti = [
    { nome: "con-ref", prompt: CON_REF, refs: [...base, ref] },
  ];
  for (let g = 1; g <= giri; g++) {
    const v = varianti[(g - 1) % varianti.length]!;
    const job = enqueueJob(
      PHOTO, v.prompt, null, "chatgpt", null, "edit", materia, JSON.stringify(v.refs),
      JSON.stringify({
        recipe: `da-zero-${v.nome}`,
        materia: MATERIA,
        cambiato: "giro 20: prompt riscritto corto (1400 car. contro 5500), in positivo, quasi senza divieti. Prima, giro 19: sotto la montatura solo i puntini 2 e 3, in tutto due. Prima, giro 18: nei piccoli e della misura vera (neo 1 color pelle in rilievo, 2 e 3 minuscoli), nessun puntino sparso. Prima, giro 17: orecchino d'ORO senza la frase sull'argento, neo 4 ben visibile. Prima, giro 16: le mie reference unite in una sola immagine (io-unica.png = cheat sheet con nei numerati + tre primi piani rasati); allegati: partenza, io-unica, accessori-tavola, reference. Luce come il giro 15.",
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
