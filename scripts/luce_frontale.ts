/**
 * Luce FRONTALE, e le mie foto vere come identita'.
 *
 * L'UTENTE, 14/09, su v132: "non sono io", "non e' sovraesposta", "la luce
 * dovrebbe essere frontale rispetto al volto come reference".
 *
 * TRE CAUSE, tutte trovate nel prompt e negli allegati — nessuna nel modello.
 *
 * 1. LA LUCE DA SOTTO E' ORDINATA, testualmente. Dentro il blocco del fondo
 *    c'e' scritto che dal bagliore in basso "arriva un riflesso ciano freddo
 *    che prende il bordo delle spalle, LA MASCELLA DA SOTTO e il lato in
 *    ombra del collo". Per tredici tiri ho misurato la direzione della luce
 *    (alto-basso -12,6 contro +19,8 della reference) e ho provato a
 *    ribaltarla aggiungendo istruzioni, senza mai leggere che era il prompt
 *    stesso a chiederla. E' la terza volta su questo progetto: come le
 *    "spalle cadenti" di settembre e la "pelle OPACA" di ieri, una frase
 *    scritta per un altro scopo ordina il difetto di oggi.
 *
 * 2. IL FARETTO DI LATO E' ORDINATO. "La luce principale e' UNA sorgente
 *    sola, dura, ALTA E APPENA A SINISTRA, quasi frontale". L'utente su
 *    v128: "sembra un faretto dal lato" — misurato sx-dx +7,7 contro -4,1
 *    della reference, rapporto laterale/verticale 0,61 contro 0,21. Il
 *    prompt diceva "appena a sinistra" e il modello ha obbedito.
 *
 * 3. LE FOTO IDENTITA' NON SONO PIU' LE SUE. Dal 13/09 allegavo
 *    `id1-luce-ciano.png` e `id2-luce-ciano.png`, cioe' le sue due foto vere
 *    TINTE DA ME in post per forzare il colore della luce. Ha funzionato sul
 *    colore (2,0% -> 24,0% di viso ciano) ma l'identita' e' l'unica cosa che
 *    non si puo' barattare, e "non sono io" e' la risposta. Qui tornano le
 *    originali intatte, e il colore resta affidato al prompt: se cala, cala —
 *    si recupera in un altro modo, non falsificando la faccia.
 *
 * COSA CAMBIA, tre sostituzioni e gli allegati. Tutto il resto invariato:
 * identita', occhiali, fondo, 35mm, pelle calda (che ieri ha portato L da
 * 34,5 a 41,5).
 *
 * BERSAGLI
 *     sx-dx        -> ~0      frontale (reference -4,1 · v128 +7,7)
 *     alto-basso   -> >0      dall'alto (reference +19,8 · v132 negativo)
 *     alte luci    -> >=8%    sovraesposta (reference 13,7% · v132 2,2%)
 *     identita'    -> il suo giudizio, che qui e' l'unico che conta
 *
 * USO
 *     bun run scripts/luce_frontale.ts [--giri 2]
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { db, initSchema } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PID = arg("--progetto") ?? "profilo";
const PHOTO = "1";
const BASE = Number(arg("--base") ?? 132);
const rounds = Math.max(1, Number(arg("--giri") ?? 2));

const SOSTITUZIONI: Array<[string, string]> = [
  // 1. il riflesso dal basso: resta sulle spalle, sparisce dalla mascella.
  [
    "che prende il bordo delle spalle, la mascella da sotto e il lato in ombra del collo",
    "che prende soltanto il bordo delle spalle e il lato in ombra del collo. " +
      "Sul VISO quel riflesso non arriva: la mascella e il mento restano in " +
      "ombra, piu' scuri della fronte",
  ],
  // 2. la chiave: frontale e centrata, non di lato.
  [
    "alta e appena a sinistra, quasi frontale",
    "FRONTALE rispetto al mio viso e centrata su di esso, posta appena sopra " +
      "l'altezza dei miei occhi e puntata dritta addosso a me — non di lato, " +
      "non a tre quarti: le due meta' del viso ricevono la stessa quantita' " +
      "di luce, e la fronte e' piu' chiara del mento",
  ],
  // 3. sovraesposizione: dirla come fatto fotografico, non come sfumatura.
  [
    "Un filo SOVRAESPOSTA, come nelle foto di moda: il viso e' il punto piu' " +
      "luminoso dell'inquadratura e sfiora il bianco su fronte e zigomi, " +
      "senza bruciare i dettagli.",
    "SOVRAESPOSTA di mezzo stop, come nelle foto di moda: ampie zone della " +
      "fronte, degli zigomi e del dorso del naso arrivano quasi al bianco e " +
      "ci restano — non un accenno, una superficie. I dettagli e i pori in " +
      "quelle zone restano leggibili, ma la faccia e' chiaramente la cosa " +
      "piu' luminosa di tutta l'immagine.",
  ],
];

withProject(PID, () => {
  initSchema();
  const base = db()
    .query<{ prompt_used: string }, [string, number]>(
      "select prompt_used from versions where photo_id=? and version_number=?",
    )
    .get(PHOTO, BASE);
  if (!base?.prompt_used) throw new Error(`v${BASE} senza prompt`);

  let testo = base.prompt_used;
  for (const [vecchio, nuovo] of SOSTITUZIONI) {
    if (!testo.includes(vecchio)) {
      throw new Error(`ancora non trovata in v${BASE}: "${vecchio.slice(0, 50)}…"`);
    }
    testo = testo.replace(vecchio, nuovo);
  }
  // La riga sul ciano rimandava agli allegati tinti: senza quelli e' una
  // bugia, e un prompt che descrive un allegato inesistente e' esattamente
  // il difetto che su questo progetto ha prodotto 17 render con gli occhiali
  // "come da riferimento" e nessun riferimento allegato.
  testo = testo.replace("Rendilo come lo vedi negli allegati.", "");

  const D = dirsFor(PID).DATA_DIR;
  const refs = [
    join(D, "RAW", "56E417C5-821D-4DC9-B5DD-D76E0F305BB6.JPG"),
    join(D, "refs", "bocca-reale.png"),
    join(D, "refs", "occhiali-gascan-ritagliato.jpg"),
  ];
  for (const p of refs) if (!existsSync(p)) throw new Error(`allegato mancante: ${p}`);

  for (let g = 1; g <= rounds; g++) {
    const lineage = JSON.stringify({
      recipe: "luce-frontale",
      base: `v${BASE}`,
      passo: "tolte le due frasi che ordinavano luce dal basso e di lato + identita' NON tinte",
      refs: refs.map((r) => r.split("/").pop()),
      misura:
        "sx-dx -> ~0 (ref -4,1 · v128 +7,7) · alto-basso -> >0 (ref +19,8) · " +
        "alte luci >85% >= 8% (ref 13,7% · v132 2,2%) · identita': il suo giudizio",
    });
    const job = enqueueJob(
      PHOTO,
      testo,
      null,
      "chatgpt",
      null,
      "edit",
      join(D, "RAW", "1.PNG"),
      JSON.stringify(refs),
      lineage,
      "cdp",
    );
    console.log(`[frontale] job ${job.id}  giro ${g}`);
  }
});
