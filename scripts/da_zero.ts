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

const CORPO = `Ritratto editoriale di moda, mezzo busto, quadrato 1:1. Sono io: la prima foto e' il mio viso e i miei ricci (della prima foto non prendere gli occhiali da vista, il telefono, la maglietta, lo sfondo). La seconda immagine e' la mia tavola di identita' (cheat sheet con la mia foto rasata e i miei 4 nei numerati, bocca, capelli, e in fondo i miei 4 nei ritagliati da vicino alla misura reale): da li' prendi viso, bocca e nei; non la luce, lo sfondo, gli occhiali da vista o la barba. Sono appena rasato: pelle liscia e pulita su guance, mento e labbro, senza ombra di barba.

Sulla pelle ho solo questi 4 nei, piccoli: copiali IDENTICI ai ritagli in fondo alla tavola, stessa misura, stesso colore, stessa posizione sul viso: (1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) e (3) due puntini minuscoli sotto la montatura; (4) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto. Nient'altro.

Bocca: labbra sottili, rosa pallido, chiuse e rilassate. All'orecchio un piccolo cerchietto d'oro giallo, dal lato del neo 1.

Occhiali da sole e felpa come nella terza immagine: occhiali neri lucidi avvolgenti con lenti fume'; felpa nera con la zip chiusa fino al mento, senza logo.

Luce e colore come nella foto di moda con gli occhiali bianchi (solo luce e colore, non la persona): una luce frontale COLORATA, ciano-blu, come un gel davanti al viso: pelle da servizio beauty: liscia, setosa e luminosa, con pori appena visibili e riflessi lucidi netti, quasi bianchi, su fronte, dorso del naso e zigomi; le alte luci sono neutre e fredde, senza arancio; i mezzitoni restano del mio incarnato, mai grigio-blu, le ombre rosa tenue; il ciano sta sul bordo del viso e della mascella; labbra rosa; contrasto medio, non piatto; neri PROFONDI e netti (felpa, occhiali, capelli), quasi senza grigio: la felpa e' nera pece, senza dettaglio nelle pieghe e senza riflessi blu sul tessuto, e' la parte piu' scura dell'immagine; Il freddo e' solo sulla pelle e sul fondo: l'orecchino resta d'ORO giallo brillante e i capelli restano castano scuro con riflessi caldi ramati. Fondo di carta blu navy in alto, blu-turchese in basso, della stessa famiglia di colore della luce. Testa appena inclinata, sguardo fuori dall'obiettivo, espressione rilassata, viso riposato e fresco, pieno e morbido come nelle mie foto (guance piene, mascella non scavata), sopracciglia dritte e rilassate, ne' alzate ne' corrucciate. Fotografia reale e nitida.`;

const CON_REF = CORPO;

// Senza la reference della modella: la luce si descrive e basta, non c'e' una terza foto a cui rimandare.
const SENZA_REF_IT = CORPO.replace(
  "Luce e colore come nella foto di moda con gli occhiali bianchi (solo luce e colore, non la persona): una luce",
  "Luce e colore da servizio di moda in studio: una luce",
);

// Stesso contenuto in inglese (test lingua del prompt). Nomi dei file e dei nei restano gli stessi.
const SENZA_REF_EN = `Editorial fashion portrait, half-length, square 1:1. This is me: the first photo is my face and my curls (from the first photo do NOT take the glasses, the phone, the t-shirt or the background). The second image is my identity sheet (a cheat sheet with my shaved photo and my 4 numbered moles, mouth, hair, and at the bottom my 4 moles cropped close-up at real size): take face, mouth and moles from it; not the light, the background, the prescription glasses or the beard. I just shaved: smooth clean skin on cheeks, chin and upper lip, no trace of stubble.

On my skin I have only these 4 small moles: copy them IDENTICAL to the crops at the bottom of the sheet, same size, same colour, same position on the face: (1) a raised skin-coloured mole on the cheek, toward the ear; (2) and (3) two tiny dots under the frame; (4) a small dark mole near the corner of the mouth, on the opposite side. Nothing else.

Mouth: thin pale-pink lips, closed and relaxed. A small yellow-gold hoop at the ear, on the same side as mole 1.

Sunglasses and hoodie as in the third image: glossy black wraparound sunglasses with smoked lenses; black hoodie zipped up to the chin, no logo.

Light and colour of a studio fashion shoot: a COLOURED frontal light, cyan-blue, like a gel in front of the face: beauty-campaign skin: smooth, silky and luminous, pores barely visible, crisp near-white specular highlights on forehead, nose bridge and cheekbones; highlights are neutral and cool, no orange; midtones stay my own skin tone, never grey-blue, shadows a soft pink; the cyan sits on the edge of the face and jaw; pink lips; medium contrast, not flat; DEEP crisp blacks (hoodie, glasses, hair), almost no grey: the hoodie is pitch black, no detail in the folds and no blue reflections on the fabric, it is the darkest part of the image. The cold is only on the skin and the backdrop: the earring stays bright yellow GOLD and the hair stays dark brown with warm coppery highlights. Paper backdrop navy blue at the top, blue-turquoise at the bottom, same colour family as the light. Head slightly tilted, gaze off-camera, relaxed expression, rested and fresh face, full and soft as in my photos (full cheeks, jaw not hollow), straight relaxed eyebrows, neither raised nor frowning. Real, sharp photograph.`;

