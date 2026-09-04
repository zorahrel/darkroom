import { spawnSync } from "bun";
import { existsSync } from "node:fs";
import { FFMPEG_BIN, moondreamBin } from "./config.ts";
import { db, type VersionRow } from "./db.ts";
import { thumbnailPath } from "./thumb.ts";

/**
 * Quality control for generated renders.
 *
 * The problem this solves: a batch produces hundreds of versions and the only
 * judge is a human scrolling the grid. Here every render can be measured
 * against a catalogue of *failure modes* — the specific ways these renders go
 * wrong (burnt skies, garbled signage, a plasticky CGI look…).
 *
 * Two kinds of check, deliberately:
 *  - `pixel` — a cheap deterministic measurement (histogram, perceptual hash).
 *    Free, ~0.1s, runs on everything.
 *  - `vlm`   — a yes/no question for the local vision model (Moondream), which
 *    costs a second or two and only runs where semantics are needed.
 *
 * Two rules borrowed from how this is done well elsewhere, and they matter:
 *  1. **A gate reports, it never deletes.** A hit marks a render suspect; the
 *     favourite is still the human's call. Auto-rejection on a checker whose
 *     real error rate is unknown throws away good work.
 *  2. **Unsure counts as pass.** A model that hedges is not evidence of a defect.
 *
 * The same catalogue feeds the prompt: every failure mode can carry a negative
 * clause, so what the checks keep catching becomes what the next generation is
 * told to avoid.
 */

export type CheckKind = "pixel" | "vlm";
export type Verdict = "hit" | "clear" | "unsure" | "error";

export type FailureMode = {
  code: string;
  label: string;
  kind: CheckKind;
  /** vlm: the yes/no question asked about the image. */
  question: string | null;
  /** Clause added to the prompt's "Do not" block. NULL = no prompt effect. */
  negative_clause: string | null;
  /** pixel: the fraction (0..1) above which the measurement counts as a hit. */
  threshold: number | null;
  gate_enabled: boolean;
  builtin: boolean;
  created_at: number;
};

export type CheckResult = {
  code: string;
  verdict: Verdict;
  detail: string | null;
};

export type VersionReport = {
  version_id: number;
  photo_id: string;
  version_number: number;
  checks: CheckResult[];
  hits: string[];
  unsure: string[];
  /** 0-10, purely a ranking aid: 10 = nothing flagged. */
  score: number;
  checked_at: number;
};

/** Ranking score. A hit costs a lot, a hedge costs a little; never below 0. */
export function scoreOf(checks: CheckResult[]): number {
  let score = 10;
  for (const c of checks) {
    if (c.verdict === "hit") score -= 3;
    else if (c.verdict === "unsure") score -= 0.5;
  }
  return Math.max(0, Math.round(score * 10) / 10);
}

// ---- Catalogue --------------------------------------------------------------

/**
 * The built-in failure modes. These are the ones that actually show up in this
 * pipeline (ChatGPT-web edits of real photographs), not a generic list: blown
 * skies and signage, invented text, the plastic 3D look, and near-duplicate
 * renders of the same shot.
 *
 * `gate_enabled` is off for the ones whose false-positive rate is not yet
 * known — they can be run on demand and switched on once trusted.
 */
