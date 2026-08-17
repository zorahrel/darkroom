import { existsSync, mkdirSync } from "node:fs";
import { db, getDefaultConfig, type PhotoRow, type VersionRow } from "./db.ts";
import { finalDir } from "./project.ts";
import {
  DEFAULT_CONFIG,
  assemblePrompt,
  mergeConfig,
  parseConfig,
  parsePartialConfig,
  type PromptConfig,
} from "./promptConfig.ts";
import { negativeClauses } from "./verify.ts";

/** Photo lookups and prompt-config resolution, shared by the route modules. */

export function getPhoto(id: string): PhotoRow | null {
  return (
    db()
      .query<PhotoRow, [string]>("SELECT * FROM photos WHERE id = ?")
      .get(id) ?? null
  );
}

export function getVersionsFor(photoId: string): VersionRow[] {
  return db()
    .query<VersionRow, [string]>(
      "SELECT * FROM versions WHERE photo_id = ? ORDER BY version_number ASC",
    )
    .all(photoId);
}

export function ensureFinalDir(): void {
  const dir = finalDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Il cielo giusto per l'ORA dello scatto.
 *
 * Un cielo diurno e uno notturno hanno bisogno di istruzioni opposte, e
 * sbagliarlo si vede più di ogni altra cosa perché il cielo è la superficie più
 * grande della foto. Sceglierlo a mano su ogni scatto è lavoro inutile: l'ora
 * di scatto lo sa già.
 *
 * Vive qui e non nella rotta perché OGNI percorso di generazione deve
 * applicarlo — è già successo che il ramo Higgsfield lo saltasse e uscisse una
 * foto notturna con le istruzioni per un cielo di mezzogiorno.
 */
export function withSkyForTime(cfg: PromptConfig, photo: PhotoRow): PromptConfig {
  // Un override esplicito per-foto vince sempre: se qualcuno ha scelto il
  // cielo a mano, sa cosa sta facendo.
  if (photo.config_override?.includes('"sky"')) return cfg;
  const h = photo.taken_at ? new Date(photo.taken_at).getHours() : 12;
  return { ...cfg, sky: h >= 18 || h < 6 ? "deep-night" : "even-blue" };
}

/** Resolve the effective PromptConfig for a photo: photo override > settings default > built-in default. */
export function effectiveConfig(photo: PhotoRow): PromptConfig {
  const base = parseConfig(getDefaultConfig()) ?? DEFAULT_CONFIG;
  // Override is stored as a partial — only the fields the user changed.
  const override = parsePartialConfig(photo.config_override);
  return mergeConfig(base, override);
}

/** Fold per-photo extra instructions into the config's freeform block, so they
 *  ride along with the assembled prompt without overriding the global config. */
export function withExtra(cfg: PromptConfig, photo: PhotoRow): PromptConfig {
  const extra = photo.extra_instructions?.trim();
  if (!extra) return cfg;
  const merged = [cfg.freeform?.trim(), extra].filter(Boolean).join(". ");
  return { ...cfg, freeform: merged };
}

/**
 * The prompt actually sent for a config — the assembled blocks plus the
 * clauses learned from the quality checks. Everything that generates OR
 * displays a prompt goes through here, so what the user reads is exactly what
 * the worker gets.
 */
export function promptFor(cfg: PromptConfig): string {
  return assemblePrompt(cfg, negativeClauses());
}
