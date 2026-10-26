#!/usr/bin/env node
// Controllo della vista Instagram di Darkroom: lo schermo del telefono scorre
// fino in fondo, la riga delle evidenze scorre di lato e la barra in basso resta
// attaccata al fondo. Registra anche il video della prova.
//
//   node scripts/ig_preview_check.mjs [progetto] [cartella-video]
//
// Esce 1 se una delle tre cose non succede. Serve il backend acceso (3535) e il
// client costruito (`bun run build:client`).
import { webkit } from "playwright";
const [, , pid = "darkroom", out = "/tmp/darkroom-ig-check"] = process.argv;
const b = await webkit.launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, recordVideo: { dir: out, size: { width: 1100, height: 1000 } } });
const p = await ctx.newPage();
let ok = true;
const fail = (m) => { ok = false; console.error("NO:", m); };
try {
  await p.goto(`http://localhost:3535/p/${pid}/instagram`, { waitUntil: "load", timeout: 120000 });
  const s = p.locator('[data-testid="ig-screen"]');
  await s.waitFor({ timeout: 15000 });
  // i dati arrivano dopo lo schermo: si aspetta la griglia, non un tempo fisso
  await p.locator('[data-testid="ig-grid"] > div').first().waitFor({ timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(600);
  const tiles = await p.locator('[data-testid="ig-grid"] > div').count();
  if (tiles === 0) fail("griglia vuota");
  const box = await s.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 160); await p.waitForTimeout(120); }
  const { top, max } = await s.evaluate((e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight }));
  if (max <= 0 || Math.abs(top - max) > 2) fail(`scroll fermo a ${top} su ${max}`);
  // La barra deve stare alla stessa distanza dal fondo dello schermo in alto, a
  // meta' e in fondo allo scroll: prima si misurava solo in fondo, dove anche
  // una barra sganciata sembra al suo posto.
  const barGap = () => p.evaluate(() => {
    const f = document.querySelector('[data-testid="ig-frame"]').getBoundingClientRect();
    const t = document.querySelector('[data-testid="ig-tabbar"]').getBoundingClientRect();
    return Math.round(f.bottom - t.bottom);
  });
  const gaps = [];
  for (const at of [0, 0.5, 1]) {
    await s.evaluate((e, a) => (e.scrollTop = (e.scrollHeight - e.clientHeight) * a), at);
    await p.waitForTimeout(150);
    gaps.push(await barGap());
  }
  const gap = gaps[0];
  if (Math.max(...gaps) - Math.min(...gaps) > 1) fail(`la barra si sposta con lo scroll: ${gaps.join("/")}px dal fondo`);
  if (gap < 0) fail(`barra fuori dallo schermo di ${-gap}px`);
  // in fondo l'ultima riga della griglia deve poter salire sopra la barra
  const hidden = await p.evaluate(() => {
    const cells = document.querySelectorAll('[data-testid="ig-grid"] > div');
    const last = cells[cells.length - 1].getBoundingClientRect();
    const t = document.querySelector('[data-testid="ig-tabbar"]').getBoundingClientRect();
    return Math.round(last.bottom - t.top);
  });
  if (hidden > 0) fail(`l'ultima riga resta sotto la barra di ${hidden}px`);
  await s.evaluate((e) => (e.scrollTop = 0));
  const hl = p.locator('[data-testid="ig-screen"] .overflow-x-auto');
  const hb = await hl.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.wheel(220, 0); await p.waitForTimeout(400);
  const left = await hl.evaluate((e) => e.scrollLeft);
  const canScroll = await hl.evaluate((e) => e.scrollWidth > e.clientWidth);
  if (canScroll && left <= 0) fail("le evidenze non scorrono di lato");
  // Finestra stretta come il pannello: la barra mobile di Darkroom («Strumenti /
  // Progetti») e' fissa in basso e non deve coprire il fondo del telefono.
  await p.setViewportSize({ width: 750, height: 600 });
  await p.waitForTimeout(800);
  // Nel pannello qualcosa sopra il telefono arriva dopo (un avviso, l'intestazione
  // che si riempie) e lo spinge in basso: la scala deve seguirlo.
  await p.evaluate(() => {
    const d = document.createElement("div");
    d.style.height = "60px";
    document.querySelector('[data-testid="instagram-page"]').before(d);
  });
  await p.waitForTimeout(800);
  const covered = await p.evaluate(() => {
    const f = document.querySelector('[data-testid="ig-frame"]').getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Navigazione principale"]');
    const r = nav && nav.getBoundingClientRect();
    const limit = r && r.height > 0 ? r.top : window.innerHeight;
    return Math.round(f.bottom - limit);
  });
  if (covered > 0) fail(`il fondo del telefono e' coperto per ${covered}px a finestra stretta`);
  console.log(JSON.stringify({ coperto_a_finestra_stretta_px: covered }));
  console.log(JSON.stringify({ riquadri: tiles, scroll: `${top}/${max}`, barra_dal_fondo_px: gaps, evidenze_scrollLeft: left }));
} finally {
  await ctx.close(); await b.close();
}
console.log(ok ? `ok — video in ${out}` : "FALLITO");
process.exit(ok ? 0 : 1);
