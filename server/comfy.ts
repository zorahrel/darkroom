import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db as getDb } from "./db.ts";
import { videoRoot } from "./video.ts";
import { listProjects, withProject } from "./project.ts";
import { COMFY_HOST, RENDER_BASH, RENDER_DIR, RENDER_OUT_DIR, RENDER_SSH } from "./config.ts";

/**
 * Video generation on the 3090.
 *
 * The graph is `gen.py`'s, ported node by node: same ids, same negative, same
 * samplers. It is not laziness, it is the reason a shot made from here can be
 * compared with the 272 made from the command line — if the graph diverged, the
 * difference between two shots would no longer say anything about the prompt.
 *
 * The Mac does not touch a single frame. ComfyUI writes into `RENDER_OUT_DIR`,
 * and `raccogli.sh` — which runs on the PC — brings those PNGs into the
 * project, interpolates them and makes the light clip. Only that clip comes
 * across, and it weighs a megabyte. Before, it was encoded at crf 10 on the PC,
 * downloaded, decoded on the Mac and re-interpolated on the Mac: a full round
 * trip through the frames for a loss of quality paid purely to cross the cable.
 */

const HOST = COMFY_HOST;
const PC = RENDER_SSH;
const BASH = RENDER_BASH;
const OUTPUT = RENDER_OUT_DIR;

/**
 * The same remote directory, in the two spellings that machine needs.
 *
 * `RENDER_DIR` is a Windows path because that is what the box runs, but the
 * collect step goes through Git-bash (which wants `/d/foo`) and the preview
 * comes back over scp (which wants `D:/foo`). These used to be one hardcoded
 * path each, pointing at a folder only the author had.
 */
const remoteBash = (): string =>
  RENDER_DIR.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
const remoteScp = (): string => RENDER_DIR.replace(/\\/g, "/");

/** `gen.py`'s negative, word for word. It no longer forbids camera movement:
 *  forbidding it produced postcards. The AI's signature is not the camera
 *  moving, it is matter that morphs — so that is what gets forbidden. */
const NEG =
  "colore, saturo, testo, scritte, watermark, logo, sottotitoli, " +
  "drone, ripresa aerea, zoom digitale, " +
  "liscio, lucido, plastica, cgi, render 3d, videogioco, illustrazione, cartone animato, " +
  "sovraesposto, hdr, nitidezza eccessiva, volti deformi, mani deformi, arti in piu', " +
  "immagine ferma, fotografia statica, nulla si muove";

/**
 * The defaults sit INSIDE the card's memory, and this is a measured number, not
 * a precaution. At 704x1280 with 81 frames and no starting image the 3090
 * reaches 23.9 GB out of 24.5: an hour at 100% GPU and zero PNGs written. The
 * same thing at 640x1152, 61 frames, 20 steps and tiled decoding at 256 comes
 * out in ninety seconds. The difference is not the method, it is the memory —
 * which is why these are visible fields and not hidden constants.
 */