// Look nuovo (giro 31): posa distratta, occhiali a specchio, felpa techwear, da una tavola di tre foto VERE (refs/look-tavola.png,
// fatta con mostra.ts da refs/ricerca/). La terza immagine e' quella: prendi solo posa, occhiali, capo, mai volti e sfondi.
const LOOK = `Ritratto editoriale di moda, mezzo busto, quadrato 1:1. Sono io: la prima foto e' il mio viso e i miei ricci (della prima foto non prendere gli occhiali da vista, il telefono, la maglietta, lo sfondo). La seconda immagine e' la mia tavola di identita' (cheat sheet con la mia foto rasata e i miei 4 nei numerati, bocca, capelli, e in fondo i miei 4 nei ritagliati da vicino alla misura reale): da li' prendi viso, bocca e nei; non la luce, lo sfondo, gli occhiali da vista o la barba. Sono appena rasato: pelle liscia e pulita su guance, mento e labbro, senza ombra di barba.

Sulla pelle ho solo questi 4 nei, piccoli: copiali IDENTICI ai ritagli in fondo alla tavola, stessa misura, stesso colore, stessa posizione sul viso: (1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) e (3) due puntini minuscoli sotto gli occhiali; (4) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto. Nient'altro.

Bocca: labbra sottili, rosa pallido, chiuse e rilassate. All'orecchio un piccolo cerchietto d'oro giallo, dal lato del neo 1.

La terza immagine e' una tavola di stile con tre persone che NON sono me: da POSA prendi solo la posa, da OCCHIALI solo gli occhiali, da FELPA solo il capo. Non prendere volti, berretto, collane, sfondi o luce.
POSA: testa abbassata e girata, sguardo distratto verso il basso, fuori campo; una mano alla montatura degli occhiali, come se li stesse abbassando o sistemando, dal lato opposto all'orecchino, cosi' il neo 1 e l'orecchino restano visibili; dita naturali, cinque, ben separate; spalle asimmetriche, aria svagata e sicura di se'.
OCCHIALI: occhiali sportivi a mascherina, lente unica a specchio blu elettrico che riflette il blu del set; sotto la lente si vedono i puntini 2 e 3.
FELPA: capo techwear nero opaco, giacca-felpa con cappuccio abbassato sulle spalle, collo alto, zip nastrata con cursore grande chiusa fino al mento, tasca a zip, cuciture a vista, tessuto tecnico senza logo; nero pece, la parte piu' scura dell'immagine.

Luce e colore da servizio di moda in studio: una luce frontale COLORATA, ciano-blu, come un gel davanti al viso: pelle da servizio beauty: liscia, setosa e luminosa, con pori appena visibili e riflessi lucidi netti, quasi bianchi, su fronte, dorso del naso e zigomi; le alte luci sono neutre e fredde, senza arancio; i mezzitoni restano del mio incarnato, mai grigio-blu, le ombre rosa tenue; il ciano sta sul bordo del viso e della mascella; labbra rosa; contrasto medio, non piatto; neri PROFONDI e netti (felpa, cappuccio, capelli), quasi senza grigio. Il freddo e' solo sulla pelle e sul fondo: l'orecchino resta d'ORO giallo brillante e i capelli restano castano scuro con riflessi caldi ramati. Fondo di carta blu navy in alto, blu-turchese in basso, della stessa famiglia di colore della luce. Espressione rilassata e distratta, viso riposato e fresco, pieno e morbido come nelle mie foto (guance piene, mascella non scavata), sopracciglia dritte e rilassate. Fotografia reale e nitida.`;

