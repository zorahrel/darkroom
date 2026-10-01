/**
 * Mostra un confronto DENTRO Darkroom: affianca le immagini in un'unica tavola, la salva in
 * `<progetto>/data/confronti/`, la indicizza come foto del progetto e la mette nel post
 * «Confronti (Jarvis)». Stampa l'indirizzo da aprire.
 *
 * Perche': i confronti finivano in Anteprima o in cartelle fuori dal progetto, dove chi
 * lavora in Darkroom non li vede. Una tavola e' una foto come le altre: ha la sua pagina,
 * si ingrandisce, si cancella dal post.
 *
 * Uso: bun run scripts/mostra.ts --progetto profilo --titolo "v318 e v325" a.png b.png c.png
 *      (ogni immagine puo' avere un'etichetta: percorso=etichetta)
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (n: string, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const progetto = opt("progetto", "profilo");
const titolo = opt("titolo", "confronto");
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!files.length) throw new Error("serve almeno un'immagine");

const api = process.env.DARKROOM_API ?? "http://localhost:3535";
const chiama = async (metodo: string, path: string, corpo?: unknown) => {
  const r = await fetch(api + path, {
    method: metodo,
    headers: { "content-type": "application/json", "x-darkroom-project": progetto },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${metodo} ${path} -> ${r.status} ${await r.text()}`);
  return r.json() as Promise<any>;
};

const radice = process.env.DARKROOM_PROJECTS_DIR ?? join(homedir(), "Darkroom", "projects");
const dir = join(radice, progetto, "data", "confronti");
mkdirSync(dir, { recursive: true });
const slug = titolo.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "confronto";
const uscita = join(dir, `${slug}.png`);

// 1) la tavola: stessa altezza, etichetta sopra
const py = `
import sys
from PIL import Image, ImageDraw, ImageFont
f = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 30, index=1)
H = 1100
voci = [a.split("=", 1) if "=" in a else [a, a.rsplit("/", 1)[-1]] for a in sys.argv[2:]]
ims = []
for p, l in voci:
    im = Image.open(p).convert("RGB"); s = H / im.height
    ims.append((im.resize((int(im.width * s), H), Image.LANCZOS), l))
# Fino a 4 immagini in una riga; oltre, due righe o piu': una striscia di 8 ritratti era larga 6000 px e nel riquadro della pagina restava illeggibile.
cols = len(ims) if len(ims) <= 4 else -(-len(ims) // 2) if len(ims) <= 8 else 4
righe = [ims[i:i + cols] for i in range(0, len(ims), cols)]
W = max(sum(i.width for i, _ in r) + 20 * (len(r) + 1) for r in righe)
out = Image.new("RGB", (W, (H + 90) * len(righe)), (20, 20, 20)); d = ImageDraw.Draw(out)
for k, r in enumerate(righe):
    x = 20
    for im, l in r:
        out.paste(im, (x, k * (H + 90) + 70)); d.text((x, k * (H + 90) + 18), l, font=f, fill=(240, 240, 240)); x += im.width + 20
out.save(sys.argv[1])
`;
const r = spawnSync("python3", ["-c", py, uscita, ...files], { encoding: "utf8" });
if (r.status !== 0) throw new Error(r.stderr);

// 2) la cartella come sorgente del progetto, poi rilettura: la tavola diventa una foto
const { sources } = await chiama("GET", "/api/sources");
if (!sources.some((s: any) => s.path === dir)) await chiama("POST", "/api/sources", { path: dir, mode: "link" });
await chiama("POST", "/api/sources/rescan");

// 3) il post «Confronti (Jarvis)»
const { photos } = await chiama("GET", "/api/photos");
const foto = photos.find((p: any) => p.original_path === uscita);
if (!foto) throw new Error(`la tavola non risulta indicizzata: ${uscita}`);
const lista = await chiama("GET", "/api/collections");
if (!lista.collections.some((c: any) => c.id === "confronti"))
  await chiama("POST", "/api/collections", { id: "confronti", title: "Confronti (Jarvis)", caption: "Tavole di confronto generate da Jarvis." });
const membri: string[] = (lista.photos?.confronti ?? []).map((p: any) => (typeof p === "string" ? p : p.id));
await chiama("PUT", "/api/collections/confronti/photos", { photo_ids: [...new Set([foto.id, ...membri])] });

console.log(`${api}/p/${progetto}/photo/${encodeURIComponent(foto.id)}`);
