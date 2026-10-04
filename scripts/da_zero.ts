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
// Quarta immagine: altre mie foto rasate (refs/io-volti-rasato.png), solo per viso e pelle pulita.
// Solo testo, senza la quarta immagine: con le tre foto di volti il modello appiattiva posa e occhiali (v370-v373).
const CLAUSOLA_PELLE = "\n\nLa pelle e' liscia e pulita su tutto il viso, in particolare sulla guancia e sulla mascella in ombra: senza puntini rossi, senza brufoletti, senza efelidi e senza ombra di barba. Gli unici segni sono i miei 4 nei.";
const CLAUSOLA_SCELTE = "\n\nLa QUARTA immagine sono tre mie foto scelte da me (rasato, barba, occhiali da vista): servono SOLO per la forma del viso, gli occhi, il naso, la bocca e i nei. Il viso nella foto finale e' rasato e con la pelle liscia e pulita: niente barba, niente ombra di barba, niente puntini rossi, niente brufoletti. Non prendere occhiali da vista, luce, sfondo, magliette o felpe.";
const CLAUSOLA_VOLTI = "\n\nLa QUARTA immagine sono altre tre mie foto, rasato: serve SOLO per il viso e per la pelle liscia e pulita di guance, mascella e collo. Non prendere gli occhiali da vista, la luce gialla, lo sfondo, i vestiti. La pelle e' senza puntini rossi, senza brufoletti, senza efelidi e senza ombra di barba, su tutto il viso e in particolare sulla guancia e sulla mascella in ombra: gli unici segni sono i miei 4 nei.";
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

// Senza la tavola identita' (la prima ref): le foto scelte da Attilio sono l'unica fonte del viso, e l'espressione
// non e' piu' «dura e annoiata» (veniva dal prompt, non dalle foto). Le immagini diventano: 1 partenza, 2 stile, 3 volti.
const senzaTavola = (luce: string) =>
  lookTrap(false, luce, true, OCCHIALI_NERI)
    .replace(/La seconda immagine e' la mia tavola di identita'.*?la barba\./s,
      "La terza immagine sono tre mie foto scelte (rasato, barba, occhiali da vista): da li' prendi viso, occhi, naso, bocca e nei; non la luce, lo sfondo, gli occhiali da vista, la barba o la stanchezza dello sguardo.")
    .replace("copiali IDENTICI ai ritagli in fondo alla tavola, stessa misura, stesso colore, stessa posizione sul viso", "copiali dalle mie foto, stessa misura, stesso colore, stessa posizione sul viso")
    .replace("La terza immagine e' una tavola di stile", "La seconda immagine e' una tavola di stile")
    .replace("sguardo fuori campo, duro e annoiato, sopracciglia leggermente corrucciate, mento appena alzato", "sguardo fuori campo, distratto ma sveglio e disteso, sopracciglia rilassate, mento a livello, bocca chiusa e morbida (espressione fresca e riposata, niente stanchezza, niente broncio, niente cipiglio)")
    + CLAUSOLA_SCELTE.replace("La QUARTA immagine", "La TERZA immagine");

// Senza io-scelte (le tre foto hanno barba e quella grana azzurra tornava sulla mascella): il viso e' quello della
// prima foto, rasata, e la pelle si chiede liscia a parole. Immagini: 1 partenza, 2 stile.
const CLAUSOLA_LISCIA = "\n\nPelle di guance, mascella, mento e collo liscia e rasata di fresco: nessuna grana, nessuna peluria, nessuna ombra di barba, nessuna texture a puntini; solo i miei 4 nei.";
const senzaVolti = (luce: string) =>
  senzaTavola(luce)
    .replace(/La terza immagine sono tre mie foto scelte.*?stanchezza dello sguardo\./s, "Il viso e' quello della prima foto (forma, occhi, naso, bocca, nei), sveglio e riposato.")
    .replace(CLAUSOLA_SCELTE.replace("La QUARTA immagine", "La TERZA immagine"), "")
    + CLAUSOLA_LISCIA;

// Giro 33: solo i DUE nei che il modello non inventa, il 1 (in rilievo, accanto all'orecchino) e il 4 (angolo della bocca,
// lato opposto), che qui diventa il 2. Su v393 il puntino scuro sotto la montatura era disegnato dal modello, piu' grande
// e in un punto diverso dal mio solco minuscolo: la zona sotto gli occhiali si chiede uniforme, senza puntini.
const sost = (t: string, a: string, b: string) => {
  if (!t.includes(a)) throw new Error(`frase non trovata: ${a.slice(0, 60)}`);
  return t.split(a).join(b);
};
const dueNei = (luce: string) => {
  let t = senzaVolti(luce);
  t = sost(t, "Sulla pelle ho solo questi 4 nei, piccoli:", "Sulla pelle ho solo questi 2 nei, piccoli:");
  t = sost(t, "; (2) e (3) due puntini minuscoli sotto gli occhiali; (4) un neo scuro", "; (2) un neo scuro");
  t = sost(t, "Nient'altro.", "Nient'altro: il resto del viso e' pelle uniforme, nessun altro neo o puntino, e la pelle sotto le lenti e accanto al naso e' liscia, senza segni.");
  t = sost(t, "; sotto le lenti si vedono i puntini 2 e 3.", ". Sotto le lenti la pelle e' liscia e uniforme, senza puntini.");
  t = sost(t, "il neo 4 resta visibile", "il neo 2 resta visibile");
  t = sost(t, "solo i miei 4 nei.", "solo i miei 2 nei.");
  const resti = t.match(/puntini 2 e 3|4 nei|neo 4|\(3\)|\(4\)/g);
  if (resti) throw new Error(`rimasti riferimenti ai nei tolti: ${resti.join(", ")}`);
  return t;
};

