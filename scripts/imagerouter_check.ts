/**
 * Verifies an ImageRouter key and measures what it really gives, instead of
 * trusting the catalogue: `gpt-image-2:free` is announced at price 0, but
 * "free" in aggregators' catalogues often only holds for the first few days.
 * Here it really generates and reads the real size of the file that comes back.
 *
 * The key is read from the Keychain, never from a plaintext file:
 *   security add-generic-password -s imagerouter -a darkroom -w "<key>" -U
 *
 * Usage: bun run scripts/imagerouter_check.ts [model]
 */
import { spawn } from "bun";

const MODEL = process.argv[2] ?? "openai/gpt-image-1.5:free";
const key = await (async () => {
  const p = spawn({ cmd: ["security", "find-generic-password", "-s", "imagerouter", "-a", "darkroom", "-w"], stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()).trim();
  return (await p.exited) === 0 && out ? out : null;
})();
if (!key) {
  console.error("nessuna chiave nel Keychain. Dopo averla creata su imagerouter.io/api-keys:\n" +
    '  security add-generic-password -s imagerouter -a darkroom -w "<chiave>" -U');
  process.exit(1);
}

const t0 = Date.now();
const res = await fetch("https://api.imagerouter.io/v1/openai/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: MODEL,
    prompt: "a vintage camera on a wooden desk, warm window light, fine detail",
    quality: "high",
    size: "1536x1024",
    response_format: "b64_json",
  }),
});
const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const j: any = await res.json();
const b64 = j?.data?.[0]?.b64_json;
const url = j?.data?.[0]?.url;
if (!b64 && !url) { console.error("risposta senza immagine:", JSON.stringify(j).slice(0, 300)); process.exit(1); }
const bytes = b64 ? Buffer.from(b64, "base64") : Buffer.from(await (await fetch(url)).arrayBuffer());
const out = `/tmp/ir_${MODEL.replace(/[^a-z0-9]/gi, "_")}.png`;
await Bun.write(out, bytes);
// The declared size is not enough: it is read from the file's bytes.
let dims = "?";
if (bytes[0] === 0x89) dims = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
console.log(`OK ${MODEL}: ${dims}px, ${Math.round(bytes.length / 1024)} KB, ${secs}s -> ${out}`);
console.log(`costo dichiarato: ${JSON.stringify(j?.cost ?? j?.usage ?? "non riportato")}`);
