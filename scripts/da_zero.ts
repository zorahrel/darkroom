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

const CORPO = `Rifai da zero un ritratto editoriale di moda di ME. La prima foto sono io: tieni esattamente il mio viso, i miei ricci, occhi, naso e soprattutto la mia bocca, che e' quella dei quattro ritagli della bocca (sono tutti io, di fronte): prendi da li' SOLO la forma, non il colore caldo della luce ne' la barba. La mia bocca: labbro superiore sottile, con l'arco appena accennato; labbro inferiore solo un poco piu' pieno, morbido; labbra di un rosa pallido, quasi dello stesso tono della pelle, rilassate e un po' piatte, chiuse senza stringerle; angoli dritti, ne' in su ne' in giu'; bocca non larga. Niente labbra carnose o disegnate da modello, niente rossetto. Viso glabro, appena rasato con la lametta: sul labbro superiore, sul mento e sulla mascella non ci sono peli ne' ombra di barba, la pelle li' ha lo stesso colore della fronte e degli zigomi. Rispetto alla prima foto questa e' l'unica cosa che cambia del mio viso: la pelle resta la mia, vera, con tutti i suoi segni.

I SEGNI DEL MIO VISO, che devono restare tutti al loro posto come nella prima foto:
- un neo marrone in leggero rilievo sulla guancia sinistra, in basso, dove la guancia diventa mascella;
- un piccolo neo scuro sulla fronte, all'attaccatura dei capelli sul lato sinistro;
- un puntino scuro sul lato sinistro del naso, vicino alla narice;
- qualche lentiggine chiara sparsa sulla guancia sotto l'occhio e sul naso;
- una linea sottile orizzontale sulla fronte;
- un piccolo neo sotto il labbro inferiore, sul lato sinistro, vicino all'angolo della bocca.
Sono la cosa che mi rende riconoscibile: nessuna pelle di plastica, nessun effetto ritoccato.

Indosso occhiali da sole con la FORMA esatta di quelli dell'immagine degli occhiali (il ritaglio della foto di moda), ma in NERO LUCIDO invece che bianchi: una maschera grossa e avvolgente, con la montatura spessissima e piatta, spessa quasi quanto un terzo dell'altezza delle lenti; una barra superiore dritta e larga all'altezza delle sopracciglia; lenti grandi e alte, scure quasi nere, che vanno dall'arcata sopraccigliare fino a meta' zigomo; e ai lati la montatura larga che gira attorno alla testa fino alle tempie, senza stanghette sottili. Indosso poi la felpa nera a mezza zip dell'immagine della felpa, con la zip CHIUSA fino in cima: il collo alto e' tutto chiuso, dritto e aderente attorno al collo, e il cursore della zip sta proprio sotto il mento. Un filo oversize, zip nera, petto liscio senza nessun logo.

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
    join(D, "refs", "bocca-reale-frontale.png"),
    join(D, "refs", "occhiali-forma-reference.png"),
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
        cambiato: "giro 5 da zero: bocca descritta com'e' (labbro superiore sottile, rosa pallido, piatta) al posto di «labbra piene», ritaglio nuovo con quattro mie bocche frontali, neo sotto il labbro; nessun ritocco dopo",
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