export const DEFAULT_PARAMS = {
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

export type ComfyParams = { -readonly [K in keyof typeof DEFAULT_PARAMS]: (typeof DEFAULT_PARAMS)[K] };

export function workflow(prefix: string, prompt: string, p: ComfyParams, startImage?: string | null) {
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
  id: number; shot: string; take: string; prompt: string; params: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  prompt_id: string | null; frames: number | null; log: string | null; error: string | null;
  created_at: number; started_at: number | null; finished_at: number | null;
};

export function enqueueVideoJob(shot: string, prompt: string, take = "a", params: Partial<ComfyParams> = {}): VideoJob {
  const p = { ...DEFAULT_PARAMS, ...params };
  const db = getDb();
  const r = db.query(
    `INSERT INTO video_jobs (shot, take, prompt, params, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?) RETURNING *`,
  ).get(shot, take, prompt, JSON.stringify(p), Date.now()) as VideoJob;
  startQueue();
  return r;
}

/** The job listing.
 *  It was cut at 50 and with a long queue the oldest generations still waiting
 *  dropped out of sight: ten "vanished" jobs that had in fact finished long
 *  before, and no way to notice it from the interface. */
export function listVideoJobs(limit = 300): VideoJob[] {
  return getDb().query(`SELECT * FROM video_jobs ORDER BY id DESC LIMIT ?`).all(limit) as VideoJob[];
}

/**
 * Stopping a generation.
 *
 * A queued one is simply removed. A **running** one, on the other hand, could
 * not be stopped at all: it sat there until it finished or until the fifteen
 * minutes without new frames ran out, and meanwhile it held up the whole queue
 * behind it. It happens: you launch a series, look at the first one and realise
 * the prompt is wrong — and the other nine are stuck behind one nobody wants
 * any more.
 *
 * Stopping it means two things: telling ComfyUI to interrupt (`/interrupt`
 * stops the running one, `/queue delete` removes the waiting ones) and marking
 * the row, so the waiting loop exits and the queue moves on.
 */
export function cancelVideoJob(id: number): boolean {
  const db = getDb();
  const j = db.query(`SELECT * FROM video_jobs WHERE id=?`).get(id) as VideoJob | null;
  if (!j || j.status === "done" || j.status === "cancelled") return false;

  if (j.status === "running") {
    fermatiSuComfy(j.prompt_id).catch(() => { /* la riga si segna comunque */ });
  }
  const r = db.run(`UPDATE video_jobs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('pending','running')`, [Date.now(), id]);
  return r.changes > 0;
}

async function fermatiSuComfy(promptId: string | null): Promise<void> {
  if (promptId) {
    await fetch(`${HOST}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    }).catch(() => {});
  }
  // `/interrupt` stops whatever is running RIGHT NOW, whatever it is: it is
  // sent after the delete, so if the prompt was still waiting we do not
  // interrupt somebody else's by mistake.
  await fetch(`${HOST}/interrupt`, { method: "POST" }).catch(() => {});
}

const write = (id: number, fields: Record<string, unknown>) => {
  const k = Object.keys(fields);
  getDb().run(`UPDATE video_jobs SET ${k.map((x) => `${x}=?`).join(", ")} WHERE id=?`, [...k.map((x) => fields[x] as any), id]);
};

const append = (id: number, row: string) => {
  const j = getDb().query(`SELECT log FROM video_jobs WHERE id=?`).get(id) as { log: string | null } | null;
  write(id, { log: ((j?.log ?? "") + row + "\n").slice(-20_000) });
};

let inCorso = false;

/**
 * The jobs a restart left half-done.
 *
 * The queue lives in the database but whoever turns it lives in the process: a
 * server restart leaves a `running` row with nobody following it, and the job
 * stays there forever even when the GPU finished long ago. It really happened —
 * 61 PNGs written, ComfyUI's queue empty, and the log stuck at "401s — 0
 * frames".
 *
 * The `prompt_id` is on disk though, so the generation can be re-attached: we
 * go back to waiting on that prompt and collect it as if nothing had happened.
 * Anything without a `prompt_id` had not started yet and goes back to the queue.
 */
export function riprendiInterrotti(): void {
  // At boot there is no "current" project: the context is per request, and
  // outside a request `getDb()` falls back to the first registered project —
  // which is a photo project and has no video jobs. So we step into each one.
  for (const p of listProjects().filter((x) => x.views.includes("video"))) {
    withProject(p.id, () => riprendiIn(p.id));
  }
}

function riprendiIn(_pid: string): void {
  const db = getDb();
  const persi = db.query(`SELECT * FROM video_jobs WHERE status='running'`).all() as VideoJob[];
  for (const j of persi) {
    append(j.id, j.prompt_id
      ? "-- il server e' ripartito: mi riaggancio alla generazione --"
      : "-- il server e' ripartito prima che partisse: torna in coda --");
    write(j.id, { status: "pending" });
  }
  if (persi.length) startQueue();
}

/** One card, one generation: the queue advances by itself while there is work. */
export function startQueue(): void {
  if (inCorso) return;
  const next = getDb().query(`SELECT * FROM video_jobs WHERE status='pending' ORDER BY id LIMIT 1`).get() as VideoJob | null;
  if (!next) return;
  inCorso = true;
  void run(next)
    .catch((e) => {
      const ora = getDb().query(`SELECT status FROM video_jobs WHERE id=?`).get(next.id) as { status: string } | null;
      if (ora?.status === "cancelled") return;   // stopped on purpose, not a fault
      write(next.id, { status: "failed", error: String(e), finished_at: Date.now() });
    })
    .finally(() => { inCorso = false; startQueue(); });
}

const ssh = async (command: string) => {
  const proc = Bun.spawn(["ssh", "-o", "ConnectTimeout=30", PC, command], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out, err };
};

async function run(job: VideoJob): Promise<void> {
  const p = JSON.parse(job.params) as ComfyParams;
  const prefix = `${job.shot}_${job.take}_${job.id}`;
  write(job.id, { status: "running", started_at: Date.now(), log: "" });
  append(job.id, `-> ${p.width}x${p.height}, ${p.length} fotogrammi, ${p.steps} passi, tasselli ${p.tiled}`);

  /**
   * First, empty the card.
   *
   * The defaults fit inside the 24 GB *if the card is free*. ComfyUI, however,
   * keeps the last generation's models in memory, and the next request starts
   * from what is left: measured on this very job — 640x1152, 61 frames, that is
   * the ninety-second parameters — the 3090 sat at 24,036 MiB out of 24,576 and
   * after five minutes had not written a single PNG. It is not a parameter
   * problem, it is that the budget depended on what had run before.
   */
  await fetch(`${HOST}/free`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => { /* se non risponde lo dira' la generazione */ });

  /**
   * Re-attaching, properly.
   *
   * A prompt already sent can be in three places: finished (in the history),
   * still alive (in ComfyUI's queue), or nowhere. Only the third case should be
   * sent again.
   *
   * The "still alive" branch was missing, and the consequence showed: every
   * server restart during a generation published a fresh copy of it on the
   * card. Three restarts in one session, three identical copies of the same
   * shot queued on the 3090 — four and a half minutes of GPU for frames that
   * were already on their way.
   */
  if (job.prompt_id) {
    const h = await fetch(`${HOST}/history/${job.prompt_id}`).then((x) => x.json() as any).catch(() => ({}));
    if (h[job.prompt_id]) {
      append(job.id, `ripreso: ${job.prompt_id} era gia' finito`);
      return await collect(job, prefix);
    }
    if (await queuedOnComfy(job.prompt_id)) {
      append(job.id, `ripreso: ${job.prompt_id} sta ancora girando, torno ad aspettarlo`);
      await waitFor(job, job.prompt_id, prefix, p);
      return await collect(job, prefix);
    }
    append(job.id, `${job.prompt_id} non e' ne' finito ne' in coda: lo rimando`);
  }

  const r = await fetch(`${HOST}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow(prefix, job.prompt, p), client_id: crypto.randomUUID() }),
  });
  if (!r.ok) throw new Error(`ComfyUI ha rifiutato: ${r.status} ${(await r.text()).slice(0, 400)}`);
  const promptId = ((await r.json()) as any).prompt_id as string;
  write(job.id, { prompt_id: promptId });
  append(job.id, `in coda su ComfyUI: ${promptId}`);

  await waitFor(job, promptId, prefix, p);
  return await collect(job, prefix);
}

/** Is that prompt still in ComfyUI's queue (running or waiting)? */
async function queuedOnComfy(promptId: string): Promise<boolean> {
  const q = await fetch(`${HOST}/queue`).then((x) => x.json() as any).catch(() => null);
  if (!q) return false;
  const inside = (v: unknown[]) => v.some((x) => Array.isArray(x) && x[1] === promptId);
  return inside(q.queue_running ?? []) || inside(q.queue_pending ?? []);
}

/**
 * The wait does not end on time, it ends on frames. The way this generation
 * fails is not by stopping: it is by staying at 100% GPU without writing
 * anything, and a fixed-time timeout cannot tell that case from a generation
 * that is slow but alive. What gets watched is how many PNGs have appeared.
 */
async function waitFor(job: VideoJob, promptId: string, prefix: string, p: ComfyParams): Promise<void> {
  const t0 = Date.now();
  const LIMIT_WITHOUT_FRAMES = 15 * 60_000;
  let lastCount = 0, lastMove = t0;
  for (;;) {
    await Bun.sleep(5000);
    // Cancelled while waiting: we leave here, nothing gets collected.
    const ora = getDb().query(`SELECT status FROM video_jobs WHERE id=?`).get(job.id) as { status: string } | null;
    if (ora?.status === "cancelled") throw new Error("annullata");
    const h = await fetch(`${HOST}/history/${promptId}`).then((x) => x.json() as any).catch(() => ({}));
    if (h[promptId]) {
      const st = h[promptId].status ?? {};
      if (st.status_str === "error") throw new Error(`ComfyUI: ${JSON.stringify(st).slice(0, 600)}`);
      return;
    }
    const n = await countFrames(prefix);
    if (n > lastCount) { lastCount = n; lastMove = Date.now(); }
    const attesa = Math.round((Date.now() - t0) / 1000);
    append(job.id, `  ${attesa}s — ${n} fotogrammi`);
    if (Date.now() - lastMove > LIMIT_WITHOUT_FRAMES) {
      throw new Error(
        `nessun fotogramma nuovo per 15 minuti (${attesa}s totali, ${n} fotogrammi). ` +
        `Parametri: ${p.width}x${p.height}/${p.length}/${p.steps}. A 704x1280 con 81 fotogrammi ` +
        `la scheda satura la memoria e non scrive nulla: prova piu' piccolo.`,
      );
    }
  }
}

