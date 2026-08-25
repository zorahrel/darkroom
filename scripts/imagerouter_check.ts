/**
 * Verifica una chiave ImageRouter e misura cosa dà davvero, invece di fidarsi
 * del catalogo: `gpt-image-2:free` è annunciato a prezzo 0, ma "gratis" nei
 * cataloghi degli aggregatori regge spesso solo i primi giorni. Qui si genera
 * per davvero e si legge la dimensione reale del file che torna.
 *
 * La chiave si legge dal Keychain, mai da un file in chiaro:
 *   security add-generic-password -s imagerouter -a darkroom -w "<chiave>" -U
 *
 * Uso: bun run scripts/imagerouter_check.ts [modello]
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
// La dimensione dichiarata non basta: si legge dai byte del file.
let dims = "?";
if (bytes[0] === 0x89) dims = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
console.log(`OK ${MODEL}: ${dims}px, ${Math.round(bytes.length / 1024)} KB, ${secs}s -> ${out}`);
console.log(`costo dichiarato: ${JSON.stringify(j?.cost ?? j?.usage ?? "non riportato")}`);
