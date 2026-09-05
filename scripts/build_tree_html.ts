/**
 * Prototype of the tree view (LIN-02), built from the project's real data.
 *
 * It is for deciding whether the shape works BEFORE writing it inside the app:
 * a pick view is judged by using it, not by reading its specification.
 *
 * Usage: bun run scripts/build_tree_html.ts <manifest.json> <out.html>
 */
const [, , manifestPath, outPath] = process.argv;
if (!manifestPath || !outPath) {
  console.error("uso: build_albero_html.ts <manifest.json> <out.html>");
  process.exit(1);
}
const m = JSON.parse(await Bun.file(manifestPath).text());

const RECIPES: Record<string, string> = {
  "bw-hard": "B/N luce dura",
  "bw-soft": "B/N luce morbida",
  "color-editorial": "Colore editoriale",
  "square-profile": "Quadrata 1:1",
  "bw-grain": "B/N grana 35mm",
};
const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type V = { id: number; n: number; recipe: string; refset?: string; thumb: string; path: string };

const trees = m.photos
  .map((p: any, pi: number) => {
    // Grouped by configuration: that is the unit of decision, not the individual
    // variant. Two variants of the same recipe with different references are
    // two experiments, and must be read as such.
    const groups = new Map<string, V[]>();
    for (const v of p.variants as V[]) {
      const k = `${v.refset ?? "origine non registrata"}|${v.recipe}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(v);
    }
    const gs = [...groups.entries()]
      .map(([k, vs]) => {
        const [refset, recipe] = k.split("|");
        return `
      <div class="grp">
        <div class="grp-head">
          <span class="grp-recipe">${esc(RECIPES[recipe] ?? recipe)}</span>
          <span class="grp-refs" title="set di riferimenti">${esc(refset)}</span>
          <span class="grp-n">${vs.length}</span>
        </div>
        <div class="branch">
          ${vs
            .map(
              (v) => `
          <figure class="leaf" data-k="${esc(p.photo)}/v${String(v.n).padStart(2, "0")}" data-path="${esc(v.path)}">
            <div class="lw"><img src="${v.thumb}" alt="${esc(RECIPES[v.recipe] ?? v.recipe)}" loading="lazy">
              <svg class="gl" viewBox="0 0 120 120" aria-hidden="true"><ellipse class="ring" cx="60" cy="60" rx="50" ry="44" transform="rotate(-7 60 60)"/><path class="cross" d="M18 20 L102 100 M102 22 L20 98"/></svg>
            </div>
            <figcaption>
              <span class="vn">v${String(v.n).padStart(2, "0")}</span>
              <button class="nb" type="button" title="nota">&#9998;</button>
              <button class="vote" type="button" title="tieni / forse / scarta">&#9675;</button>
            </figcaption>
            <div class="nbox" hidden><textarea rows="2" placeholder="perch&eacute;&hellip;"></textarea></div>
          </figure>`,
            )
            .join("")}
        </div>
      </div>`;
      })
      .join("");
    return `
  <section class="tree">
    <div class="root">
      <span class="rlab">sorgente ${String(pi + 1).padStart(2, "0")}</span>
      <img src="${p.source ?? ""}" alt="Scatto di partenza">
      <span class="rname">${esc(p.photo)}</span>
      <span class="rmeta">${p.variants.length} varianti &middot; ${new Set(p.variants.map((v: V) => v.recipe)).size} ricette</span>
    </div>
    <div class="groups">${gs}</div>
  </section>`;
  })
  .join("");

const total = m.photos.reduce((n: number, p: any) => n + p.variants.length, 0);

const html = `<title>Albero delle varianti</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400;6..96,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{--ground:#f1eee9;--sheet:#fffdfa;--edge:#dad3c9;--edge2:#b8afa2;--ink:#1a1715;--mut:#7b7166;
  --grease:#c93520;--soft:rgba(201,53,32,.12);--mat:#2a2724;--sh:0 1px 2px rgba(26,23,21,.06),0 8px 22px rgba(26,23,21,.05)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#141210;--sheet:#1e1b18;--edge:#332e29;--edge2:#4a4238;
  --ink:#ece7e0;--mut:#8f857a;--grease:#e05437;--soft:rgba(224,84,55,.16);--mat:#0d0b0a;--sh:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.32)}}
:root[data-theme="dark"]{--ground:#141210;--sheet:#1e1b18;--edge:#332e29;--edge2:#4a4238;--ink:#ece7e0;--mut:#8f857a;
  --grease:#e05437;--soft:rgba(224,84,55,.16);--mat:#0d0b0a;--sh:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.32)}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.5;padding:0 0 92px}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px}
header.top{padding:52px 0 24px;border-bottom:1px solid var(--edge)}
h1{font-family:"Bodoni Moda",Didot,Georgia,serif;font-weight:600;font-size:clamp(2.1rem,5vw,3.3rem);margin:0 0 10px;line-height:1;text-wrap:balance}
.dek{max-width:66ch;color:var(--mut);margin:0}
.dek em{font-style:normal;color:var(--ink);font-weight:500}
.meta{display:flex;gap:8px 20px;flex-wrap:wrap;margin-top:18px;font-family:"IBM Plex Mono",monospace;font-size:.72rem;
  letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-variant-numeric:tabular-nums}
.meta b{color:var(--ink);font-weight:500}
.tree{display:grid;grid-template-columns:190px 1fr;gap:26px;padding:30px 0;border-bottom:1px solid var(--edge);align-items:start}
.root{position:sticky;top:16px;display:flex;flex-direction:column;gap:7px}
.root img{width:100%;aspect-ratio:4/5;object-fit:cover;background:var(--mat);border:1px solid var(--edge2);box-shadow:var(--sh)}
.rlab{font-family:"IBM Plex Mono",monospace;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--grease)}
.rname{font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
.rmeta{font-family:"IBM Plex Mono",monospace;font-size:.68rem;color:var(--mut)}
.groups{display:flex;flex-direction:column;gap:16px;min-width:0}
.grp{position:relative;padding-left:24px}
.grp::before{content:"";position:absolute;left:0;top:14px;width:16px;height:1px;background:var(--edge2)}
.grp::after{content:"";position:absolute;left:0;top:0;bottom:0;width:1px;background:var(--edge)}
.grp:last-child::after{height:14px}
.grp-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:9px}
.grp-recipe{font-weight:600;font-size:.92rem}
.grp-refs{font-family:"IBM Plex Mono",monospace;font-size:.66rem;letter-spacing:.05em;text-transform:uppercase;
  color:var(--grease);border:1px solid var(--edge2);padding:1px 6px}
.grp-n{margin-left:auto;font-family:"IBM Plex Mono",monospace;font-size:.7rem;color:var(--mut)}
.branch{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(168px,1fr))}
.leaf{margin:0;background:var(--sheet);border:1px solid var(--edge);box-shadow:var(--sh)}
.lw{position:relative;background:var(--mat);aspect-ratio:4/5;overflow:hidden}
.lw img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in}
.gl{position:absolute;left:9%;top:9%;width:82%;height:82%;pointer-events:none;fill:none;stroke:var(--grease);stroke-width:4;stroke-linecap:round}
.gl .ring,.gl .cross{opacity:0}
.leaf[data-v="si"] .ring,.leaf[data-v="forse"] .ring,.leaf[data-v="no"] .cross{opacity:1}
.leaf[data-v="forse"] .ring{stroke-dasharray:14 12;opacity:.85}
.leaf[data-v="si"]{outline:2px solid var(--grease);outline-offset:-1px;background:var(--soft)}
.leaf[data-v="no"]{opacity:.45}
figcaption{display:flex;align-items:center;gap:7px;padding:6px 8px;border-top:1px solid var(--edge);
  font-family:"IBM Plex Mono",monospace;font-size:.68rem}
.vn{color:var(--mut)}
.nb{margin-left:auto}
.vote,.nb{font:inherit;font-size:.9rem;border:0;background:transparent;color:var(--mut);cursor:pointer;padding:1px 3px}
.vote:hover,.nb:hover{color:var(--grease)}
.vote:focus-visible,.nb:focus-visible{outline:2px solid var(--grease);outline-offset:1px}
.leaf.hasnote .nb{color:var(--grease)}
.leaf[data-v="si"] .vote,.leaf[data-v="no"] .vote,.leaf[data-v="forse"] .vote{color:var(--grease)}
.nbox{padding:0 8px 8px}
.nbox textarea{width:100%;font:inherit;font-size:.74rem;background:transparent;color:var(--ink);border:1px solid var(--edge);padding:5px;resize:vertical}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--sheet);border-top:1px solid var(--edge2);padding:11px 24px;
  display:flex;gap:14px;align-items:center;flex-wrap:wrap;z-index:9}
