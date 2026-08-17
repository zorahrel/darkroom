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

/**
 * Riferimenti di CIELO, validi su tutto il set e non solo dentro un post.
 *
 * Il cielo è la superficie più grande della foto e cambiava tono da uno scatto
 * all'altro: sul set misurato andava da saturazione 0,31 a 0,85. Il riferimento
 * del post non basta, perché due post diversi ripresi la stessa mattina devono
 * avere lo stesso cielo. Sono due, non uno: un cielo diurno e uno notturno non
 * si assomigliano e non devono essere allineati fra loro.
 *
 * `null` disattiva il meccanismo (nessuna foto eletta).
 */
export type SkyRefs = { day: string | null; night: string | null };

export function skyReferences(): SkyRefs {
  const get = (k: string) =>
    db()
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(k)?.value ?? null;
  return { day: get("sky_ref_day"), night: get("sky_ref_night") };
}

/** La foto di riferimento del post a cui appartiene `photoId`, se esiste.
 *
 *  Non si allega mai la foto a sé stessa: sarebbe rumore, e in un post di due
 *  foto manderebbe il modello a inseguire la propria coda. */
/** Il riferimento di cielo adatto a questa foto: notturno se scattata di sera,
 *  diurno altrimenti. Mai la foto stessa. */
export function skyReferenceFor(photoId: string): string | null {
  const row = db()
    .query<{ taken_at: number | null }, [string]>(
      "SELECT taken_at FROM photos WHERE id = ?",
    )
    .get(photoId);
  const refs = skyReferences();
  const h = row?.taken_at ? new Date(row.taken_at).getHours() : 12;
  const refId = h >= 18 || h < 6 ? refs.night : refs.day;
  if (!refId || refId === photoId) return null;
  return versionPathOf(refId);
}

/** Percorso del render approvato di una foto (preferita, o l'ultima). */
function versionPathOf(photoId: string): string | null {
  const v = db()
    .query<{ image_path: string }, [string, string]>(
      `SELECT v.image_path AS image_path
         FROM versions v
        WHERE v.photo_id = ?1
        ORDER BY (v.id = (SELECT favorite_version_id FROM photos WHERE id = ?2)) DESC,
                 v.id DESC
        LIMIT 1`,
    )
    .get(photoId, photoId);
  return v?.image_path && existsSync(v.image_path) ? v.image_path : null;
}

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
/** Clausola per il riferimento di cielo, distinta da quella del post: qui si
 *  chiede di copiare SOLO il cielo, non il resto del trattamento. */
export const SKY_REFERENCE_CLAUSE =
  "One of the attached images is a SKY REFERENCE. If this photograph shows sky, " +
  "render that sky with exactly the same colour, saturation, brightness and " +
  "texture as the sky in the reference, so that every photograph in the set " +
  "looks shot under the same sky on the same day. Match ONLY the sky from that " +
  "reference — nothing else about it: not its subject, its framing, its light " +
  "direction or its ground-level colours. If this photograph shows no sky, ignore " +
  "the reference entirely.";

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