const BUILTIN_MODES: Omit<FailureMode, "created_at" | "builtin">[] = [
  {
    code: "burnt_highlights",
    label: "Alte luci bruciate",
    kind: "pixel",
    question: null,
    negative_clause: "do not blow out the highlights: keep texture in the sky and in bright signage",
    threshold: 0.02,
    gate_enabled: true,
  },
  {
    code: "crushed_blacks",
    label: "Neri schiacciati",
    kind: "pixel",
    question: null,
    negative_clause: "do not crush the shadows into flat black: keep detail in the dark areas",
    threshold: 0.12,
    gate_enabled: true,
  },
  {
    code: "near_duplicate",
    label: "Quasi identica a un'altra versione",
    kind: "pixel",
    question: null,
    negative_clause: null,
    threshold: 0.93,
    gate_enabled: true,
  },
  {
    code: "garbled_text",
    label: "Testo/insegne inventate",
    kind: "vlm",
    question:
      "Look at any text or signage in this image. If there is no text at all, answer no. Otherwise answer yes only if the lettering is clearly garbled, malformed or made of nonsensical characters. Answer yes or no.",
    negative_clause: "do not alter, invent or garble any text, signage or writing",
    threshold: null,
    gate_enabled: true,
  },
  {
    code: "cgi_look",
    label: "Look 3D/illustrazione",
    kind: "vlm",
    question:
      "Answer yes only if this image clearly looks like a 3D render, a painting or a digital illustration rather than a photograph taken with a camera. If it looks like a real photograph, answer no. Answer yes or no.",
    negative_clause: "do not produce a 3D render, illustration or CGI look — it must read as a real photograph",
    threshold: null,
    gate_enabled: false,
  },
  {
    code: "deformed_anatomy",
    label: "Anatomia deformata",
    kind: "vlm",
    question:
      "Look at the people in this image. If there are no people, answer no. Otherwise answer yes only if a face, hand or limb is clearly deformed or malformed. Answer yes or no.",
    negative_clause: "do not deform faces, hands or limbs",
    threshold: null,
    gate_enabled: true,
  },
  {
    code: "watermark",
    label: "Watermark o didascalie",
    kind: "vlm",
    question:
      "Ignore any text that belongs to the real scene, such as signs or shopfronts. Answer yes only if a watermark, logo or caption has been overlaid on top of the photo by software; otherwise answer no. Answer yes or no.",
    negative_clause: "do not add watermarks, logos, captions or any overlaid text",
    threshold: null,
    gate_enabled: true,
  },
];

function rowToMode(r: Record<string, unknown>): FailureMode {
  return {
    code: String(r.code),
    label: String(r.label),
    kind: r.kind as CheckKind,
    question: (r.question as string | null) ?? null,
    negative_clause: (r.negative_clause as string | null) ?? null,
    threshold: r.threshold === null || r.threshold === undefined ? null : Number(r.threshold),
    gate_enabled: Number(r.gate_enabled) === 1,
    builtin: Number(r.builtin) === 1,
    created_at: Number(r.created_at),
  };
}

/**
 * Install the built-ins, and keep their wording current.
 *
 * The split matters: `question` and `negative_clause` are code — when a
 * question turns out to produce false positives (an early one answered "yes"
 * on photos with no people in them), the fix has to reach existing projects.
 * Everything the user tunes — whether the mode gates, its threshold, its
 * label — is left exactly as they set it.
 */
export function seedFailureModes(): void {
  const insert = db().prepare(
    `INSERT INTO failure_modes
       (code, label, kind, question, negative_clause, threshold, gate_enabled, builtin, created_at)
     VALUES (?,?,?,?,?,?,?,1,?)
     ON CONFLICT(code) DO UPDATE SET
       question = excluded.question,
       negative_clause = excluded.negative_clause
     WHERE failure_modes.builtin = 1`,
  );
  const now = Date.now();
  for (const m of BUILTIN_MODES) {
    insert.run(
      m.code,
      m.label,
      m.kind,
      m.question,
      m.negative_clause,
      m.threshold,
      m.gate_enabled ? 1 : 0,
      now,
    );
  }
}

export function listFailureModes(opts: { gateOnly?: boolean } = {}): FailureMode[] {
  seedFailureModes();
  const sql = opts.gateOnly
    ? "SELECT * FROM failure_modes WHERE gate_enabled = 1 ORDER BY kind, code"
    : "SELECT * FROM failure_modes ORDER BY kind, code";
  return db().query<Record<string, unknown>, []>(sql).all().map(rowToMode);
}

export function getFailureMode(code: string): FailureMode | null {
  const row = db()
    .query<Record<string, unknown>, [string]>("SELECT * FROM failure_modes WHERE code = ?")
    .get(code);
  return row ? rowToMode(row) : null;
}

export type FailureModeInput = {
  code: string;
  label?: string;
  kind?: CheckKind;
  question?: string | null;
  negative_clause?: string | null;
  threshold?: number | null;
  gate_enabled?: boolean;
};

