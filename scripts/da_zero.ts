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
// Giro 45: la luce e' COLORATA sulla pelle. Misurato sulla reference: luci a -8 / b +6 (fredde, verso il ciano), ombre a +7 / b -9
// (viola-blu). In v451 luci a +7 / b +8 (beige caldo) e ombre neutre: il prompt diceva "incarnato beige" e "ombre calde e rosate".
const premiumGel = () => {
  const t = premiumAnulareDoc();
  const l0 = t.indexOf("LUCE: "), l1 = t.indexOf("QUALITA': ");
  if (l0 < 0 || l1 < 0 || l1 < l0) throw new Error("premiumGel: blocchi non trovati");
  const luce =
    "LUCE E COLORE: UNA sola sorgente grande e potente esattamente DAVANTI al viso, sull'asse dell'obiettivo e appena sopra, con un gel " +
    "VERDE-CIANO saturo. E' una luce COLORATA, non bianca, e colora tutta la pelle che colpisce: fronte, naso, zigomi, guance, labbro " +
    "superiore e mento sono pelle chiara, pallida e FREDDA con una tinta ciano-verde ben visibile, come porcellana sotto un neon turchese. " +
    "I riflessi lucidi su fronte, naso e zigomi sono quasi bianchi con una venatura ciano. Sulla pelle illuminata NON c'e' beige, dorato, " +
    "arancio ne' rosa caldo. Le ombre (sotto il mento, sotto le lenti, ai lati del naso, bordi di guance e mascella, collo) non sono " +
    "marroni ne' calde: sono blu-viola profondo, verso il magenta freddo, come il riflesso del fondale blu. Le due guance hanno la " +
    "stessa luce e la stessa tinta; la luce scende piano verso i bordi del viso. Labbra rosa spento e freddo, quasi malva. Fondo di " +
    "carta blu navy in alto e blu-turchese in basso, della stessa famiglia del gel. Il caldo sta SOLO nell'orecchino d'ORO giallo " +
    "brillante e nei riflessi ramati dei capelli castano scuro.\n\n";
  return t.slice(0, l0) + luce + t.slice(l1);
};
// Giro 46: le TRE foto scelte da Attilio (io-tre-foto.png) e il faro come nella reference.
const premiumFaro = () => {
  const t = premiumAnulareDoc();
  const p0 = t.indexOf("PERSONA. "), p1 = t.indexOf("La PRIMA immagine");
  const l0 = t.indexOf("LUCE: "), l1 = t.indexOf("QUALITA': ");
  if (p0 < 0 || p1 < p0 || l0 < 0 || l1 < l0) throw new Error("premiumFaro: blocchi non trovati");
  const persona =
    "PERSONA. Sono io. La SECONDA immagine contiene tre mie foto, una accanto all'altra: quella a sinistra con la mano alla bocca, " +
    "quella al centro con gli occhiali da vista, quella a destra allo specchio. Da li' prendi SOLO la forma del viso, la fronte, i " +
    "ricci, gli occhi, le sopracciglia, il naso, la bocca (labbra sottili, rosa pallido, chiuse) e i miei nei. Non prendere occhiali " +
    "da vista, luce, sfondo, vestiti, mano, telefono ne' la posa: sono selfie dal basso. In quelle foto ho un velo di barba e " +
    "un'ombra scura su mento e guance: NON copiarla. Qui sono rasato di fresco, pelle di guance, mento, mascella e collo liscia " +
    "e pulita. CAPELLI: ricci voluminosi sopra la testa, CORTI ai lati e sulla nuca; nessun ricciolo lungo dietro l'orecchio o " +
    "sul collo (la foto a destra li ha lunghi: ignorali), niente mullet. Sulla pelle ho solo questi 2 nei, piccoli: (1) un neo in " +
    "rilievo color pelle sulla guancia, davanti all'orecchio con il cerchietto, all'altezza della narice; (2) un neo scuro piccolo " +
    "vicino all'angolo della bocca, sull'altra guancia. Nient'altro. Il piccolo cerchietto e' d'ORO giallo e il neo 1 sta sotto " +
    "di lui: nello stesso lato dell'immagine in cui li vedi nelle mie foto, senza mai specchiarli.\n\n";
  const luce =
    "LUCE E COLORE: come una foto di moda da studio con UN faro duro e potente, appena sopra l'obiettivo e puntato dritto in " +
    "faccia: luce diretta e netta, non morbida, non un flash anulare. Il faro scolpisce il viso: fronte, ponte e punta del naso, " +
    "zigomi e labbro superiore sono i punti piu' luminosi, con riflessi lucidi quasi bianchi e freddi; sotto le lenti, ai lati e sotto " +
    "il naso, sotto il labbro e sotto il mento cadono ombre vere, morbide solo ai bordi, calde e profonde, rosate-brune. La pelle nei " +
    "mezzitoni e' pesca chiara, calda e naturale come nelle mie foto, mai verde, mai cianotica, mai grigia; solo i riflessi lucidi hanno " +
    "una venatura fredda. Contrasto alto, pelle luminosa e liscia. Fondo di carta blu navy cupo in alto, blu elettrico che schiarisce " +
    "in basso, con vignettatura. Un debole bordo ciano solo sul lato dell'orecchio e sui capelli. Il caldo sta anche nell'orecchino " +
    "d'ORO giallo brillante.\n\n";
  return t.slice(0, p0) + persona + t.slice(p1, l0) + luce + t.slice(l1);
};
// Giro 47: v457-v460 avevano il modellato giusto ma alte luci arancio e puntinatura da barba.
const premiumFaro2 = () => {
  let t = premiumFaro();
  const a = "La pelle nei mezzitoni e' pesca chiara, calda e naturale come nelle mie foto, mai verde, mai cianotica, mai grigia; solo i riflessi lucidi hanno una venatura fredda.";
  const b = "Qui sono rasato di fresco, pelle di guance, mento, mascella e collo liscia e pulita.";
  if (!t.includes(a) || !t.includes(b)) throw new Error("premiumFaro2: frasi non trovate");
  t = t.replace(a,
    "I riflessi sulla fronte, sul naso e sugli zigomi sono BIANCHI con una leggera venatura fredda azzurrina, mai gialli, mai arancio. " +
    "La pelle nei mezzitoni e' rosata chiara, delicata, come porcellana calda: ne' abbronzata, ne' beige, ne' arancio, ne' verde.");
  t = t.replace(b,
    "Qui sono rasato di fresco: mento, mascella, guance, collo e la pelle sopra il labbro sono perfettamente lisci e uniformi, color " +
    "pelle, come ritoccati da un fotografo di moda; nessuna ombra grigia, nessuna puntinatura, nessun pelo, nemmeno corto.");
  return t;
};
// Giro 48: la struttura di colore della reference misurata sul viso: luci bianco-azzurre, mezzitoni rosa-pesca, ombre viola-blu.
const premiumFaro3 = () => {
  const t = premiumFaro2();
  const l0 = t.indexOf("LUCE E COLORE: "), l1 = t.indexOf("QUALITA': ");
  if (l0 < 0 || l1 < l0) throw new Error("premiumFaro3: blocco luce non trovato");
  const luce =
    "LUCE E COLORE: come la mia foto di riferimento da studio: UN faro duro e potente appena sopra l'obiettivo, puntato dritto in " +
    "faccia, con un gel azzurro-ciano. Luce diretta e netta, non morbida, non un flash anulare. Scolpisce il viso: fronte, ponte e " +
    "punta del naso, zigomi e labbro superiore sono i punti piu' luminosi, con riflessi lucidi BIANCO-AZZURRI freddi, mai gialli, " +
    "mai arancio. Nei mezzitoni la pelle e' rosa-pesca chiara e viva, mai verde, mai grigia. Sotto le lenti, ai lati del naso, " +
    "sotto il labbro e sotto il mento cadono ombre vere, profonde, VIOLA-BLU (non brune, non nere). Contrasto alto, pelle luminosa " +
    "e liscia. Fondo di carta blu navy cupo in alto, blu elettrico che schiarisce in basso, con vignettatura: stesso colore del " +
    "gel. Il caldo resta solo nell'orecchino d'ORO giallo brillante e nei capelli.\n\n";
  return t.slice(0, l0) + luce + t.slice(l1);
};
// POV: grandangolo a distanza di braccio, motion blur su sfondo e bordi, viso e occhiali nitidi.
const premiumPov = () => {
  const t = premiumFaro3();
  const a1 = t.indexOf("PERSONA. "), p0 = t.indexOf("POSA: "), p1 = t.indexOf("LUCE E COLORE: ");
  const q0 = t.indexOf("QUALITA': "), q1 = t.indexOf("Pelle di guance, mascella");
  if (a1 < 1 || p0 < a1 || p1 < p0 || q0 < p1 || q1 < q0) throw new Error("premiumPov: blocchi non trovati");
  const apertura =
    "Fotografia POV in stile selfie d'azione, scattata con un obiettivo super grandangolo da 14 mm tenuto a distanza di braccio, " +
    "un poco sotto il mento: il viso e' grande e vicino al centro, con la prospettiva allargata del grandangolo (naso appena " +
    "piu' grande, spalle che si allargano verso i bordi, leggera distorsione a barilotto), quadrato 1:1, campagna di un marchio " +
    "techwear di lusso.\n\n";
  const posa =
    "POSA: la testa e' quasi frontale, girata di soli 10 gradi, il mento appena alzato verso la camera; la camera e' inclinata di " +
    "8-10 gradi. Espressione neutra e distaccata, bocca chiusa e morbida, sguardo dritto in macchina dietro le lenti. Nessuna mano " +
    "e nessun telefono nel quadro.\n\n";
  const motion =
    "EFFETTO MOTION BLUR: l'immagine e' scattata in corsa. Il viso, gli occhiali e il collo sono nitidi e a fuoco. Tutto il resto " +
    "e' mosso da una sfocatura direzionale orizzontale: lo sfondo si stira in strisce luminose blu elettrico e ciano, le spalle e " +
    "la t-shirt sono mosse e leggermente sdoppiate, i capelli lasciano una scia sui lati, ai bordi la sfocatura e' piu' forte e " +
    "radiale verso l'esterno. Piccoli aloni di luce strisciati ai lati. Il riflesso nelle lenti resta nitido.\n\n";
  const qualita =
    "QUALITA': fotografia reale con grandangolo, nitida sul viso e sugli occhiali, pelle con grana naturale; il motion blur sta solo " +
    "sullo sfondo, sulle spalle e sui bordi, mai sul viso; niente aspetto da render, niente plastica, niente effetto AI. Neri " +
    "profondi e netti. Il viso e' pieno e morbido come nelle mie foto e ben illuminato, non scuro.\n\n";
  return apertura + t.slice(a1, p0) + posa + t.slice(p1, q0) + motion + qualita + t.slice(q1);
};
// Giro 49: prompt in INGLESE e corto (~2000 caratteri, prima 4800); camera dall'alto verso il basso.
const promptPovEn = () => [
  "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 14mm ultra-wide lens at arm's length, held slightly ABOVE eye level and angled down at me (never from below). Face large and close, chin slightly tucked, soft natural jawline, mild wide-angle perspective.",
  "PERSON: me. Image 2 has three photos of me. Take ONLY face shape, forehead, curly hair, eyes, eyebrows, nose, thin pale-pink closed lips and my moles. Do NOT copy glasses, light, background, clothes, hand, phone or pose (they are low-angle selfies), nor stubble, nor the long curls behind the ear. I am freshly shaved: cheeks, jaw, chin, neck and upper lip are perfectly smooth, even and skin-colored, no grey shadow, no dots, no hair at all. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. Only 2 small moles: (1) a raised skin-colored mole on the cheek in front of the ear with the small GOLD hoop earring, at nostril height; (2) a small dark mole near the mouth corner on the other cheek. Hoop and mole 1 on the same side of the image as in my photos, never mirrored.",
  "GLASSES: image 1 is a product photo of my sunglasses. Copy them exactly: glossy black wraparound shield, thick flat brow bar, big low dark lenses, wide blade temples that taper toward the ear. No logo, no mirror coating.",
  "CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.",
  "POSE: head almost frontal (10 degree turn), chin tucked, neutral detached expression, relaxed closed mouth, eyes straight into the lens, camera tilted 8-10 degrees. No hand, no phone.",
  "LIGHT: one hard powerful light just above the lens aimed straight at the face, with a pale cyan gel. It sculpts the face: forehead, nose bridge, cheekbones and upper lip are the brightest points, cold white-blue highlights, never yellow or orange. Midtones pale peach-pink, never green or grey. Deep real VIOLET-BLUE shadows under the glasses, nose, lip and chin. High contrast. Background navy at the top, electric blue at the bottom, with vignette. Warmth only in the gold hoop and the hair.",
  "MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur: background stretched into electric-blue and cyan light streaks, shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. Reflections in the lenses stay sharp.",
  "Real photograph, fine pore texture, no render look, no AI look, deep blacks.",
].join("\n\n");