// Look trap (giro 32): atteggiamento prima dello stile pulito. Tavola refs/look-trap.png = posa 2 (testa girata, sguardo fuori campo),
// occhiali rosso-arancio a specchio dalla trap-verde, guscio techwear 3. Due varianti: cappuccio giu' (A) e alzato come cornice (B).

// Luce del look trap. BASE = quella dei giri 32-33 (la luce arrivava di lato: meta' viso nera). FRONTE = geometria della reference
// (una sorgente grande sull'asse dell'obiettivo, riempimento dal basso). FORTE = come FRONTE ma il colore del gel si vede sulla pelle.
const LUCE_BASE = `Luce e colore da servizio di moda in studio: una luce frontale COLORATA, ciano-blu, come un gel davanti al viso: pelle da servizio beauty: liscia, setosa e luminosa, con pori appena visibili e riflessi lucidi netti, quasi bianchi, su fronte, dorso del naso e zigomi; le alte luci sono neutre e fredde, senza arancio; i mezzitoni restano del mio incarnato, mai grigio-blu, le ombre rosa tenue; il ciano sta sul bordo del viso e della mascella; labbra rosa; contrasto medio, non piatto; neri PROFONDI e netti (giacca, capelli), quasi senza grigio.`;
const LUCE_FRONTE = `Luce e colore da servizio beauty: UNA sola sorgente grande e morbida (softbox) DAVANTI al viso, sull'asse dell'obiettivo e appena sopra, con un gel ciano-blu; avvolge tutto il viso in modo uniforme, come nelle foto beauty di moda: nessuna meta' del viso in ombra, nessuna luce laterale, nessuna ombra dura sul lato lontano. Un pannello bianco dal basso alza le ombre sotto mento, naso e orbite. Il viso e' CHIARO e luminoso, non scuro ne' in penombra: pelle liscia, setosa, pori appena visibili, riflessi lucidi netti quasi bianchi su fronte, dorso del naso, zigomi e labbro superiore; le alte luci sono neutre e fredde, senza arancio; i mezzitoni restano del mio incarnato; labbra rosa; contrasto medio. Neri PROFONDI e netti (guscio, capelli), quasi senza grigio.`;
const LUCE_FORTE = LUCE_FRONTE.replace("con un gel ciano-blu;", "con un gel ciano-blu SATURO, il cui colore si vede sulla pelle: alte luci bianco-azzurre, mezzitoni con un velo ciano, ombre blu profondo ai bordi del viso e della mascella;");
const GIACCA_SPAZIALE = "GIACCA: giacca techwear da tuta spaziale, nero opaco, SENZA scritte, loghi, bandiere, patch ne' etichette di nessun tipo; SENZA CAPPUCCIO: la giacca non ha cappuccio, ne' alzato ne' abbassato ne' ripiegato dietro il collo, dietro il collo si vede il fondo, nessun tessuto. COLLETTO alto rigido a fascia che arriva sotto la mascella, con un BORDO SPESSO: bordatura in nastro gommato termosaldato larga circa 2 cm tutto intorno al colletto, alle tasche e ai pannelli, ben visibile e in rilievo come un cordolo. ZIP: zip stagna nastrata, sicura, coperta da una PATTA paravento che si chiude con velcro nero e due automatici; in alto la zip finisce dentro un garage (tasca di protezione) imbottito; il cursore e' corto e bassissimo, a filo del tessuto, NESSUN tirazip lungo o penzolante, nessuna linguetta che pende. Spalle e petto a pannelli a blocchi con cuciture a vista, una grande tasca pettorale a blocco con zip nastrata e patta, tasche utility, una cinghia con fibbia che attraversa il petto, tessuto tecnico opaco; nero pece, la parte piu' scura dell'immagine.";
const felpaTrap = (alzato: boolean, spaziale = false) =>
  spaziale
    ? GIACCA_SPAZIALE
    : alzato
    ? "FELPA: guscio techwear nero opaco, cappuccio ALZATO sul capo come una cornice attorno al viso, cordino tirato; i miei ricci escono sulla fronte e sulle tempie, ben visibili; collo alto chiuso fino al mento, zip nastrata con cursore grande, tasca a zip, cuciture a vista, nessun logo; nero pece, la parte piu' scura dell'immagine."
    : "FELPA: guscio techwear nero opaco, collo alto a imbuto chiuso fino al mento e oltre, cappuccio abbassato sulle spalle, zip nastrata con cursore grande, tasca a zip, cuciture a vista, nessun logo; nero pece, la parte piu' scura dell'immagine.";
