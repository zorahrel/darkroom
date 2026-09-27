/**
 * Secondo giro della luce da solo prompt, corretto sulle misure di v168/v169.
 *
 *                 ciano centro  ciano bordi  a* luci  b* luci  alte luci
 *   reference         52,7%        28,2%      -9,8     +4,4      97,4
 *   v168              12,5%        39,6%      -8,4    -11,4      86,5
 *
 * Il segno del colore delle alte luci ora e' giusto (freddo). Tre scarti:
 * il ciano e' finito sul CONTORNO invece che sul viso, e' BLU mentre la
 * reference e' verde-acqua (b* positivo), e le alte luci sono meno bianche.
 * Cambia solo il blocco LUCE. Reference sempre non allegata.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";
const PHOTO = "1";
const MATERIA = "1.PNG";

const PROMPT = `Questa foto sono IO. Rifalla come un ritratto da studio, tenendo il mio viso esattamente com'e'.

GLI ALLEGATI, uno per uno:
1. il ritaglio ravvicinato della MIA bocca (naso, bocca e mento);
2. i MIEI occhiali da sole su fondo grigio;
3. la MIA felpa nera, vista da sola su un manichino invisibile.

CHI SONO. Sono un ragazzo MAGRO e ossuto, corporatura esile. Viso stretto e lungo, zigomi sottili, mascella normale, mento non squadrato. Collo sottile, piu' stretto della testa, pomo d'Adamo sporgente. Spalle strette e cadenti. Non allargarmi, non irrobustirmi, non simmetrizzarmi il viso, non ringiovanirmi. I miei capelli sono CASTANI SCURI e ricci. Il mio viso e' completamente GLABRO: guance, mento, mascella, collo e labbro superiore hanno la stessa pelle liscia, chiara e uniforme della fronte, dello stesso identico colore: la zona fra naso e labbro e il mento sono chiari e puliti quanto le guance. Ignora la posa e le mani della foto: niente mano vicino al viso.

LA MIA BOCCA e' esattamente quella del ritaglio allegato: labbra chiuse e rilassate, niente sorriso, niente denti. E' una bocca stretta.

GLI OCCHIALI DA SOLE sono esattamente quelli dell'immagine su fondo grigio: stessa forma, proporzioni, spessore della montatura e curvatura.

LA POSA e' quasi FRONTALE ma non in posa: il viso e' rivolto verso la camera, girato solo di poco (circa 10-15 gradi) verso la destra dell'immagine, e la testa e' appena inclinata di lato, un filo storta, non dritta come in una foto tessera. Lo sguardo e' distratto: gli occhi guardano appena fuori asse, un po' oltre la camera e leggermente in basso, come se stessi pensando ad altro, non dentro l'obiettivo. Spalle rilassate e un po' asimmetriche, quasi di fronte alla camera, bocca chiusa e rilassata. Sono sovrappensiero, fermo, tranquillo.

LA LUCE sul mio viso e' una luce da studio DURA e contrastata, bianca appena calda (circa 5000 K): un beauty dish argentato SENZA diffusore, piccolo e vicino, messo in ALTO e davanti a me, sopra la camera, che scende sul viso da circa 30 gradi. Il volto e' illuminato di fronte in modo pieno, ma con CONTRASTO forte da editoriale di moda: fronte, dorso del naso, zigomi e labbro inferiore hanno riflessi speculari quasi bianchi e lucidi; guance e mento sono color pesca caldo e saturo, il colore vero della mia pelle; le ombre sono nette e profonde: sotto il naso un'ombra corta e definita, sotto gli zigomi un incavo scuro, sotto la mascella e sul collo un'ombra densa. La luce cala in fretta verso i bordi del viso. Nessuna luce di riempimento: il lato in ombra resta scuro.

IL BLU viene tutto da DIETRO di me: il fondale azzurro illuminato rimbalza e disegna un sottile bordo di luce ciano-azzurra lungo il contorno esterno di capelli, spalle e braccia, piu' marcato sul lato destro dell'immagine, e un riflesso bianco-azzurro sulla sommita' dei capelli. E' una luce di contorno: sfiora i bordi della figura e resta dietro, mentre la parte frontale del viso ha il colore caldo e naturale della pelle sotto la luce bianca.

LA PELLE e' RITOCCATA come in un servizio di moda: tono uniforme e pulito, senza imperfezioni, senza brufoli, macchie, rossori, occhiaie. E' una pelle LUCIDA e rugiadosa, glow da editoriale: calda, color pesca, con riflessi brillanti dove la luce la colpisce, mai opaca, mai grigia, mai pallida. Superficie liscia, sfumature di tono continue.

IL FONDO e' un fondale seamless blu illuminato in modo UNIFORME, con un gradiente solo VERTICALE: navy scuro in alto che schiarisce dolcemente fino a un ciano-teal luminoso in basso. Nessun alone, nessuno spot, nessuna macchia di luce dietro la testa o le spalle: a ogni altezza il fondo ha lo stesso colore da sinistra a destra. Mi stacco dal fondo per contrasto fra la pelle calda e luminosa e il blu.

INQUADRATURA: mezzo busto stretto con un 50mm: la testa occupa circa due quinti dell'altezza, si vedono le spalle e l'inizio del petto.

VESTITO: indosso la felpa della terza immagine allegata, identica: nera a mezza zip, leggermente OVERSIZE e morbida, spalle scese, con il collo ALTO a imbuto che copre meta' del mio collo; zip nera opaca tono su tono chiusa in alto. Mi cade morbida addosso, e si capisce comunque che sotto sono magro.

Quadrata 1:1.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = join(D, "RAW", MATERIA);
  const refs = [
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
    join(D, "refs", "giacca-armonia-nera-v4.png"),
  ];
  for (const p of [materia, ...refs]) if (!existsSync(p)) throw new Error(`manca: ${p}`);
  // Controllo sulle frasi che si contraddicevano: non devono tornare.
  for (const vietata of ["ritratto di studio", "UN'ALTRA PERSONA", "OPACA", "matificante", "senza punti speculari", "NON e' una persona", "secondo scatto"]) {
    if (PROMPT.includes(vietata)) throw new Error(`il prompt contiene di nuovo: ${vietata}`);
  }

  // Due varianti per confronto, un tiro ciascuna: il testo di ChatGPT parola
  // per parola, e lo stesso con «verde» -> «ciano» (l'utente ha bocciato il
  // verde su v170). Cosi' si vede se quella parola sposta la tinta.
  const varianti = [
    { nome: "dura-lucida", prompt: PROMPT },
  ];
  for (let g = 1; g <= giri; g++) {
    const v = varianti[(g - 1) % varianti.length]!;
    const job = enqueueJob(
      PHOTO,
      v.prompt,
      null,
      "chatgpt",
      null,
      "edit",
      materia,
      JSON.stringify(refs),
      JSON.stringify({
        recipe: `luce-${v.nome}`,
        materia: MATERIA,
        cambiato: "ricetta di v215 con luce dura e contrastata (beauty dish senza diffusore, riflessi lucidi, ombre profonde), pelle calda e lucida invece che morbida e opaca, fondo uniforme a gradiente solo verticale senza alone dietro la testa",
        refs: refs.map((r) => r.split("/").pop()),
        misura: "uniformita' zone > 0,8 (v198 0,91) E ciano sulla fronte > 50% (ref 90, v198 0)",
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[asse] job ${job.id}  ${v.nome}  verde:${(v.prompt.match(/verde/gi) || []).length}`);
  }
});
