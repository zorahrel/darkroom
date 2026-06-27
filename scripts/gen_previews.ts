#!/usr/bin/env bun
/**
 * Generate filter preview thumbnails for the PromptBuilder cards.
 *
 * Two modes:
 *   --mode=local   (default) Fast, free, zero-credit ImageMagick approximations
 *                  applied to a single base photo. Illustrative, not literal
 *                  model output — meant to convey "what this knob does".
 *   --mode=chatgpt 1:1 with the real pipeline: applies each filter's prompt
 *                  fragment to the base photo via the ChatGPT-web worker
 *                  (free but slow, needs the ChatGPT browser alive + logged in).
 *
 * Flags:
 *   --base=<path>   override the base photo
 *   --group=<key>   only (re)generate one group (e.g. --group=film_stock)
 *   --force         overwrite existing previews
 *
 * Output: client/public/previews/<group>/<value>.jpg  +  _base.jpg
 */
import { spawn } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { assemblePrompt, DEFAULT_CONFIG, type PromptConfig } from "../server/promptConfig.ts";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "client", "public", "previews");
const DEFAULT_BASE = join(ROOT, "data", "RAW", "9E89D0EC-6CC0-4EB3-B5EE-CEE0807D8F21.jpg");
const SIZE = 256;

// Square center-crop + resize applied before any color op.
const CROP = ["-resize", `${SIZE}x${SIZE}^`, "-gravity", "center", "-extent", `${SIZE}x${SIZE}`];

/** ImageMagick op chains per group/value. Base/no-op values are intentionally
 *  omitted — the UI shows the base photo for those. */
type GroupOps = { group: string; ops: Record<string, string[]> };

