/**
 * Dal manifest di contact_sheet.ts alla pagina di valutazione ("provino").
 *
 * Separato dal manifest perché le miniature costano (una passata di magick per
 * file) mentre il layout si ritocca dieci volte: rigenerare le immagini a ogni
 * modifica del CSS sarebbe minuti buttati.
 *
 * Uso: bun run scripts/build_sheet_html.ts <manifest.json> <out.html>
 */
const [, , manifestPath, outPath] = process.argv;
if (!manifestPath || !outPath) { console.error("uso: build_sheet_html.ts <manifest.json> <out.html>"); process.exit(1); }
const m = JSON.parse(await Bun.file(manifestPath).text());

const RECIPES: Record<string, { label: string; note: string }> = {
  "bw-hard": { label: "B/N luce dura", note: "chiave direzionale netta, fondo bianco, taglio stretto" },
  "bw-soft": { label: "B/N luce morbida", note: "sorgente ampia da sinistra, sfumatura sul fondo" },
  "color-editorial": { label: "Colore editoriale", note: "stessa luce e taglio, palette desaturata" },
};
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const counts: Record<string, number> = {};
for (const p of m.photos) for (const v of p.variants) counts[v.recipe] = (counts[v.recipe] ?? 0) + 1;
const total = m.photos.reduce((n: number, p: any) => n + p.variants.length, 0);

const strips = m.photos.map((p: any, i: number) => `
  <section class="strip">
    <div class="strip-head">
      <span class="roll">rullo ${String(i + 1).padStart(2, "0")}</span>
      <span class="strip-id">${esc(p.photo)}</span>
    </div>
    <div class="frames">
      <figure class="frame is-source">
        <div class="img-wrap"><img src="${p.source ?? ""}" alt="Scatto di partenza ${esc(p.photo)}" loading="lazy"></div>
        <figcaption class="rebate"><span class="fnum">00</span><span class="fname">partenza</span></figcaption>
      </figure>
      ${p.variants.map((v: any) => `
      <figure class="frame" data-pick="${esc(p.photo)}/v${String(v.n).padStart(2, "0")}_${esc(v.recipe)}" data-path="${esc(v.path)}" data-vid="${v.id}">
        <div class="img-wrap">
          <img src="${v.thumb}" alt="${esc(RECIPES[v.recipe]?.label ?? v.recipe)} da ${esc(p.photo)}" loading="lazy">
          <button class="mark" aria-pressed="false" aria-label="Tieni questo fotogramma"><svg viewBox="0 0 120 120" aria-hidden="true"><ellipse cx="60" cy="60" rx="50" ry="44" transform="rotate(-7 60 60)"/></svg></button>
        </div>
        <figcaption class="rebate">
          <span class="fnum">${String(v.n).padStart(2, "0")}</span>
          <span class="fname">${esc(RECIPES[v.recipe]?.label ?? v.recipe)}</span>
          <span class="fid">v${v.id}</span>
        </figcaption>
      </figure>`).join("")}
    </div>
  </section>`).join("");

