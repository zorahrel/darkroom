import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { LUT_DIR } from "./config.ts";
import { normalizeGrade, type ColorGrade, type GradeStep } from "./db.ts";

// Import external color-grade templates into our ColorGrade model. Supported:
//   • .json         — a ColorGrade (or { grade } / { steps }) we already speak.
//   • .xmp / .xml   — Lightroom AND Adobe Camera Raw develop settings: both use
//                     the identical crs: (camera-raw-settings) namespace, so one
//                     parser covers ACR sidecars/presets and LR presets alike.
//   • .lrtemplate   — legacy Lightroom preset (Lua table).
//   • .cube         — a 3D LUT: stored under LUT_DIR/Imported and wrapped in a lut step.
// The mapping to our engine is intentionally partial and HONEST: whatever we
// can't reproduce (tone curve, HSL, split toning, masks…) is returned in `notes`
// so the user knows what was dropped rather than trusting a silent "faithful" import.

export type ImportResult = { grade: ColorGrade; name: string; notes: string[] };

const clamp = (n: number, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

let _seq = 0;
function sid(t: string): string {
  return `${t}_imp_${Date.now().toString(36)}_${(_seq++).toString(36)}`;
}

function colorStep(params: Record<string, number>): GradeStep {
  return { id: sid("color"), type: "color", enabled: true, params };
}

const HSL_XMP_BANDS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];

// Build an `hsl` step from Lightroom/ACR Hue/Saturation/Luminance adjustments,
// or null when the file carries no color-mixer edits. `read` is the crs getter
// bound to the source (XMP attribute/element or Lua key).
function hslStep(read: (key: string) => number | null): GradeStep | null {
  const params: Record<string, number> = {};
  let any = false;
  for (const B of HSL_XMP_BANDS) {
    const b = B.toLowerCase();
    const h = read(`HueAdjustment${B}`);
    const s = read(`SaturationAdjustment${B}`);
    const l = read(`LuminanceAdjustment${B}`);
    if (h != null) { params[`hue_${b}`] = clamp(h); any = any || h !== 0; }
    if (s != null) { params[`sat_${b}`] = clamp(s); any = any || s !== 0; }
    if (l != null) { params[`lum_${b}`] = clamp(l); any = any || l !== 0; }
  }
  return any ? { id: sid("hsl"), type: "hsl", enabled: true, params } : null;
}

// Parse a ToneCurve rdf:Seq (e.g. ToneCurvePV2012 or ...Red) into [x,y] points,
// or null if absent / the identity line.
function curvePoints(text: string, tag: string): [number, number][] | null {
  const seq = new RegExp(`<crs:${tag}>[\\s\\S]*?</crs:${tag}>`).exec(text);
  if (!seq) return null;
  const pts: [number, number][] = [];
  const re = /<rdf:li>\s*(\d+)\s*,\s*(\d+)\s*<\/rdf:li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seq[0])) !== null) pts.push([Number(m[1]), Number(m[2])]);
  const nonIdentity = pts.length >= 2 && pts.some(([x, y]) => Math.abs(x - y) > 1);
  return nonIdentity ? pts : null;
}

// Build a `curve` step from a Lightroom/ACR tone curve: composite point curve
// (else parametric sliders) plus optional per-channel R/G/B point curves.
function curveStep(text: string): GradeStep | null {
  const params: Record<string, unknown> = {};
  const composite = curvePoints(text, "ToneCurvePV2012");
  if (composite) {
    params.points = composite;
  } else {
    const ps = crsNum(text, "ParametricShadows") ?? 0;
    const pd = crsNum(text, "ParametricDarks") ?? 0;
    const pl = crsNum(text, "ParametricLights") ?? 0;
    const ph = crsNum(text, "ParametricHighlights") ?? 0;
    if (ps || pd || pl || ph) {
      params.shadows = clamp(ps);
      params.darks = clamp(pd);
      params.lights = clamp(pl);
      params.highlights = clamp(ph);
    }
  }
  const r = curvePoints(text, "ToneCurvePV2012Red");
  const g = curvePoints(text, "ToneCurvePV2012Green");
  const b = curvePoints(text, "ToneCurvePV2012Blue");
  if (r) params.points_r = r;
  if (g) params.points_g = g;
  if (b) params.points_b = b;
  return Object.keys(params).length ? { id: sid("curve"), type: "curve", enabled: true, params } : null;
}

