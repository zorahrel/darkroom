import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as cfg from "./config.ts";

/**
 * Multi-project support (Studio). Darkroom runs as ONE process serving several
 * local projects, each a self-contained folder with its own SQLite DB and
 * `data/{RAW,generations,final,graded,…}`. The active project for a given unit
 * of work (an HTTP request, a runner job) is carried in an AsyncLocalStorage
 * context, so `db()` and the dir accessors below resolve to the right project
 * without any mutable global that the background runner could race on.
 *
 * Back-compat: with no registry file, a single implicit "default" project is
 * synthesized from the env config (GALLERY_ROOT etc.), so the single-project
 * setup keeps working untouched.
 */

export const DEFAULT_PROJECT_ID = process.env.DARKROOM_PROJECT_ID ?? "default";

/** Where the project registry lives (list of {id,name,root,active}). */
export const REGISTRY_PATH =
  (process.env.DARKROOM_REGISTRY && resolve(process.env.DARKROOM_REGISTRY.trim())) ||
  join(homedir(), "Darkroom", "projects.json");

/** What a project is for. It decides which views the UI offers — the pipeline
 *  (generation, grade, quality checks) is the same for both. */
export type ProjectKind = "photo" | "storyboard" | "video";
export const TUTTE_LE_VISTE: ProjectKind[] = ["photo", "storyboard", "video"];

/**
 * Un progetto non è di un tipo solo.
 *
 * `kind` diceva "questo è un progetto foto" e da lì discendeva tutto: quali
 * schede compaiono, cosa mostra la scheda nell'elenco, dove si atterra
 * aprendolo. Ma un lavoro vero comincia con le foto di un sopralluogo, diventa
 * uno storyboard e finisce in un montaggio — e con un tipo solo bisognava
 * fare tre progetti sulla stessa cartella.
 *
 * Quindi: `views` è cosa il progetto sa fare, `kind` è da dove si entra. Il
 * secondo resta perché "aprendo, dove atterro" è una domanda con una risposta
 * sola, e perché tutto ciò che è stato scritto prima continua a leggersi.
 */
export type Project = {
  id: string;
  name: string;
  root: string;
  /** La vista principale: quella su cui si atterra aprendo il progetto. */
  kind: ProjectKind;
  /** Le viste accese. Contiene sempre `kind`. */
  views: ProjectKind[];
  active: boolean;
  created_at: number;
};

/** Ripulisce un elenco di viste: solo quelle note, senza doppioni, e con
 *  `principale` sempre dentro — una vista principale spenta sarebbe un
 *  progetto che si apre su una pagina che non esiste. */
export function normalizzaViste(viste: unknown, principale: ProjectKind): ProjectKind[] {
  const dentro = new Set<ProjectKind>([principale]);
  if (Array.isArray(viste)) {
    for (const v of viste) {
      if (TUTTE_LE_VISTE.includes(v as ProjectKind)) dentro.add(v as ProjectKind);
    }
  }
  return TUTTE_LE_VISTE.filter((v) => dentro.has(v));
}

export type ProjectDirs = {
  ROOT: string;
  DATA_DIR: string;
  RAW_DIR: string;
  TEST1_DIR: string;
  GEN_DIR: string;
  FINAL_DIR: string;
  UPLOADS_DIR: string;
  GRADED_DIR: string;
  DB_PATH: string;
};

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** The env-configured project, used when the registry is empty and as the
 *  root that honors every GALLERY_* override in config.ts. */
function defaultProject(): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    name: basename(cfg.ROOT) || DEFAULT_PROJECT_ID,
    root: cfg.ROOT,
    kind: "photo",
    views: ["photo"],
    active: true,
    created_at: 0,
  };
}

/** A readable id derived from the name. The user never types this. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** `base`, or `base-2`, `base-3`… — whatever is free in the registry. */
function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`troppi progetti chiamati "${base}"`);
}