// Giro 34: due nei (come il 33) con la luce forte, che era la piu' luminosa (v394 54, v396 60 contro 48 e 46 della frontale),
// piu' una frase su esposizione e incarnato: la forte da sola raffredda troppo (v396 b 2,7 contro 12,3 della reference).
const CLAUSOLA_CHIARO = "\n\nEsposizione: il viso e' ben illuminato e luminoso, luce alta e piena sulla pelle, ombre aperte e morbide, nessuna guancia che cade nel buio. L'incarnato resta caldo, beige dorato e naturale: il freddo del gel sta solo sul bordo del viso e sulla mascella, mai al centro della pelle, che non deve sembrare gesso ne' pallida.";
// Giro 35: le tre foto scelte da Attilio, ma RITAGLIATE dalla fronte al naso (refs/io-volti-alti.png): niente barba nel
// ritaglio, quindi il modello non la copia (con io-scelte intera tornava la grana su mascella e mento). Bocca e mento
// vengono dalla prima immagine. Immagini: 1 partenza, 2 stile, 3 volti alti.
const CLAUSOLA_ALTI = "\n\nLa TERZA immagine sono tre mie foto scelte da me, ritagliate dalla fronte al naso: servono SOLO per la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso e il neo 1 (nei due selfie si vede il neo in rilievo sulla guancia, accanto all'orecchino). Bocca, mento, mascella e collo NON sono in quelle foto: vengono dalla prima immagine e restano lisci e rasati di fresco, senza barba. Non prendere occhiali da vista, luce, sfondo, la mano, la maglietta o la felpa.";
// Giro 36: le tre foto scelte da Attilio INTERE, cosi' come sono (niente ritagli: «non c'era bisogno di tagliarle»).
// Immagini: 1 partenza, 2 stile, 3-5 le sue tre foto.
const CLAUSOLA_INTERE = "\n\nLe immagini dalla TERZA alla QUINTA sono tre mie foto scelte da me, intere: servono SOLO per la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca e il neo 1. Mento, mascella e collo restano lisci e rasati di fresco come nella prima immagine: in due di quelle foto c'e' un po' di barba e non va copiata. Non prendere occhiali da vista, luce, sfondo, la mano, il telefono, la maglietta o la felpa.";
// Giro 37 «premium»: Attilio, su v410: «non mi sembra premium, la giacca e' di plastica e i bottoni sembrano cinesi, gli
// occhiali non sono ancora i miei affusolati, manca la luce frontale come la reference». Cause trovate: (1) la tavola di stile
// conteneva una posa con luce laterale rosso-blu e il modello copiava QUELLA luce; (2) gli occhiali erano una miniatura;
// (3) la giacca chiedeva nastro gommato e automatici. Ora: tavola solo occhiali + giacca (grandi), posa a parole, giacca tono su
// tono senza bottoni, luce frontale con la testa quasi di fronte. Immagini: 1 partenza, 2 tavola, [3 luce modella], poi le sue 3 foto.
const premium = (conLuceRef: boolean) => {
  const n = conLuceRef ? 4 : 3;
  const luceRef = conLuceRef
    ? `\n\nLa TERZA immagine e' una foto di moda con una modella: serve SOLO per la luce e il colore del fondo. Non prendere la persona, gli occhiali bianchi, la mano, la posa, la collana, i capelli.`
    : "";
  return `Ritratto editoriale di moda di alta gamma, campagna di un marchio techwear di lusso. Primo piano stretto: viso grande, colletto e spalle in quadro, quadrato 1:1.

PERSONA. Sono io. La prima immagine e' il mio selfie rasato: da li' prendi viso, ricci e bocca (labbra sottili, rosa pallido, chiuse). Le immagini dalla ${n === 4 ? "QUARTA alla SESTA" : "TERZA alla QUINTA"} sono tre mie foto scelte da me, intere: servono SOLO per la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca e il neo 1. Mento, mascella e collo restano lisci e rasati di fresco come nella prima immagine: in due di quelle foto c'e' un po' di barba e non va copiata. Non prendere occhiali da vista, luce, sfondo, mano, telefono, magliette o felpe.
Sulla pelle ho solo questi 2 nei, piccoli, copiati dalle mie foto: (1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto. Nient'altro: pelle uniforme, nessun altro neo o puntino, liscia anche sotto le lenti. All'orecchio un piccolo cerchietto d'ORO giallo, dal lato del neo 1.

La seconda immagine e' una tavola con due oggetti, non persone: OCCHIALI e GIACCA.
OCCHIALI: i miei occhiali neri lucidi a mascherina avvolgente, IDENTICI a quelli della foto: frontale spesso e piatto, lenti scure fume' grandi e basse, stanghette larghe a lama che si AFFUSOLANO verso l'orecchio e girano attorno alla testa; montatura e lenti formano un'unica fascia che fascia il viso. Nero lucido, nessun logo, nessuno specchio, nessun colore.
GIACCA: giacca techwear di lusso nello stile della foto (Acronym, Veilance), SENZA CAPPUCCIO (dietro il collo si vede il fondo), senza scritte, loghi, bandiere o patch. Tessuto: nylon tecnico a tre strati, OPACO e spesso, con grana fine di twill, che cade con pieghe pesanti e credibili; niente effetto plastica, niente lucido gommoso. Colletto alto e rigido, strutturato, sotto la mascella, con una bordatura spessa circa 2 cm in tessuto nello STESSO nero (tono su tono, cucitura saldata a filo), non un nastro grigio lucido. Chiusura: zip stagna nascosta sotto una patta paravento piatta; NESSUN bottone visibile, nessun automatico, nessun bottone a pressione, nessun velcro a vista, nessun tirazip che penzola; in alto la zip finisce in un garage imbottito. Una tasca pettorale a blocco con zip nastrata tono su tono. Ferramenta minima, in metallo nero anodizzato opaco, fatta bene: al massimo una fibbia a sgancio sulla cinghia, mai di plastica lucida. Tutto nero pece, tono su tono, senza grigio.${luceRef}

POSA: testa girata di soli 15-20 gradi, quasi frontale, il lato con il neo 1 e l'orecchino un poco piu' verso l'obiettivo; mento a livello, sguardo fuori campo, distratto ma sveglio, bocca chiusa e morbida, sopracciglia rilassate; nessuna mano nel quadro.

LUCE: UNA sola sorgente grande e morbida (beauty dish con softbox) esattamente DAVANTI al viso, sull'asse dell'obiettivo e appena sopra, con un gel ciano-blu; avvolge tutto il viso: tutte e due le guance, la fronte, il naso e il mento sono illuminati allo stesso modo; le uniche ombre sono sotto le lenti, sotto il naso e sotto il mento, aperte da un pannello bianco dal basso. Nessuna luce laterale, nessuna meta' del viso in penombra. Pelle luminosa con pori appena visibili e riflessi lucidi netti, quasi bianchi, su fronte, dorso del naso, zigomi e labbro superiore; alte luci neutre e fredde senza arancio; mezzitoni del mio incarnato beige dorato, mai grigio-blu; ombre rosa tenue; il ciano sta sul bordo del viso e sulla mascella; labbra rosa. Fondo di carta blu navy in alto e blu-turchese in basso, della stessa famiglia di colore della luce. Il caldo sta solo nell'orecchino d'ORO e nei capelli castano scuro con riflessi ramati.

QUALITA': fotografia reale da campagna di alta gamma, obiettivo 85 mm, nitida sul viso e sul tessuto, profondita' di campo ridotta dietro le spalle; pelle con grana naturale, tessuti con trama leggibile, niente aspetto da render, niente plastica, niente effetto AI. Neri profondi e netti. Il viso e' pieno e morbido come nelle mie foto (guance piene, mascella non scavata) e ben illuminato, non scuro.${CLAUSOLA_LISCIA}`;
};
// Giro 38: SENZA foto di partenza. Il selfie `p08` (specchio, telefono, occhiali da vista, maglietta, luce gialla, ombra di
// barba su guance e mento) era l'unica cosa presente in ogni giro dal v266: in modalita' «modifica» il modello ne ereditava barba,
// espressione e posa. Qui si genera puro (`mode: generate`): immagini 1 tavola occhiali+giacca, 2 luce della modella, 3-5 le tre
// foto che Attilio ha scelto. Il testo e' quello di `premium(true)` con la persona riscritta e i numeri delle immagini scalati.
const premiumPura = () => {
  const sost: [string, string][] = [
    [`La prima immagine e' il mio selfie rasato: da li' prendi viso, ricci e bocca (labbra sottili, rosa pallido, chiuse). Le immagini dalla QUARTA alla SESTA sono tre mie foto scelte da me, intere: servono SOLO per la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca e il neo 1. Mento, mascella e collo restano lisci e rasati di fresco come nella prima immagine: in due di quelle foto c'e' un po' di barba e non va copiata.`,
     `Le immagini dalla TERZA alla QUINTA sono tre mie foto, intere: da li' prendi la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca (labbra sottili, rosa pallido, chiuse) e il neo 1. Ma io qui sono rasato di fresco: mento, mascella, guance e collo sono lisci e puliti, senza ombra di barba, senza puntini, anche se in quelle foto c'e' un po' di barba o di ombra: non va copiata.`],
    [`La seconda immagine e' una tavola`, `La PRIMA immagine e' una tavola`],
    [`La TERZA immagine e' una foto di moda`, `La SECONDA immagine e' una foto di moda`],
  ];
  let t = premium(true);
  for (const [da, a] of sost) {
    if (!t.includes(da)) throw new Error(`premiumPura: frase non trovata: ${da.slice(0, 50)}`);
    t = t.replace(da, a);
  }
  return t;
};
// Giro 39: due soli allegati. 1 = tavola occhiali+giacca, 2 = le tre foto di Attilio intere in UNA immagine (refs/io-tre-foto.png).
// Niente reference della modella (Attilio: «non dobbiamo allegarla»): la luce e' gia' descritta a parole nel prompt.
const premiumDue = () => {
  const t0 = premium(false);
  const i = t0.indexOf("La prima immagine e' il mio selfie rasato");
  const fine = "non va copiata.";
  const j = t0.indexOf(fine, i);
  if (i < 0 || j < 0) throw new Error("premiumDue: frase della persona non trovata");
  let t = t0.slice(0, i) +
    `La SECONDA immagine contiene tre mie foto, una accanto all'altra: da li' prendi la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca (labbra sottili, rosa pallido, chiuse) e il neo 1. Ma io qui sono rasato di fresco: mento, mascella, guance e collo sono lisci e puliti, senza ombra di barba, senza puntini, anche se in quelle foto c'e' barba o ombra di barba: non va copiata.` +
    t0.slice(j + fine.length);
  const da = "La seconda immagine e' una tavola";
  if (!t.includes(da)) throw new Error("premiumDue: frase della tavola non trovata");
  return t.replace(da, "La PRIMA immagine e' una tavola");
};
// Giro 36 (annotazione di Attilio su v421: «luce verde ciano», e la luce non e' frontale). Tre correzioni al prompt di
// v419-v421: (1) in fondo diceva «solo i miei 4 nei» mentre sopra ne elencava 2; (2) i lati erano «dal lato opposto» senza
// dire se sinistra e' la mia o quella di chi guarda, e il modello li scambiava (v420 specchiata); (3) la luce era scritta
// «davanti» ma la posa girata di 15-20 gradi la rendeva laterale, e il colore era ciano-blu solo sul bordo.
const premiumTre = () => {
  let t = premiumDue();
  const sostT = (da: string, a: string) => {
    if (!t.includes(da)) throw new Error(`premiumTre: non trovo «${da.slice(0, 50)}»`);
    t = t.replace(da, a);
  };
  sostT("solo i miei 4 nei.", "solo i miei 2 nei.");
  sostT(
    "(1) un neo in rilievo color pelle sulla guancia, verso l'orecchio; (2) un neo scuro piccolo vicino all'angolo della bocca, dal lato opposto.",
    "(1) un neo in rilievo color pelle sulla guancia sotto l'orecchio, all'altezza della narice; (2) un neo scuro piccolo vicino all'angolo della bocca, sull'altra guancia.",
  );
  sostT(
    "All'orecchio un piccolo cerchietto d'ORO giallo, dal lato del neo 1.",
    "LATI: sono quelli dell'IMMAGINE, come li vede chi guarda, non i miei. A SINISTRA nell'immagine: l'orecchio con un piccolo cerchietto d'ORO giallo e, sulla guancia sotto quell'orecchio, il neo 1. A DESTRA nell'immagine: il neo 2, vicino all'angolo della bocca, e l'altro orecchio quasi nascosto. Non specchiare mai la persona: in qualche mia foto i lati sono invertiti perche' sono selfie allo specchio, ma qui il cerchietto e il neo 1 stanno a sinistra dell'immagine.",
  );
  const iP = t.indexOf("POSA:"), jP = t.indexOf("LUCE:"), jQ = t.indexOf("QUALITA'");
  if (iP < 0 || jP < 0 || jQ < 0) throw new Error("premiumTre: blocchi POSA/LUCE/QUALITA' non trovati");
  const posa = "POSA: testa quasi di fronte all'obiettivo, girata di NON PIU' di 10 gradi, naso al centro del viso, spalle quasi parallele all'inquadratura; mento a livello, sguardo fuori campo, distratto ma sveglio, bocca chiusa e morbida, sopracciglia rilassate; nessuna mano nel quadro.\n\n";
  const luce = "LUCE: UNA sola sorgente grande e morbida (beauty dish con softbox) esattamente DAVANTI al viso, sull'asse dell'obiettivo e appena sopra: la luce arriva dritta sul volto, non da un lato. Il suo colore e' VERDE-CIANO (tra turchese e menta, come una luce fredda al neon) e si vede bene sulla pelle: un velo verde-ciano chiaro sulle alte luci e sui mezzitoni di fronte, naso, zigomi e mento. Arriva anche sul lato DESTRO dell'immagine, sotto la montatura e accanto al naso, dove non c'e' buio ma lo stesso colore. Tutte e due le guance, la fronte, il naso e il mento ricevono la stessa luce: nessun lato in penombra, nessuna ombra dura laterale. Le uniche ombre sono sotto le lenti, sotto il naso e sotto il mento, morbide e di un verde-ciano piu' scuro. Pelle luminosa con pori appena visibili e riflessi lucidi netti, quasi bianchi con venatura verde-ciano, su fronte, dorso del naso, zigomi e labbro superiore. Il mio incarnato resta beige ma sotto questa luce vira al fresco: mai arancio, mai rosa acceso, mai grigio spento. Labbra rosa. Fondo di carta blu navy in alto e blu-turchese in basso, della stessa famiglia di colore della luce. Il caldo sta solo nell'orecchino d'ORO e nei capelli castano scuro con riflessi ramati.\n\n";
  t = t.slice(0, iP) + posa + luce + t.slice(jQ);
  const resti = t.match(/\b4 nei\b|neo 4|dal lato opposto|dal lato del neo/g);
  if (resti) throw new Error(`premiumTre: restano frasi vecchie: ${resti.join(", ")}`);
  return t;
};
// Giro 37: tessuto imbottito (canali trapuntati, volume) al posto del nylon liscio, e luce a conchiglia SIMMETRICA
// con camera all'altezza degli occhi. In v425 la luce batteva da sinistra e la mascella destra cadeva in ombra
// perche' la camera era bassa e la testa inclinata all'indietro.
const premiumImbottita = () => {
  let t = premiumTre();
  const g0 = t.indexOf("GIACCA: ");
  const g1 = t.indexOf("POSA: ");
  if (g0 < 0 || g1 < 0) throw new Error("premiumTre: blocchi GIACCA/POSA non trovati");
  const giacca = "GIACCA: giacca imbottita techwear di lusso, nello stile della giacca della foto (Stone Island in Cordura, " +
    "Veilance): SENZA CAPPUCCIO (dietro il collo si vede il fondo), senza scritte, loghi, bandiere, patch o stemmi, neanche sulla manica. " +
    "Tessuto: nylon tecnico opaco, fitto e un po' ruvido (grana fine di ripstop), IMBOTTITO a canali orizzontali trapuntati: i canali " +
    "gonfi sulle spalle e sul petto creano volume e pieghe morbide, con le cuciture dei canali ben visibili; la luce fa risaltare i " +
    "rilievi, non un riflesso uniforme. Niente effetto k-way, niente plastica, niente lucido gommoso. Colletto alto, imbottito e morbido, " +
    "dritto attorno al collo fino sotto la mascella. Zip nera centrale, stagna, a filo, con il cursore corto che non penzola; nessun " +
    "bottone, automatico o velcro a vista. Tutto nero pece, tono su tono, senza grigio.\n\n";
  t = t.slice(0, g0) + giacca + t.slice(g1);
  const posa = "POSA: camera all'altezza degli occhi, mai dal basso; testa dritta, non inclinata ne' tirata all'indietro, girata di NON PIU' di 5 gradi, " +
    "naso al centro del viso, spalle parallele all'inquadratura; mento a livello, sguardo fuori campo, distratto ma sveglio, bocca chiusa e " +
    "morbida, sopracciglia rilassate; nessuna mano nel quadro.\n\n";
  const p0 = t.indexOf("POSA: "), p1 = t.indexOf("LUCE: ");
  if (p0 < 0 || p1 < 0) throw new Error("premiumTre: blocchi POSA/LUCE non trovati");
  t = t.slice(0, p0) + posa + t.slice(p1);
  const l0 = t.indexOf("LUCE: "), l1 = t.indexOf("QUALITA': ");
  if (l0 < 0 || l1 < 0) throw new Error("premiumTre: blocchi LUCE/QUALITA non trovati");
  const luce = "LUCE: illuminazione a CONCHIGLIA, perfettamente SIMMETRICA e frontale: un softbox grande sopra e davanti al viso, sull'asse " +
    "dell'obiettivo, e un pannello bianco sotto il mento che rimanda la stessa luce verso l'alto. La luce non arriva da un lato: la meta' " +
    "sinistra e la meta' destra del viso, della mascella e del collo hanno la stessa luminosita', specchio una dell'altra. Nessuna ombra " +
    "dura, nessuna meta' del viso piu' scura dell'altra. L'unica ombra del naso e' piccola, sotto il naso, al centro. Sotto le lenti e " +
    "sotto il mento ombre morbide e chiare. Il colore della luce e' VERDE-CIANO (tra turchese e menta), con un velo verde-ciano chiaro " +
    "sulle alte luci e sui mezzitoni di fronte, naso, zigomi e mento, sullo stesso identico livello a destra e a sinistra. Pelle luminosa con " +
    "pori appena visibili e riflessi lucidi quasi bianchi con venatura verde-ciano su fronte, dorso del naso, zigomi e labbro superiore. Il " +
    "mio incarnato resta beige ma sotto questa luce vira al fresco: mai arancio, mai rosa acceso, mai grigio spento. Labbra rosa. Fondo di " +
    "carta blu navy in alto e blu-turchese in basso, della stessa famiglia di colore della luce. Il caldo sta solo nell'orecchino d'ORO e " +
    "nei capelli castano scuro con riflessi ramati.\n\n";
  return t.slice(0, l0) + luce + t.slice(l1);
};
// Giro 38: le tre foto dell'utente sono selfie dall'alto o di lato, testa girata e inclinata: il modello ne copia la posa
// (v426/v427: testa girata di 25-30 gradi, meta' viso a 20 punti di luminosita' dall'altra). Qui la posa delle foto si
// scarta in modo esplicito e si chiede un ritratto frontale da foto-documento.
const premiumFrontale = () => {
  let t = premiumImbottita();
  const a = "Non prendere occhiali da vista, luce, sfondo, mano, telefono, magliette o felpe.";
  if (t.split(a).length !== 2) throw new Error("premiumImbottita: frase sulle foto non trovata");
  t = t.replace(a, a + " Non prendere NEANCHE la posa: in quelle foto la testa e' girata, inclinata e ripresa dall'alto (sono selfie); qui no, la testa e' dritta e di fronte.");
  const p0 = t.indexOf("POSA: "), p1 = t.indexOf("LUCE: ");
  if (p0 < 0 || p1 < 0) throw new Error("blocchi POSA/LUCE non trovati");
  const posa = "POSA: ritratto FRONTALE, come una foto per documento fatta da un fotografo di moda. La testa e' DRITTA e rivolta all'obiettivo: " +
    "il naso sta esattamente al centro del viso, le due orecchie sono visibili con la stessa ampiezza, le due guance occupano lo stesso spazio, " +
    "le spalle sono parallele al bordo dell'immagine, il collo e' verticale. Il mento non e' alzato ne' abbassato, la testa non e' inclinata di lato. " +
    "Camera all'altezza degli occhi, mai dall'alto ne' dal basso. Espressione neutra e annoiata, bocca chiusa e morbida, sopracciglia rilassate; " +
    "nessuna mano nel quadro.\n\n";
  return t.slice(0, p0) + posa + t.slice(p1);
};
// Giro 39: tolta la foto allo specchio (p13): i ricci scendono lunghi dietro l'orecchio e il modello li copia (effetto mullet).
// Restano due foto con i lati corti.
const premiumFrontaleDue = () => {
  let t = premiumFrontale();
  const a = "contiene tre mie foto";
  if (t.split(a).length !== 2) throw new Error("frase 'tre mie foto' non trovata");
  t = t.replace(a, "contiene due mie foto");
  const b = "qui no, la testa e' dritta e di fronte.";
  if (t.split(b).length !== 2) throw new Error("frase sulla posa non trovata");
  return t.replace(b, b + " CAPELLI: ricci voluminosi sopra la testa, CORTI ai lati e sulla nuca; nessun ricciolo lungo dietro l'orecchio o sul collo, niente mullet: la nuca e' pulita e i lati stanno sopra l'orecchio.");
};
// Giro 40: la luce della reference NON e' piatta. Misurata sui punti luce (senza filtro pelle): fronte L 95, a -8, b 6, cioe'
// quasi bianca e fredda; nei nostri tiri L 78, a +15, b +18, calda e piu' scura. Il testo "simmetrica, nessuna ombra" del giro
// 38/39 faceva una luce da foto-tessera e spegneva il colore. Qui: una sorgente forte e diretta sull'asse dell'obiettivo, con gel
// ciano, riflessi lucidi quasi bianchi e freddi sulla parte alta del viso, caduta morbida verso mascella e collo con ombre calde.
// La posa torna da ritratto di moda (testa girata poco, mento appena su): era la luce che andava cambiata, non la posa.
const premiumLuce = () => {
  let t = premiumFrontaleDue();
  const b = "qui no, la testa e' dritta e di fronte.";
  if (t.split(b).length !== 2) throw new Error("frase sulla posa non trovata");
  t = t.replace(b, "qui la posa e' quella descritta sotto, in POSA.");
  const p0 = t.indexOf("POSA: "), p1 = t.indexOf("QUALITA'");
  if (p0 < 0 || p1 < 0 || p1 < p0) throw new Error("blocchi POSA/LUCE/QUALITA non trovati");
  const nuovo =
    "POSA: ritratto di moda in primo piano. La testa e' girata di circa 10-15 gradi verso DESTRA dell'immagine e il mento e' appena sollevato, " +
    "come in una campagna; camera all'altezza degli occhi o appena sotto. Le due orecchie restano visibili e il lato SINISTRO dell'immagine " +
    "(cerchietto d'oro e neo 1) e' ben in vista. Espressione neutra e distaccata, bocca chiusa e morbida; nessuna mano nel quadro.\n\n" +
    "LUCE: e' il cuore della foto, come in una campagna beauty di alta gamma. Una sola sorgente grande, FORTE e diretta, sull'asse dell'obiettivo " +
    "e appena sopra (softbox frontale o ring light), con un gel VERDE-CIANO (tra turchese e ciano) davanti. Arriva sempre dalla parte della macchina " +
    "fotografica, quindi investe il viso dal davanti anche se la testa e' girata: nessuna luce di taglio, nessun lato del viso lasciato nel buio. " +
    "EFFETTO SULLA PELLE: fronte, dorso del naso, punta del naso, zigomi e labbro superiore hanno riflessi lucidi QUASI BIANCHI con una venatura " +
    "fredda ciano-turchese, mai gialli, mai arancio, mai rosa; la pelle illuminata ha una patina fredda, come ben idratata, non bagnata ne' unta. " +
    "Da quei riflessi la luce scende in modo morbido e graduale: sotto le lenti, sotto gli zigomi, sulla mascella e sul collo la pelle si scurisce " +
    "piano, con ombre morbide leggermente calde e rosate (il colore complementare del gel), e sotto il mento l'ombra e' piu' marcata. Entrambe le " +
    "guance sono illuminate; non e' una luce piatta da foto tessera. Il mio incarnato resta beige nei mezzitoni, ma le zone colpite dalla luce " +
    "virano al fresco. Labbra rosa. Fondo di carta blu navy in alto e blu-turchese in basso, della stessa famiglia di colore della luce. " +
    "Il caldo sta solo nell'orecchino d'ORO e nei capelli castano scuro con riflessi ramati.\n\n";
  return t.slice(0, p0) + nuovo + t.slice(p1);
};
// Giro 41: Attilio: «direi t-shirt normale ma stile figo». Via la giacca (e il collo alto): si parte dal prompt di pura-luce
// (luce a gel verde-ciano, due foto sue, capelli corti ai lati), la tavola diventa i SOLI occhiali e il capo e' una t-shirt a parole.
const premiumTshirt = () => {
  let t = premiumLuce();
  const a = "La PRIMA immagine e' una tavola con due oggetti, non persone: OCCHIALI e GIACCA.";
  if (t.split(a).length !== 2) throw new Error("premiumTshirt: frase della tavola non trovata");
  t = t.replace(a, "La PRIMA immagine e' una foto di prodotto dei miei OCCHIALI, non una persona.");
  if (t.split("colletto e spalle in quadro").length !== 2) throw new Error("premiumTshirt: frase del colletto non trovata");
  t = t.replace("colletto e spalle in quadro", "collo e spalle in quadro");
  const g0 = t.indexOf("GIACCA: "), g1 = t.indexOf("POSA: ");
  if (g0 < 0 || g1 < 0 || g1 < g0) throw new Error("premiumTshirt: blocchi GIACCA/POSA non trovati");
  const maglia =
    "T-SHIRT: indosso una t-shirt NORMALE ma con stile, nera, a girocollo: collo basso e largo con costina spessa e netta, cotone pesante " +
    "(heavyweight) opaco, taglio boxy leggermente oversize con la spalla un poco scesa, cuciture pulite, pieghe naturali sul petto e sulle spalle. " +
    "Nero lavato morbido, appena sbiadito, tono su tono. NESSUN logo, scritta, stampa, grafica o patch. Nessun collo alto, nessun cappuccio, " +
    "nessuna giacca o strato sopra, nessuna collana o catena: si vedono bene collo e clavicole.\n\n";
  return t.slice(0, g0) + maglia + t.slice(g1);
};
// Giro 42: Attilio: «ce l'hai nelle reference» (le foto davvero rasate sono quelle del 08/03/2025, io-rasati-tre.png)
// e «non hai ancora il faretto frontale»: la luce era scritta frontale ma le foto di riferimento portavano luce
// laterale e posa girata. Qui: faretto sull'asse, testa dritta, riferimenti rasati.
const premiumFaretto = () => {
  const t = premiumTshirt();
  const a0 = t.indexOf("PERSONA. "), a1 = t.indexOf("La PRIMA immagine");
  const p0 = t.indexOf("POSA: "), p1 = t.indexOf("QUALITA'");
  if (a0 < 0 || a1 < 0 || p0 < 0 || p1 < 0 || !(a0 < a1 && a1 < p0 && p0 < p1)) throw new Error("premiumFaretto: blocchi non trovati");
  const persona =
    "PERSONA. Sono io. La SECONDA immagine contiene tre mie foto, una accanto all'altra, scattate dal basso con occhiali da vista e luce gialla " +
    "di una stanza. Da li' prendi la forma del viso, la fronte, i ricci, gli occhi, le sopracciglia, il naso, la bocca (labbra sottili, rosa " +
    "pallido, chiuse), la pelle liscia e i miei nei. In quelle tre foto sono rasato: mento, mascella, guance e collo sono puliti e lisci, e cosi' " +
    "devono restare; nessuna ombra di barba, nessun puntino. Non prendere occhiali da vista, luce, sfondo, giacca, telefono o la posa: sono selfie " +
    "dal basso con la testa inclinata; qui la posa e' quella descritta in POSA. CAPELLI: ricci voluminosi sopra la testa, CORTI ai lati e sulla " +
    "nuca; nessun ricciolo lungo dietro l'orecchio o sul collo, niente mullet.\n" +
    "Sulla pelle ho solo questi 2 nei, piccoli, copiati dalle mie foto: (1) un neo in rilievo color pelle sulla guancia, davanti all'orecchio con " +
    "il cerchietto, all'altezza della narice; (2) un neo scuro piccolo vicino all'angolo della bocca, sull'altra guancia. Nient'altro: pelle " +
    "uniforme, nessun altro neo o puntino, liscia anche sotto le lenti. Il piccolo cerchietto e' d'ORO giallo e il neo 1 sta sotto di lui: nello " +
    "stesso lato dell'immagine in cui li vedi nelle mie foto, senza mai specchiarli.";
  const posa =
    "POSA: testa DRITTA verso l'obiettivo, girata di NON PIU' di 5 gradi, mento a livello e appena sollevato, spalle quasi parallele " +
    "all'inquadratura. Camera all'altezza degli occhi, mai dal basso e mai dall'alto (le mie foto sono selfie dal basso: qui no). Le due orecchie " +
    "sono visibili e uguali. Espressione neutra e distaccata, bocca chiusa e morbida, sguardo dritto in macchina dietro le lenti; nessuna mano nel quadro.";
  const luce =
    "LUCE: e' il cuore della foto: un FARETTO FRONTALE puntato dritto in faccia, come un flash diretto da set o una campagna beauty. Una sola " +
    "sorgente piccola e potente, appena sopra l'obiettivo e sul suo asse, con un gel VERDE-CIANO (tra turchese e ciano). Colpisce il viso " +
    "esattamente dal davanti: le due guance sono illuminate allo stesso modo, il naso proietta solo una piccola ombra dritta verso il basso sotto " +
    "la narice, non di lato. Nessuna luce di taglio, nessuna luce di bordo, nessuna sorgente laterale, nessun lato del viso nel buio, nessuna " +
    "ombra della testa sul fondo. EFFETTO SULLA PELLE: molto luminosa e brillante; fronte, dorso e punta del naso, zigomi, labbro superiore e mento " +
    "hanno riflessi lucidi QUASI BIANCHI con una venatura fredda ciano-turchese, mai gialli, mai arancio, mai rosa. Da li' la luce cala piano " +
    "verso i bordi di guance e mascella e verso il collo, con ombre morbide leggermente calde e rosate (il colore complementare del gel), e sotto " +
    "il mento un'ombra piu' netta. Il mio incarnato resta beige nei mezzitoni, ma le zone colpite dalla luce virano al fresco. Labbra rosa. " +
    "Fondo di carta blu navy in alto e blu-turchese in basso, della stessa famiglia di colore della luce. Il caldo sta solo nell'orecchino d'ORO " +
    "e nei capelli castano scuro con riflessi ramati.";
  return t.slice(0, a0) + persona + "\n\n" + t.slice(a1, p0) + posa + "\n\n" + luce + "\n\n" + t.slice(p1);
};
// Giro 43: la luce del faretto veniva da un lato (guance 50 contro 78): un FLASH ANULARE sull'asse dell'obiettivo e' simmetrico per costruzione.
const premiumAnulare = () => {
  const t = premiumFaretto();
  const e0 = t.indexOf("LUCE: "), e1 = t.indexOf("EFFETTO SULLA PELLE:");
  if (e0 < 0 || e1 < 0 || e1 < e0) throw new Error("premiumAnulare: blocchi non trovati");
  const nuova =
    "LUCE: e' il cuore della foto: un FLASH ANULARE (ring flash) montato attorno all'obiettivo, come nei ritratti beauty da campagna. La luce parte " +
    "esattamente dall'asse dell'obiettivo e colpisce il viso dritto dal davanti, quindi e' IDENTICA a sinistra e a destra: le due guance, le due " +
    "tempie e le due orecchie hanno la stessa luminosita'; il naso non proietta ombra di lato ma solo un'ombretta piccola sotto la narice, e sotto " +
    "il mento c'e' una sottile ombra morbida. Sul flash c'e' un gel VERDE-CIANO: la pelle illuminata vira al fresco. Nessuna luce di taglio, nessuna " +
    "luce laterale, nessun lato del viso piu' scuro dell'altro. Sulle lenti nere si vede il piccolo riflesso circolare chiaro del flash. ";
  return t.slice(0, e0) + nuova + t.slice(e1);
};
// Giro 44: flash anulare + la posa FRONTALE di v431 (unica con guance simmetriche, 2,4): la testa dei selfie e' inclinata e il modello la copia.
const premiumAnulareDoc = () => {
  const t = premiumAnulare();
  const p0 = t.indexOf("POSA: "), p1 = t.indexOf("LUCE: ");
  if (p0 < 0 || p1 < 0 || p1 < p0) throw new Error("premiumAnulareDoc: blocchi non trovati");
  const posa =
    "POSA: ritratto FRONTALE, come una foto per documento fatta da un fotografo di moda. La testa e' DRITTA e rivolta all'obiettivo: il naso sta " +
    "esattamente al centro del viso, le due orecchie sono visibili con la stessa ampiezza, le due guance occupano lo stesso spazio, le spalle sono " +
    "parallele al bordo dell'immagine, il collo e' verticale. Il mento non e' alzato ne' abbassato, la testa non e' inclinata di lato. Camera " +
    "all'altezza degli occhi, mai dall'alto ne' dal basso. Espressione neutra e distaccata, bocca chiusa e morbida, sguardo dritto in macchina " +
    "dietro le lenti; nessuna mano nel quadro.\n\n";
  return t.slice(0, p0) + posa + t.slice(p1);
};
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
  const volti = join(D, "refs", "io-volti-rasato.png");
  const tavolaScelte = join(D, "refs", "io-scelte.png");
  const voltiAlti = join(D, "refs", "io-volti-alti.png");
  const intere = ["io-felpa-mano-1.png", "io-occhiali-vista-632DC4E9.jpeg", "io-rasato-2023-06-23-p13.jpg"].map((f) => join(D, "refs", f));
  for (const p of [materia, ref, look, lookT, lookT2, lookT3, volti, tavolaScelte, voltiAlti, ...base, ...intere]) if (!existsSync(p)) throw new Error(`manca: ${p}`);

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
    { nome: "pulita-forte", prompt: lookTrap(false, LUCE_FORTE, true, OCCHIALI_NERI) + CLAUSOLA_PELLE, refs: [base[0]!, lookT3] },
    { nome: "pulita-fronte", prompt: lookTrap(false, LUCE_FRONTE, true, OCCHIALI_NERI) + CLAUSOLA_PELLE, refs: [base[0]!, lookT3] },
    { nome: "scelte-forte", prompt: lookTrap(false, LUCE_FORTE, true, OCCHIALI_NERI) + CLAUSOLA_SCELTE, refs: [base[0]!, lookT3, tavolaScelte] },
    { nome: "scelte-fronte", prompt: lookTrap(false, LUCE_FRONTE, true, OCCHIALI_NERI) + CLAUSOLA_SCELTE, refs: [base[0]!, lookT3, tavolaScelte] },
    { nome: "solo-stile-forte", prompt: senzaVolti(LUCE_FORTE), refs: [lookT3] },
    { nome: "solo-stile-fronte", prompt: senzaVolti(LUCE_FRONTE), refs: [lookT3] },
    { nome: "solo-volti-forte", prompt: senzaTavola(LUCE_FORTE), refs: [lookT3, tavolaScelte] },
    { nome: "solo-volti-fronte", prompt: senzaTavola(LUCE_FRONTE), refs: [lookT3, tavolaScelte] },
    { nome: "intere-forte", prompt: dueNei(LUCE_FORTE) + CLAUSOLA_CHIARO + CLAUSOLA_INTERE, refs: [lookT3, ...intere] },
    { nome: "alti-forte", prompt: dueNei(LUCE_FORTE) + CLAUSOLA_CHIARO + CLAUSOLA_ALTI, refs: [lookT3, voltiAlti] },
    { nome: "chiaro-forte", prompt: dueNei(LUCE_FORTE) + CLAUSOLA_CHIARO, refs: [lookT3] },
    { nome: "due-nei-forte", prompt: dueNei(LUCE_FORTE), refs: [lookT3] },
    { nome: "due-nei-fronte", prompt: dueNei(LUCE_FRONTE), refs: [lookT3] },
    { nome: "premium", prompt: premium(true), refs: [join(D, "refs", "look-premium.png"), ref, ...intere] },
    { nome: "premium-senza-luce", prompt: premium(false), refs: [join(D, "refs", "look-premium.png"), ...intere] },
    { nome: "pura-due", pura: true, prompt: premiumDue(), refs: [join(D, "refs", "look-premium.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-anulare-doc", pura: true, prompt: premiumAnulareDoc(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-anulare", pura: true, prompt: premiumAnulare(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-faretto", pura: true, prompt: premiumFaretto(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-tshirt", pura: true, prompt: premiumTshirt(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-due-foto.png")] },
    { nome: "pura-luce", pura: true, prompt: premiumLuce(), refs: [join(D, "refs", "look-premium-imbottita.png"), join(D, "refs", "io-due-foto.png")] },
    { nome: "pura-frontale-due", pura: true, prompt: premiumFrontaleDue(), refs: [join(D, "refs", "look-premium-imbottita.png"), join(D, "refs", "io-due-foto.png")] },
    { nome: "pura-frontale", pura: true, prompt: premiumFrontale(), refs: [join(D, "refs", "look-premium-imbottita.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-imbottita", pura: true, prompt: premiumImbottita(), refs: [join(D, "refs", "look-premium-imbottita.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-tre", pura: true, prompt: premiumTre(), refs: [join(D, "refs", "look-premium.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "premium-pura", pura: true, prompt: premiumPura(), refs: [join(D, "refs", "look-premium.png"), ref, ...intere] },
    { nome: "volti-forte", prompt: lookTrap(false, LUCE_FORTE, true, OCCHIALI_NERI) + CLAUSOLA_VOLTI, refs: [base[0]!, lookT3, volti] },
    { nome: "volti-fronte", prompt: lookTrap(false, LUCE_FRONTE, true, OCCHIALI_NERI) + CLAUSOLA_VOLTI, refs: [base[0]!, lookT3, volti] },
  ];
  // `--var it-senza-ref,en-senza-ref`: le varianti si alternano giro dopo giro. Default: con-ref.
  const iV = process.argv.indexOf("--var");
  const scelte = iV > 0 ? process.argv[iV + 1]!.split(",") : ["con-ref"];
  const varianti = scelte.map((n) => tutte.find((t) => t.nome === n) ?? (() => { throw new Error(`variante sconosciuta: ${n}`); })());
  for (let g = 1; g <= giri; g++) {
    const v = varianti[(g - 1) % varianti.length]!;
    const job = enqueueJob(
      PHOTO, v.prompt, null, "chatgpt", null, (v as { pura?: boolean }).pura ? "generate" : "edit", (v as { pura?: boolean }).pura ? null : materia, JSON.stringify(v.refs),
      JSON.stringify({
        recipe: `da-zero-${v.nome}`,
        // La UI chiama «ritocco» ogni versione con `materia`: solo se parte da un'altra immagine, non dall'originale.
        ...(iM > 0 && !(v as { pura?: boolean }).pura ? { partenza: MATERIA } : {}),
        cambiato: `giro 30: variante ${v.nome} (test senza la reference della modella, prompt italiano contro inglese). Prima, giro 29: pelle beauty liscia e lucida con riflessi quasi bianchi, alte luci neutre (reference a 0 e b 7, nostre a 12 e b 17, specular 1.5% contro 0.2%). Prima, giro 28: sopracciglia dritte, viso pieno (v317 era angoloso e corrucciato), felpa la parte piu' scura (10 contro 6-7). Prima, giro 27: felpa nera pece (nei giri dal selfie i neri erano 15-18, reference 6-7) e viso riposato non stanco. Prima, giro 26: foto di partenza = selfie rasato (derivate/io-rasato-2023-06-23-p08-dritto.jpg) invece di 1.PNG, che ha la barba corta e la passava ai tiri; giro 25 aveva tolto i primi piani senza effetto sulla grana. Prima, giro 25: tavola io-identita-nei.png = cheat sheet + 4 nei, SENZA i tre primi piani rasati (test grana mascella). Prima, giro 24: incarnato caldo beige dorato (mio), ciano solo su ombre e bordo; nel giro 23 la pelle era pallida e grigio-blu. Prima, giro 23: luce fredda ma orecchino d'ORO e capelli castani caldi (nel giro 22 erano diventati argento e neri). Prima, giro 22: luce frontale COLORATA ciano-blu come la reference (pelle fredda, neri profondi, contrasto medio) al posto di «morbida e piatta». Prima, giro 21: io-unica-nei.png = io-unica + fascia con i 4 nei veri ritagliati da p08 alla misura reale; prompt: copiali identici. Prima, giro 20: prompt riscritto corto (1400 car. contro 5500), in positivo, quasi senza divieti. Prima, giro 19: sotto la montatura solo i puntini 2 e 3, in tutto due. Prima, giro 18: nei piccoli e della misura vera (neo 1 color pelle in rilievo, 2 e 3 minuscoli), nessun puntino sparso. Prima, giro 17: orecchino d'ORO senza la frase sull'argento, neo 4 ben visibile. Prima, giro 16: le mie reference unite in una sola immagine (io-unica.png = cheat sheet con nei numerati + tre primi piani rasati); allegati: partenza, io-unica, accessori-tavola, reference. Luce come il giro 15.`,
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