const html = `<title>Provino Profilo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#f0ece6; --sheet:#fffdfa; --edge:#d9d2c8; --edge-strong:#b9b0a3;
  --ink:#1a1715; --ink-muted:#7c7267; --grease:#c93520; --grease-soft:rgba(201,53,32,.14);
  --frame-mat:#2a2724;
  --shadow:0 1px 2px rgba(26,23,21,.07), 0 8px 24px rgba(26,23,21,.06);
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --ground:#141210; --sheet:#1e1b18; --edge:#332e29; --edge-strong:#4a4238;
  --ink:#ece7e0; --ink-muted:#8f857a; --grease:#e05437; --grease-soft:rgba(224,84,55,.18);
  --frame-mat:#0d0b0a;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.35);
}}
:root[data-theme="dark"]{
  --ground:#141210; --sheet:#1e1b18; --edge:#332e29; --edge-strong:#4a4238;
  --ink:#ece7e0; --ink-muted:#8f857a; --grease:#e05437; --grease-soft:rgba(224,84,55,.18);
  --frame-mat:#0d0b0a;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,-apple-system,sans-serif;line-height:1.55;
  -webkit-font-smoothing:antialiased;padding:0 0 96px}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header.top{padding:56px 0 28px;border-bottom:1px solid var(--edge)}
h1{font-family:"Bodoni Moda",Didot,Georgia,serif;font-weight:600;font-size:clamp(2.4rem,6vw,4rem);
  line-height:.98;margin:0 0 10px;letter-spacing:-.01em;text-wrap:balance}
.dek{max-width:62ch;color:var(--ink-muted);margin:0;font-size:1.02rem}
.meta{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:22px;
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.76rem;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink-muted);font-variant-numeric:tabular-nums}
.meta b{color:var(--ink);font-weight:500}
.legend{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
  margin:32px 0 8px;padding:22px 0 30px;border-bottom:1px solid var(--edge)}
.ref{display:flex;gap:16px;align-items:flex-start}
.ref img{width:96px;height:96px;object-fit:cover;background:var(--frame-mat);border:1px solid var(--edge-strong)}
.lab{font-family:"IBM Plex Mono",monospace;font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-muted);display:block;margin-bottom:5px}
.recipe b{display:block;font-weight:600;font-size:.98rem}
.recipe span{color:var(--ink-muted);font-size:.88rem}
.strip{padding:34px 0;border-bottom:1px solid var(--edge)}
.strip-head{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;
  font-family:"IBM Plex Mono",monospace;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase}
.roll{color:var(--grease);font-weight:500}
.strip-id{color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.frames{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.frame{margin:0;background:var(--sheet);border:1px solid var(--edge);box-shadow:var(--shadow)}
.frame.is-source{opacity:.72}
.img-wrap{position:relative;background:var(--frame-mat);aspect-ratio:4/5;overflow:hidden}
.img-wrap img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in}
.mark{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;padding:0;cursor:pointer}
.mark svg{width:82%;height:82%;position:absolute;left:9%;top:9%;fill:none;
  stroke:var(--grease);stroke-width:4;stroke-linecap:round;opacity:0;
  stroke-dasharray:300;stroke-dashoffset:300;transition:opacity .18s}
.mark:hover svg{opacity:.32}
.frame.picked .mark svg{opacity:1;animation:draw .5s ease forwards}
.frame.picked{outline:2px solid var(--grease);outline-offset:-1px;background:var(--grease-soft)}
@keyframes draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.frame.picked .mark svg{animation:none;stroke-dashoffset:0}}
.mark:focus-visible{outline:2px solid var(--grease);outline-offset:2px}
.rebate{display:flex;align-items:center;gap:9px;padding:7px 9px;border-top:1px solid var(--edge);
  font-family:"IBM Plex Mono",monospace;font-size:.7rem;font-variant-numeric:tabular-nums}
.fnum{color:var(--grease);font-weight:500}
.fname{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fid{margin-left:auto;color:var(--ink-muted)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--sheet);border-top:1px solid var(--edge-strong);
  padding:12px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;z-index:20}
.bar .n{font-family:"IBM Plex Mono",monospace;font-size:.8rem;color:var(--ink-muted);font-variant-numeric:tabular-nums}
.bar .n b{color:var(--grease);font-size:1.05rem}
button.act{font:inherit;font-size:.86rem;padding:8px 15px;border:1px solid var(--edge-strong);
  background:transparent;color:var(--ink);cursor:pointer}
button.act:hover{border-color:var(--grease);color:var(--grease)}
button.act:focus-visible{outline:2px solid var(--grease);outline-offset:2px}
.picks{font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:var(--ink-muted);
  flex:1 1 260px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
dialog.lb{border:0;padding:0;background:transparent;max-width:96vw;max-height:96vh}
dialog.lb::backdrop{background:rgba(8,7,6,.88)}
dialog.lb img{max-width:96vw;max-height:90vh;display:block}
dialog.lb .cap{font-family:"IBM Plex Mono",monospace;font-size:.74rem;color:#cfc7bd;padding:8px 2px}
footer.note{padding:34px 0;color:var(--ink-muted);font-size:.9rem;max-width:64ch}
</style>

<div class="wrap">
<header class="top">
  <h1>Provino Profilo</h1>
  <p class="dek">Nove scatti, tre ricette, un solo riferimento allegato a ogni generazione — è quello che tiene insieme le varianti invece di avere nove foto ritoccate ognuna a modo suo. Segna col rosso quelle da tenere, poi copia l'elenco e passamelo.</p>
  <div class="meta">
    <span>fotogrammi <b>${total}</b></span>
    <span>scatti <b>${m.photos.length}</b></span>
    <span>modello <b>gpt-image 2.0</b></span>
    <span>via <b>codex-http</b></span>
    <span>nativo <b>1122×1402</b></span>
  </div>
</header>

<div class="legend">
  <div class="ref">
    <img src="${m.reference ?? ""}" alt="Immagine di riferimento">
    <div><span class="lab">riferimento</span><b>Allegato a ogni fotogramma</b>
    <span style="color:var(--ink-muted);font-size:.88rem">luce dura, taglio stretto, capelli bagnati</span></div>
  </div>
  ${Object.entries(RECIPES).map(([k, r]) => `
  <div class="recipe"><span class="lab">${esc(k)} · ${counts[k] ?? 0}</span><b>${esc(r.label)}</b><span>${esc(r.note)}</span></div>`).join("")}
</div>

${strips}

<footer class="note">
  Le miniature sono ridotte per stare in pagina; i file originali stanno in
  <code>~/Darkroom/projects/profilo/data/generations</code>. L'ingrandimento a 4K si fa dopo la scelta,
  in locale, su ciò che sopravvive a questo provino.
</footer>
</div>

<div class="bar">
  <span class="n"><b id="cnt">0</b> / ${total} tenuti</span>
  <button class="act" id="copy">Copia elenco</button>
  <button class="act" id="clear">Azzera</button>
  <span class="picks" id="list">nessuna scelta</span>
</div>

<dialog class="lb" id="lb"><img alt=""><div class="cap"></div></dialog>

<script>
const KEY="provino-profilo-picks";
let picks=new Set();
try{picks=new Set(JSON.parse(localStorage.getItem(KEY)||"[]"))}catch(e){}
const cnt=document.getElementById("cnt"), list=document.getElementById("list");
function save(){try{localStorage.setItem(KEY,JSON.stringify([...picks]))}catch(e){}}
function render(){
  cnt.textContent=picks.size;
  list.textContent=picks.size?[...picks].join("  ·  "):"nessuna scelta";
  document.querySelectorAll(".frame[data-pick]").forEach(f=>{
    const on=picks.has(f.dataset.pick);
    f.classList.toggle("picked",on);
    f.querySelector(".mark").setAttribute("aria-pressed",String(on));
  });
}
document.querySelectorAll(".frame[data-pick]").forEach(f=>{
  f.querySelector(".mark").addEventListener("click",e=>{
    e.stopPropagation();
    const k=f.dataset.pick;
    picks.has(k)?picks.delete(k):picks.add(k);
    save();render();
  });
});
const lb=document.getElementById("lb"), lbImg=lb.querySelector("img"), lbCap=lb.querySelector(".cap");
document.querySelectorAll(".frame img").forEach(img=>{
  img.addEventListener("click",e=>{
    e.stopPropagation();
    lbImg.src=img.src; lbImg.alt=img.alt;
    const fr=img.closest(".frame");
    lbCap.textContent=fr.dataset.path||img.alt;
    lb.showModal();
  });
});
lb.addEventListener("click",()=>lb.close());
document.getElementById("copy").addEventListener("click",async ()=>{
  const t=[...picks].join("\\n")||"(nessuna)";
  try{await navigator.clipboard.writeText(t);document.getElementById("copy").textContent="Copiato";
      setTimeout(()=>document.getElementById("copy").textContent="Copia elenco",1400);}
  catch(e){list.textContent=t.replace(/\\n/g,"  ·  ")}
});
document.getElementById("clear").addEventListener("click",()=>{picks.clear();save();render()});
render();
</script>`;

await Bun.write(outPath, html);
console.log(`[sheet] ${total} fotogrammi, ${m.photos.length} scatti -> ${outPath} (${Math.round((await Bun.file(outPath).size)/1024)} KB)`);
