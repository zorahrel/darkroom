/**
 * Il righello: misura le viste a diverse larghezze e dice cosa si rompe.
 *
 * Non guarda: misura. Un modello che stima i pixel a occhio sbaglia proprio dove
 * conta — tre pixel di disallineamento, un bersaglio da 30 px invece di 44 — quindi
 * qui si interroga il DOM e si contano i difetti.
 *
 * Esce non-zero quando trova qualcosa: è un cancello, non un rapporto.
 *
 *   bun run ui:audit                    tutte le viste, tutte le larghezze
 *   bun run ui:audit -- --larghezza 390 una sola
 */

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RADICE = new URL("..", import.meta.url).pathname;
const BASE = process.env.DARKROOM_URL ?? "http://127.0.0.1:3535";

/** Le larghezze che contano davvero, e perché. */
const LARGHEZZE = [
  { px: 390, nome: "telefono" }, // iPhone in verticale
  { px: 768, nome: "tavoletta" },
  { px: 1280, nome: "portatile" },
  { px: 1920, nome: "scrivania" },
];

const VISTE = [
  { percorso: "/", nome: "strumenti" },
  { percorso: "/p/darkroom", nome: "galleria" },
  { percorso: "/p/darkroom/culling", nome: "culling" },
  { percorso: "/p/darkroom/girato", nome: "girato" },
  { percorso: "/p/darkroom/tree", nome: "albero" },
];

/**
 * Quando un bersaglio è troppo piccolo.
 *
 * Due soglie e non una, perché "44×44" preso alla lettera non è la regola giusta per
 * uno strumento professionale: applicato a ogni comando distruggerebbe la densità
 * delle barre di lavoro, dove la vicinanza fra i controlli È la funzionalità.
 *
 * - **24 px** su entrambi i lati è WCAG 2.2 «Target Size (Minimum)», livello AA: è
 *   uno standard, non un'opinione, ed è il minimo assoluto.
 * - **44 px** su almeno un lato è la misura del polpastrello: un bottone lungo e
 *   basso si prende bene, uno quadrato da 28 no. Fallisce solo chi è corto in
 *   *entrambe* le direzioni.
 */
const LATO_MINIMO_ASSOLUTO = 24;
const LATO_COMODO = 44;

type Difetto = { vista: string; larghezza: number; tipo: string; dettaglio: string };

/**
 * Misura una pagina. Gira dentro il browser, quindi non può chiudere su niente.
 *
 * I punti ciechi già pagati altrove sono chiusi qui: i nodi dentro un `details`
 * chiuso non si misurano (Chrome restituisce il riquadro del contenitore per tutti,
 * e seicento finte sovrapposizioni seppelliscono quelle vere), e un comando coperto
 * da un modale non è un comando.
 */
const MISURA = `(() => {
  const MINIMO = ${LATO_MINIMO_ASSOLUTO};
  const COMODO = ${LATO_COMODO};
  const vp = document.documentElement.clientWidth;
  const fuori = { overflowX: null, bersagli: [], testoTroncato: [], sovrapposte: [], contrasto: [] };

  const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (docW > vp + 1) {
    const colpevoli = [];
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > vp + 1) {
        colpevoli.push({ el: nome(el), oltre: Math.round(b.right - vp), largo: Math.round(b.width) });
      }
    }
    colpevoli.sort((a, b) => b.oltre - a.oltre);
    fuori.overflowX = { docW, vp, colpevoli: colpevoli.slice(0, 6) };
  }

  function nome(el) {
    if (el.id) return '#' + el.id;
    const c = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + c;
  }
  function visibile(el) {
    if (el.closest('details:not([open])')) return false;
    if (el.closest('[hidden]')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  }

  for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"]')) {
    if (!visibile(el)) continue;
    const b = el.getBoundingClientRect();
    // Un comando coperto da un modale non e' un comando: non si misura.
    const sopra = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    if (sopra && !el.contains(sopra) && !sopra.contains(el)) continue;
    const w = Math.round(b.width), h = Math.round(b.height);
    const sottoIlMinimo = w < MINIMO || h < MINIMO;
    const scomodo = w < COMODO && h < COMODO;
    if (sottoIlMinimo || scomodo) {
      fuori.bersagli.push({ el: nome(el), w, h, perche: sottoIlMinimo ? 'sotto il minimo' : 'corto in entrambe le direzioni' });
    }
  }

  // Contrasto del testo dei comandi.
  //
  // Un tasto che non si legge e' un tasto che non c'e'. La soglia e' quella di
  // WCAG per il testo normale (4,5:1) e quella del testo grande (3:1) sopra i 18px
  // o i 14 in grassetto. I comandi spenti sono esclusi dalla norma, ma non da qui:
  // devono restare leggibili, altrimenti non si capisce che ci sono.
  function canale(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  /** null quando il colore non e' in una forma che sappiamo leggere: meglio non
   *  misurare che misurare un numero inventato. */
  function luminanza(rgb) {
    const m = (rgb || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const v = m.map(Number);
    return 0.2126 * canale(v[0]) + 0.7152 * canale(v[1]) + 0.0722 * canale(v[2]);
  }
  function opaco(rgb) {
    const m = (rgb || '').match(/[\d.]+/g);
    return !!m && m.length >= 3 && (m.length < 4 || Number(m[3]) === 1);
  }
  /** Il primo fondo davvero dipinto sopra cui sta questo elemento. */
  function fondo(el) {
    for (let e = el; e; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== 'transparent' && opaco(b)) return b;
    }
    return 'rgb(10, 10, 10)';
  }
  for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
    if (!visibile(el) || el.textContent.trim().length === 0) continue;
    const s = getComputedStyle(el);
    // Il colore va letto dove sta il testo: su un tasto con il pieno chiaro il
    // fondo e' il tasto stesso, non la pagina sotto.
    const f = opaco(s.backgroundColor) ? s.backgroundColor : fondo(el.parentElement || el);
    const la = luminanza(s.color), lb = luminanza(f);
    if (la === null || lb === null) continue;
    const r = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    const px = parseFloat(s.fontSize);
    const grande = px >= 18 || (px >= 14 && Number(s.fontWeight) >= 600);
    const soglia = grande ? 3 : 4.5;
    if (r < soglia) {
      fuori.contrasto.push({ el: nome(el), testo: el.textContent.trim().slice(0, 24), rapporto: Math.round(r * 100) / 100, soglia });
    }
  }

  // Testo tagliato: il contenuto e' piu' largo del contenitore e non c'e' ellissi.
  for (const el of document.querySelectorAll('h1,h2,h3,p,span,label,button,a')) {
    if (!visibile(el) || el.children.length) continue;
    const s = getComputedStyle(el);
    if (s.overflow === 'visible' || s.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      fuori.testoTroncato.push({ el: nome(el), dentro: el.clientWidth, serve: el.scrollWidth });
    }
  }

  return fuori;
})()`;

