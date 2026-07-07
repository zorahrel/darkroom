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

export type Project = {
  id: string;
  name: string;
  root: string;
  active: boolean;
  created_at: number;
};

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
    active: true,
    created_at: 0,
  };
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

export function addProject(input: { id: string; name?: string; root: string; active?: boolean }): Project {
  const id = String(input.id || "").trim();
  if (!SLUG.test(id)) throw new Error(`id progetto non valido: "${id}" (usa a-z 0-9 _ -)`);
  const list = load();
  if (list.some((p) => p.id === id)) throw new Error(`progetto già esistente: ${id}`);
  const root = resolve(String(input.root || "").trim());
  if (!root) throw new Error("root progetto mancante");
  const project: Project = {
    id,
    name: (input.name && input.name.trim()) || id,
    root,
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
  if (typeof patch.active === "boolean") p.active = patch.active;
  persist();
  return { ...p };
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
export const finalDir = (): string => dirs().FINAL_DIR;
export const uploadsDir = (): string => dirs().UPLOADS_DIR;
export const gradedDir = (): string => dirs().GRADED_DIR;
export const dbPathFor = (): string => dirs().DB_PATH;
