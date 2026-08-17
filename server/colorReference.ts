// Riferimento cromatico di un post ---------------------------------------------
// Il problema, e perché il filtro non basta.
//
// Ogni render AI decide il proprio colore in isolamento, quindi due scatti dello
// stesso pomeriggio tornano con dominanti diverse. Correggerlo DOPO — allineando
// le statistiche in Lab — funziona sui numeri ma resta un filtro applicato
// sopra: sposta il colore che è già stato deciso male, invece di farlo decidere
// bene.
//
// Qui si fa il contrario: si allega alla generazione una foto GIÀ approvata del
// suo stesso post, e le si dice di accordarsi a quella. Il modello vede il
// bersaglio mentre lavora, e il colore giusto nasce col render invece di essere
// corretto a valle. Nessun filtro sopra la foto.
import { existsSync } from "node:fs";
import { db } from "./db.ts";

/** La foto di riferimento del post a cui appartiene `photoId`, se esiste.
 *
 *  Non si allega mai la foto a sé stessa: sarebbe rumore, e in un post di due
 *  foto manderebbe il modello a inseguire la propria coda. */
export function colorReferenceFor(photoId: string): string | null {
  const row = db()
    .query<{ ref_id: string | null }, [string]>(
      `SELECT c.reference_photo_id AS ref_id
         FROM collection_photos cp
         JOIN collections c ON c.id = cp.collection_id
        WHERE cp.photo_id = ?`,
    )
    .get(photoId);
  const refId = row?.ref_id;
  if (!refId || refId === photoId) return null;

  // Il render approvato della foto di riferimento: se non ha una preferita si
  // usa l'ultima, che è quel che si sta guardando nella griglia.
  const v = db()
    .query<{ image_path: string }, [string, string]>(
      `SELECT v.image_path AS image_path
         FROM versions v
        WHERE v.photo_id = ?1
        ORDER BY (v.id = (SELECT favorite_version_id FROM photos WHERE id = ?2)) DESC,
                 v.id DESC
        LIMIT 1`,
    )
    .get(refId, refId);
  if (!v?.image_path || !existsSync(v.image_path)) return null;
  return v.image_path;
}

/** La clausola da appendere al prompt quando c'è un riferimento allegato.
 *
 *  Nomina esplicitamente cosa copiare e cosa NON copiare: senza la seconda
 *  parte il modello tende a importare anche il soggetto o l'inquadratura della
 *  reference, che è il modo tipico in cui questa tecnica fallisce. */
export const COLOR_REFERENCE_CLAUSE =
  "A SECOND IMAGE is attached purely as a COLOUR REFERENCE. Match its colour " +
  "treatment exactly: same white balance and colour temperature, same tint, same " +
  "saturation level, same contrast character and the same treatment of skin, " +
  "greenery and skies. The two photographs must look shot on the same camera, on " +
  "the same day, and graded by the same hand. Copy ONLY the colour and tonal " +
  "character from the reference: never its subject, composition, framing, " +
  "objects, people or lighting direction — those come from the first image and " +
  "must be preserved exactly. Do not blend, collage or insert any part of the " +
  "reference image into the result.";
