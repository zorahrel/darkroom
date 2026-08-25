import { existsSync } from "node:fs";
import { join } from "node:path";
import { db as getDb } from "./db.ts";
import { videoRoot } from "./video.ts";

/**
 * Generazione video sulla 3090.
 *
 * Il grafo e' quello di `gen.py`, portato nodo per nodo: stessi id, stesso
 * negativo, stessi campionatori. Non e' pigrizia, e' la ragione per cui si puo'
 * confrontare una ripresa fatta da qui con le 272 fatte dalla riga di comando —
 * se il grafo divergesse, la differenza fra due riprese non direbbe piu' niente
 * sul prompt.
 *
 * Il Mac non tocca un fotogramma. ComfyUI scrive su `D:\video_out`, e
 * `raccogli.sh` — che gira sul PC — porta quei PNG dentro al progetto, li
 * interpola e ne fa la clip leggera. Di qui passa solo quella clip, che pesa
 * un megabyte. Prima si codificava a crf 10 sul PC, si scaricava, si
 * decodificava sul Mac e si reinterpolava sul Mac: un giro completo dei
 * fotogrammi per una perdita di qualita' pagata solo per attraversare il cavo.
 */

const HOST = "http://$COMFY_HOST:8188";
const PC = "<utente>@$COMFY_HOST";
const BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const USCITA = "D:\\video_out";

/** Il negativo di `gen.py`, parola per parola. Non vieta piu' il movimento di
 *  camera: vietarlo produceva cartoline. La firma dell'AI non e' la camera che
 *  si muove, e' la materia che morfa — quindi si vieta quella. */
const NEG =
  "colore, saturo, testo, scritte, watermark, logo, sottotitoli, " +
  "drone, ripresa aerea, zoom digitale, " +
  "liscio, lucido, plastica, cgi, render 3d, videogioco, illustrazione, cartone animato, " +
  "sovraesposto, hdr, nitidezza eccessiva, volti deformi, mani deformi, arti in piu', " +
  "immagine ferma, fotografia statica, nulla si muove";

/**
 * I default stanno DENTRO la memoria della scheda, e questo e' un numero
 * misurato, non una precauzione. A 704x1280 con 81 fotogrammi e nessuna
 * immagine di partenza la 3090 arriva a 23,9 GB su 24,5: un'ora al 100% di GPU
 * e zero PNG scritti. Gli stessi 640x1152 a 61 fotogrammi, 20 passi e decodifica
 * a tasselli da 256 escono in novanta secondi. La differenza non e' il metodo,
 * e' la memoria — per questo sono campi visibili e non costanti nascoste.
 */
export const PARAMETRI_DEFAULT = {
  width: 640,
  height: 1152,
  length: 61,
  steps: 20,
  cfg: 5.0,
  shift: 8.0,
  seed: 1,
  tiled: 256,
  overlap: 64,
  neg_extra: "",
} as const;

export type ParametriComfy = { -readonly [K in keyof typeof PARAMETRI_DEFAULT]: (typeof PARAMETRI_DEFAULT)[K] };

export function workflow(prefix: string, prompt: string, p: ParametriComfy, startImage?: string | null) {
  const neg = NEG + (p.neg_extra ? ", " + p.neg_extra : "");
  const wf: Record<string, any> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_ti2v_5B_fp16.safetensors", weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: "wan2.2_vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: prompt } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: neg } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["1", 0], shift: p.shift } },
    "7": { class_type: "Wan22ImageToVideoLatent", inputs: { vae: ["3", 0], width: p.width, height: p.height, length: p.length, batch_size: 1 } },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["6", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["7", 0],
        seed: p.seed, steps: p.steps, cfg: p.cfg, sampler_name: "uni_pc", scheduler: "simple", denoise: 1.0,
      },
    },
    "9": p.tiled
      ? { class_type: "VAEDecodeTiled", inputs: { samples: ["8", 0], vae: ["3", 0], tile_size: p.tiled, overlap: p.overlap, temporal_size: 12, temporal_overlap: 4 } }
      : { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: prefix } },
  };
  if (startImage) {
    wf["11"] = { class_type: "LoadImage", inputs: { image: startImage, upload: "image" } };
    wf["7"].inputs.start_image = ["11", 0];
  }
  return wf;
}

export type VideoJob = {
  id: number; piano: string; take: string; prompt: string; params: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  prompt_id: string | null; frames: number | null; log: string | null; error: string | null;
  created_at: number; started_at: number | null; finished_at: number | null;
};

export function accodaVideoJob(piano: string, prompt: string, take = "a", params: Partial<ParametriComfy> = {}): VideoJob {
  const p = { ...PARAMETRI_DEFAULT, ...params };
  const db = getDb();
  const r = db.query(
    `INSERT INTO video_jobs (piano, take, prompt, params, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?) RETURNING *`,
  ).get(piano, take, prompt, JSON.stringify(p), Date.now()) as VideoJob;
  avviaCoda();
  return r;
}

export function listaVideoJob(limit = 50): VideoJob[] {
  return getDb().query(`SELECT * FROM video_jobs ORDER BY id DESC LIMIT ?`).all(limit) as VideoJob[];
}

export function annullaVideoJob(id: number): boolean {
  const r = getDb().run(`UPDATE video_jobs SET status='cancelled', finished_at=? WHERE id=? AND status='pending'`, [Date.now(), id]);
  return r.changes > 0;
}