.bar .n{font-family:"IBM Plex Mono",monospace;font-size:.78rem;color:var(--mut);font-variant-numeric:tabular-nums}
.bar .n b{color:var(--grease);font-size:1rem}
button.act{font:inherit;font-size:.84rem;padding:7px 14px;border:1px solid var(--edge2);background:transparent;color:var(--ink);cursor:pointer}
button.act:hover{border-color:var(--grease);color:var(--grease)}
.picks{flex:1 1 240px;min-width:0;font-family:"IBM Plex Mono",monospace;font-size:.7rem;color:var(--mut);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
dialog.lb{border:0;padding:0;background:transparent;max-width:96vw;max-height:96vh}
dialog.lb::backdrop{background:rgba(8,7,6,.9)}
dialog.lb img{max-width:96vw;max-height:90vh;display:block}
dialog.lb .cap{font-family:"IBM Plex Mono",monospace;font-size:.72rem;color:#cfc7bd;padding:8px 2px}
footer.n{padding:30px 0;color:var(--mut);font-size:.88rem;max-width:66ch}
</style>
<div class="wrap">
<header class="top">
  <h1>Albero delle varianti</h1>
  <p class="dek">Ogni scatto a sinistra, e da l&igrave; i rami: un gruppo per configurazione, non un mucchio di versioni.
  La griglia risponde a <em>quali foto ho</em>; questa risponde a <em>quale tengo, e da cosa &egrave; nata</em>.</p>
  <div class="meta"><span>sorgenti <b>${m.photos.length}</b></span><span>varianti <b>${total}</b></span><span>prototipo di <b>LIN-02</b></span></div>
</header>
${trees}
<footer class="n">Prototipo costruito sui dati reali del progetto Profilo. Qui voti e note vivono nel browser;
dentro darkroom staranno nel database, come dice LIN-02.</footer>
</div>
<div class="bar">
  <span class="n"><b id="cnt">0</b> / ${total} tenute</span>
  <button class="act" id="copy">Copia scelte</button>
  <button class="act" id="clear">Azzera</button>
  <span class="picks" id="list">nessun giudizio</span>
</div>
<dialog class="lb" id="lb"><img alt=""><div class="cap"></div></dialog>
<script>
var KEY="albero-profilo";
var data={}; try{data=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
var CY=["","si","forse","no"], GL={"":"\\u25CB",si:"\\u25CF",forse:"?",no:"\\u2715"};
var cnt=document.getElementById("cnt"), list=document.getElementById("list");
function save(){try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}}
function lines(){return Object.keys(data).filter(function(k){return data[k]&&(data[k].v||data[k].n)})
  .map(function(k){var x=data[k];return k+"  "+(x.v||"-").toUpperCase()+(x.n?"  \\u2014 "+x.n:"")});}
function render(){
  var si=0,fo=0,no=0,nt=0;
  Object.keys(data).forEach(function(k){var x=data[k]||{};if(x.v==="si")si++;if(x.v==="forse")fo++;if(x.v==="no")no++;if(x.n)nt++;});
  cnt.textContent=si;
  list.textContent=(si+fo+no+nt)===0?"nessun giudizio":si+" tenute \\u00b7 "+fo+" forse \\u00b7 "+no+" scartate \\u00b7 "+nt+" note";
  [].forEach.call(document.querySelectorAll(".leaf"),function(f){
    var d=data[f.dataset.k]||{}; f.dataset.v=d.v||""; f.classList.toggle("hasnote",!!d.n);
    f.querySelector(".vote").textContent=GL[d.v||""];
    var ta=f.querySelector("textarea"); if(ta&&ta.value!==(d.n||"")) ta.value=d.n||"";
  });
}
[].forEach.call(document.querySelectorAll(".leaf"),function(f){
  var k=f.dataset.k;
  f.querySelector(".vote").addEventListener("click",function(){
    var cur=(data[k]&&data[k].v)||""; var nx=CY[(CY.indexOf(cur)+1)%CY.length];
    data[k]=Object.assign({},data[k]||{},{v:nx}); save(); render();
  });
  var box=f.querySelector(".nbox"), btn=f.querySelector(".nb");
  btn.addEventListener("click",function(){
    var open=box.hasAttribute("hidden");
    if(open){box.removeAttribute("hidden");box.querySelector("textarea").focus();}else box.setAttribute("hidden","");
  });
  box.querySelector("textarea").addEventListener("input",function(e){
    data[k]=Object.assign({},data[k]||{},{n:e.target.value.trim()}); save();
    f.classList.toggle("hasnote",!!e.target.value.trim());
  });
});
var lb=document.getElementById("lb"), li=lb.querySelector("img"), lc=lb.querySelector(".cap");
[].forEach.call(document.querySelectorAll(".leaf img"),function(img){
  img.addEventListener("click",function(){li.src=img.src;li.alt=img.alt;lc.textContent=img.closest(".leaf").dataset.path;lb.showModal();});
});
lb.addEventListener("click",function(){lb.close()});
document.getElementById("copy").addEventListener("click",function(){
  var t=lines().join("\\n")||"(nessuna)"; var b=document.getElementById("copy");
  navigator.clipboard.writeText(t).then(function(){b.textContent="Copiato";setTimeout(function(){b.textContent="Copia scelte"},1300);},
    function(){list.textContent=t.replace(/\\n/g,"  |  ")});
});
document.getElementById("clear").addEventListener("click",function(){data={};save();render()});
render();
</script>`;

// The entities only outside the script: inside they would break the code.
const parts = html.split(/(<script>[\s\S]*?<\/script>)/);
await Bun.write(
  outPath,
  parts
    .map((c) => (c.startsWith("<script>") ? c : c.replace(/[\u0080-\uFFFF]/g, (ch) => `&#${ch.charCodeAt(0)};`)))
    .join(""),
);
console.log(`[albero] ${m.photos.length} sorgenti, ${total} varianti -> ${outPath}`);

// The file uses top-level await: without an export, tsc does not treat it as
// a module and reports two errors bun does not have.
export {};