async function misura(page: Page, vista: string, larghezza: number): Promise<Difetto[]> {
  const r = (await page.evaluate(MISURA)) as {
    overflowX: { docW: number; vp: number; colpevoli: { el: string; oltre: number }[] } | null;
    bersagli: { el: string; w: number; h: number; perche: string }[];
    testoTroncato: { el: string; dentro: number; serve: number }[];
    contrasto: { el: string; testo: string; rapporto: number; soglia: number }[];
  };
  const d: Difetto[] = [];

  if (r.overflowX) {
    d.push({
      vista,
      larghezza,
      tipo: "scorre-in-orizzontale",
      dettaglio:
        `la pagina è larga ${r.overflowX.docW} px in un viewport da ${r.overflowX.vp}` +
        (r.overflowX.colpevoli.length
          ? ` — ${r.overflowX.colpevoli.map((c) => `${c.el} (+${c.oltre})`).join(", ")}`
          : ""),
    });
  }
  // Solo sul telefono: col mouse un bersaglio da 30 px si prende benissimo.
  if (larghezza <= 480) {
    for (const b of r.bersagli.slice(0, 8)) {
      d.push({
        vista,
        larghezza,
        tipo: "bersaglio-piccolo",
        dettaglio: `${b.el} è ${b.w}×${b.h}: ${b.perche}`,
      });
    }
  }
  // Il contrasto non dipende dalla larghezza: si guarda una volta sola, e la piu'
  // stretta e' quella dove i tasti si affollano di piu'.
  for (const c of r.contrasto.slice(0, 8)) {
    d.push({
      vista,
      larghezza,
      tipo: "contrasto-basso",
      dettaglio: `${c.el} «${c.testo}» sta a ${c.rapporto}:1, ne servono ${c.soglia}`,
    });
  }
  for (const t of r.testoTroncato.slice(0, 6)) {
    d.push({
      vista,
      larghezza,
      tipo: "testo-tagliato",
      dettaglio: `${t.el} ha ${t.serve} px di testo in ${t.dentro} px, senza ellissi`,
    });
  }
  return d;
}

const soloLarghezza = Number(
  process.argv[process.argv.indexOf("--larghezza") + 1] || 0,
);
const larghezze = soloLarghezza
  ? LARGHEZZE.filter((l) => l.px === soloLarghezza)
  : LARGHEZZE;

const browser = await chromium.launch({ channel: "chrome" });
const difetti: Difetto[] = [];

for (const l of larghezze) {
  const page = await browser.newPage({ viewport: { width: l.px, height: 900 } });
  for (const v of VISTE) {
    try {
      // `domcontentloaded` e non `networkidle`: una griglia con duecento immagini
      // pigre non smette mai di caricare, e aspettare la quiete della rete faceva
      // scadere proprio le viste piene — cioè quelle in cui il layout si rompe.
      await page.goto(BASE + v.percorso, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(2500);
      difetti.push(...(await misura(page, v.nome, l.px)));
    } catch (e) {
      difetti.push({
        vista: v.nome,
        larghezza: l.px,
        tipo: "non-si-apre",
        dettaglio: e instanceof Error ? e.message.split("\n")[0]! : String(e),
      });
    }
  }
  await page.close();
}
await browser.close();

if (difetti.length === 0) {
  console.log(`Nessun difetto su ${VISTE.length} viste × ${larghezze.length} larghezze.`);
  process.exit(0);
}

const perTipo = new Map<string, Difetto[]>();
for (const d of difetti) {
  if (!perTipo.has(d.tipo)) perTipo.set(d.tipo, []);
  perTipo.get(d.tipo)!.push(d);
}
for (const [tipo, elenco] of perTipo) {
  console.log(`\n${tipo.toUpperCase()} — ${elenco.length}`);
  for (const d of elenco) {
    console.log(`  ${d.vista} @ ${d.larghezza}px: ${d.dettaglio}`);
  }
}
console.log(`\n${difetti.length} difetti in totale.`);
process.exit(1);
