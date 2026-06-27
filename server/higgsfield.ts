import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

const TOKEN_FILE = join(DATA_DIR, "higgsfield.json");
const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const TOKEN_URL = "https://mcp.higgsfield.ai/oauth2/token";
const RESOURCE = "https://mcp.higgsfield.ai/";
// Cloudflare blocks non-browser UAs on the higgsfield endpoints.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

type TokenStore = {
  access_token: string;
  refresh_token?: string;
  client_id: string;
  expires_in?: number;
  obtained_at?: number;
  scope?: string;
};

export function higgsfieldConfigured(): boolean {
  return existsSync(TOKEN_FILE);
}

function loadTokens(): TokenStore {
  if (!existsSync(TOKEN_FILE)) {
    throw new Error(
      "Higgsfield non collegato: manca data/higgsfield.json (rifai il flusso OAuth).",
    );
  }
  return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as TokenStore;
}

function saveTokens(t: TokenStore): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

function isExpired(t: TokenStore): boolean {
  if (!t.obtained_at || !t.expires_in) return false;
  // refresh 2 min before actual expiry
  return Date.now() > (t.obtained_at + t.expires_in - 120) * 1000;
}

async function refreshTokens(t: TokenStore): Promise<TokenStore> {
  if (!t.refresh_token) throw new Error("Nessun refresh_token disponibile.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: t.client_id,
    resource: RESOURCE,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`refresh fallito: ${res.status} ${await res.text()}`);
  }
  const fresh = (await res.json()) as TokenStore;
  const next: TokenStore = {
    ...t,
    ...fresh,
    refresh_token: fresh.refresh_token ?? t.refresh_token,
    client_id: t.client_id,
    obtained_at: Math.floor(Date.now() / 1000),
  };
  saveTokens(next);
  return next;
}

async function accessToken(): Promise<string> {
  let t = loadTokens();
  if (isExpired(t)) t = await refreshTokens(t);
  return t.access_token;
}

function parseRpc(raw: string): any {
  // streamable HTTP returns either plain JSON or SSE framing (data: {...})
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim());
  }
  throw new Error(`risposta MCP non parsabile: ${raw.slice(0, 200)}`);
}

let rpcId = 100;

/** Stateless JSON-RPC tools/call against the Higgsfield MCP. Auto-refreshes on 401. */
async function mcpCall<T = any>(
  name: string,
  args: Record<string, unknown>,
  retry = true,
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "user-agent": UA,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  if (res.status === 401 && retry) {
    await refreshTokens(loadTokens());
    return mcpCall<T>(name, args, false);
  }
  const raw = await res.text();
  if (!res.ok) throw new Error(`MCP ${name} ${res.status}: ${raw.slice(0, 300)}`);

  const rpc = parseRpc(raw);
  if (rpc.error) {
    throw new Error(`MCP ${name}: ${JSON.stringify(rpc.error).slice(0, 300)}`);
  }
  const result = rpc.result ?? {};
  return (result.structuredContent ?? result) as T;
}

// ---- High-level helpers ----------------------------------------------------

export type HiggsfieldModel = {
  id: string;
  name: string;
  provider_name: string;
  description: string;
  parameters: { name: string; options?: string[]; default?: string }[];
  aspect_ratios: string[];
  tags: string[];
};

let modelCache: { at: number; models: HiggsfieldModel[] } | null = null;

export async function balance(): Promise<{
  credits: number;
  subscription_plan_type: string;
}> {
  return mcpCall("balance", {});
}

export async function listImageModels(): Promise<HiggsfieldModel[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60 * 1000) {
    return modelCache.models;
  }
  const out = await mcpCall<{ items: HiggsfieldModel[] }>("models_explore", {
    action: "list",
    type: "image",
    input: "image",
    limit: 40,
  });
  const models = (out.items ?? []).filter((m) => m.id !== "ms_image"); // skip brand-kit-required
  modelCache = { at: Date.now(), models };
  return models;
}

export async function getCost(
  model: string,
  prompt: string,
  params: Record<string, unknown>,
): Promise<{ credits: number; credits_exact: number } | null> {
  try {
    const out = await mcpCall<{ cost?: { credits: number; credits_exact: number } }>(
      "generate_image",
      { params: { model, prompt, get_cost: true, ...params } },
    );
    return out.cost ?? null;
  } catch {
    // some models (marketing studio) don't support get_cost
    return null;
  }
}

type UploadResult = {
  uploads: { upload_url: string; media_id: string; url: string }[];
};

