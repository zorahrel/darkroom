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

const CORPO = `Rifai da zero un ritratto editoriale di moda di ME. La prima foto sono io: tieni esattamente il mio viso, i miei ricci, occhi, naso e soprattutto la mia bocca. La seconda immagine e' una tavola con tre mie foto vere da vicino, appena rasato, con gli occhiali da vista: e' la fonte migliore per il mio viso, la pelle rasata, i nei e la bocca; da li' prendi SOLO forme e segni, ignora gli occhiali da vista, la luce, i colori e lo sfondo. La mia bocca: labbro superiore sottile, con l'arco appena accennato; labbro inferiore solo un poco piu' pieno, morbido; labbra di un rosa pallido, quasi dello stesso tono della pelle, rilassate e un po' piatte, chiuse senza stringerle; angoli dritti, ne' in su ne' in giu'; bocca non larga. Niente labbra carnose o disegnate da modello, niente rossetto. Viso glabro, appena rasato con la lametta: sul labbro superiore, sul mento e sulla mascella non ci sono peli ne' ombra di barba, la pelle li' ha lo stesso colore della fronte e degli zigomi. Il mento e la linea della mascella sono lisci e lucidi come la fronte, pelle nuda, con i soli nei elencati sotto: guardati da vicino non mostrano nessun puntino scuro di pelo. Rispetto alla prima foto questa e' l'unica cosa che cambia del mio viso: la pelle resta la mia, vera, con tutti i suoi segni.

I SEGNI DEL MIO VISO sono questi quattro nei, che vedi nella tavola delle mie foto rasate, nella stessa posizione sul mio viso, senza aggiungerne altri:
- dal lato dell'orecchino: (1) un neo in rilievo color pelle con la base scura, circa 3 mm, a meta' tra naso e orecchio; (2) un puntino marrone piccolo nel solco tra guancia e naso, sotto la montatura; (3) un puntino rossastro piccolo in alto sulla guancia, sotto l'angolo degli occhiali;
- dal lato opposto: (4) un neo scuro di circa 2 mm all'altezza dell'angolo della bocca, verso la mascella.
NON ho: lentiggini sul naso, nei sotto il labbro o sul mento, barba. Il naso e il mento sono puliti.
L'orecchino e' un cerchietto piccolo al lobo, dal lato del neo 1: lo porto in ORO giallo (nella tavola sembra argento, e' la luce).
Sono la cosa che mi rende riconoscibile e vanno disegnati nitidi come nella foto, non attenuati: nessuna pelle di plastica, nessun effetto ritoccato.

La terza immagine e' la tavola degli accessori. Indosso gli occhiali da sole a sinistra nella tavola, su fondo bianco, IDENTICI: acetato NERO LUCIDO, lenti rettangolari fumé scure, frontale spesso e squadrato, aste larghe e piatte, stessa cerniera. Sono AVVOLGENTI: il frontale curva attorno al mio viso da una tempia all'altra, le lenti seguono la stessa curva e le loro estremita' esterne girano all'indietro verso le tempie, cosi' gli occhiali fasciano il volto come una maschera, aderenti, senza spazio tra montatura e zigomi. Indosso poi la felpa nera a mezza zip a destra nella tavola, con la zip CHIUSA fino in cima: il collo alto e' tutto chiuso, dritto e aderente attorno al collo, e il cursore della zip sta proprio sotto il mento. Un filo oversize, zip nera, petto liscio senza nessun logo.

LUCE E COLORE:
- la luce della mia prima foto non conta: rifai la luce da zero;
- luce BEAUTY frontale e piatta, in asse con l'obiettivo: un ring flash grande e una luce a conchiglia (clamshell) con pannello bianco sotto il mento, come nei servizi beauty high-key; tutto il viso e' illuminato in modo uniforme, le due guance chiare quanto la fronte, quasi nessuna ombra sul viso: solo una piccola ombra sotto il naso e sotto il mento; nessuna luce laterale;
- pelle "glass skin", dewy: pallida, idratata e LUCIDA, con riflessi speculari netti e quasi bianchi su fronte, dorso del naso, zigomi, arco di Cupido e labbro inferiore, esattamente come la pelle della foto di moda; la pelle riflette la luce, non e' opaca ne' polverosa, ma non e' unta;
- le ombre della pelle sono aperte e ROSATE, un rosa caldo tenue sotto gli zigomi, sotto il mento e sul collo; solo il bordo estremo del profilo e delle spalle prende un filo del blu del fondo;
- fondo di carta liscio in sfumatura: blu navy scuro e profondo in alto e agli angoli; verso il basso, dietro le spalle, si schiarisce in un blu-turchese SPENTO e polveroso, poco saturo, come carta colorata vista in una luce morbida, mai azzurro elettrico;
- contrasto morbido sul viso; i neri profondi sono solo nella felpa.

POSA: mezzo busto, viso quasi frontale ma girato appena, testa un filo inclinata, sguardo distratto appena fuori dall'obiettivo, espressione naturale e rilassata, bocca chiusa.

Fotografia reale e nitida, non un'illustrazione. Pelle naturale e vera, con solo i segni elencati sopra. Quadrata 1:1.`;

const CON_REF = CORPO.replace(
  "LUCE E COLORE:",
  "LUCE E COLORE, presi dalla foto di moda con la ragazza e gli occhiali bianchi (da quella prendi SOLO la luce, la lucentezza della pelle, il colore e il fondo, non la persona, la posa o i vestiti):",
);

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = MATERIA.includes("/") ? join(D, MATERIA) : join(D, "RAW", MATERIA);
  const base = [
    join(D, "refs", "io-tavola-rasato.png"),
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
        cambiato: "giro 15: allegati ridotti da 8 a 4 (partenza, tavola io-tavola-rasato con tre primi piani rasati, tavola accessori con occhiali e felpa, reference della luce); luce riscritta in termini beauty (ring flash in asse, clamshell, pelle glass skin con riflessi speculari) per avere luce piu' piatta e pelle lucida come la reference.",
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