// Giro 50: Attilio: «non sono io». v472 era un viso magro e scavato da modello. Si parte dalla SUA foto in modalita' modifica.
const promptEditId = () => [
  "Edit image 1. It is a selfie of me. Keep MY face exactly as it is, as a real photo of a real person: the same full, rounded face with wide soft cheeks and a soft jaw, the same brown eyes, thick dark eyebrows, broad nose, mouth and ears, my medium-brown curly hair with lighter tips, and my moles exactly where they are. Do NOT slim, sharpen, sculpt or beautify the face and do not make it look like a model. Image 3 has more photos of me, only to confirm the same face. Image 2 is a product photo of sunglasses, not a person.",
  "CHANGE ONLY THIS. Glasses: replace my round glasses with the sunglasses of image 2, copied exactly: glossy black wraparound shield, thick flat brow bar, big low dark lenses, wide blade temples tapering toward the ear, no logo, no mirror coating. Skin: freshly shaved. Remove all stubble, grey shadow and dots from cheeks, chin, jaw, neck and upper lip so the skin is smooth and even, keeping the real texture of pores. Add no moles, no freckles. Keep the small gold hoop earring. Hair: keep my curls, short at the sides and nape, no long curls behind the ear. Clothes: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, washed black, no logo, print or patch, nothing over it, no necklace. Remove the phone, hands and the room.",
  "CAMERA: square 1:1 action-selfie POV shot on a 14mm ultra-wide lens at arm's length, held slightly above eye level and angled down at me, never from below. Face large and close, head almost frontal, chin slightly tucked, neutral detached expression, closed relaxed mouth, eyes straight into the lens, camera tilted 8 degrees.",
  "LIGHT: one hard powerful light just above the lens aimed straight at the face, with a pale cyan gel. Forehead, nose bridge, cheekbones and upper lip are the brightest points with cold white-blue highlights, never yellow or orange. Midtones pale peach-pink. Deep violet-blue shadows under the glasses, nose, lip and chin. High contrast. Background navy at the top, electric blue at the bottom, with vignette.",
  "MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur: background stretched into electric-blue and cyan light streaks, shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. Lens reflections stay sharp.",
  "Real photograph, fine pore texture, no render look, no AI look, deep blacks.",
].join("\n\n");

// Giro 51: v474-v477 avevano il viso giusto ma la camera dal basso, ereditata dalla partenza.
const promptEditIdAlto = () => promptEditId().split("\n\n").map((par) => {
  if (par.startsWith("CAMERA:")) {
    return "CAMERA: re-frame the shot, do NOT keep the camera angle of image 1, which is taken from below. Square 1:1 selfie POV on a 14mm ultra-wide lens at arm's length, camera held ABOVE my eye level and pointing down at my face. Nostrils must not be visible from below. The top of the forehead and hair is prominent, jaw and chin short and soft, never protruding, chin slightly tucked. Head almost frontal, neutral detached expression, closed relaxed mouth, eyes straight into the lens, camera tilted 8 degrees.";
  }
  if (par.startsWith("LIGHT:")) {
    return par + " No pink or warm cast on the lit skin: highlights pale, cool and almost white-blue, peach only in the midtones.";
  }
  return par;
}).join("\n\n");

// Giro 52: v481 ha la camera giusta ma lo sguardo cupo ereditato dalla m17.
const promptEditIdNeutro = () => {
  const par = promptEditIdAlto().split("\n\n");
  const i = par.findIndex((x) => x.startsWith("LIGHT:"));
  par.splice(i, 0, "EXPRESSION: change my expression. Calm, relaxed and neutral, like a composed portrait. Eyebrows relaxed and level, no frown, no scowl, no furrowed brow, not angry, not tired. Eyes wide open and looking straight into the lens, never down. Mouth closed and soft.");
  return par.join("\n\n");
};

// Giro 53: niente partenza (solo i riferimenti), barba leggera ok, luce colorata esplicita sulla pelle.
const promptPovColore = () => promptPovEn().split("\n\n").map((par) => {
  if (par.startsWith("PERSON:")) {
    const a = par.indexOf("I am freshly shaved");
    const b = par.indexOf("Jaw soft and rounded");
    if (a < 0 || b < 0 || b < a) throw new Error("promptPovColore: frasi barba non trovate");
    return par.slice(0, a) + "I have at most a very light, short, subtle stubble: skin mostly clean, no dark beard, no grey shadow. " + par.slice(b);
  }
  if (par.startsWith("LIGHT:")) {
    return "LIGHT: one hard powerful light just above the lens aimed straight at the face, with a saturated cyan-teal gel. The colored light visibly tints the skin it hits: forehead, nose bridge, cheekbones, upper lip and the lit part of the cheeks glow pale cyan-teal, clearly colored, not white, not neutral, not pink, not orange. Soft peach only in the midtones where the light falls off. Deep violet-blue shadows under the glasses, nose, lip and chin, with a cyan bounce on the jaw and neck. High contrast. Background navy at the top, electric blue at the bottom, with vignette. Warmth only in the gold hoop and the hair.";
  }
  return par;
}).join("\n\n");

// Giro 54: Attilio: ripreso dal suo lato SINISTRO (non destro), laterale ok ma verticalmente dritto.
const promptPovSx = () => promptPovColore().split("\n\n").map((par) => {
  if (par.startsWith("Square 1:1")) {
    return "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 14mm ultra-wide lens at arm's length, held at exactly my eye level, perfectly level and upright, no up or down angle. Face large and close, soft natural jawline, mild wide-angle perspective.";
  }
  if (par.startsWith("PERSON:")) {
    const a = par.indexOf("Hoop and mole 1 on the same side");
    if (a < 0) throw new Error("promptPovSx: frase nei non trovata");
    return par.slice(0, a) + "The gold hoop and mole 1 are on my LEFT ear and LEFT cheek. The camera is on my left, so they are on the near side, at the right edge of the frame. Mole 2 is on my right cheek, on the far side near the mouth corner.";
  }
  if (par.startsWith("POSE:")) {
    return "POSE: the camera is on my LEFT side, a left three-quarter view: my head is turned so my nose points toward the LEFT edge of the frame (about 40 degrees), showing my left cheek, left jaw and left ear on the right side of the frame. Vertically dead straight: camera at eye level, horizon perfectly level, NO roll or tilt, head and neck upright and vertical, chin level, not tucked and not raised. Neutral detached expression, relaxed closed mouth, eyes toward the lens. No hand, no phone.";
  }
  return par;
}).join("\n\n");

// Giro 55: frontale alla telecamera, non tre quarti.
const promptPovFronte = () => promptPovSx().split("\n\n").map((par) => {
  if (par.startsWith("PERSON:")) {
    const a = par.indexOf("The gold hoop and mole 1 are on my LEFT ear");
    if (a < 0) throw new Error("promptPovFronte: frase nei non trovata");
    return par.slice(0, a) + "The gold hoop and mole 1 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 2 is on my right cheek near the mouth corner, on the LEFT side of the frame.";
  }
  if (par.startsWith("POSE:")) {
    return "POSE: strictly FRONTAL. I face the camera head-on: nose centred, both eyes looking straight into the lens, both ears visible and symmetric, at most 5 degrees of turn. Camera at exactly eye level, horizon level, no roll or tilt, head and neck upright, chin level. Neutral relaxed expression, closed mouth. The single hard cyan-green key light sits right on the lens axis and hits my face straight on, so both cheeks are lit evenly. No hand, no phone.";
  }
  return par;
}).join("\n\n");