const clampHue = (v: number) => ((Math.round(v) % 360) + 360) % 360;
const clampSat = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// Build a `split_tone` step from Lightroom/ACR Color Grading (3-way wheels), or
// the legacy Split Toning (shadow+highlight), or null.
function splitToneStep(text: string): GradeStep | null {
  const params: Record<string, number> = {};
  let any = false;
  const cgSat = crsNum(text, "ColorGradeShadowSat");
  const cgMid = crsNum(text, "ColorGradeMidtoneSat");
  const cgHi = crsNum(text, "ColorGradeHighlightSat");
  if (cgSat != null || cgMid != null || cgHi != null) {
    const map: [string, string][] = [
      ["shadows", "Shadow"],
      ["midtones", "Midtone"],
      ["highlights", "Highlight"],
    ];
    for (const [region, cg] of map) {
      const s = crsNum(text, `ColorGrade${cg}Sat`);
      const h = crsNum(text, `ColorGrade${cg}Hue`);
      if (s != null && s !== 0) {
        params[`${region}_sat`] = clampSat(s);
        params[`${region}_hue`] = clampHue(h ?? 0);
        any = true;
      }
    }
    const bal = crsNum(text, "ColorGradeBalance");
    if (bal != null) params.balance = clamp(bal);
  } else {
    const shS = crsNum(text, "SplitToningShadowSaturation");
    const hiS = crsNum(text, "SplitToningHighlightSaturation");
    if (shS != null && shS !== 0) {
      params.shadows_sat = clampSat(shS);
      params.shadows_hue = clampHue(crsNum(text, "SplitToningShadowHue") ?? 0);
      any = true;
    }
    if (hiS != null && hiS !== 0) {
      params.highlights_sat = clampSat(hiS);
      params.highlights_hue = clampHue(crsNum(text, "SplitToningHighlightHue") ?? 0);
      any = true;
    }
    const bal = crsNum(text, "SplitToningBalance");
    if (bal != null) params.balance = clamp(bal);
  }
  return any ? { id: sid("split_tone"), type: "split_tone", enabled: true, params } : null;
}

export function importTemplate(filename: string, text: string): ImportResult {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const base = filename.replace(/\.[^.]+$/, "") || "Template";
  if (ext === "json") return fromJson(text, base);
  if (ext === "cube") return fromCube(filename, text);
  if (ext === "xmp" || ext === "xml") return fromXmp(text, base);
  if (ext === "lrtemplate") return fromLrtemplate(text, base);
  // Unknown extension: try JSON, then XMP, else fail loudly.
  try {
    return fromJson(text, base);
  } catch {
    if (/<x:xmpmeta|crs:/.test(text)) return fromXmp(text, base);
    throw new Error(`Formato non riconosciuto: .${ext}`);
  }
}

// ---- our own JSON ---------------------------------------------------------

function fromJson(text: string, base: string): ImportResult {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const raw =
    parsed && typeof parsed === "object" && "grade" in parsed ? parsed.grade : parsed;
  const grade = normalizeGrade(raw);
  const name =
    (typeof parsed?.name === "string" && parsed.name) || base;
  return { grade, name, notes: [] };
}

// ---- Lightroom / Camera Raw XMP ------------------------------------------