/** Add a failure mode, or amend one. This is how a recurring complaint becomes
 *  a check and a prompt clause instead of a note nobody reads. */
export function upsertFailureMode(input: FailureModeInput): FailureMode {
  const code = String(input.code ?? "").trim();
  if (!/^[a-z0-9_]+$/.test(code)) {
    throw new Error("code must be lowercase letters, digits and underscores");
  }
  const existing = getFailureMode(code);
  if (!existing) {
    const kind = input.kind ?? "vlm";
    if (kind === "vlm" && !input.question?.trim()) {
      throw new Error("a vlm failure mode needs a yes/no question");
    }
    if (kind === "pixel" && !BUILTIN_MODES.some((m) => m.code === code)) {
      throw new Error("pixel checks are built in; a new failure mode must be of kind 'vlm'");
    }
    db().run(
      `INSERT INTO failure_modes
         (code, label, kind, question, negative_clause, threshold, gate_enabled, builtin, created_at)
       VALUES (?,?,?,?,?,?,?,0,?)`,
      [
        code,
        input.label?.trim() || code,
        kind,
        input.question?.trim() ?? null,
        input.negative_clause?.trim() || null,
        input.threshold ?? null,
        input.gate_enabled === false ? 0 : 1,
        Date.now(),
      ],
    );
    return getFailureMode(code)!;
  }
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.label !== undefined) { sets.push("label = ?"); params.push(input.label.trim() || existing.label); }
  if (input.question !== undefined) { sets.push("question = ?"); params.push(input.question?.trim() || null); }
  if (input.negative_clause !== undefined) {
    sets.push("negative_clause = ?");
    params.push(input.negative_clause?.trim() || null);
  }
  if (input.threshold !== undefined) { sets.push("threshold = ?"); params.push(input.threshold); }
  if (input.gate_enabled !== undefined) { sets.push("gate_enabled = ?"); params.push(input.gate_enabled ? 1 : 0); }
  if (sets.length) {
    params.push(code);
    db().run(`UPDATE failure_modes SET ${sets.join(", ")} WHERE code = ?`, params);
  }
  return getFailureMode(code)!;
}

/** Built-ins can be disabled but not deleted — they'd come back on next seed. */
export function deleteFailureMode(code: string): boolean {
  const mode = getFailureMode(code);
  if (!mode) return false;
  if (mode.builtin) throw new Error(`${code} is built in: disable its gate instead of deleting it`);
  db().run("DELETE FROM failure_modes WHERE code = ?", [code]);
  db().run("DELETE FROM version_checks WHERE code = ?", [code]);
  return true;
}

/** Clauses for the prompt's "Do not" block: every gate-enabled mode that has one. */
export function negativeClauses(): string[] {
  return listFailureModes({ gateOnly: true })
    .map((m) => m.negative_clause?.trim())
    .filter((c): c is string => Boolean(c));
}

// ---- Pixel measurements -----------------------------------------------------

/** Decode an image to a small grayscale buffer. ffmpeg is already a dependency
 *  of the color grade, so this adds nothing to install. */