// Giro 56: stesso frontale, ma le strisce del motion blur sono SCHERMI luminosi.
const promptPovSchermi = () => promptPovFronte().split("\n\n").map((par) => {
  if (!par.startsWith("MOTION BLUR:")) return par;
  return "MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a wall of glowing SCREENS: LED video walls, digital billboards, rows of monitors, phone and laptop displays, smeared into long horizontal light trails. Each streak keeps a rectangular screen shape with a visible pixel grid, scanlines and tiny blurred UI or text, in electric blue, cyan and white with a few magenta hints. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. Reflections in the lenses stay sharp and show small screens.";
}).join("\n\n");

// Giro 57: schermi BIANCHI, fisheye forte, testa girata di 8 gradi, due fari uguali ai lati dell'obiettivo.
const promptPovBianchi = () => promptPovFronte().split("\n\n").map((par) => {
  if (par.startsWith("Square 1:1")) return "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on an 8mm circular-fisheye-style ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong fisheye barrel distortion: the world curves hard around the frame edges, while my face stays large and close in the centre with only mild distortion. Soft natural jawline.";
  if (par.startsWith("POSE:")) return "POSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.";
  if (par.startsWith("LIGHT:")) return "LIGHT: two identical hard lights with the same saturated cyan-teal gel, one on each side of the lens at the same distance and height, so both sides of my face get exactly the same light, like a single frontal beam. The colored light visibly tints the skin it hits: forehead, nose bridge, cheekbones and upper lip glow pale cyan-teal, clearly colored, not white, not pink, not orange. Soft peach only in the midtones. Deep violet-blue shadows under the glasses, nose, lip and chin, with a cyan bounce on jaw and neck. High contrast. No light from the side or from behind my head. Warmth only in the gold hoop and the hair.";
  if (par.startsWith("MOTION BLUR:")) return "MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus bright white ceiling panels and screens overhead, seen from above. Because of the fisheye the screens curve and bend around the frame and converge toward the top. They are smeared into long horizontal white light trails, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. Reflections in the lenses stay sharp and show small white screens.";
  return par;
}).join("\n\n");

// Giro 58: faro singolo ciano (v494), fisheye a tutto fotogramma senza angoli neri, schermi bianchi.
const promptPovBianchi2 = () => {
  const luce = promptPovFronte().split("\n\n").find((x) => x.startsWith("LIGHT:"));
  if (!luce) throw new Error("promptPovBianchi2: manca il blocco LIGHT in promptPovFronte");
  return promptPovBianchi().split("\n\n").map((par) => {
    if (par.startsWith("Square 1:1")) return "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.";
    if (par.startsWith("LIGHT:")) return luce + " The nose shadow falls straight down under the nose, never to one side, and both cheeks are equally bright, with no shadow on either side of the face.";
    if (par.startsWith("MOTION BLUR:")) return par + " The screens fill every corner of the frame.";
    return par;
  }).join("\n\n");
};

// Giro 59: v502-v504 hanno luci quasi bianche (L97-99, a/b ~0): il gel ciano deve colorare la pelle.
const promptPovBianchi3 = () => promptPovBianchi2().split("\n\n").map((par) =>
  par.startsWith("LIGHT:") ? par + ' EXPOSURE: expose the face one stop darker than feels natural so that forehead, nose bridge and cheekbones are never blown to white: they must stay clearly tinted cyan-green (like a cold teal neon on skin), with visible colour in the brightest spots. The cyan-green gel must visibly colour all lit skin; the skin never looks neutral, white or grey.' : par).join("\n\n");

// Giro 60: v506 e' la scia giusta. Cambiano solo i nei: UNO solo, piccolo e opaco (dalle tre foto scelte non risulta un neo alla bocca).
const promptPovBianchi4 = () => promptPovBianchi3().split("\n\n").map((par) => {
  const i = par.indexOf("Only 2 small moles:");
  if (i < 0) return par;
  const j = par.indexOf("GLASSES") >= 0 ? par.indexOf("GLASSES") : par.length;
  const nuovo = "Exactly ONE mole on my whole face: a small, matte, flat-to-slightly-raised, skin-colored to faintly darker mole on the cheek just in front of the ear that wears the small GOLD hoop earring, at nostril height, about the size of a lentil seed, with NO gloss, NO highlight, NO wet look, not a bump or wart. That gold hoop and that mole are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. No other mole anywhere: nothing near the mouth, no dark dot on the lips or chin, no freckles on the nose or cheeks, no beauty marks, no spots.";
  return par.slice(0, i) + nuovo + par.slice(j);
}).join("\n\n");

// Giro 61: gli schermi in alto non curvavano bene intorno: cupola di schermi a volta sopra la testa.
const promptPovBianchi5 = () => {
  const vecchio = "plus bright white ceiling panels and screens overhead, seen from above. Because of the fisheye the screens curve and bend around the frame and converge toward the top.";
  const nuovo = "plus a vaulted dome of white LED screens overhead: the top third of the frame is one continuous curved video wall that arches over my head like the inside of a cylinder, its screen rows bending in strong arcs that follow the fisheye curvature and converge to a vanishing point above me. The screens wrap around the whole frame, left, right and top, every row bent along the frame edge: no flat ceiling, no straight lines, no dark empty top.";
  const t = promptPovBianchi4();
  if (!t.includes(vecchio)) throw new Error("promptPovBianchi5: frase del soffitto non trovata");
  return t.replace(vecchio, nuovo);
};

// Giro 62: lo sfondo e' un TUNNEL quadrato di schermi tutto intorno (non un cilindro/silo).
const promptPovTunnel = () => {
  const vecchio = "plus bright white ceiling panels and screens overhead, seen from above. Because of the fisheye the screens curve and bend around the frame and converge toward the top. They are smeared into long horizontal white light trails,";
  const nuovo = "plus a SQUARE TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the left wall, right wall, ceiling and floor are all continuous screen surfaces, so the tunnel surrounds me on all four sides and recedes into the distance behind me. Every row of screens runs in strong perspective toward one single vanishing point far behind my head, at the centre of the frame. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NOT a round silo, NOT a cylinder, NOT a dome, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it,";
  const t = promptPovBianchi4();
  if (!t.includes(vecchio)) throw new Error("promptPovTunnel: frase del soffitto non trovata");
  return t.replace(vecchio, nuovo);
};

// Giro 63: serve una vista FRONTALE pulita dei Gascan di Attilio (la foto di prodotto e' di tre quarti).
const promptOcchialiFronte = () => "Image 1 is a product photo of black wraparound sunglasses. Re-shoot exactly these same sunglasses from a perfectly straight-on FRONT view, centred and symmetrical, floating on a pure white seamless background, soft even studio light, square 1:1 product photo. Keep every detail identical to image 1: glossy black one-piece wraparound frame, thick top rim, small notch at the nose bridge, two dark smoke-grey lenses that are NOT mirrored and reflect nothing, thin curved temple arms with a small hinge block beside each lens. No logo, no text, no face, no person, no mirror coating.";

// Giro 64: occhiali Gascan veri (conchiglia nera lucida, lenti fume NON a specchio, stanghette sottili) + vista frontale come riferimento.
const promptPovTunnel2 = () => {
  const t = promptPovTunnel();
  const g0 = t.indexOf("GLASSES:");
  const g1 = t.indexOf("\n\n", g0);
  if (g0 < 0 || g1 < 0) throw new Error("promptPovTunnel2: paragrafo GLASSES non trovato");
  const occhiali = "GLASSES: image 1 shows my sunglasses from the front and from three-quarter view. Copy them exactly: glossy black one-piece wraparound frame (Oakley Gascan style), thick top rim, small notch at the nose bridge, two dark smoke-grey lenses, thin curved temple arms with a small hinge block beside each lens that wrap around the temples. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text, no colored coating.";
  const rifl = "Reflections in the lenses stay sharp and show small white screens.";
  if (!t.includes(rifl)) throw new Error("promptPovTunnel2: frase dei riflessi non trovata");
  return (t.slice(0, g0) + occhiali + t.slice(g1)).replace(rifl, "The lenses stay dark smoke-grey with only a faint soft reflection of white screens.");
};

// Giro 65: il tunnel deve avere la sezione TONDA (tubo), non quadrata.
const promptPovTunnel3 = () => {
  const t = promptPovTunnel2();
  const a = t.indexOf("plus a SQUARE TUNNEL");
  const b = t.indexOf("They are smeared", a);
  if (a < 0 || b < 0) throw new Error("promptPovTunnel3: paragrafo del tunnel non trovato");
  const tondo = "plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. ";
  return t.slice(0, a) + tondo + t.slice(b);
};

// Giro 66: luce meno bruciata e colorata, pelle quasi liscia.
const promptPovTunnel4 = () => {
  let t = promptPovTunnel3();
  const e0 = t.indexOf("EXPOSURE:");
  const e1 = t.indexOf("MOTION BLUR:");
  if (e0 < 0 || e1 < 0 || e1 < e0) throw new Error("promptPovTunnel4: blocco EXPOSURE non trovato");
  const esp = "EXPOSURE: expose the face TWO stops darker than feels natural, like a night shot lit only by coloured neon. The face is a mid-tone: forehead, nose bridge and cheekbones are NEVER white or pale, even in the brightest spot they keep a clear saturated colour. The light is a cyan-green gel leaning slightly yellow-green (teal-lime), not blue and not white, and it visibly tints ALL lit skin; skin never looks neutral, white, grey or blue. Shadows under nose, lips and chin are deep violet-blue. ";
  t = t.slice(0, e0) + esp + t.slice(e1);
  const s0 = t.indexOf("I have at most a very light");
  const s1 = t.indexOf("Jaw soft", s0);
  if (s0 < 0 || s1 < 0) throw new Error("promptPovTunnel4: frase barba non trovata");
  const barba = "My skin on chin, jaw and above the lip is smooth and clean, at most a barely visible hint of stubble, no grey dots, no dark shadow. ";
  t = t.slice(0, s0) + barba + t.slice(s1);
  return t;
};

