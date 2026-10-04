/**
 * Collega Darkroom a Higgsfield: OAuth authorization-code + PKCE contro il loro MCP.
 * Scrive data/higgsfield.json nel formato che server/higgsfield.ts si aspetta
 * (access_token, refresh_token, client_id, expires_in, obtained_at in secondi).
 *
 * Uso: bun run scripts/higgsfield_oauth.ts
 * Stampa l'URL di login, resta in ascolto sul ritorno locale e poi scrive il token.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { DATA_DIR } from "../server/config.ts";

const BASE = "https://mcp.higgsfield.ai";
const RESOURCE = "https://mcp.higgsfield.ai/";
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = "openid email offline_access";
// Cloudflare blocca gli user agent che non sono browser.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const b64url = (b: Buffer) => b.toString("base64url");

const reg = await fetch(`${BASE}/oauth2/register`, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({
    client_name: "Darkroom",
    redirect_uris: [REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
  }),
});
if (!reg.ok) throw new Error(`registrazione client fallita: ${reg.status} ${await reg.text()}`);
const { client_id } = (await reg.json()) as { client_id: string };

const verifier = b64url(randomBytes(48));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const state = b64url(randomBytes(16));

const authUrl = new URL(`${BASE}/oauth2/authorize`);
authUrl.search = new URLSearchParams({
  response_type: "code",
  client_id,
  redirect_uri: REDIRECT,
  scope: SCOPE,
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: RESOURCE,
}).toString();

console.log(`LOGIN_URL ${authUrl.toString()}`);

const code = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("nessun login entro 10 minuti")), 10 * 60_000);
  const srv = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== "/callback") return new Response("not found", { status: 404 });
      const err = u.searchParams.get("error");
      if (err || u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
        clearTimeout(timer);
        setTimeout(() => srv.stop(), 200);
        reject(new Error(`ritorno OAuth non valido: ${err ?? "state/code mancanti"}`));
        return new Response("Errore: puoi chiudere questa scheda.", { status: 400 });
      }
      clearTimeout(timer);
      setTimeout(() => srv.stop(), 200);
      resolve(u.searchParams.get("code")!);
      return new Response("Higgsfield collegato a Darkroom. Puoi chiudere questa scheda.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    },
  });
});

const tok = await fetch(`${BASE}/oauth2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "application/json" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id,
    code_verifier: verifier,
    resource: RESOURCE,
  }),
});
if (!tok.ok) throw new Error(`scambio del codice fallito: ${tok.status} ${await tok.text()}`);
const t = (await tok.json()) as Record<string, unknown>;

mkdirSync(DATA_DIR, { recursive: true });
const file = join(DATA_DIR, "higgsfield.json");
writeFileSync(
  file,
  JSON.stringify({ ...t, client_id, obtained_at: Math.floor(Date.now() / 1000) }, null, 2),
  { mode: 0o600 },
);
console.log(`OK token salvato in ${file} (refresh_token: ${t.refresh_token ? "sì" : "NO"}, scade tra ${t.expires_in ?? "?"} s)`);