function grayPixels(path: string, size: number): Uint8Array | null {
  const res = spawnSync({
    cmd: [FFMPEG_BIN, "-v", "error", "-i", path, "-vf", `scale=${size}:${size}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!res.success) return null;
  const out = new Uint8Array(res.stdout);
  return out.length >= size * size ? out.subarray(0, size * size) : null;
}

/** Fraction of pixels at or above `level` (highlights) / at or below (shadows). */
function tailFraction(pixels: Uint8Array, level: number, above: boolean): number {
  let n = 0;
  for (const p of pixels) {
    if (above ? p >= level : p <= level) n++;
  }
  return n / pixels.length;
}

/** 16x16 average-hash. Cheap, orientation-sensitive, good enough to catch a
 *  render that is the previous one again. */
export function perceptualHash(path: string): boolean[] | null {
  const px = grayPixels(path, 16);
  if (!px) return null;
  let sum = 0;
  for (const p of px) sum += p;
  const avg = sum / px.length;
  return Array.from(px, (p) => p > avg);
}

export function hashSimilarity(a: boolean[], b: boolean[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return same / a.length;
}

// ---- Vision model -----------------------------------------------------------

/** Path of the Moondream CLI. Read per call (not cached) so it is overridable
 *  per machine — and so tests can point it at a stub. */
/** Ask the vision model a yes/no question about an image.
 *  Anything that is not a clear yes/no is `unsure`, which counts as a pass. */
export function askVision(imagePath: string, question: string, timeoutMs = 30000): { verdict: Verdict; detail: string } {
  const bin = moondreamBin();
  const res = spawnSync({
    cmd: [bin, imagePath, question],
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const out = new TextDecoder().decode(res.stdout).trim();
  if (!res.success) {
    const err = new TextDecoder().decode(res.stderr).trim();
    return { verdict: "error", detail: err.slice(0, 200) || `${bin} failed` };
  }
  const answer = out.toLowerCase();
  if (/^(yes|sì|si)\b/.test(answer)) return { verdict: "hit", detail: out.slice(0, 200) };
  if (/^(no)\b/.test(answer)) return { verdict: "clear", detail: out.slice(0, 200) };
  return { verdict: "unsure", detail: out.slice(0, 200) };
}

// ---- Running the checks -----------------------------------------------------

function getVersion(versionId: number): VersionRow | null {
  return (
    db().query<VersionRow, [number]>("SELECT * FROM versions WHERE id = ?").get(versionId) ?? null
  );
}

function siblingVersions(photoId: string, exceptId: number): VersionRow[] {
  return db()
    .query<VersionRow, [string, number]>(
      "SELECT * FROM versions WHERE photo_id = ? AND id <> ? ORDER BY id DESC",
    )
    .all(photoId, exceptId);
}

function runPixelCheck(mode: FailureMode, version: VersionRow): CheckResult {
  const threshold = mode.threshold ?? 0;
  if (mode.code === "near_duplicate") {
    const mine = perceptualHash(version.image_path);
    if (!mine) return { code: mode.code, verdict: "error", detail: "could not read the image" };
    for (const other of siblingVersions(version.photo_id, version.id)) {
      if (!existsSync(other.image_path)) continue;
      const theirs = perceptualHash(other.image_path);
      if (!theirs) continue;
      const sim = hashSimilarity(mine, theirs);
      if (sim >= threshold) {
        return {
          code: mode.code,
          verdict: "hit",
          detail: `${Math.round(sim * 100)}% simile alla v${other.version_number}`,
        };
      }
    }
    return { code: mode.code, verdict: "clear", detail: null };
  }

  // Histogram checks read a mid-size render: full res costs time and changes
  // nothing, a thumbnail would average the clipping away.
  const px = grayPixels(version.image_path, 512);
  if (!px) return { code: mode.code, verdict: "error", detail: "could not read the image" };
  const isHighlights = mode.code === "burnt_highlights";
  const fraction = isHighlights ? tailFraction(px, 250, true) : tailFraction(px, 4, false);
  const pct = `${(fraction * 100).toFixed(1)}%`;
  return fraction >= threshold
    ? { code: mode.code, verdict: "hit", detail: `${pct} dei pixel (soglia ${(threshold * 100).toFixed(1)}%)` }
    : { code: mode.code, verdict: "clear", detail: pct };
}

/**
 * Run the catalogue against one render and store the verdicts.
 * `only` restricts to specific codes; by default every gate-enabled mode runs.
 */
export async function checkVersion(
  versionId: number,
  opts: { only?: string[]; includeDisabled?: boolean } = {},
): Promise<VersionReport> {
  const version = getVersion(versionId);
  if (!version) throw new Error(`version not found: ${versionId}`);
  if (!existsSync(version.image_path)) throw new Error(`image missing: ${version.image_path}`);

  let modes = listFailureModes({ gateOnly: !opts.includeDisabled });
  if (opts.only?.length) modes = modes.filter((m) => opts.only!.includes(m.code));

  // One downscaled copy feeds every vision question: the model's latency is
  // dominated by upload size, and the cached thumbnail is already on disk.
  let visionImage: string | null = null;
  if (modes.some((m) => m.kind === "vlm")) {
    try {
      visionImage = await thumbnailPath(version.image_path, 768);
    } catch {
      visionImage = version.image_path;
    }
  }

  const checks: CheckResult[] = [];
  for (const mode of modes) {
    if (mode.kind === "pixel") {
      checks.push(runPixelCheck(mode, version));
    } else if (mode.question && visionImage) {
      const { verdict, detail } = askVision(visionImage, mode.question);
      checks.push({ code: mode.code, verdict, detail });
    }
  }

  const now = Date.now();
  const save = db().prepare(
    `INSERT INTO version_checks (version_id, code, verdict, detail, checked_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(version_id, code) DO UPDATE SET
       verdict = excluded.verdict, detail = excluded.detail, checked_at = excluded.checked_at`,
  );
  db().transaction(() => {
    for (const c of checks) save.run(versionId, c.code, c.verdict, c.detail, now);
  })();

  return {
    version_id: versionId,
    photo_id: version.photo_id,
    version_number: version.version_number,
    checks,
    hits: checks.filter((c) => c.verdict === "hit").map((c) => c.code),
    unsure: checks.filter((c) => c.verdict === "unsure").map((c) => c.code),
    score: scoreOf(checks),
    checked_at: now,
  };
}

/** Stored verdicts for a render, without re-running anything. */
export function storedReport(versionId: number): VersionReport | null {
  const version = getVersion(versionId);
  if (!version) return null;
  const rows = db()
    .query<{ code: string; verdict: Verdict; detail: string | null; checked_at: number }, [number]>(
      "SELECT code, verdict, detail, checked_at FROM version_checks WHERE version_id = ? ORDER BY code",
    )
    .all(versionId);
  if (!rows.length) return null;
  const checks: CheckResult[] = rows.map((r) => ({ code: r.code, verdict: r.verdict, detail: r.detail }));
  return {
    version_id: versionId,
    photo_id: version.photo_id,
    version_number: version.version_number,
    checks,
    hits: checks.filter((c) => c.verdict === "hit").map((c) => c.code),
    unsure: checks.filter((c) => c.verdict === "unsure").map((c) => c.code),
    score: scoreOf(checks),
    checked_at: rows[0]!.checked_at,
  };
}

/** Check every render of a photo (cheapest first, so a batch still says
 *  something useful if it is interrupted). */
export async function checkPhoto(
  photoId: string,
  opts: { only?: string[]; includeDisabled?: boolean } = {},
): Promise<VersionReport[]> {
  const versions = db()
    .query<VersionRow, [string]>("SELECT * FROM versions WHERE photo_id = ? ORDER BY id ASC")
    .all(photoId);
  const reports: VersionReport[] = [];
  for (const v of versions) {
    if (!existsSync(v.image_path)) continue;
    reports.push(await checkVersion(v.id, opts));
  }
  return reports;
}

export type FavoriteSuggestion = {
  photo_id: string;
  suggested_version_id: number | null;
  suggested_version_number: number | null;
  current_favorite_id: number | null;
  /** True when the suggestion differs from what is currently starred. */
  differs: boolean;
  reason: string;
  scores: { version_id: number; version_number: number; score: number; hits: string[] }[];
};

/**
 * Which render the checks like best. A suggestion, never an action: the
 * favourite stays the human's to set.
 */
export function suggestFavorite(photoId: string): FavoriteSuggestion {
  const versions = db()
    .query<VersionRow, [string]>("SELECT * FROM versions WHERE photo_id = ? ORDER BY id ASC")
    .all(photoId);
  const photo = db()
    .query<{ favorite_version_id: number | null }, [string]>(
      "SELECT favorite_version_id FROM photos WHERE id = ?",
    )
    .get(photoId);

  const scores = versions
    .map((v) => {
      const report = storedReport(v.id);
      return report
        ? { version_id: v.id, version_number: v.version_number, score: report.score, hits: report.hits }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (!scores.length) {
    return {
      photo_id: photoId,
      suggested_version_id: null,
      suggested_version_number: null,
      current_favorite_id: photo?.favorite_version_id ?? null,
      differs: false,
      reason: "nessuna versione ancora controllata",
      scores: [],
    };
  }

  // Best score wins; ties go to the newest render, which is the one made with
  // the most recent prompt.
  const best = scores.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.version_id > a.version_id) ? b : a));
  const runnerUp = scores.filter((s) => s.version_id !== best.version_id).sort((a, b) => b.score - a.score)[0];
  const margin = runnerUp ? best.score - runnerUp.score : null;
  const reason =
    best.hits.length === 0
      ? margin !== null && margin > 0
        ? `nessun problema rilevato, ${margin.toFixed(1)} punti sopra la seconda`
        : "nessun problema rilevato"
      : `la meno problematica (${best.hits.join(", ")})`;

  return {
    photo_id: photoId,
    suggested_version_id: best.version_id,
    suggested_version_number: best.version_number,
    current_favorite_id: photo?.favorite_version_id ?? null,
    differs: (photo?.favorite_version_id ?? null) !== best.version_id,
    reason,
    scores: scores.sort((a, b) => b.score - a.score),
  };
}

export type VerificationSummary = {
  checked_versions: number;
  total_versions: number;
  flagged_versions: number;
  by_code: { code: string; label: string; hits: number; checked: number; rate: number }[];
  /** Hit rate over time, oldest bucket first — is the tuning working? */
  trend: { from: number; to: number; versions: number; flagged: number; rate: number }[];
};

/** Project-wide view: what gets flagged, how often, and whether it is improving. */
export function verificationSummary(bucketSize = 25): VerificationSummary {
  const d = db();
  const totalVersions = d.query<{ n: number }, []>("SELECT COUNT(*) n FROM versions").get()?.n ?? 0;
  const checkedVersions =
    d.query<{ n: number }, []>("SELECT COUNT(DISTINCT version_id) n FROM version_checks").get()?.n ?? 0;
  const flagged =
    d.query<{ n: number }, []>(
      "SELECT COUNT(DISTINCT version_id) n FROM version_checks WHERE verdict = 'hit'",
    ).get()?.n ?? 0;

  const modes = new Map(listFailureModes().map((m) => [m.code, m.label]));
  const byCode = d
    .query<{ code: string; hits: number; checked: number }, []>(
      `SELECT code,
              SUM(CASE WHEN verdict = 'hit' THEN 1 ELSE 0 END) AS hits,
              COUNT(*) AS checked
         FROM version_checks GROUP BY code ORDER BY hits DESC, code`,
    )
    .all()
    .map((r) => ({
      code: r.code,
      label: modes.get(r.code) ?? r.code,
      hits: r.hits,
      checked: r.checked,
      rate: r.checked ? Math.round((r.hits / r.checked) * 100) / 100 : 0,
    }));

  // Buckets follow check order, so the trend reads as "how the last N runs went".
  const perVersion = d
    .query<{ version_id: number; checked_at: number; hits: number }, []>(
      `SELECT version_id, MIN(checked_at) AS checked_at,
              SUM(CASE WHEN verdict = 'hit' THEN 1 ELSE 0 END) AS hits
         FROM version_checks GROUP BY version_id ORDER BY checked_at ASC`,
    )
    .all();
  const trend: VerificationSummary["trend"] = [];
  for (let i = 0; i < perVersion.length; i += bucketSize) {
    const slice = perVersion.slice(i, i + bucketSize);
    if (!slice.length) break;
    const flaggedInBucket = slice.filter((v) => v.hits > 0).length;
    trend.push({
      from: slice[0]!.checked_at,
      to: slice[slice.length - 1]!.checked_at,
      versions: slice.length,
      flagged: flaggedInBucket,
      rate: Math.round((flaggedInBucket / slice.length) * 100) / 100,
    });
  }

  return {
    checked_versions: checkedVersions,
    total_versions: totalVersions,
    flagged_versions: flagged,
    by_code: byCode,
    trend,
  };
}