// Giro 67: v528 piace. I 4 nei VERI (tavola io-identita-nei), occhiali Gascan fasciati veri, testa livellata.
const promptPovTunnel5 = () => {
  let t = promptPovTunnel4();
  const n0 = t.indexOf("Exactly ONE mole");
  const n1 = t.indexOf("GLASSES:");
  const c0 = t.indexOf("CLOTHES:");
  if (n0 < 0 || n1 < n0 || c0 < n1) throw new Error("promptPovTunnel5: blocchi nei/occhiali non trovati");
  const nei = "My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. "
    + "Mole 1: a small raised mole, skin-colored with a slightly darker base, about 3 mm, halfway between the nose and the ear at nostril height; it is my signature mark. "
    + "Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. "
    + "Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. "
    + "Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. "
    + "All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. ";
  const occ = "GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text, no colored coating. ";
  t = t.slice(0, n0) + nei + t.slice(n1, n1) + occ + t.slice(c0);
  const r0 = t.indexOf("no roll or tilt");
  if (r0 < 0) throw new Error("promptPovTunnel5: frase roll non trovata");
  t = t.slice(0, r0) + "no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level" + t.slice(r0 + "no roll or tilt".length);
  return t;
};

// Giro 68: v528 piace e il giro 67 e' peggiorato. Si parte da v528 e si cambiano solo occhiali e nei.
// Giro 80: da zero (la catena di modifiche v528..v565 aveva dimezzato il dettaglio fine della pelle e creato aloni).
// Giro 81: come il 80 ma con la foto di luce e tinta (image 3) che avevo tolto.
// Giro 82: come il giro 81 + la tavola identita-nei (v565 la aveva, dal giro 80 l'avevo persa).
// Giro 83: come fresco3 + v565 come quinto riferimento (Attilio: "l'ultima simile e' la 565", ok esplicito alla deroga).
// Giro 84: come il giro 83 ma con 3 riferimenti (occhiali-vero, v565-look, io-identita-nei); luce scritta, non allegata.
// Giro 86: il set di riferimento scelto da Attilio (reference_pick = io-tre-foto) al posto di io-volti-veri; viso senza descrizione inventata.
// Giro 87: luce frontale sull'asse (ring di schermi dietro la camera) + scie del tunnel nelle lenti.
const promptPovFresco8 = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. My face comes from image 2, three real unretouched photos of me that I chose myself (see LIKENESS below). Lips: thin, matte, pale pink, closed, no gloss, upper lip thin and lower lip slightly fuller. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nIDENTITY SHEET: image 3 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 3, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.\n\nLIKENESS: image 2 shows three real, unretouched photos of me, chosen by me as my reference set. The face in the result must be recognisably THIS person, exactly as in those three photos, not a model and not a more handsome version of me. Copy from image 2 the exact shape of my face, cheeks, jaw and chin, my nose, my eyebrows, my eyes, my ears and my curly hair, and the proportions of my face: eye spacing, nose length and width, mouth width, distance from nose to mouth, chin height. Ignore everything else in image 2: the prescription glasses, the hand on the face, the peace sign, the phone, the mirror, the clothes, the necklace, the backgrounds and the warm indoor light. Do not beautify, slim, age or sharpen my face.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nSKIN AND LIGHT: FRONTAL, ON-AXIS LIGHT. The brightest part of the tunnel is a huge round ring of white LED screens directly BEHIND THE CAMERA, centred on the lens at my eye height, so the light hits my face straight from the front like a giant ring light or an on-camera flash, exactly like a fashion flash shot. Result on the face: both cheeks EQUALLY bright, left and right of the frame identical; no side light, no top light, no light from above or from one side; the nose casts almost no shadow, only a thin soft shadow straight down under the nose and under the chin; the eye sockets and under-brow are lit, not dark. The light is cool white with a cyan-turquoise cast (about #20A2B0 in the glow). Skin: warm tanned golden midtones (not orange, not yellow, not grey), cyan-white sheen on the forehead, nose bridge, cheekbones and lips, slight overexposure only on those highlights, never a white mask. The sides of the face, the jaw edge, the ears and the hair also get a cyan rim from the tunnel wall on both sides, equally. Shadows are deep teal-blue and keep detail, never flat black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No warm or neutral daylight, no window light, no orange studio lamp, no light from the upper right or upper left. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The screens fill every corner of the frame.\n\nLENSES: the tunnel continues inside the lenses WITH THE SAME MOTION EFFECT as the background. Each wraparound smoke-grey lens reflects the round screen tunnel behind the camera, and that reflection is smeared exactly like the background: the white screens become long radial zoom-blur light streaks and trails rushing toward a vanishing point, curved by the lens, with the same speed and direction as the tunnel around me. NOT a sharp static picture of the tunnel, NOT crisp rectangles: blurred white-cyan light trails and smeared screen shapes, bright where the screens are and dark smoke-grey in the gaps, strongest toward the outer edges. The lens keeps its smoke tint, not a chrome mirror. A bright specular line runs along the top rim, and the glossy black frame catches cyan-white streaks on its curves.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";
const promptPovFresco8r = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. My face comes from image 2, three real unretouched photos of me that I chose myself (see LIKENESS below). Lips: thin, matte, pale pink, closed, no gloss, upper lip thin and lower lip slightly fuller. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nIDENTITY SHEET: image 3 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 3, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.\n\nLIKENESS: image 2 shows three real, unretouched photos of me, chosen by me as my reference set. The face in the result must be recognisably THIS person, exactly as in those three photos, not a model and not a more handsome version of me. Copy from image 2 the exact shape of my face, cheeks, jaw and chin, my nose, my eyebrows, my eyes, my ears and my curly hair, and the proportions of my face: eye spacing, nose length and width, mouth width, distance from nose to mouth, chin height. Ignore everything else in image 2: the prescription glasses, the hand on the face, the peace sign, the phone, the mirror, the clothes, the necklace, the backgrounds and the warm indoor light. Do not beautify, slim, age or sharpen my face.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nSKIN AND LIGHT: FRONTAL, ON-AXIS LIGHT. The brightest part of the tunnel is a huge round ring of white LED screens directly BEHIND THE CAMERA, centred on the lens at my eye height, so the light hits my face straight from the front like a giant ring light or an on-camera flash, exactly like a fashion flash shot. Result on the face: both cheeks EQUALLY bright, left and right of the frame identical; no side light, no top light, no light from above or from one side; the nose casts almost no shadow, only a thin soft shadow straight down under the nose and under the chin; the eye sockets and under-brow are lit, not dark. The light is cool white with a cyan-turquoise cast (about #20A2B0 in the glow). Skin: warm tanned golden midtones (not orange, not yellow, not grey), cyan-white sheen on the forehead, nose bridge, cheekbones and lips, slight overexposure only on those highlights, never a white mask. The sides of the face, the jaw edge, the ears and the hair also get a cyan rim from the tunnel wall on both sides, equally. Shadows are deep teal-blue and keep detail, never flat black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No warm or neutral daylight, no window light, no orange studio lamp, no light from the upper right or upper left. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The screens fill every corner of the frame.\n\nLENSES: the tunnel continues inside the lenses WITH THE SAME MOTION EFFECT as the background. Each wraparound smoke-grey lens reflects the round screen tunnel behind the camera, and that reflection is smeared exactly like the background: the white screens become long radial zoom-blur light streaks and trails rushing toward a vanishing point, curved by the lens, with the same speed and direction as the tunnel around me. NOT a sharp static picture of the tunnel, NOT crisp rectangles: blurred white-cyan light trails and smeared screen shapes, bright where the screens are and dark smoke-grey in the gaps, strongest toward the outer edges. The lens keeps its smoke tint, not a chrome mirror. A bright specular line runs along the top rim, and the glossy black frame catches cyan-white streaks on its curves.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.\n\nLIGHT REFERENCE: image 4 is a fashion photo used ONLY for the lighting: copy its frontal on-camera flash, the even light on both cheeks, the slight overexposure on the highlights, the tanned skin tone and the blue shadows. Do NOT copy anything else from image 4: not her face, not her hair, not her white glasses (mine are black), not her hand, pose, clothes or blue background.";
const promptPovFresco9 = () => promptPovFresco8r() + "\n\nV368 GUIDE: image 5 is my best finished portrait of this same person. Match its quality: clean natural skin with visible pores and no grain or stubble dots, the same wraparound Gascan fit hugging the temples, the gold hoop and mole 1 on the same side, and the same recognisable likeness. Do NOT copy from image 5 its flat blue studio background, its high-collar jacket (mine is the black crew-neck tee), its three-quarter pose or its side light: pose and light follow the paragraphs above.";

const promptPovFresco7 = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. My face comes from image 2, three real unretouched photos of me that I chose myself (see LIKENESS below). Lips: thin, matte, pale pink, closed, no gloss, upper lip thin and lower lip slightly fuller. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nIDENTITY SHEET: image 3 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 3, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.\n\nLIKENESS: image 2 shows three real, unretouched photos of me, chosen by me as my reference set. The face in the result must be recognisably THIS person, exactly as in those three photos, not a model and not a more handsome version of me. Copy from image 2 the exact shape of my face, cheeks, jaw and chin, my nose, my eyebrows, my eyes, my ears and my curly hair, and the proportions of my face: eye spacing, nose length and width, mouth width, distance from nose to mouth, chin height. Ignore everything else in image 2: the prescription glasses, the hand on the face, the peace sign, the phone, the mirror, the clothes, the necklace, the backgrounds and the warm indoor light. Do not beautify, slim, age or sharpen my face.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nSKIN AND LIGHT: warm, tanned, golden skin; strong frontal light with slight overexposure on the highlights; high contrast; blue-teal shadows that keep detail. The cyan-blue tint must be visible on my skin in the lit areas and in the shadows. LIGHT: the ONLY light source is the tunnel of white LED screens around me: huge, very close, soft and wide, a white light with a cyan-turquoise cast (about #20A2B0 in the glow) that reaches my face from the front and from both sides at once, so both cheeks are equally lit and the nose shadow falls straight down under the nose. My skin keeps a warm tanned golden colour in the midtones (not orange, not yellow, not grey), with the cyan-blue cast clearly visible on the lit planes and in the shadows, not only as a rim on hair and jawline. Slight overexposure only on the forehead, nose bridge and cheekbones, never a white mask. Shadows are deep teal-blue and keep visible detail, never flat pure black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No orange studio lamp, no separate coloured gel light, no violet blast. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The screens fill every corner of the frame.\n\nLENSES: the tunnel continues inside the lenses. Each wraparound smoke-grey lens carries a clear, real reflection of the round screen tunnel that is behind the camera: the same concentric rings of white LED screens and their motion trails, bent by the curve of the lens and continuing the perspective and the lines of the tunnel in the background, bright white-cyan where the screens are and dark smoke-grey in the gaps. The reflection is visible and readable across the whole lens, strongest toward the outer edges, like a glossy curved smoked lens in a very bright environment, but the lens keeps its smoke tint: not a chrome mirror and not a flat sticker of the background. A bright specular line runs along the top rim, and the glossy black frame catches cyan-white highlights from the screens on its curves.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";
const promptPovFresco6 = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. My face comes from image 2, two real unretouched photos of me (see LIKENESS below). Lips: thin, matte, pale pink, closed, no gloss, upper lip thin and lower lip slightly fuller. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nIDENTITY SHEET: image 3 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 3, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.\n\nLIKENESS: image 2 shows two real, unretouched photos of me. The face in the result must be recognisably THIS person, not a model and not a more handsome version of me: a full, soft, slightly round face, wide at the cheeks, with full cheeks and a soft rounded jaw and chin (no hollow cheeks, no chiselled cheekbones, no sharp jawline); a straight nose with a broad, rounded, fleshy tip; thick, straight, dark-brown eyebrows close above the eyes; hazel greenish-brown eyes, slightly hooded; light-to-medium brown curly hair with loose springy curls on top, lighter brown highlights and a few grey strands, short sides; fair Mediterranean skin. Copy the proportions of my face exactly from image 2: eye spacing, nose length and width, mouth width, distance from nose to mouth, chin height. Ignore the clothes, the background, the warm lamp light, the necklace and the smile of image 2: closed relaxed mouth. Do not beautify, slim, age or sharpen my face.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nSKIN AND LIGHT: warm, tanned, golden skin; strong frontal light with slight overexposure on the highlights; high contrast; blue-teal shadows that keep detail. The cyan-blue tint must be visible on my skin in the lit areas and in the shadows. LIGHT: the ONLY light source is the tunnel of white LED screens around me: huge, very close, soft and wide, a white light with a cyan-turquoise cast (about #20A2B0 in the glow) that reaches my face from the front and from both sides at once, so both cheeks are equally lit and the nose shadow falls straight down under the nose. My skin keeps a warm tanned golden colour in the midtones (not orange, not yellow, not grey), with the cyan-blue cast clearly visible on the lit planes and in the shadows, not only as a rim on hair and jawline. Slight overexposure only on the forehead, nose bridge and cheekbones, never a white mask. Shadows are deep teal-blue and keep visible detail, never flat pure black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No orange studio lamp, no separate coloured gel light, no violet blast. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The screens fill every corner of the frame.\n\nLENSES: the tunnel continues inside the lenses. Each wraparound smoke-grey lens carries a clear, real reflection of the round screen tunnel that is behind the camera: the same concentric rings of white LED screens and their motion trails, bent by the curve of the lens and continuing the perspective and the lines of the tunnel in the background, bright white-cyan where the screens are and dark smoke-grey in the gaps. The reflection is visible and readable across the whole lens, strongest toward the outer edges, like a glossy curved smoked lens in a very bright environment, but the lens keeps its smoke tint: not a chrome mirror and not a flat sticker of the background. A bright specular line runs along the top rim, and the glossy black frame catches cyan-white highlights from the screens on its curves.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";
const promptPovFresco5 = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. My face shape, forehead, curly hair, eyes, eyebrows and nose come from image 2 (see LIKENESS below). Lips: thin, matte, pale pink, closed, no gloss, upper lip thin and lower lip slightly fuller. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nIDENTITY SHEET: image 3 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 3, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.\n\nLIKENESS AND LOOK: image 2 is the earlier render that looked most like me and that I like. Keep from it: the narrow oval face and jaw, the tight dark curly hair (dark brown, dense small curls, not loose or light), the head tilt and camera angle, the thin pale-pink matte lips, and above all the cyan-white light of the screens falling on the skin of the face (cyan on forehead, nose bridge and cheekbones, teal-blue in the shadows under the nose, lips and jaw). Do NOT copy its flaws: render sharp natural skin texture with pores, no plastic smoothing, no white halos along the nose or glasses, no painterly strokes, no grain-heavy beard (keep the short tidy beard).\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nSKIN AND LIGHT: warm, tanned, golden skin; strong frontal light with slight overexposure on the highlights; high contrast; blue-teal shadows that keep detail. The cyan-blue tint must be visible on my skin in the lit areas and in the shadows. LIGHT: the ONLY light source is the tunnel of white LED screens around me: huge, very close, soft and wide, a white light with a cyan-turquoise cast (about #20A2B0 in the glow) that reaches my face from the front and from both sides at once, so both cheeks are equally lit and the nose shadow falls straight down under the nose. My skin keeps a warm tanned golden colour in the midtones (not orange, not yellow, not grey), with the cyan-blue cast clearly visible on the lit planes and in the shadows, not only as a rim on hair and jawline. Slight overexposure only on the forehead, nose bridge and cheekbones, never a white mask. Shadows are deep teal-blue and keep visible detail, never flat pure black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No orange studio lamp, no separate coloured gel light, no violet blast. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The lenses stay dark smoke-grey with a soft, partial, slightly blurred reflection of the white tunnel rings, strongest at the upper and outer edge and nearly absent in the centre, like real glass: not a sharp copy of the tunnel and not a mirror. The screens fill every corner of the frame.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";

const promptPovFresco4 = () => {
  const t = promptPovFresco3();
  const ancora = "\n\nPOSE: almost frontal";
  if (t.split(ancora).length !== 2) throw new Error("ancora POSE non trovata o duplicata in promptPovFresco3");
  const look = "\n\nLIKENESS AND LOOK: image 5 is the earlier render that looked most like me and that I like. Keep from it: the narrow oval face and jaw, the tight dark curly hair (dark brown, dense small curls, not loose or light), the head tilt and camera angle, the thin pale-pink matte lips, and above all the cyan-white light of the screens falling on the skin of the face (cyan on forehead, nose bridge and cheekbones, teal-blue in the shadows under the nose, lips and jaw). Do NOT copy its flaws: render sharp natural skin texture with pores, no plastic smoothing, no white halos along the nose or glasses, no painterly strokes, no grain-heavy beard (keep the short tidy beard).";
  return t.replace(ancora, look + ancora);
};

const promptPovFresco3 = () => {
  const t = promptPovFresco2();
  const ancora = "\n\nPOSE: almost frontal";
  if (t.split(ancora).length !== 2) throw new Error("ancora POSE non trovata o duplicata in promptPovFresco2");
  const nei = "\n\nIDENTITY SHEET: image 4 is my identity sheet. Use it ONLY for the exact look of my lips (the crop labelled 'bocca': thin upper lip, lower lip only slightly fuller, pale muted pink, matte, closed and relaxed, no gloss, no lipstick colour) and for my four real moles exactly as drawn there: small, flesh-toned or tiny brown/reddish, never bigger or darker than in image 4, and no other moles, freckles or marks. Ignore its glasses, its hair, its background, its lack of beard, its colours and its text. The light on the lips and moles follows the cyan-white screens.";
  return t.replace(ancora, nei + ancora);
};

const promptPovFresco2 = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. Image 2 has three photos of me. Take ONLY face shape, forehead, curly hair, eyes, eyebrows, nose, thin matte pale-pink closed lips, no gloss, upper lip thin and lower lip slightly fuller and my moles. Do NOT copy glasses, light, background, clothes, hand, phone or pose (they are low-angle selfies), nor stubble, nor the long curls behind the ear. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nLIGHT AND SKIN REFERENCE: image 3 is a studio photo of a model, given ONLY to show how the light must render skin. Copy from it the skin tone (warm, tanned, golden), the strong frontal light with slight overexposure on the highlights, the contrast, and the blue-teal colour of the shadows, which keep detail. The cyan-blue tint must be visible on my skin in the lit areas and in the shadows, as in image 3. Do NOT copy her face, hair, glasses (hers are silver-white, mine are black), hand, clothes, pose or the blue studio background. LIGHT: the ONLY light source is the tunnel of white LED screens around me: huge, very close, soft and wide, a white light with a cyan-turquoise cast (about #20A2B0 in the glow) that reaches my face from the front and from both sides at once, so both cheeks are equally lit and the nose shadow falls straight down under the nose. My skin keeps a warm tanned golden colour in the midtones, like image 3 (not orange, not yellow, not grey), with the cyan-blue cast clearly visible on the lit planes and in the shadows, not only as a rim on hair and jawline. Slight overexposure only on the forehead, nose bridge and cheekbones, never a white mask. Shadows are deep teal-blue and keep visible detail, never flat pure black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No orange studio lamp, no separate coloured gel light, no violet blast. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The lenses stay dark smoke-grey with a soft, partial, slightly blurred reflection of the white tunnel rings, strongest at the upper and outer edge and nearly absent in the centre, like real glass: not a sharp copy of the tunnel and not a mirror. The screens fill every corner of the frame.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";

const promptPovFresco = () => "Square 1:1 action-selfie POV photo for a luxury techwear campaign, shot on a 12mm ultra-wide lens at arm's length, at my eye level, perfectly level and upright. Strong wide-angle barrel distortion: the world curves around the frame edges, while my face stays large and close in the centre with only mild distortion. FULL FRAME: the image fills the whole square edge to edge. NO black circular vignette, NO black corners, NO circular crop, no frame or border: background content reaches all four corners. Soft natural jawline.\n\nPERSON: me. Image 2 has three photos of me. Take ONLY face shape, forehead, curly hair, eyes, eyebrows, nose, thin matte pale-pink closed lips, no gloss, upper lip thin and lower lip slightly fuller and my moles. Do NOT copy glasses, light, background, clothes, hand, phone or pose (they are low-angle selfies), nor stubble, nor the long curls behind the ear. On cheeks, jaw, chin and above the lip I have short tidy dark stubble, two or three days of growth, even and uniform, under 3 mm, with a clean neck below the jawline: not patchy, not noisy, no grey dots. Jaw soft and rounded, not square, not wide, not jutting. Hair: voluminous curls on top, SHORT sides and nape, no mullet. My four real moles, nothing else on the face. The gold hoop earring and moles 1, 2 and 3 are on my LEFT ear and LEFT cheek, which appear on the RIGHT side of the frame. Mole 1: a small raised mole, skin-colored with a slightly darker base, about 2 mm and small, halfway between the nose and the ear at nostril height; it is my signature mark. Mole 2: a tiny brown dot in the crease between the cheek and the nose, just under the frame of the glasses. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye. Mole 4: on the OTHER side (the LEFT side of the frame), a small dark mole about 2 mm at the height of the corner of the mouth, toward the jaw. All four are small and matte, no gloss, no wet look. I have NO freckles on the nose, no moles on or under the lip or on the chin. GLASSES: image 1 shows my real sunglasses from three angles (three-quarter and side). Copy them exactly: glossy black one-piece WRAPAROUND shield frame (Oakley Gascan). The wide frame and the lenses curve around the sides of my face and hug the temples, so seen from the front the outer ends of the frame bend backwards toward the ears. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide thick temple arms next to the lens that taper toward the ears. They are NOT flat rectangular lenses and NOT a thin frame. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text, no colored coating. CLOTHES: plain black heavyweight cotton crew-neck tee, wide low neck with thick ribbed collar, boxy, slightly oversized, drop shoulder, washed black. No logo, print or patch. Nothing over it, no necklace.\n\nPOSE: almost frontal with one very slight turn: my nose points a tiny bit toward the LEFT of the frame (about 8 degrees), so the RIGHT side of the frame (my left cheek, ear and gold hoop) shows just slightly more than the other side. Both eyes still look straight into the lens, both ears visible. Camera at exactly eye level, horizon level, no roll or tilt: the line through both eyes is perfectly horizontal and both shoulders are level, head and neck upright, chin level. Neutral relaxed expression, closed mouth. No hand, no phone.\n\nLIGHT: the ONLY light source is the tunnel of white LED screens around me: huge, very close, soft and wide, a white light with a cyan-turquoise cast (about #20A2B0 in the glow) that reaches my face from the front and from both sides at once, so both cheeks are equally lit and the nose shadow falls straight down under the nose. My skin keeps its natural warm olive tan colour in the midtones: golden, not orange, not yellow, not grey, not blue. The cyan shows only as a soft rim light on hair, ear and jawline and a faint tint on the brightest planes. Slight overexposure only on the forehead, nose bridge and cheekbones, never a white mask. Shadows are deep teal-blue and keep visible detail, never flat pure black: blacks are lifted, the tee is dark grey-blue with folds catching cyan light, gaps between screens are navy. The gold hoop stays warm. No orange studio lamp, no separate coloured gel light, no violet blast. MOTION BLUR: shot on the run. Face, glasses and neck stay sharp. Everything else is smeared by horizontal directional blur. The background is a dense wall of PURE WHITE glowing screens: LED video walls, billboards, rows of monitors, phone and laptop displays, plus a ROUND TUNNEL made entirely of white LED screens, seen from inside with me in the middle of it: the tunnel has a perfectly CIRCULAR cross-section, like the inside of a tube, so a continuous curved wall of screens wraps around me on every side (left, right, above and below) and recedes into the distance behind me. Rows of screens bend along the circular wall and converge toward one single vanishing point far behind my head, at the centre of the frame, forming concentric rings. Screens are big and bright near the frame edges and smaller toward the centre, with wide-angle barrel distortion. NO flat walls, NO square or rectangular corners, NO flat ceiling, NO flat floor, no open sky, no dark empty areas. They are smeared into long white light trails that follow the tunnel perspective, as if I am running through it, each keeping a rectangular screen shape with a visible pixel grid and scanlines, hot white with only a faint cyan edge, no blue or magenta fills. Dark navy gaps between screens give contrast. Shoulders and tee blurred with slight ghosting, hair trailing, stronger radial blur at the edges. The lenses stay dark smoke-grey with a soft, partial, slightly blurred reflection of the white tunnel rings, strongest at the upper and outer edge and nearly absent in the centre, like real glass: not a sharp copy of the tunnel and not a mirror. The screens fill every corner of the frame.\n\nReal photograph, natural fine pore texture, no skin smoothing, no halo or white outline around the nose, glasses or hair, no oversharpening, no painterly or plastic look, no render look, no AI look, detailed shadows.";


const promptEdit528 = () => JSON.parse('"Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face, curly hair, head pose and angle, the round tunnel of white screens with its motion blur, the teal-green light and colour grade, the dark moody exposure, the black t-shirt, the crop and the square format. Do not smooth, slim, sharpen or re-light anything. Change ONLY these two things.\\n\\nGLASSES: replace the sunglasses with the exact pair shown in image 2 (my real Oakley Gascan): glossy black one-piece WRAPAROUND shield frame whose wide frame and lenses curve around the sides of my face and hug the temples. Thick top rim, one deep smoke-grey lens on each side with a small wing at the outer corner, small notch at the nose bridge, wide temple arms next to the lens that taper toward the ears. NOT flat rectangular lenses, NOT a thin frame. The lenses are NOT mirrored: only a faint soft reflection. No logo, no text.\\n\\nMOLES: image 3 is the chart of my four real moles; they are the only marks on my face. Place them exactly as in the chart, small and matte, no gloss. Remove any other mole, dot or freckle that is not in the chart and add none. The gold hoop earring and my signature raised mole stay on the same side of the frame as in image 1. Do not copy any text or label from the chart.\\n\\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders."');

// Giro 69: v534 e' la candidata. Si cambia solo la pelle del viso basso (stoppia), nient'altro.
const promptEdit534 = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, eyes, nose, lips, curly hair, the wraparound sunglasses, the gold hoop earring, all four moles in their exact places, head pose and angle, the round tunnel of white screens with its motion blur, the teal-green light and colour grade, the dark moody exposure, the black t-shirt, the crop and the square format. Do not change the lighting, do not slim or reshape the face, do not move or add any mole. Change ONLY the skin of my lower face.\n\nSKIN: remove the grey stubble speckle and the grainy beard shadow on my chin, jaw, cheeks and above the upper lip. That skin must be clean and smooth like freshly shaved, with no dark or grey dots and no stubble. Keep a natural, fine skin texture with visible pores, not plastic, not airbrushed, not waxy, and keep the same teal light and the same natural shading on it. Keep the soft rounded jawline.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";

// Giro 70: il giro 69 ha dato 4 volte la foto identica. Prompt piu' esplicito (b), con riferimento di pelle liscia (c).
const promptEdit534b = () => "TASK: produce a NEW edited image. Do not just describe the change, do not ask questions, and do not hand back the original unchanged: the skin of my lower face MUST visibly change.\n\n" + promptEdit534();
const promptEdit534c = () => promptEdit534b().replace("OUTPUT:", "REFERENCE: image 2 shows my real clean-shaved skin on chin and jaw. Use it only as a guide for how smooth and clean my skin must look there. Do not copy the face, light, pose or background from it.\n\nOUTPUT:");

// Giro 71: i giri 69-70 (solo pelle) tornano identici. Si riusa lo schema di edit-528 che ha funzionato, con la pelle come terzo cambio.
const promptEdit534d = () => promptEdit528().replace("Change ONLY these two things.", "Change ONLY these three things.").replace("OUTPUT:", "SKIN: also remove the grey stubble speckle and the grainy beard shadow on my chin, jaw, cheeks and above the upper lip, so that skin looks clean and freshly shaved. This change must be visible. Keep a natural fine skin texture with pores, not plastic, not airbrushed, and keep the same teal light on it. Keep the soft rounded jawline.\n\nOUTPUT:");

// Giro 73: relight generativo da v539 (la luce non convince). a = solo parole, b = con la reference di luce.
const promptRelight539 = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, skin texture and my four moles in their exact places, curly hair, the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the lighting on my face, neck and t-shirt: RELIGHT them.\n\nLIGHT: one hard, bright LED spotlight is mounted right on top of the camera and aimed straight at my face, on the lens axis, like a head-on flash. It carries a strongly coloured gel, pale lime-teal green. It lights both cheeks, the forehead, the nose bridge and the upper lip equally, so the nose shadow falls straight down under the nose and never to the side. Highlights on the skin are tinted pale lime-green: bright but NOT blown out to white (about 90% brightness), and they must visibly colour the skin. Mid-tones keep a natural skin tone with a faint green cast. Shadows under the nose, lips, chin, jaw and neck are deep violet-blue, not black and not plain blue. The skin must never look white, grey or pale. This relight must be clearly visible.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";
const promptRelight539r = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, skin texture and my four moles in their exact places, curly hair, the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the lighting on my face, neck and t-shirt: RELIGHT them.\n\nLIGHT: one hard, bright LED spotlight is mounted right on top of the camera and aimed straight at my face, on the lens axis, like a head-on flash. It carries a strongly coloured gel, pale lime-teal green. It lights both cheeks, the forehead, the nose bridge and the upper lip equally, so the nose shadow falls straight down under the nose and never to the side. Highlights on the skin are tinted pale lime-green: bright but NOT blown out to white (about 90% brightness), and they must visibly colour the skin. Mid-tones keep a natural skin tone with a faint green cast. Shadows under the nose, lips, chin, jaw and neck are deep violet-blue, not black and not plain blue. The skin must never look white, grey or pale. This relight must be clearly visible.\n\nREFERENCE: image 2 is only a lighting reference. Copy only the colour of its light (pale lime-teal highlights, violet-blue shadows) and its head-on hard light. Do NOT copy the person, face, hair, clothes, glasses or background from it.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";

// Giro 74: la luce deve venire dagli schermi (soggetto e occhiali illuminati da loro) con leggera sovraesposizione come la reference.
const promptRelightSchermi = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, skin texture and my four moles in their exact places, curly hair, the shape of the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the lighting: RELIGHT me and my glasses.\n\nLIGHT: the only light sources are the glowing white screens of the tunnel around me. They are huge, bright and very close, so they wrap strong cool-white light with a cyan-teal tint around my face, neck, hair and t-shirt from the front and from both sides, as if I were inside a ring of lit monitors. The light is strong: the brightest skin areas (forehead, nose bridge, cheekbones, upper lip, chin) are slightly overexposed, close to white with a pale teal-lime tint, like a flash photo, never dull and never dark. Mid-tones are natural skin with a teal-green cast. Shadows under the nose, lips, chin, jaw and neck are violet-blue. Both cheeks are lit and the nose shadow falls straight down. My hair edge and shoulders catch a bright cool rim light from the screens.\n\nGLASSES: my sunglasses are lit by the same screens. Bright white-cyan highlights run along the top of the frame and along the temple arm, the glossy black frame catches the glow, and the dark lenses show clear soft reflections of the lit screen grid of the tunnel. Keep the exact same glasses shape.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";
const promptRelightSchermir = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, skin texture and my four moles in their exact places, curly hair, the shape of the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the lighting: RELIGHT me and my glasses.\n\nLIGHT: the only light sources are the glowing white screens of the tunnel around me. They are huge, bright and very close, so they wrap strong cool-white light with a cyan-teal tint around my face, neck, hair and t-shirt from the front and from both sides, as if I were inside a ring of lit monitors. The light is strong: the brightest skin areas (forehead, nose bridge, cheekbones, upper lip, chin) are slightly overexposed, close to white with a pale teal-lime tint, like a flash photo, never dull and never dark. Mid-tones are natural skin with a teal-green cast. Shadows under the nose, lips, chin, jaw and neck are violet-blue. Both cheeks are lit and the nose shadow falls straight down. My hair edge and shoulders catch a bright cool rim light from the screens.\n\nGLASSES: my sunglasses are lit by the same screens. Bright white-cyan highlights run along the top of the frame and along the temple arm, the glossy black frame catches the glow, and the dark lenses show clear soft reflections of the lit screen grid of the tunnel. Keep the exact same glasses shape.\n\nREFERENCE: image 2 is only a lighting reference. Copy only its exposure and colour: the skin highlights are slightly overexposed and nearly white with a teal-lime tint, with violet-blue shadows. Do NOT copy the person, face, hair, clothes, glasses or background from it.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";

// Giro 75: pelle abbronzata calda nelle mezzetinte (reference), luci solo leggermente sovraesposte, luce degli schermi ciano della palette IG (non blu).
const promptRelightCiano = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, my four moles in their exact places, curly hair, the shape of the wraparound sunglasses and the screen reflections in their lenses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the exposure and the colour of the light and skin.\n\nSKIN TONE: my skin is warm and sun-tanned, golden-tan with a peachy warmth in the mid-tones, like a naturally tanned person. It must NOT look pale, white, grey, icy or blue. The face is bright and slightly overexposed, but only slightly: only the very brightest highlights (forehead, nose bridge, cheekbones) clip towards white, with a faint warm tint, and everywhere else the tan colour of the skin stays clearly visible. Lower the overall exposure of the face by about one stop compared to image 1 so the picture is balanced, not washed out.\n\nLIGHT COLOUR: the glowing screens around me give a turquoise-cyan light (about #20A2B0), not blue and not white. It shows as a cyan rim light on my hair edge, shoulders and the edge of my face, as cyan highlights on the glasses frame and as cyan tinted reflections in the lenses. The deepest shadows under the chin, jaw and neck are dark teal-cyan (about #0A3A44), never blue and never violet. The warm tan skin against the cyan light makes a complementary contrast.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";
const promptRelightCianor = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, my four moles in their exact places, curly hair, the shape of the wraparound sunglasses and the screen reflections in their lenses, the gold hoop earring, head pose and angle, the clean smooth skin, the round tunnel of white screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY the exposure and the colour of the light and skin.\n\nSKIN TONE: my skin is warm and sun-tanned, golden-tan with a peachy warmth in the mid-tones, like a naturally tanned person. It must NOT look pale, white, grey, icy or blue. The face is bright and slightly overexposed, but only slightly: only the very brightest highlights (forehead, nose bridge, cheekbones) clip towards white, with a faint warm tint, and everywhere else the tan colour of the skin stays clearly visible. Lower the overall exposure of the face by about one stop compared to image 1 so the picture is balanced, not washed out.\n\nLIGHT COLOUR: the glowing screens around me give a turquoise-cyan light (about #20A2B0), not blue and not white. It shows as a cyan rim light on my hair edge, shoulders and the edge of my face, as cyan highlights on the glasses frame and as cyan tinted reflections in the lenses. The deepest shadows under the chin, jaw and neck are dark teal-cyan (about #0A3A44), never blue and never violet. The warm tan skin against the cyan light makes a complementary contrast.\n\nREFERENCE: image 2 is only a reference for skin tone and exposure: warm tanned skin with slightly overexposed white highlights. Do NOT copy the person, face, hair, clothes, glasses or background from it.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";

// Giro 76: v553 ha il colore ma la pelle e' troppo arancione (mezzetinte a+13,8 b+24,5 contro +4,5/+5,6 della reference). Si desatura la tinta, il resto fermo.
const promptRelightCiano2 = () => promptRelightCianor().replace("OUTPUT:", "SKIN TONE CORRECTION: in image 1 my skin is too orange and too saturated. Make it a natural, neutral golden-tan, like a lightly sun-tanned olive skin: less orange, less red, much less saturated, the mid-tones only slightly warm. It must not look orange, red, sunburnt, spray-tanned or muddy brown, and it must not go pale or grey either. Keep the same slightly overexposed bright highlights, the same exposure and the same cyan screen light.\n\nOUTPUT:").replace("Change ONLY the exposure and the colour of the light and skin.", "Change ONLY the colour of my skin.");

// Giro 77: v556 troppo nera (41% pixel <25 contro 25% della reference; soggetto 52% contro 23%). Neri sollevati, pelle piu' luminosa, schermi con bagliore visibile.
const promptRelightNeri = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, my four moles in their exact places, curly hair, the shape of the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin with its fine natural texture, the round tunnel of screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Do not repaint or smooth the skin. Change ONLY the tonal balance and the glow of the screens.\n\nBALANCE: image 1 is too black. Lift the dark tones so that nothing is a flat black hole: the shadows on my face, neck, hair and t-shirt are deep navy-teal with visible detail and soft gradients, never pure black. The black t-shirt becomes a dark charcoal-navy where the folds and edges catch the cyan light of the screens. My skin is more luminous and brighter overall (about one stop brighter on the face), warm and natural, with only the brightest highlights slightly overexposed. The gaps between the screen panels are dark navy, not black.\n\nSCREEN GLOW: the screens must look like real light emitters, and their light must be visibly the source of the light on me. Every bright panel has a natural soft glow: a gentle bloom and halation around its edges, a faint luminous haze in the air of the tunnel, and a cyan-white light spill that you can see travelling from the panels onto my hair, my glasses and my shoulders. The brightest panels near me glow turquoise-cyan (about #20A2B0 with a white core). Keep it natural, like a long-exposure photo of lit monitors, not a cartoon or neon effect.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";
const promptRelightNerir = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, my four moles in their exact places, curly hair, the shape of the wraparound sunglasses, the gold hoop earring, head pose and angle, the clean smooth skin with its fine natural texture, the round tunnel of screens with its motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Do not repaint or smooth the skin. Change ONLY the tonal balance and the glow of the screens.\n\nBALANCE: image 1 is too black. Lift the dark tones so that nothing is a flat black hole: the shadows on my face, neck, hair and t-shirt are deep navy-teal with visible detail and soft gradients, never pure black. The black t-shirt becomes a dark charcoal-navy where the folds and edges catch the cyan light of the screens. My skin is more luminous and brighter overall (about one stop brighter on the face), warm and natural, with only the brightest highlights slightly overexposed. The gaps between the screen panels are dark navy, not black.\n\nSCREEN GLOW: the screens must look like real light emitters, and their light must be visibly the source of the light on me. Every bright panel has a natural soft glow: a gentle bloom and halation around its edges, a faint luminous haze in the air of the tunnel, and a cyan-white light spill that you can see travelling from the panels onto my hair, my glasses and my shoulders. The brightest panels near me glow turquoise-cyan (about #20A2B0 with a white core). Keep it natural, like a long-exposure photo of lit monitors, not a cartoon or neon effect.\n\nREFERENCE: image 2 is only a reference for tonal balance: its dark areas keep detail and colour (deep blue, never flat black) and its skin is bright and warm. Do NOT copy the person, face, hair, clothes, glasses or background from it.\n\nOUTPUT: one square 1:1 image, same size and framing as image 1, no text, no borders.";

// Giro 78: da v559 solo occhiali Gascan veri, tunnel nelle lenti, barba corta.
const promptOccBarba = () => "Edit image 1, my finished portrait. KEEP EVERYTHING EXACTLY AS IT IS: my face shape, my four moles in their exact places, curly hair, the gold hoop earring, head pose and angle, the skin tone and the warm light on my skin, the round tunnel of white screens with its cyan glow and motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Do not repaint the skin. Change ONLY these three things.\n\n1) SUNGLASSES: replace them with the exact model shown in image 2, which is a set of real photos of the Gascan wraparound sunglasses (three-quarter and side views). Heavy, thick, glossy black plastic wrap shield: a chunky rectangular frame with rounded corners, a wide solid brow bar, a deep curve that wraps around the temples, a small angular hinge block at the outer corner of each lens, and thick wide temple arms that taper toward the ears. The lenses are large rectangular dark smoke-grey. NOT thin-rimmed, NOT oval or round, NO cyan outline around the frame, NO metal rim. Same position and about the same width on my face as now.\n\n2) THE TUNNEL IN THE LENSES: both lenses clearly reflect the tunnel of screens that is in front of me: curved bright white-cyan rings and rows of screens converging to the vanishing point, bent by the curvature of the lens, brighter at the top and at the outer edge of each lens. It must look natural: a semi-transparent reflection over the dark smoke tint, not a flat white mirror. The glossy black frame also catches soft highlights of the same screens.\n\n3) LIGHT BEARD: add a short, even, dark stubble beard like the one in image 3 (my real photos): two to three days of short dark-brown stubble on the cheeks, along the jawline, on the chin and as a thin shadow above the upper lip, slightly denser on the chin, with a clean neckline under the jaw. It must read as real short facial hair with the follicle density of image 3: neat and even, never noisy grain, never blotchy, never grey speckles, never longer than 3 mm. Forehead, nose and the upper cheeks stay smooth and clean. The small mole near the corner of the mouth stays visible. The stubble catches the same cyan glow on its edges. Use image 3 only for the density and colour of the beard: ignore its round eyeglasses, its hair, its clothes, its background and its lighting.\n\nDo not add any text, logo or watermark.";

// Giro 79: riflesso naturale nelle lenti, luce vera degli schermi, labbra e nei come la tavola identita.
const promptLuceVera = () => "Edit image 1, my finished portrait. KEEP EXACTLY AS IT IS: my face shape and identity, the curly hair, the gold hoop earring, the head pose and angle, the thick black Gascan wraparound frame (shape, size and position unchanged), the short even stubble beard, the round tunnel of white screens with its cyan glow and motion blur, the black t-shirt, the crop and the square format. Do not reshape, slim or move anything. Change ONLY these four things.\n\n1) NATURAL REFLECTION IN THE LENSES. Right now the lenses show a sharp, bright copy of the tunnel, like two small screens. Real sunglasses do not do that. The lenses must read first of all as DARK SMOKE-GREY TINTED GLASS. On top of that tint, a faint, soft, out-of-focus reflection of the tunnel: only a few blurred, low-contrast curved bands of cyan-white light, strongest along the top edge and the outer edge of each lens, fading to almost nothing toward the centre and the bottom. The reflection is about 25 percent as bright as the real screens, bent by the curvature of the lens, with one thin soft highlight streak. No sharp screen grid, no readable rings, no flat mirror, no bright blue fill inside the lens.\n\n2) REAL LIGHT ON ME. The only light source in this scene is the tunnel of screens around me, so the light on my face, neck, ear, hair and t-shirt must be exactly what that tunnel would physically produce: a very large, soft, wraparound white-cyan light from the front and both sides, with natural falloff. Brightest on the forehead, the bridge of the nose, the cheekbones and the chin that face the camera, with small crisp specular glints on the nose tip and forehead. The skin keeps my natural olive tan in the midtones with only a slight teal influence; the highlights go white with a cyan tint; the shadow side under the jaw, under the nose and on the neck goes deep teal, never black and never orange. A thin cyan rim of light on the hair, the ear edge and the jaw, in the same places where the bright rings of the tunnel are. The shadows fall consistently with that light: soft, no hard shadow from a studio lamp. No warm, yellow or orange key light on the face, because there is no warm source in this scene.\n\n3) LIPS. Use image 2 (my identity sheet, the crop labelled 'bocca') for the exact look of my lips: thin upper lip, lower lip only slightly fuller, pale muted pink, closed and relaxed, a little dry and matte. Right now they are too full, too saturated pink and glossy. No gloss, no wet highlight, no lipstick colour, no pout. The light on them follows the same cyan-white screens.\n\n4) MY FOUR MOLES, exactly as in image 2 and nowhere else. Mole 1: small raised bump, skin-coloured with a slightly darker base, about 3 mm, on the cheek halfway between nose and ear at nostril height, on the side of the earring; right now it is too big and too dark, a round dark ball: make it small and flesh-toned. Mole 2: a tiny brown dot in the groove between cheek and nose, just under the frame. Mole 3: a tiny reddish dot high on the cheek, under the outer corner of the eye, at the lower edge of the frame. Mole 4: a small dark mole of about 2 mm on the opposite side of the face, at the height of the corner of the mouth, toward the jaw. Each one tiny and realistic, never bigger than in image 2. No other moles, no freckles, no marks. Use image 2 only for the lips and the moles: ignore its glasses, its hair, its background, its lack of beard, its colours and its text.\n\nDo not add any text, logo or watermark.";

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
    { nome: "pura-gel", pura: true, prompt: premiumGel(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-anulare-doc", pura: true, prompt: premiumAnulareDoc(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-anulare", pura: true, prompt: premiumAnulare(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-rasati-tre.png")] },
    { nome: "pura-faro2", pura: true, prompt: premiumFaro2(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-top", pura: true, prompt: premiumFaro3(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "edit-id-neutro", pura: false, prompt: promptEditIdNeutro(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "edit-id-alto", pura: false, prompt: promptEditIdAlto(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "edit-528", pura: false, prompt: promptEdit528(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "edit-534", pura: false, prompt: promptEdit534(), refs: [] },
    { nome: "edit-534b", pura: false, prompt: promptEdit534b(), refs: [] },
    { nome: "relight-539", pura: false, prompt: promptRelight539(), refs: [] },
    { nome: "relight-539r", pura: false, prompt: promptRelight539r(), refs: [join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "relight-schermi", pura: false, prompt: promptRelightSchermi(), refs: [] },
    { nome: "relight-schermir", pura: false, prompt: promptRelightSchermir(), refs: [join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "relight-ciano", pura: false, prompt: promptRelightCiano(), refs: [] },
    { nome: "relight-cianor", pura: false, prompt: promptRelightCianor(), refs: [join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "relight-ciano2", pura: false, prompt: promptRelightCiano2(), refs: [join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "relight-neri", pura: false, prompt: promptRelightNeri(), refs: [] },
    { nome: "relight-nerir", pura: false, prompt: promptRelightNerir(), refs: [join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "luce-vera", pura: false, prompt: promptLuceVera(), refs: [join(D, "refs", "io-identita-nei.png")] },
    { nome: "occ-barba", pura: false, prompt: promptOccBarba(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "edit-534d", pura: false, prompt: promptEdit534d(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "edit-534c", pura: false, prompt: promptEdit534c(), refs: [join(D, "refs", "io-rasati-tre.png")] },
    { nome: "occhiali-fronte", pura: false, prompt: promptOcchialiFronte(), refs: [] as string[] },
    { nome: "edit-id", pura: false, prompt: promptEditId(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-schermi", pura: true, prompt: promptPovSchermi(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-bianchi", pura: true, prompt: promptPovBianchi(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-bianchi2", pura: true, prompt: promptPovBianchi2(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-bianchi3", pura: true, prompt: promptPovBianchi3(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-bianchi4", pura: true, prompt: promptPovBianchi4(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-bianchi5", pura: true, prompt: promptPovBianchi5(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-tunnel", pura: true, prompt: promptPovTunnel(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-tunnel2", pura: true, prompt: promptPovTunnel2(), refs: [join(D, "refs", "occhiali-doppio.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-tunnel3", pura: true, prompt: promptPovTunnel3(), refs: [join(D, "refs", "occhiali-doppio.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-tunnel4", pura: true, prompt: promptPovTunnel4(), refs: [join(D, "refs", "occhiali-doppio.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-tunnel5", pura: true, prompt: promptPovTunnel5(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-fresco", pura: true, prompt: promptPovFresco(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-fresco2", pura: true, prompt: promptPovFresco2(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "pura-pov-fresco3", pura: true, prompt: promptPovFresco3(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "luce-bg-studio-blu.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "pura-pov-fresco4", pura: true, prompt: promptPovFresco4(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "luce-bg-studio-blu.png"), join(D, "refs", "io-identita-nei.png"), join(D, "refs", "v565-look.png")] },
    { nome: "pura-pov-fresco5", pura: true, prompt: promptPovFresco5(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "v565-look.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "pura-pov-fresco6", pura: true, prompt: promptPovFresco6(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-volti-veri.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "pura-pov-fresco7", pura: true, prompt: promptPovFresco7(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "pura-pov-fresco8", pura: true, prompt: promptPovFresco8(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "io-identita-nei.png")] },
    { nome: "pura-pov-fresco8r", pura: true, prompt: promptPovFresco8r(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "io-identita-nei.png"), join(D, "refs", "luce-bg-studio-blu.png")] },
    { nome: "pura-pov-fresco9", pura: true, prompt: promptPovFresco9(), refs: [join(D, "refs", "occhiali-vero.png"), join(D, "refs", "io-tre-foto.png"), join(D, "refs", "io-identita-nei.png"), join(D, "refs", "luce-bg-studio-blu.png"), "/tmp/v368-look.png"] },
    { nome: "pura-pov-fronte", pura: true, prompt: promptPovFronte(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-sx", pura: true, prompt: promptPovSx(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-colore", pura: true, prompt: promptPovColore(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov-en", pura: true, prompt: promptPovEn(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-pov", pura: true, prompt: premiumPov(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
    { nome: "pura-faro", pura: true, prompt: premiumFaro(), refs: [join(D, "refs", "occhiali-solo.png"), join(D, "refs", "io-tre-foto.png")] },
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
        cambiato: `variante ${v.nome}, giro ${g} di ${giri}`,
        refs: v.refs.map((r) => r.split("/").pop()),
        giro: g,
      }),
      "openbrowser",
    );
    console.log(`[da-zero] job ${job.id}  ${v.nome}  ${v.prompt.length} car.`);
  }
});