function normalize(p: unknown): Project | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !SLUG.test(o.id)) return null;
  if (typeof o.root !== "string" || !o.root) return null;
  return {
    id: o.id,
    name: typeof o.name === "string" && o.name ? o.name : o.id,
    root: resolve(o.root),
    // Projects written before this field existed are photo projects.
    kind: o.kind === "storyboard" || o.kind === "video" ? o.kind : "photo",
    // Un progetto scritto prima che le viste esistessero ha solo la sua.
    views: normalizzaViste(
      o.views,
      o.kind === "storyboard" || o.kind === "video" ? o.kind : "photo",
    ),
    active: o.active !== false,
    created_at: typeof o.created_at === "number" ? o.created_at : 0,
  };
}

let _cache: Project[] | null = null;

function load(): Project[] {
  if (_cache) return _cache;
  let list: Project[] = [];
  try {
    if (existsSync(REGISTRY_PATH)) {
      const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const p = normalize(item);
          if (p && !list.some((x) => x.id === p.id)) list.push(p);
        }
      }
    }
  } catch {
    list = [];
  }
  if (list.length === 0) list = [defaultProject()];
  _cache = list;
  return list;
}

function persist(): void {
  if (!_cache) return;
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(_cache, null, 2) + "\n");
}

export function listProjects(): Project[] {
  return load().map((p) => ({ ...p }));
}

export function getProject(id: string): Project | undefined {
  const p = load().find((x) => x.id === id);
  return p ? { ...p } : undefined;
}

/**
 * Create a project from a name.
 *
 * Everything else is optional: the id is a slug of the name (deduped), and with
 * no `root` the project gets its own folder under `PROJECTS_DIR`, created here
 * along with its data dirs. Passing `root` is the escape hatch for "I already
 * have a folder" — that one has to exist.
 */
