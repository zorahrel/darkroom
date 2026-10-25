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
  await p.goto(`http://localhost:3535/p/${pid}/instagram`, { waitUntil: "networkidle" });
  const s = p.locator('[data-testid="ig-screen"]');
  await s.waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  const tiles = await p.locator('[data-testid="ig-grid"] > div').count();
  if (tiles === 0) fail("griglia vuota");
  const box = await s.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 160); await p.waitForTimeout(120); }
  const { top, max } = await s.evaluate((e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight }));
  if (max <= 0 || Math.abs(top - max) > 2) fail(`scroll fermo a ${top} su ${max}`);
  const gap = await s.evaluate((e) => Math.round(e.getBoundingClientRect().bottom - e.lastElementChild.getBoundingClientRect().bottom));
  if (Math.abs(gap) > 1) fail(`barra in basso staccata di ${gap}px`);
  await s.evaluate((e) => (e.scrollTop = 0));
  const hl = p.locator('[data-testid="ig-screen"] .overflow-x-auto');
  const hb = await hl.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await p.mouse.wheel(220, 0); await p.waitForTimeout(400);
  const left = await hl.evaluate((e) => e.scrollLeft);
  const canScroll = await hl.evaluate((e) => e.scrollWidth > e.clientWidth);
  if (canScroll && left <= 0) fail("le evidenze non scorrono di lato");
  console.log(JSON.stringify({ riquadri: tiles, scroll: `${top}/${max}`, barra_dal_fondo_px: gap, evidenze_scrollLeft: left }));
} finally {
  await ctx.close(); await b.close();
}
console.log(ok ? `ok — video in ${out}` : "FALLITO");
process.exit(ok ? 0 : 1);
