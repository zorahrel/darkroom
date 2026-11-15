/**
 * Character sheet un pannello alla volta, per MODIFICA di una foto vera.
 *
 * Generare da zero con le foto come riferimento rende Attilio piu' magro e piu'
 * giovane: il modello ridisegna il viso. Qui l'immagine 1 e' una sua foto vera
 * evidenziata in Darkroom e il prompt chiede di cambiare solo inquadratura, sfondo,
 * luce e vestito, lasciando la geometria del viso com'e'. Ogni pannello e' una foto
 * del progetto (`sheet-<pannello>`), cosi' i tentativi stanno nel suo albero.
 *
 *   bun run scripts/sheet_pannello.ts --pannello frontale [--giri 3] [--stampa]
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { initSchema, db } from "../server/db.ts";
import { enqueueJob } from "../server/jobs.ts";
import { dirsFor, withProject } from "../server/project.ts";

const PROGETTO = "profilo";

const VISO_INTATTO =
  "This is a REAL photo of me. Keep my face EXACTLY as it is in this photo: the same face width and fullness, " +
  "round cheeks, jaw and chin, the same nose shape and width, eyes, eyelids, eyebrows, lips, ears, skin texture, " +
  "moles and small gold hoop earring, same age. Do NOT slim the face, do NOT sharpen the jaw or cheekbones, " +
  "do NOT beautify, de-age or retouch, do NOT change the proportions. It must still be obviously me.";

const PANNELLI: Record<string, { da: string; prompt: string }> = {
  frontale: {
    da: "io-felpa-mano-1.png",
    prompt: [
      VISO_INTATTO,
      "Change only these things:",
      "1. Remove my hand from my face and show my real mouth, chin and jaw, continuing the same face naturally, with the same short stubble as in the photo.",
      "2. Head straight, facing the camera, neutral relaxed expression, eyes looking into the lens.",
      "3. Plain light grey seamless studio background.",
      "4. Soft even studio light from the front, both cheeks equally lit, no harsh shadows.",
      "5. Plain black crew-neck t-shirt.",
      "6. Square framing: head and top of the shoulders, centered, the face filling about half the frame.",
      "Photographic, real skin pores, no smoothing, no painterly or CGI look.",
    ].join("\n"),
  },
};

function arg(nome: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

withProject(PROGETTO, () => {
  initSchema();
  const nome = arg("pannello", "frontale")!;
  const p = PANNELLI[nome];
  if (!p) throw new Error(`pannello sconosciuto: ${nome} (noti: ${Object.keys(PANNELLI).join(", ")})`);
  const giri = Number(arg("giri", "3"));

  const evidenziate = db().query<{ file: string }, []>("SELECT file FROM reference_pick").all().map((r) => r.file);
  if (!evidenziate.includes(p.da)) throw new Error(`${p.da} non e' fra le foto evidenziate: ${evidenziate.join(", ")}`);
  const input = join(dirsFor(PROGETTO).DATA_DIR, "refs", p.da);
  if (!existsSync(input)) throw new Error(`foto mancante: ${input}`);

  if (process.argv.includes("--stampa")) {
    console.log(`da: ${p.da}\n${p.prompt.length} car.\n${p.prompt}`);
    return;
  }

  const foto = `sheet-${nome}`;
  const now = Date.now();
  db().prepare(
    `INSERT OR IGNORE INTO photos (id, original_path, original_ext, kind, created_at, updated_at)
     VALUES (?, ?, '.png', 'generated', ?, ?)`,
  ).run(foto, input, now, now);

  for (let g = 1; g <= giri; g++) {
    const job = enqueueJob(
      foto, p.prompt, null, "chatgpt", null, "edit", input, null,
      JSON.stringify({ recipe: `sheet-${nome}`, sources: [p.da], giro: g, cambiato: `pannello ${nome}, giro ${g} di ${giri}` }),
      "openbrowser",
      // La foto vera e' l'immagine da modificare, non un riferimento allegato:
      // dichiararla come riferimento fa fermare il worker (non la trova fra gli allegati).
      null,
    );
    console.log(`[sheet-${nome}] job ${job.id}  giro ${g}/${giri}`);
  }
});