/** From PNGs to a shot: it happens on the PC, and only the preview comes across. */
async function collect(job: VideoJob, prefix: string): Promise<void> {
  append(job.id, "-> raccolta sul PC");
  const rac = await ssh(`"${BASH}" -lc "${remoteBash()}/raccogli.sh ${prefix} ${job.shot} ${job.take}"`);
  append(job.id, (rac.out + rac.err).trim());
  if (rac.code !== 0) throw new Error(`raccogli.sh e' uscito ${rac.code}: ${(rac.err || rac.out).slice(0, 600)}`);

  // Only the light clip comes across: it is the only thing the browser has to open.
  const name = `${job.shot}__${job.take}`;
  for (const est of ["mp4", "jpg"]) {
    const scp = Bun.spawn(["scp", "-q", `${PC}:${remoteScp()}/prev/${name}.${est}`, join(videoRoot(), "prev", `${name}.${est}`)], { stdout: "pipe", stderr: "pipe" });
    if ((await scp.exited) !== 0) append(job.id, `!! anteprima ${est} non ritirata`);
  }
  const frames = Number(/src\/[^:]+: (\d+) fotogrammi/.exec(rac.out)?.[1] ?? 0);

  /**
   * The frames stay on the PC, and that is fine — but `shots()` builds the list
   * of shots by reading `src/` **here**, so a shot born over there would not
   * appear anywhere despite having its preview on the Mac. The count is noted
   * beside the preview: it is the only thing about those frames we need to know
   * without crossing the network.
   */
  const reg = join(videoRoot(), "raccolte.json");
  const prec = existsSync(reg) ? JSON.parse(readFileSync(reg, "utf8")) as Record<string, any> : {};
  prec[`${job.shot}__${job.take}`] = { frames, when: Date.now(), prompt: job.prompt, remota: true };
  writeFileSync(reg, JSON.stringify(prec, null, 1));

  write(job.id, { status: "done", frames, finished_at: Date.now() });
  append(job.id, `fatto: ${frames} fotogrammi, anteprima ${existsSync(join(videoRoot(), "prev", `${name}.mp4`)) ? "pronta" : "MANCANTE"}`);
}

async function countFrames(prefix: string): Promise<number> {
  const r = await ssh(`dir /b "${OUTPUT}\\${prefix}_"*.png 2>nul | find /c /v ""`);
  return Number(r.out.trim().split(/\s+/).pop() ?? 0) || 0;
}