/** Bake EXIF orientation into pixels (Higgsfield reads raw pixels, ignoring the
 *  EXIF flag, so a phone photo with orientation 6/8 would come out rotated).
 *  Returns a temp JPEG path, or the original path if normalization fails. */
async function normalizeOrientation(srcPath: string): Promise<{
  path: string;
  cleanup: boolean;
}> {
  const out = join(DATA_DIR, "uploads", `hf_oriented_${Date.now()}.jpg`);
  mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
  const py =
    "from PIL import Image, ImageOps; import sys; " +
    "im = ImageOps.exif_transpose(Image.open(sys.argv[1])); " +
    "im.convert('RGB').save(sys.argv[2], 'JPEG', quality=95)";
  try {
    const proc = Bun.spawn({
      cmd: ["python3", "-c", py, srcPath, out],
      stdout: "ignore",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code === 0 && existsSync(out)) return { path: out, cleanup: true };
  } catch {
    // fall through to original
  }
  return { path: srcPath, cleanup: false };
}

async function uploadImage(localPath: string): Promise<string> {
  const oriented = await normalizeOrientation(localPath);
  try {
    const filename = (oriented.path.split("/").pop() ?? "image.jpg").replace(
      /\.[^.]+$/,
      ".jpg",
    );
    const contentType = "image/jpeg";

    const up = await mcpCall<UploadResult>("media_upload", {
      filename,
      content_type: contentType,
    });
    const slot = up.uploads?.[0];
    if (!slot?.upload_url || !slot?.media_id) {
      throw new Error("media_upload: nessuna upload_url restituita");
    }
    const bytes = readFileSync(oriented.path);
    const put = await fetch(slot.upload_url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: bytes,
    });
    if (!put.ok) throw new Error(`upload PUT fallito: ${put.status}`);

    await mcpCall("media_confirm", { media_id: slot.media_id, type: "image" });
    return slot.media_id;
  } finally {
    if (oriented.cleanup) {
      try {
        unlinkSync(oriented.path);
      } catch {}
    }
  }
}

/** Full edit pipeline: upload reference → generate → poll → download to outputPath. */
export async function generateEdit(opts: {
  imagePath: string;
  prompt: string;
  model: string;
  params?: Record<string, unknown>;
  outputPath: string;
  onLog?: (msg: string) => void;
}): Promise<{ credits: number | null }> {
  const { imagePath, prompt, model, params = {}, outputPath, onLog } = opts;
  const log = onLog ?? (() => {});

  log(`upload ${imagePath.split("/").pop()}`);
  const mediaId = await uploadImage(imagePath);

  // Preflight cost — the generation payload doesn't reliably expose credits,
  // but get_cost.credits_exact matches the actual balance delta.
  let preflightCost: number | null = null;
  try {
    const c = await getCost(model, prompt, params);
    preflightCost = c?.credits_exact ?? null;
  } catch {
    preflightCost = null;
  }

  log(`generate model=${model}`);
  const gen = await mcpCall<{ results?: { id: string }[] }>("generate_image", {
    params: {
      model,
      prompt,
      medias: [{ role: "image", value: mediaId }],
      ...params,
    },
  });
  const jobId = gen.results?.[0]?.id;
  if (!jobId) throw new Error(`generate_image: nessun job id (${JSON.stringify(gen).slice(0, 200)})`);

  log(`poll job ${jobId}`);
  const deadline = Date.now() + 5 * 60 * 1000;
  let creditsSpent: number | null = null;
  while (Date.now() < deadline) {
    const st = await mcpCall<{
      generation?: {
        status: string;
        results?: { rawUrl?: string; raw_url?: string; url?: string };
        credits?: number;
      };
    }>("job_status", { jobId, sync: true });
    const g = st.generation;
    const status = g?.status;
    if (status === "completed") {
      const url = g?.results?.rawUrl ?? g?.results?.raw_url ?? g?.results?.url;
      if (!url) throw new Error("job completed ma nessun rawUrl");
      creditsSpent = g?.credits ?? preflightCost;
      log(`download ${url.slice(0, 60)}`);
      const img = await fetch(url, { headers: { "user-agent": UA } });
      if (!img.ok) throw new Error(`download risultato fallito: ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      writeFileSync(outputPath, buf);
      return { credits: creditsSpent };
    }
    if (status === "failed" || status === "nsfw") {
      throw new Error(`generazione ${status}`);
    }
    if (status === "ip_detected") {
      throw new Error("generazione bloccata (ip_detected): contenuto coperto da copyright");
    }
    await sleep(4000);
  }
  throw new Error("timeout: generazione Higgsfield non completata in 5 min");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
