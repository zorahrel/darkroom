// A post's colour reference ---------------------------------------------------
// The problem, and why a filter is not enough.
//
// Every AI render decides its own colour in isolation, so two shots from the
// same afternoon come back with different casts. Correcting it AFTERWARDS — by
// aligning the statistics in Lab — works on the numbers but stays a filter laid
// on top: it moves colour that has already been decided badly, instead of
// getting it decided well.
//
// Here we do the opposite: an ALREADY approved photo from the same post is
// attached to the generation, and the model is told to match it. The model sees
// the target while it works, and the right colour is born with the render
// instead of being corrected downstream. No filter over the photo.
import { existsSync } from "node:fs";
import { db } from "./db.ts";

/**
 * SKY references, valid across the whole set and not just inside one post.
 *
 * The sky is the largest surface in the photo and changed tone from one shot to
 * the next: on the measured set it ran from saturation 0.31 to 0.85. The post's
 * reference is not enough, because two different posts shot on the same morning
 * have to have the same sky. There are two, not one: a daytime sky and a
 * night-time one do not resemble each other and must not be aligned together.
 *
 * `null` turns the mechanism off (no photo elected).
 */
export type SkyRefs = { day: string | null; night: string | null };

export function skyReferences(): SkyRefs {
  const get = (k: string) =>
    db()
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(k)?.value ?? null;
  return { day: get("sky_ref_day"), night: get("sky_ref_night") };
}

/** The reference photo of the post `photoId` belongs to, if there is one.
 *
 *  A photo is never attached to itself: it would be noise, and in a post of two
 *  photos it would send the model chasing its own tail. */
/** The sky reference suited to this photo: night-time if shot in the evening,
 *  daytime otherwise. Never the photo itself. */
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

/** Path of a photo's approved render (the favourite, or the last one). */
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
  // GLOBAL references win over the post's own.
  //
  // One reference per post seemed reasonable but did the opposite of what was
  // needed: six posts, six different references, with saturations measured from
  // 0.23 to 0.66. Every post became internally coherent and different from all
  // the others — but the set is ONE, and it is scrolled straight through on the
  // same profile.
  const skyRef = skyReferenceFor(photoId);
  if (skyRef) return skyRef;

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

  // The reference photo's approved render: without a favourite the last one is
  // used, which is what you are looking at in the grid.
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

/** The clause to append to the prompt when a reference is attached.
 *
 *  It explicitly names what to copy and what NOT to copy: without the second
 *  part the model tends to import the reference's subject or framing too, which
 *  is the typical way this technique fails. */
/** Clause for the sky reference, distinct from the post's: here we ask to copy
 *  ONLY the sky, not the rest of the treatment. */
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