// crs:Key can appear as an attribute (crs:Key="v") or a child element
// (<crs:Key>v</crs:Key>). Read both forms.
function crs(text: string, key: string): string | null {
  const attr = new RegExp(`crs:${key}\\s*=\\s*"([^"]*)"`).exec(text);
  if (attr) return attr[1] ?? null;
  const el = new RegExp(`<crs:${key}>\\s*([^<]*?)\\s*</crs:${key}>`).exec(text);
  return el ? el[1] ?? null : null;
}
function crsNum(text: string, key: string): number | null {
  const v = crs(text, key);
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function xmpName(text: string, fallback: string): string {
  // <crs:Name><rdf:Alt><rdf:li ...>NAME</rdf:li>
  const m = /<crs:Name>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/.exec(text);
  if (m && m[1]) return m[1].trim();
  const attr = crs(text, "Name");
  return attr?.trim() || fallback;
}

function fromXmp(text: string, base: string): ImportResult {
  const notes: string[] = [];

  // Temperature: non-raw uses a -100..100 offset; raw uses Kelvin (~2000-50000).
  let temp = 0;
  const tRaw = crsNum(text, "Temperature");
  if (tRaw != null) {
    if (Math.abs(tRaw) <= 100) temp = clamp(tRaw);
    else {
      temp = clamp(((tRaw - 5500) / 3000) * 100);
      notes.push("Temperatura in Kelvin convertita in modo approssimativo.");
    }
  }

  let tint = 0;
  const tintRaw = crsNum(text, "Tint");
  if (tintRaw != null) tint = clamp(tintRaw);

  // Exposure2012 is in photographic stops (-5..+5); our exposure param is
  // +100 ≈ +1.5 stop, so map 1:1 on that scale.
  let exposure = 0;
  const exp = crsNum(text, "Exposure2012") ?? crsNum(text, "Exposure");
  if (exp != null) exposure = clamp((exp / 1.5) * 100);

  const contrast = clamp(crsNum(text, "Contrast2012") ?? crsNum(text, "Contrast") ?? 0);
  const highlights = clamp(crsNum(text, "Highlights2012") ?? 0);
  const shadows = clamp(crsNum(text, "Shadows2012") ?? 0);
  const whites = clamp(crsNum(text, "Whites2012") ?? 0);
  const blacks = clamp(crsNum(text, "Blacks2012") ?? 0);
  const saturation = clamp(crsNum(text, "Saturation") ?? 0);
  const vibrance = clamp(crsNum(text, "Vibrance") ?? 0);

  // Flag the develop settings we still can't reproduce.
  if (/crs:(Texture|Clarity2012|Dehaze|Sharpness|LuminanceSmoothing)/.test(text))
    notes.push("Texture/Chiarezza/Dehaze/Nitidezza non importati.");
  if (/crs:(CircularGradient|Mask\/|PaintBasedCorrections|GradientBasedCorrections)/.test(text))
    notes.push("Maschere / regolazioni locali non importate.");

  const steps: GradeStep[] = [
    colorStep({ exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, vibrance }),
  ];
  const hsl = hslStep((k) => crsNum(text, k));
  if (hsl) steps.push(hsl);
  const curve = curveStep(text);
  if (curve) steps.push(curve);
  const split = splitToneStep(text);
  if (split) steps.push(split);

  const grade: ColorGrade = { enabled: true, steps };
  if (notes.length === 0) notes.push("Base, HSL, curva e color grading mappati.");
  return { grade, name: xmpName(text, base), notes };
}

// ---- legacy .lrtemplate (Lua) --------------------------------------------

function fromLrtemplate(text: string, base: string): ImportResult {
  // Lua table: keys like `Exposure2012 = 0.35,` and `title = "Name",`. Reuse the
  // XMP mapping by reading bare `Key = value` pairs.
  const luaNum = (key: string): number | null => {
    const m = new RegExp(`\\b${key}\\s*=\\s*(-?[\\d.]+)`).exec(text);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };
  const notes: string[] = [];
  let temp = 0;
  const tRaw = luaNum("Temperature");
  if (tRaw != null) {
    if (Math.abs(tRaw) <= 100) temp = clamp(tRaw);
    else { temp = clamp(((tRaw - 5500) / 3000) * 100); notes.push("Temperatura in Kelvin approssimata."); }
  }
  const tint = clamp(luaNum("Tint") ?? 0);
  let exposure = 0;
  const exp = luaNum("Exposure2012") ?? luaNum("Exposure");
  if (exp != null) exposure = clamp((exp / 1.5) * 100);
  const contrast = clamp(luaNum("Contrast2012") ?? luaNum("Contrast") ?? 0);
  const highlights = clamp(luaNum("Highlights2012") ?? 0);
  const shadows = clamp(luaNum("Shadows2012") ?? 0);
  const whites = clamp(luaNum("Whites2012") ?? 0);
  const blacks = clamp(luaNum("Blacks2012") ?? 0);
  const saturation = clamp(luaNum("Saturation") ?? 0);
  const vibrance = clamp(luaNum("Vibrance") ?? 0);
  const nameM = /\btitle\s*=\s*"([^"]+)"/.exec(text);
  if (notes.length === 0) notes.push("Pannello base mappato.");
  return {
    grade: {
      enabled: true,
      steps: [
        colorStep({ exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, vibrance }),
      ],
    },
    name: nameM?.[1]?.trim() || base,
    notes,
  };
}

// ---- .cube LUT ------------------------------------------------------------

function fromCube(filename: string, text: string): ImportResult {
  if (!/LUT_3D_SIZE|LUT_1D_SIZE/i.test(text)) {
    throw new Error("File .cube non valido (manca LUT_3D_SIZE).");
  }
  const safe = filename.replace(/[^\w.\- ]+/g, "_").replace(/\.cube$/i, "") || "lut";
  const rel = join("Imported", `${safe}.cube`);
  const dest = join(LUT_DIR, rel);
  mkdirSync(join(LUT_DIR, "Imported"), { recursive: true });
  writeFileSync(dest, text);
  const grade: ColorGrade = {
    enabled: true,
    steps: [
      {
        id: sid("lut"),
        type: "lut",
        enabled: true,
        params: { lut: rel, dose: 100, auto_dose: false, dose_night: 30 },
      },
    ],
  };
  return { grade, name: safe, notes: [`LUT salvata in ${rel}, applicata al 100%.`] };
}