const GROUPS: GroupOps[] = [
  {
    group: "preset",
    ops: {
      cinematic: ["-brightness-contrast", "0x10", "-modulate", "100,92,100", "-fill", "#ff9d4d", "-tint", "8"],
      editorial: ["-brightness-contrast", "4x6", "-modulate", "104,96,100"],
      documentary: ["-brightness-contrast", "0x4", "-modulate", "100,98,100"],
      "fine-art": ["-sigmoidal-contrast", "2x50%", "-modulate", "100,90,100"],
    },
  },
  {
    group: "film_stock",
    ops: {
      "portra-400": ["-modulate", "102,104,100", "-fill", "#ffd9a0", "-tint", "10"],
      "portra-800": ["-modulate", "102,108,100", "-fill", "#ffc38a", "-tint", "16"],
      "cinestill-800t": ["-channel", "R", "-evaluate", "multiply", "1.06", "+channel", "-modulate", "100,104,98"],
      "ektar-100": ["-modulate", "100,135,100", "-brightness-contrast", "0x12"],
      "fuji-400h": ["-modulate", "104,88,100", "-fill", "#bfead6", "-tint", "10"],
    },
  },
  {
    group: "white_balance",
    ops: {
      neutral: ["-normalize"],
      warm: ["-fill", "#ffb84d", "-tint", "18"],
      cool: ["-fill", "#4db8ff", "-tint", "18"],
    },
  },
  {
    group: "time_of_day",
    ops: {
      golden: ["-modulate", "102,108,100", "-fill", "#ffae42", "-tint", "22"],
      blue: ["-modulate", "96,100,100", "-fill", "#3f7bd8", "-tint", "24"],
      overcast: ["-brightness-contrast", "2x-12", "-modulate", "100,82,100"],
      noon: ["-brightness-contrast", "6x18", "-modulate", "100,102,100"],
      tungsten: ["-fill", "#ff9e3d", "-tint", "26", "-modulate", "100,104,100"],
    },
  },
  {
    group: "palette",
    ops: {
      "warm-earth": ["-fill", "#c97b3c", "-tint", "22", "-modulate", "100,96,100"],
      "teal-orange": ["-fill", "#1f8a8a", "-tint", "12", "-fill", "#ff8a3d", "-tint", "12"],
      desaturated: ["-modulate", "100,55,100"],
      "high-saturation": ["-modulate", "100,160,100"],
    },
  },
  {
    group: "contrast",
    ops: {
      flat: ["+sigmoidal-contrast", "4x50%"],
      punchy: ["-sigmoidal-contrast", "6x50%", "-modulate", "100,108,100"],
    },
  },
  {
    group: "shadows",
    ops: {
      lifted: ["+level", "12%,100%", "-brightness-contrast", "4x-6"],
      crushed: ["-level", "8%,100%", "-brightness-contrast", "-6x10"],
    },
  },
  {
    group: "highlights",
    ops: {
      "warm-lift": ["-fill", "#ffd9a0", "-tint", "10", "-brightness-contrast", "6x0"],
      "cool-lift": ["-fill", "#a0d4ff", "-tint", "10", "-brightness-contrast", "6x0"],
      muted: ["-brightness-contrast", "-4x0", "-level", "0%,94%"],
      neutral: ["-brightness-contrast", "8x2"],
    },
  },
  {
    group: "skin_tones",
    ops: {
      "airy-lift": ["-brightness-contrast", "8x-4", "-modulate", "104,92,100", "-fill", "#ffd6e0", "-tint", "6"],
      desaturate: ["-modulate", "100,72,100"],
      saturate: ["-modulate", "100,124,100", "-fill", "#ffb27a", "-tint", "8"],
      porcelain: ["-modulate", "104,90,98", "-fill", "#e6f0ff", "-tint", "8", "-blur", "0x0.6"],
    },
  },
  {
    group: "atmosphere",
    ops: {
      clean: ["-brightness-contrast", "4x14", "-modulate", "100,108,100"],
      enhance: ["-brightness-contrast", "6x-14", "-fill", "white", "-colorize", "12%"],
      dreamy: ["-blur", "0x2", "-brightness-contrast", "6x-8", "-modulate", "104,94,100"],
    },
  },
  {
    group: "bloom",
    // composite ops handled specially below
    ops: {
      subtle: ["__bloom"],
      halation: ["__halation"],
    },
  },
  {
    group: "grain",
    ops: {
      fine: ["-attenuate", "0.4", "+noise", "Gaussian"],
      visible: ["-attenuate", "1.1", "+noise", "Gaussian"],
    },
  },
  {
    group: "dof",
    ops: { shallow: ["__dof"] },
  },
  {
    group: "harmony",
    ops: {
      subtle: ["-modulate", "100,96,100", "-brightness-contrast", "0x6"],
      strong: ["-modulate", "100,108,100", "-sigmoidal-contrast", "3x50%", "-fill", "#ffcf99", "-tint", "6"],
    },
  },
  {
    group: "food",
    ops: {
      enhance: ["-modulate", "104,122,100", "-brightness-contrast", "4x8", "-fill", "#ffce8a", "-tint", "6"],
    },
  },
];

async function run(cmd: string[]): Promise<void> {
  const proc = spawn({ cmd, stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`cmd failed (${code}): ${cmd.join(" ")}\n${err}`);
  }
}

/** Special composite recipes that can't be a flat op chain. */
function specialCmd(kind: string, base: string, out: string): string[] {
  if (kind === "__bloom") {
    // Screen a blurred copy over itself to glow highlights.
    return ["magick", base, ...CROP, "(", "+clone", "-blur", "0x4", ")", "-compose", "screen", "-composite", "-quality", "85", out];
  }
  if (kind === "__halation") {
    return ["magick", base, ...CROP, "(", "+clone", "-channel", "R", "-blur", "0x6", "+channel", ")", "-compose", "lighten", "-composite", "-fill", "#ff4d4d", "-tint", "6", "-quality", "85", out];
  }
  if (kind === "__dof") {
    // Sharp center, blurred edges via radial mask (black center keeps base).
    return ["magick", base, ...CROP, "(", "+clone", "-blur", "0x9", ")", "(", "-size", `${SIZE}x${SIZE}`, "radial-gradient:black-white", ")", "-composite", "-quality", "85", out];
  }
  throw new Error(`unknown special ${kind}`);
}