const OCCHIALI_ROSSI = "occhiali sportivi avvolgenti, montatura rossa lucida e lenti a specchio rosso-arancio che riflettono il blu del set; sotto le lenti si vedono i puntini 2 e 3.";
const OCCHIALI_NERI = "i miei occhiali neri lucidi a mascherina avvolgente, come nella foto OCCHIALI: montatura nera lucida spessa, stanghette larghe che girano attorno alla testa, lenti scure fume' (nessuno specchio, nessun colore); sotto le lenti si vedono i puntini 2 e 3.";
const lookTrap = (alzato: boolean, luce = LUCE_BASE, spaziale = false, occhiali = OCCHIALI_ROSSI) => `Ritratto editoriale di moda, primo piano stretto (viso grande, spalle tagliate), quadrato 1:1. Sono io: la prima foto e' il mio viso e i miei ricci (della prima foto non prendere gli occhiali da vista, il telefono, la maglietta, lo sfondo). La seconda immagine e' la mia tavola di identita' (cheat sheet con la mia foto rasata e i miei 4 nei numerati, bocca, capelli, e in fondo i miei 4 nei ritagliati da vicino alla misura reale): da li' prendi viso, bocca e nei; non la luce, lo sfondo, gli occhiali da vista o la barba. Sono appena rasato: pelle liscia e pulita su guance, mento e labbro, senza ombra di barba.

Sulla pelle ho solo questi 4 nei, piccoli: copiali IDENTICI ai ritagli in fondo alla tavola, stessa misura, stesso colore, stessa posizione sul viso: (1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) e (3) due puntini minuscoli sotto gli occhiali; (4) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto. Nient'altro.

Bocca: labbra sottili, rosa pallido, chiuse. All'orecchio un piccolo cerchietto d'oro giallo, dal lato del neo 1.

La terza immagine e' una tavola di stile con tre persone che NON sono me: da POSA prendi solo la posa e l'atteggiamento, da OCCHIALI solo gli occhiali e l'attitudine dura, da FELPA solo il capo. Non prendere volti, pelo verde, orecchini, sfondi, colori della luce.
POSA: testa girata di tre quarti, il lato con il neo 1 e l'orecchino verso l'obiettivo (il neo 4 resta visibile all'angolo della bocca), sguardo fuori campo, duro e annoiato, sopracciglia leggermente corrucciate, mento appena alzato; nessuna mano nel quadro.
OCCHIALI: ${occhiali}
${felpaTrap(alzato, spaziale)}

${luce} Il caldo sta solo negli occhiali e nell'orecchino d'ORO giallo brillante; i capelli restano castano scuro con riflessi caldi ramati. Fondo di carta blu navy in alto, blu-turchese in basso, della stessa famiglia di colore della luce. Viso pieno e morbido come nelle mie foto (guance piene, mascella non scavata). Fotografia reale e nitida.`;

const giri = Number(process.argv[process.argv.indexOf("--giri") + 1] ?? 2) || 2;