export function addProject(input: {
  name: string;
  id?: string;
  root?: string;
  kind?: ProjectKind;
  views?: ProjectKind[];
  active?: boolean;
}): Project {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("serve un nome per il progetto");
  const list = load();
  const taken = new Set(list.map((p) => p.id));

  const requested = String(input.id ?? "").trim();
  if (requested && !SLUG.test(requested)) {
    throw new Error(`id progetto non valido: "${requested}" (usa a-z 0-9 _ -)`);
  }
  if (requested && taken.has(requested)) throw new Error(`progetto già esistente: ${requested}`);
  const base = requested || slugify(name);
  if (!base) throw new Error(`dal nome "${name}" non esce un id utilizzabile: scrivilo con delle lettere`);
  const id = requested || uniqueId(base, taken);

  const explicitRoot = String(input.root ?? "").trim();
  const root = explicitRoot ? resolve(explicitRoot) : join(cfg.PROJECTS_DIR, id);
  if (explicitRoot && !existsSync(root)) {
    throw new Error(`cartella inesistente: ${root}`);
  }
  if (list.some((p) => p.root === root)) {
    throw new Error(`quella cartella è già di un altro progetto: ${root}`);
  }
  if (!explicitRoot) {
    // Ours to create: make the folder and the data layout in one go, so the
    // project is usable the moment it appears in the list.
    for (const dir of [root, join(root, "data"), join(root, "data", "RAW")]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const kind: ProjectKind =
    input.kind === "storyboard" || input.kind === "video" ? input.kind : "photo";
  const project: Project = {
    id,
    name,
    root,
    kind,
    views: normalizzaViste(input.views, kind),
    active: input.active !== false,
    created_at: Date.now(),
  };
  list.push(project);
  persist();
  return { ...project };
}

export function updateProject(id: string, patch: Partial<Omit<Project, "id" | "created_at">>): Project | undefined {
  const list = load();
  const p = list.find((x) => x.id === id);
  if (!p) return undefined;
  if (typeof patch.name === "string" && patch.name.trim()) p.name = patch.name.trim();
  if (typeof patch.root === "string" && patch.root.trim()) p.root = resolve(patch.root.trim());
  if (patch.kind === "photo" || patch.kind === "storyboard" || patch.kind === "video") {
    p.kind = patch.kind;
  }
  if (patch.views !== undefined) p.views = normalizzaViste(patch.views, p.kind);
  // Cambiare la vista principale non deve mai lasciarla spenta.
  p.views = normalizzaViste(p.views, p.kind);
  if (typeof patch.active === "boolean") p.active = patch.active;
  persist();
  return { ...p };
}

/**
 * Forget a project. Only the registry entry goes: the folder, the database and
 * every render stay exactly where they are, so this is undoable by re-adding
 * the same folder. Deleting a project's work is not something a dashboard
 * button should be able to do.
 */
export function removeProject(id: string): Project | undefined {
  const list = load();
  const at = list.findIndex((p) => p.id === id);
  if (at < 0) return undefined;
  const [removed] = list.splice(at, 1);
  persist();
  return removed ? { ...removed } : undefined;
}

// ---- Active-project context (AsyncLocalStorage) ---------------------------

const ctx = new AsyncLocalStorage<string>();

/** Run `fn` (and everything it awaits) with `pid` as the active project. */
export function withProject<T>(pid: string, fn: () => T): T {
  return ctx.run(pid, fn);
}

/** The active project id. Falls back to the first registered project (the env
 *  default) when there is no ambient context (boot, CLI, pre-wrap runner). */
export function currentProjectId(): string {
  return ctx.getStore() ?? load()[0]?.id ?? DEFAULT_PROJECT_ID;
}

// ---- Per-project directory resolution -------------------------------------

/** Resolve every data dir for a project. A project whose root matches the
 *  env-configured ROOT uses the fully env-driven layout (honoring all GALLERY_*
 *  overrides); any other project uses the conventional layout under its root. */
export function dirsFor(pid: string): ProjectDirs {
  const p = getProject(pid) ?? defaultProject();
  if (p.root === cfg.ROOT) {
    return {
      ROOT: cfg.ROOT,
      DATA_DIR: cfg.DATA_DIR,
      RAW_DIR: cfg.RAW_DIR,
      TEST1_DIR: cfg.TEST1_DIR,
      GEN_DIR: cfg.GEN_DIR,
      FINAL_DIR: cfg.FINAL_DIR,
      UPLOADS_DIR: cfg.UPLOADS_DIR,
      GRADED_DIR: cfg.GRADED_DIR,
      DB_PATH: cfg.DB_PATH,
    };
  }
  const root = p.root;
  const data = join(root, "data");
  return {
    ROOT: root,
    DATA_DIR: data,
    RAW_DIR: join(data, "RAW"),
    TEST1_DIR: join(data, "TEST1"),
    GEN_DIR: join(data, "generations"),
    FINAL_DIR: join(data, "final"),
    UPLOADS_DIR: join(data, "uploads"),
    GRADED_DIR: join(data, "graded"),
    DB_PATH: join(root, "photos.db"),
  };
}

/** Dirs for the currently-active project. */
export function dirs(): ProjectDirs {
  return dirsFor(currentProjectId());
}

export const rootDir = (): string => dirs().ROOT;
export const dataDir = (): string => dirs().DATA_DIR;
export const rawDir = (): string => dirs().RAW_DIR;
export const test1Dir = (): string => dirs().TEST1_DIR;
export const genDir = (): string => dirs().GEN_DIR;
/** Le immagini di stile del progetto (`data/refs`). Esistevano gia' su disco e
 *  venivano allegate ai job, ma nessuna rotta le serviva: per confrontare una
 *  variante col riferimento bisognava aprire il Finder. */
export const refsDir = (): string => join(dataDir(), "refs");
export const finalDir = (): string => dirs().FINAL_DIR;
export const uploadsDir = (): string => dirs().UPLOADS_DIR;
export const gradedDir = (): string => dirs().GRADED_DIR;
export const dbPathFor = (): string => dirs().DB_PATH;
