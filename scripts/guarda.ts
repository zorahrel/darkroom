/**
 * Guarda una pagina di Darkroom come la vede chi la apre: WebKit headless, schermata
 * salvata e conteggio delle immagini che NON si caricano.
 *
 * Perche': il pannello del browser di Topics risulta spesso scollegato e non ne vedo
 * l'esito; qui l'immagine rotta (un <img> con dentro HTML, un 404) si misura invece
 * di indovinarla.
 *
 * Uso: bun run scripts/guarda.ts <percorso> [--attesa selettore] [--larghezza 1400]
 *   es. bun run scripts/guarda.ts /p/profilo/photo/1
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { webkit } from "playwright-core";

const args = process.argv.slice(2);
const percorso = args.find((a) => a.startsWith("/")) ?? "/";
const opt = (nome: string, def: string) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const larghezza = Number(opt("larghezza", "1400"));
const base = process.env.DARKROOM_API ?? "http://localhost:3535";

const dir = join(homedir(), "Darkroom", "archive", "schermate");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${percorso.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`);

const browser = await webkit.launch();
try {
  const page = await browser.newPage({ viewport: { width: larghezza, height: 900 } });
  const rotte: string[] = [];
  page.on("response", (r) => {
    const tipo = r.headers()["content-type"] ?? "";
    if (r.request().resourceType() === "image" && (!r.ok() || tipo.startsWith("text/html")))
      rotte.push(`${r.status()} ${tipo.split(";")[0]} ${r.url()}`);
  });
  await page.goto(base + percorso, { waitUntil: "networkidle", timeout: 30000 });
  const sel = opt("attesa", "");
  if (sel) await page.waitForSelector(sel, { timeout: 15000 });
  await page.waitForTimeout(1200);
  // Le miniature fuori schermo sono `loading="lazy"`: non caricate non vuol dire rotte.
  const img = await page.evaluate(() =>
    Array.from(document.images).map((i) => ({
      src: i.currentSrc,
      ok: i.complete && i.naturalWidth > 0,
      lazy: i.loading === "lazy" && !i.complete,
    })),
  );
  await page.screenshot({ path: file, fullPage: false });
  const rotte2 = img.filter((i) => !i.ok && !i.lazy);
  const pigre = img.filter((i) => i.lazy).length;
  console.log(`${percorso}: ${img.length} immagini, ${rotte2.length} rotte, ${pigre} in attesa di scorrimento, ${rotte.length} risposte sbagliate`);
  for (const r of rotte2.slice(0, 8)) console.log("  rotta:", r.src);
  for (const r of rotte.slice(0, 8)) console.log("  risposta sbagliata:", r);
  console.log("schermata:", file);
} finally {
  await browser.close();
}