async function genLocal(base: string, opts: { group?: string; force: boolean }) {
  // Base photo (used by UI for "neutral" options).
  const basePrep = join(OUT_DIR, "_base.jpg");
  mkdirSync(OUT_DIR, { recursive: true });
  if (opts.force || !existsSync(basePrep)) {
    await run(["magick", base, ...CROP, "-quality", "88", basePrep]);
    console.log("  ✓ _base.jpg");
  }

  let made = 0;
  for (const g of GROUPS) {
    if (opts.group && g.group !== opts.group) continue;
    const dir = join(OUT_DIR, g.group);
    mkdirSync(dir, { recursive: true });
    for (const [value, ops] of Object.entries(g.ops)) {
      const out = join(dir, `${value}.jpg`);
      if (!opts.force && existsSync(out)) continue;
      if (ops.length === 1 && ops[0].startsWith("__")) {
        await run(specialCmd(ops[0], base, out));
      } else {
        await run(["magick", base, ...CROP, ...ops, "-quality", "85", out]);
      }
      made++;
      console.log(`  ✓ ${g.group}/${value}.jpg`);
    }
  }
  console.log(`\nDone (local). ${made} preview(s) generated in ${OUT_DIR}`);
}

/** Build a one-knob config: defaults reset to the most neutral, then set the
 *  single group to `value` — so the preview isolates that one filter. */
function isolatedPrompt(group: keyof PromptConfig, value: string): string {
  const neutral: PromptConfig = {
    ...DEFAULT_CONFIG,
    preset: "documentary",
    film_stock: "none",
    white_balance: "preserve",
    geometry: "off",
    composition: "off",
    harmony: "off",
    food: "off",
    time_of_day: "preserve",
    palette: "preserve",
    contrast: "natural",
    grain: "none",
    shadows: "natural",
    highlights: "preserve",
    bloom: "off",
    dof: "preserve",
    skin_tones: "preserve",
    atmosphere: "preserve",
    cleanup: "off",
    preserve: ["identity", "composition"],
    exclude: ["no_added_elements"],
    freeform: "",
  };
  return assemblePrompt({ ...neutral, [group]: value } as PromptConfig);
}

async function genChatgpt(base: string, opts: { group?: string; force: boolean }) {
  const { runWorker, launchChatgptBrowser } = await import("../server/worker.ts");
  const boot = await launchChatgptBrowser();
  if (!boot.ok) throw new Error(`ChatGPT browser not available: ${boot.error}`);

  const basePrep = join(OUT_DIR, "_base.jpg");
  mkdirSync(OUT_DIR, { recursive: true });
  if (opts.force || !existsSync(basePrep)) {
    await run(["magick", base, ...CROP, "-quality", "88", basePrep]);
  }

  for (const g of GROUPS) {
    if (opts.group && g.group !== opts.group) continue;
    const dir = join(OUT_DIR, g.group);
    mkdirSync(dir, { recursive: true });
    for (const value of Object.keys(g.ops)) {
      const out = join(dir, `${value}.jpg`);
      if (!opts.force && existsSync(out)) continue;
      const prompt = isolatedPrompt(g.group as keyof PromptConfig, value);
      const tmpPng = out.replace(/\.jpg$/, ".src.png");
      console.log(`  … ${g.group}/${value} (chatgpt)`);
      const res = await runWorker({ image: base, prompt, output: tmpPng });
      if (res.status !== "ok") {
        console.warn(`    ✗ ${g.group}/${value}: ${res.error}`);
        continue;
      }
      await run(["magick", tmpPng, ...CROP, "-quality", "85", out]);
      await run(["rm", "-f", tmpPng]);
      console.log(`    ✓ ${g.group}/${value}.jpg`);
    }
  }
  console.log("\nDone (chatgpt).");
}

// ---- main ------------------------------------------------------------------
const args = process.argv.slice(2);
const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const mode = get("mode") ?? "local";
const base = get("base") ?? DEFAULT_BASE;
const group = get("group");
const force = args.includes("--force");

if (!existsSync(base)) {
  console.error(`Base photo not found: ${base}`);
  process.exit(1);
}

console.log(`Generating previews (mode=${mode}) from ${base}${group ? ` [group=${group}]` : ""}${force ? " [force]" : ""}`);

if (mode === "chatgpt") {
  await genChatgpt(base, { group, force });
} else {
  await genLocal(base, { group, force });
}
