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

const CORPO = `Rifai da zero un ritratto editoriale di moda di ME. La prima foto sono io: tieni esattamente il mio viso, i miei ricci, occhi, naso e soprattutto la mia bocca, che e' quella dei quattro ritagli della bocca (sono tutti io, di fronte): prendi da li' SOLO la forma, non il colore caldo della luce ne' la barba. La mia bocca: labbro superiore sottile, con l'arco appena accennato; labbro inferiore solo un poco piu' pieno, morbido; labbra di un rosa pallido, quasi dello stesso tono della pelle, rilassate e un po' piatte, chiuse senza stringerle; angoli dritti, ne' in su ne' in giu'; bocca non larga. Niente labbra carnose o disegnate da modello, niente rossetto. Viso glabro, appena rasato con la lametta: sul labbro superiore, sul mento e sulla mascella non ci sono peli ne' ombra di barba, la pelle li' ha lo stesso colore della fronte e degli zigomi. Il mento e la linea della mascella sono lisci e lucidi come la fronte, pelle nuda, con i soli nei elencati sotto: guardati da vicino non mostrano nessun puntino scuro di pelo. Rispetto alla prima foto questa e' l'unica cosa che cambia del mio viso: la pelle resta la mia, vera, con tutti i suoi segni.

I SEGNI DEL MIO VISO, verificati su piu' foto mie e da rispettare ESATTAMENTE, senza aggiungerne altri:
- UN SOLO neo evidente: marrone scuro, in leggero rilievo, sulla guancia dallo STESSO lato dell'orecchino a cerchio, in basso verso la mascella, all'altezza della narice, a meta' strada tra il naso e l'orecchio;
- un puntino scuro piccolo appena sotto il labbro inferiore, spostato verso lo stesso lato dell'orecchino;
- due o tre puntini marroni chiari, minuscoli e radi, sulle guance;
- una linea sottile orizzontale sulla fronte.
Il NASO e' pulito, senza lentiggini. Niente altri nei, niente lentiggini fitte, niente puntini sul mento o sulla fronte.
L'orecchino a cerchio argento all'orecchio e' mio: tienilo.
Sono la cosa che mi rende riconoscibile e vanno disegnati nitidi come nella foto, non attenuati: nessuna pelle di plastica, nessun effetto ritoccato.

Indosso gli occhiali da sole della foto prodotto su fondo bianco, IDENTICI: acetato NERO LUCIDO, lenti rettangolari fumé scure, frontale spesso e squadrato, aste larghe e piatte, stessa cerniera. Sono AVVOLGENTI: il frontale curva attorno al mio viso da una tempia all'altra, le lenti seguono la stessa curva e le loro estremita' esterne girano all'indietro verso le tempie, cosi' gli occhiali fasciano il volto come una maschera, aderenti, senza spazio tra montatura e zigomi. Indosso poi la felpa nera a mezza zip dell'immagine della felpa, con la zip CHIUSA fino in cima: il collo alto e' tutto chiuso, dritto e aderente attorno al collo, e il cursore della zip sta proprio sotto il mento. Un filo oversize, zip nera, petto liscio senza nessun logo.

LUCE E COLORE:
- fondo di carta blu cobalto saturo, liscio: quasi navy in alto, e verso il basso un blu piu' chiaro che tende al ciano; nessun alone dietro la testa;
- una sola luce principale BIANCA, piccola e dura, davanti a me e un po' piu' in alto: riflessi lucidi netti su fronte, naso, zigomi e labbra, pelle lucida da servizio moda;
- le ombre non sono nere: le riempie il blu del fondo che rimbalza, quindi i lati del viso, il collo e i contorni prendono una sfumatura blu, mentre le parti colpite dalla luce restano color pelle, chiare e luminose;
- contrasto alto, neri profondi nella felpa.

POSA: mezzo busto, viso quasi frontale ma girato appena, testa un filo inclinata, sguardo distratto appena fuori dall'obiettivo, espressione naturale e rilassata, bocca chiusa.

Fotografia reale e nitida, non un'illustrazione. Pelle naturale e vera, con solo i segni elencati sopra. Quadrata 1:1.`;

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
    join(D, "refs", "bocca-reale-frontale.png"),
    join(D, "refs", "occhiali-gascan-curvi.png"),
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
        cambiato: "giro 10 da zero: nei veri verificati su 3 selfie rasati (un neo in rilievo sulla guancia lato orecchino, un puntino sotto il labbro, pochi puntini chiari); tolti quelli inventati (lentiggini sul naso, due nei sul mento, neo in fronte); orecchino tenuto",
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
