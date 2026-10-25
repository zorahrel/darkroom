import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { LUT_DIR } from "./config.ts";
import { type ColorGrade, db, getColorGrade } from "./db.ts";
import { REGISTRY_PATH, currentProjectId, getProject, withProject } from "./project.ts";

/**
 * Anteprima Instagram: il profilo vero dell'account, con i post del progetto
 * messi in cima come se fossero gia' pubblicati.
 *
 * Due cose diverse, e stanno in due posti diversi:
 * - il PROFILO e' dell'account, non del progetto: la sua copia locale (scritta
 *   da `scripts/ig_snapshot.mjs`) sta accanto al registro dei progetti
 *   (`~/Darkroom/instagram/<utente>/`), la stessa per ogni progetto che
 *   pubblica su quell'account. Non sotto GALLERY_ROOT: per il progetto Japan
 *   quella e' la cartella del repo, e la copia finirebbe dentro il codice;
 * - QUALE account e QUALE foto profilo provare sono scelte del progetto, e
 *   stanno nelle sue impostazioni (`settings.instagram`).
 *
 * I post in programma sono le collezioni del progetto: e' gia' l'unita' che si
 * pubblica (un post o un carosello), quindi l'anteprima non inventa un secondo
 * elenco da tenere allineato.
 */

export const IG_ROOT = (): string => join(dirname(REGISTRY_PATH), "instagram");

export type IgPostKind = "reel" | "carousel" | "photo";

export type IgProfile = {
  username: string;
  fetched_at: number;
  full_name: string;
  counts: { posts: string | null; followers: string | null; following: string | null };
  bio: string[];
  link: { text: string; url: string | null } | null;
  avatar: string | null;
  highlights: { title: string; image: string | null }[];
  posts: { href: string; kind: IgPostKind; alt: string; image: string | null }[];
};

/** La foto profilo da provare: una versione di una foto di un progetto qualsiasi. */
export type AvatarRef = { project: string; photo: string; version: number; focus_y?: number };

/**
 * La palette di prova: due LUT (in LUT_DIR) verso i colori del feed, una
 * costruita sui post in programma e una sulla foto profilo, perche' partono da
 * colori diversi (vedi scripts/lut_palette.py). Si vedono solo nell'anteprima:
 * il grade salvato del progetto non cambia.
 */
export type IgPalette = { planned_lut: string | null; avatar_lut: string | null };

export type IgSettings = { username: string | null; avatar: AvatarRef | null; palette?: IgPalette | null };

/** Un id di LUT valido: relativo, .cube, dentro LUT_DIR, esistente. */
export function isValidLut(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.endsWith(".cube") &&
    !id.startsWith("/") &&
    !id.split("/").includes("..") &&
    existsSync(join(LUT_DIR, id))
  );
}

/** Il grade di `base` con il passo LUT acceso su `lut`, a dose piena. */
export function withLut(base: ColorGrade | null, lut: string): ColorGrade {
  const step = { id: "lut", type: "lut" as const, enabled: true, params: { lut, dose: 100, auto_dose: false } };
  const steps = (base?.steps ?? []).filter((x) => x.type !== "ai");
  const i = steps.findIndex((x) => x.type === "lut");
  if (i >= 0) steps[i] = { ...steps[i], ...step, params: { ...steps[i].params, ...step.params } };
  else steps.push(step);
  return { enabled: true, steps };
}

const gParam = (g: ColorGrade) => `&g=${encodeURIComponent(JSON.stringify(g))}`;

const SAFE_USER = /^[A-Za-z0-9._]{1,30}$/;

export function isValidUsername(u: unknown): u is string {
  return typeof u === "string" && SAFE_USER.test(u);
}

export function profileDir(username: string): string {
  if (!isValidUsername(username)) throw new Error(`nome utente non valido: ${username}`);
  return join(IG_ROOT(), username);
}