const scrivi = (id: number, campi: Record<string, unknown>) => {
  const k = Object.keys(campi);
  getDb().run(`UPDATE video_jobs SET ${k.map((x) => `${x}=?`).join(", ")} WHERE id=?`, [...k.map((x) => campi[x] as any), id]);
};

const appendi = (id: number, riga: string) => {
  const j = getDb().query(`SELECT log FROM video_jobs WHERE id=?`).get(id) as { log: string | null } | null;
  scrivi(id, { log: ((j?.log ?? "") + riga + "\n").slice(-20_000) });
};

let inCorso = false;

/** Una scheda, una generazione: la coda avanza da sola finche' c'e' lavoro. */
export function avviaCoda(): void {
  if (inCorso) return;
  const prossimo = getDb().query(`SELECT * FROM video_jobs WHERE status='pending' ORDER BY id LIMIT 1`).get() as VideoJob | null;
  if (!prossimo) return;
  inCorso = true;
  void esegui(prossimo)
    .catch((e) => scrivi(prossimo.id, { status: "failed", error: String(e), finished_at: Date.now() }))
    .finally(() => { inCorso = false; avviaCoda(); });
}

const ssh = async (comando: string) => {
  const proc = Bun.spawn(["ssh", "-o", "ConnectTimeout=30", PC, comando], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out, err };
};

async function esegui(job: VideoJob): Promise<void> {
  const p = JSON.parse(job.params) as ParametriComfy;
  const prefix = `${job.piano}_${job.take}_${job.id}`;
  scrivi(job.id, { status: "running", started_at: Date.now(), log: "" });
  appendi(job.id, `-> ${p.width}x${p.height}, ${p.length} fotogrammi, ${p.steps} passi, tasselli ${p.tiled}`);

  const r = await fetch(`${HOST}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow(prefix, job.prompt, p), client_id: crypto.randomUUID() }),
  });
  if (!r.ok) throw new Error(`ComfyUI ha rifiutato: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const promptId = ((await r.json()) as any).prompt_id as string;
  scrivi(job.id, { prompt_id: promptId });
  appendi(job.id, `in coda su ComfyUI: ${promptId}`);

  /**
   * L'attesa non finisce per tempo, finisce per fotogrammi. Il modo in cui
   * questa generazione fallisce non e' fermarsi: e' restare al 100% di GPU
   * senza scrivere niente, e un timeout a tempo fisso non distingue quel caso
   * da una generazione lenta ma viva. Si guarda quanti PNG sono comparsi.
   */
  const t0 = Date.now();
  const LIMITE_SENZA_FOTOGRAMMI = 15 * 60_000;
  let ultimoConteggio = 0, ultimoMovimento = t0;
  for (;;) {
    await Bun.sleep(5000);
    const h = await fetch(`${HOST}/history/${promptId}`).then((x) => x.json() as any).catch(() => ({}));
    if (h[promptId]) {
      const st = h[promptId].status ?? {};
      if (st.status_str === "error") throw new Error(`ComfyUI: ${JSON.stringify(st).slice(0, 600)}`);
      break;
    }
    const n = await contaFotogrammi(prefix);
    if (n > ultimoConteggio) { ultimoConteggio = n; ultimoMovimento = Date.now(); }
    const attesa = Math.round((Date.now() - t0) / 1000);
    appendi(job.id, `  ${attesa}s — ${n} fotogrammi`);
    if (Date.now() - ultimoMovimento > LIMITE_SENZA_FOTOGRAMMI) {
      throw new Error(
        `nessun fotogramma nuovo per 15 minuti (${attesa}s totali, ${n} fotogrammi). ` +
        `Parametri: ${p.width}x${p.height}/${p.length}/${p.steps}. A 704x1280 con 81 fotogrammi ` +
        `la scheda satura la memoria e non scrive nulla: prova piu' piccolo.`,
      );
    }
  }

  // I fotogrammi diventano una ripresa del progetto, sul PC.
  appendi(job.id, "-> raccolta sul PC");
  const rac = await ssh(`"${BASH}" -lc "/d/progetto/raccogli.sh ${prefix} ${job.piano} ${job.take}"`);
  appendi(job.id, (rac.out + rac.err).trim());
  if (rac.code !== 0) throw new Error(`raccogli.sh e' uscito ${rac.code}: ${(rac.err || rac.out).slice(0, 600)}`);

  // Di qui passa solo la clip leggera: e' l'unica cosa che il browser deve aprire.
  const nome = `${job.piano}__${job.take}`;
  for (const est of ["mp4", "jpg"]) {
    const scp = Bun.spawn(["scp", "-q", `${PC}:D:/progetto/prev/${nome}.${est}`, join(videoRoot(), "prev", `${nome}.${est}`)], { stdout: "pipe", stderr: "pipe" });
    if ((await scp.exited) !== 0) appendi(job.id, `!! anteprima ${est} non ritirata`);
  }
  const frames = Number(/src\/[^:]+: (\d+) fotogrammi/.exec(rac.out)?.[1] ?? 0);
  scrivi(job.id, { status: "done", frames, finished_at: Date.now() });
  appendi(job.id, `fatto: ${frames} fotogrammi, anteprima ${existsSync(join(videoRoot(), "prev", `${nome}.mp4`)) ? "pronta" : "MANCANTE"}`);
}

async function contaFotogrammi(prefix: string): Promise<number> {
  const r = await ssh(`dir /b "${USCITA}\\${prefix}_"*.png 2>nul | find /c /v ""`);
  return Number(r.out.trim().split(/\s+/).pop() ?? 0) || 0;
}