await withProject(PROGETTO, async () => {
  initSchema();
  const D = dirsFor(PROGETTO).DATA_DIR;
  const materia = MATERIA.includes("/") ? join(D, MATERIA) : join(D, "RAW", MATERIA);
  const base = [
    join(D, "refs", "io-identita-nei.png"),
    join(D, "refs", "accessori-tavola.png"),
  ];
  const ref = join(D, "refs", "luce-bg-studio-blu.png");
  const look = join(D, "refs", "look-tavola.png");
  const lookT = join(D, "refs", "look-trap.png");
  const lookT2 = join(D, "refs", "look-trap2.png");
  const lookT3 = join(D, "refs", "look-pose-occhiali-giacca.png");
  for (const p of [materia, ref, look, lookT, lookT2, lookT3, ...base]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

  const tutte = [
    { nome: "con-ref", prompt: CON_REF, refs: [...base, ref] },
    { nome: "it-senza-ref", prompt: SENZA_REF_IT, refs: base },
    { nome: "en-senza-ref", prompt: SENZA_REF_EN, refs: base },
    { nome: "look", prompt: LOOK, refs: [base[0]!, look] },
    { nome: "trap-a", prompt: lookTrap(false), refs: [base[0]!, lookT] },
    { nome: "trap-b", prompt: lookTrap(true), refs: [base[0]!, lookT] },
    { nome: "trap-fronte", prompt: lookTrap(false, LUCE_FRONTE), refs: [base[0]!, lookT] },
    { nome: "trap-forte", prompt: lookTrap(false, LUCE_FORTE), refs: [base[0]!, lookT] },
    { nome: "spaz-fronte", prompt: lookTrap(false, LUCE_FRONTE, true), refs: [base[0]!, lookT2] },
    { nome: "spaz-forte", prompt: lookTrap(false, LUCE_FORTE, true), refs: [base[0]!, lookT2] },
    { nome: "neri-forte", prompt: lookTrap(false, LUCE_FORTE, true, OCCHIALI_NERI), refs: [base[0]!, lookT3] },
    { nome: "neri-fronte", prompt: lookTrap(false, LUCE_FRONTE, true, OCCHIALI_NERI), refs: [base[0]!, lookT3] },
  ];
  // `--var it-senza-ref,en-senza-ref`: le varianti si alternano giro dopo giro. Default: con-ref.
  const iV = process.argv.indexOf("--var");
  const scelte = iV > 0 ? process.argv[iV + 1]!.split(",") : ["con-ref"];
  const varianti = scelte.map((n) => tutte.find((t) => t.nome === n) ?? (() => { throw new Error(`variante sconosciuta: ${n}`); })());
  for (let g = 1; g <= giri; g++) {
    const v = varianti[(g - 1) % varianti.length]!;
    const job = enqueueJob(
      PHOTO, v.prompt, null, "chatgpt", null, "edit", materia, JSON.stringify(v.refs),
      JSON.stringify({
        recipe: `da-zero-${v.nome}`,
        // La UI chiama «ritocco» ogni versione con `materia`: solo se parte da un'altra immagine, non dall'originale.
        ...(iM > 0 ? { partenza: MATERIA } : {}),
        cambiato: `giro 30: variante ${v.nome} (test senza la reference della modella, prompt italiano contro inglese). Prima, giro 29: pelle beauty liscia e lucida con riflessi quasi bianchi, alte luci neutre (reference a 0 e b 7, nostre a 12 e b 17, specular 1.5% contro 0.2%). Prima, giro 28: sopracciglia dritte, viso pieno (v317 era angoloso e corrucciato), felpa la parte piu' scura (10 contro 6-7). Prima, giro 27: felpa nera pece (nei giri dal selfie i neri erano 15-18, reference 6-7) e viso riposato non stanco. Prima, giro 26: foto di partenza = selfie rasato (derivate/io-rasato-2023-06-23-p08-dritto.jpg) invece di 1.PNG, che ha la barba corta e la passava ai tiri; giro 25 aveva tolto i primi piani senza effetto sulla grana. Prima, giro 25: tavola io-identita-nei.png = cheat sheet + 4 nei, SENZA i tre primi piani rasati (test grana mascella). Prima, giro 24: incarnato caldo beige dorato (mio), ciano solo su ombre e bordo; nel giro 23 la pelle era pallida e grigio-blu. Prima, giro 23: luce fredda ma orecchino d'ORO e capelli castani caldi (nel giro 22 erano diventati argento e neri). Prima, giro 22: luce frontale COLORATA ciano-blu come la reference (pelle fredda, neri profondi, contrasto medio) al posto di «morbida e piatta». Prima, giro 21: io-unica-nei.png = io-unica + fascia con i 4 nei veri ritagliati da p08 alla misura reale; prompt: copiali identici. Prima, giro 20: prompt riscritto corto (1400 car. contro 5500), in positivo, quasi senza divieti. Prima, giro 19: sotto la montatura solo i puntini 2 e 3, in tutto due. Prima, giro 18: nei piccoli e della misura vera (neo 1 color pelle in rilievo, 2 e 3 minuscoli), nessun puntino sparso. Prima, giro 17: orecchino d'ORO senza la frase sull'argento, neo 4 ben visibile. Prima, giro 16: le mie reference unite in una sola immagine (io-unica.png = cheat sheet con nei numerati + tre primi piani rasati); allegati: partenza, io-unica, accessori-tavola, reference. Luce come il giro 15.`,
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