export function readProfile(username: string): IgProfile | null {
  const p = join(profileDir(username), "profile.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as IgProfile;
}

export function getIgSettings(): IgSettings {
  const row = db()
    .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'instagram'")
    .get();
  const base: IgSettings = { username: null, avatar: null };
  if (!row) return base;
  try {
    return { ...base, ...(JSON.parse(row.value) as Partial<IgSettings>) };
  } catch {
    return base;
  }
}

export function setIgSettings(patch: Partial<IgSettings>): IgSettings {
  const next = { ...getIgSettings(), ...patch };
  db().run(
    `INSERT INTO settings (key, value) VALUES ('instagram', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(next)],
  );
  return next;
}

/** Il file di una versione, cercato nel progetto a cui appartiene. */
function versionFile(photo: string, version: number): string | null {
  const row = db()
    .query<{ image_path: string }, [string, number]>(
      "SELECT image_path FROM versions WHERE photo_id = ? AND version_number = ?",
    )
    .get(photo, version);
  return row ? basename(row.image_path) : null;
}

/** L'indirizzo dell'avatar scelto, o null se la versione non esiste (piu').
 *  Con `lut` passa da /graded con la sola LUT, senza creare una versione. */
export function avatarUrl(ref: AvatarRef, lut?: string | null): string | null {
  if (!getProject(ref.project)) return null;
  const file = withProject(ref.project, () => versionFile(ref.photo, ref.version));
  if (!file) return null;
  const q = `project=${encodeURIComponent(ref.project)}&w=480`;
  const seg = `${encodeURIComponent(ref.photo)}/${encodeURIComponent(file)}`;
  if (lut) return `/graded/${seg}?${q}${gParam(withLut(null, lut))}`;
  return `/thumb/gen/${seg}?${q}`;
}

export type PlannedPost = {
  id: string;
  title: string;
  caption: string;
  photo_count: number;
  kind: IgPostKind;
  cover: string | null;
};

/**
 * Le collezioni del progetto come post in programma, dal piu' recente.
 *
 * Sulla griglia di Instagram l'ultimo pubblicato sta in alto a sinistra: la
 * collezione con `position` piu' alta e' l'ultima che uscira', quindi va per
 * prima. La copertina e' la preferita della foto di copertina, passata dal
 * grade del progetto (`/graded`), cioe' com'e' davvero quando si esporta.
 */
export function plannedPosts(lut?: string | null): PlannedPost[] {
  const pid = currentProjectId();
  // Con la palette di prova: il grade del progetto con la LUT di prova al posto
  // della sua, cosi' il resto della catena (bilanciamento, livelli) resta quello.
  const g = lut ? gParam(withLut(getColorGrade(), lut)) : "";
  const rows = db()
    .query<
      { id: string; title: string; caption: string; cover_photo_id: string | null; photo_count: number },
      []
    >(
      `SELECT c.id, c.title, c.caption, c.cover_photo_id,
              (SELECT COUNT(*) FROM collection_photos cp WHERE cp.collection_id = c.id) AS photo_count
         FROM collections c
        ORDER BY c.position DESC, c.created_at DESC`,
    )
    .all();
  return rows.map((r) => {
    const coverPhoto =
      r.cover_photo_id ??
      db()
        .query<{ photo_id: string }, [string]>(
          "SELECT photo_id FROM collection_photos WHERE collection_id = ? ORDER BY position LIMIT 1",
        )
        .get(r.id)?.photo_id ??
      null;
    let cover: string | null = null;
    if (coverPhoto) {
      const fav = db()
        .query<{ image_path: string }, [string]>(
          `SELECT v.image_path FROM photos p JOIN versions v ON v.id = p.favorite_version_id
            WHERE p.id = ?`,
        )
        .get(coverPhoto);
      if (fav) {
        const q = `project=${encodeURIComponent(pid)}&w=720`;
        cover = `/graded/${encodeURIComponent(coverPhoto)}/${encodeURIComponent(basename(fav.image_path))}?${q}${g}`;
      }
    }
    return {
      id: r.id,
      title: r.title ?? "",
      caption: r.caption ?? "",
      photo_count: r.photo_count,
      kind: r.photo_count > 1 ? "carousel" : "photo",
      cover,
    };
  });
}
