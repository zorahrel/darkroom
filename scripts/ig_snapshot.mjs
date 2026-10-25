#!/usr/bin/env node
// Copia locale di un profilo Instagram PUBBLICO, letto come lo legge chiunque
// senza account: intestazione, bio, link, evidenze e i post che Instagram mostra
// a un visitatore (i 12 piu' recenti).
//
//   node scripts/ig_snapshot.mjs <utente> <cartella>
//
// Scrive <cartella>/profile.json e le immagini accanto, poi stampa il JSON.
//
// Perche' Node e WebKit: Playwright gira sotto Node, e WebKit e' il browser piu'
// leggero fra quelli installati. Il contesto e' DESKTOP apposta: con l'aspetto
// di un iPhone Instagram risponde con il solo invito «Apri app» e la pagina
// resta vuota (misurato il 26/10). L'endpoint JSON (`web_profile_info`) da questo
// Mac risponde 401 «require_login»: e' la pagina, non l'API, che si legge.
import { webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , username, outDir] = process.argv;
if (!username || !outDir) {
  console.error("uso: node scripts/ig_snapshot.mjs <utente> <cartella>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await webkit.launch();
try {
  const ctx = await browser.newContext({ locale: "it-IT", viewport: { width: 1100, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // La griglia arriva dopo l'HTML: senza aspettarla i post sono zero.
  await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 30000 });

  const raw = await page.evaluate(() => {
    const header = document.querySelector("header");
    const lines = (header?.innerText ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    const hl = Array.from(document.querySelectorAll('a[href*="/stories/highlights/"]')).map((a) => ({
      title: (a.innerText || "").trim(),
      src: a.querySelector("img")?.currentSrc || a.querySelector("img")?.src || "",
    }));
    const posts = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')).map((a) => {
      const img = a.querySelector("img");
      const labels = Array.from(a.querySelectorAll("svg[aria-label]")).map((s) => s.getAttribute("aria-label") || "");
      const href = a.getAttribute("href") || "";
      const kind = href.includes("/reel/") || labels.some((l) => /clip|reel/i.test(l))
        ? "reel"
        : labels.some((l) => /carosel|carousel/i.test(l))
          ? "carousel"
          : "photo";
      return { href, kind, alt: img?.alt || "", src: img?.currentSrc || img?.src || "" };
    });
    const link = header?.querySelector('a[href^="https://l.instagram.com"]');
    let linkUrl = null;
    if (link) {
      try { linkUrl = new URL(link.getAttribute("href") || "").searchParams.get("u"); } catch { /* resta null */ }
    }
    return {
      lines,
      hl,
      posts,
      link: link ? { text: (link.textContent || "").trim(), url: linkUrl } : null,
      avatar: header?.querySelector("img")?.currentSrc || header?.querySelector("img")?.src || "",
      og: document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "",
    };
  });

  // Le righe dell'intestazione, in ordine: utente, follower, seguiti, nome, bio…,
  // link, titoli delle evidenze. Si ancorano a "seguiti" e al link, non alle
  // posizioni: un profilo senza nome o senza link sposta tutto di una riga.
  const L = raw.lines;
  const iFollowers = L.findIndex((l) => /follower/i.test(l));
  const iFollowing = L.findIndex((l) => /seguiti|following/i.test(l));
  const num = (l) => (l ?? "").replace(/\s*(follower|seguiti|following).*/i, "").trim();
  const hlTitles = new Set(raw.hl.map((h) => h.title));
  const after = L.slice(iFollowing + 1).filter((l) => !hlTitles.has(l));
  const iLink = raw.link ? after.indexOf(raw.link.text) : -1;
  const fullName = after[0] ?? "";
  const bio = (iLink >= 0 ? after.slice(1, iLink) : after.slice(1)).filter(Boolean);
  // Il numero dei post non e' nell'intestazione di un visitatore: e' solo
  // nell'anteprima del link ("16K follower, 964 seguiti, 271 post"), che
  // arrotonda follower e seguiti ma dice il numero dei post per intero.
  const posts = (raw.og.match(/([\d.,]+)\s+post/i) || [])[1] ?? null;

  const save = async (url, name) => {
    if (!url) return null;
    const res = await ctx.request.get(url);
    if (!res.ok()) return null;
    writeFileSync(join(outDir, name), await res.body());
    return name;
  };

  const profile = {
    username,
    fetched_at: Date.now(),
    full_name: fullName,
    counts: {
      posts,
      followers: iFollowers >= 0 ? num(L[iFollowers]) : null,
      following: iFollowing >= 0 ? num(L[iFollowing]) : null,
    },
    bio,
    link: raw.link,
    avatar: await save(raw.avatar, "avatar.jpg"),
    highlights: [],
    posts: [],
  };
  for (let i = 0; i < raw.hl.length; i++) {
    profile.highlights.push({ title: raw.hl[i].title, image: await save(raw.hl[i].src, `hl${i}.jpg`) });
  }
  for (let i = 0; i < raw.posts.length; i++) {
    const p = raw.posts[i];
    profile.posts.push({
      href: p.href,
      kind: p.kind,
      alt: p.alt,
      image: await save(p.src, `post${String(i).padStart(2, "0")}.jpg`),
    });
  }
  writeFileSync(join(outDir, "profile.json"), JSON.stringify(profile, null, 2));
  console.log(JSON.stringify(profile));
} finally {
  await browser.close();
}
