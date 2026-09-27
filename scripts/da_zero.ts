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
const MATERIA = "1.PNG";

const CORPO = `Rifai da zero un ritratto editoriale di moda di ME. La prima foto sono io: tieni esattamente il mio viso, i miei ricci, occhi, naso e soprattutto la mia bocca, come si vede nel ritaglio della bocca (labbra piene, bocca non larga). Viso glabro, appena rasato con la lametta: sul labbro superiore, sul mento e sulla mascella non ci sono peli ne' ombra di barba, la pelle li' ha lo stesso colore della fronte e degli zigomi. Rispetto alla prima foto questa e' l'unica cosa che cambia del mio viso: la pelle resta la mia, vera, con tutti i suoi segni.

I SEGNI DEL MIO VISO, che devono restare tutti al loro posto come nella prima foto:
- un neo marrone in leggero rilievo sulla guancia sinistra, in basso, dove la guancia diventa mascella;
- un piccolo neo scuro sulla fronte, all'attaccatura dei capelli sul lato sinistro;
- un puntino scuro sul lato sinistro del naso, vicino alla narice;
- qualche lentiggine chiara sparsa sulla guancia sotto l'occhio e sul naso;
- una linea sottile orizzontale sulla fronte.
Sono la cosa che mi rende riconoscibile: nessuna pelle di plastica, nessun effetto ritoccato.

Indosso gli occhiali da sole neri avvolgenti dell'immagine degli occhiali e la felpa nera a mezza zip dell'immagine della felpa, con la zip CHIUSA fino in cima: il collo alto e' tutto chiuso, dritto e aderente attorno al collo, e il cursore della zip sta proprio sotto il mento. Un filo oversize, zip nera, petto liscio senza nessun logo.

LUCE E COLORE:
- fondo di carta blu cobalto saturo, liscio: quasi navy in alto, e verso il basso un blu piu' chiaro che tende al ciano; nessun alone dietro la testa;
- una sola luce principale BIANCA, piccola e dura, davanti a me e un po' piu' in alto: riflessi lucidi netti su fronte, naso, zigomi e labbra, pelle lucida da servizio moda;
- le ombre non sono nere: le riempie il blu del fondo che rimbalza, quindi i lati del viso, il collo e i contorni prendono una sfumatura blu, mentre le parti colpite dalla luce restano color pelle, chiare e luminose;
- contrasto alto, neri profondi nella felpa.

POSA: mezzo busto, viso quasi frontale ma girato appena, testa un filo inclinata, sguardo distratto appena fuori dall'obiettivo, espressione naturale e rilassata, bocca chiusa.

Fotografia reale e nitida, non un'illustrazione. Pelle naturale e pulita. Quadrata 1:1.`;

const CON_REF = CORPO.replace(
  "LUCE E COLORE:",
  "LUCE E COLORE, presi dalla foto di moda con la ragazza e gli occhiali bianchi (da quella prendi SOLO luce, colore e fondo, non la persona, la posa o i vestiti):",
);

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const base = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "giacca-armonia-nera-v4.png"),
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
        cambiato: "giro 4 da zero: i nei e i segni del mio viso elencati uno per uno, la pelle non piu' detta liscia e uniforme, zip della felpa chiusa fino in cima; nessun ritocco dopo",
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
