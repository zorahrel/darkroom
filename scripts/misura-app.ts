/**
 * Peso del pacchetto e memoria a riposo dell'applicazione desktop.
 *
 * Sono due numeri sorvegliati, non curiosità. L'alternativa Electron è stata scartata
 * su 220 MB di pacchetto contro 4,9 e 250 MB di memoria contro 85: un numero che ha
 * deciso un'architettura merita di essere guardato mentre cambia, altrimenti
 * l'architettura resta e la ragione se ne va.
 */

import { spawn } from "bun";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const RADICE = new URL("..", import.meta.url).pathname;
const APP = join(RADICE, "app/target/release/bundle/macos/Darkroom.app");
const DMG_DIR = join(RADICE, "app/target/release/bundle/dmg");

/**
 * I limiti oltre i quali il numero smette di essere una nota e diventa un problema.
 * Si abbassano dall'ambiente per verificare che il cancello sappia diventare rosso:
 * un controllo che non si e' mai visto fallire non e' un controllo.
 */
const TETTO_PACCHETTO_MB = Number(process.env.TETTO_PACCHETTO_MB) || 60;
const TETTO_MEMORIA_MB = Number(process.env.TETTO_MEMORIA_MB) || 200;

async function guscio(cmd: string[]): Promise<string> {
  const p = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
  await p.exited;
  return await new Response(p.stdout).text();
}

function mb(byte: number): number {
  return Math.round((byte / 1024 / 1024) * 10) / 10;
}

async function pesoCartella(p: string): Promise<number> {
  const out = await guscio(["du", "-sk", p]);
  return Number(out.split("\t")[0] ?? 0) * 1024;
}

const righe: string[] = [];
let problemi = 0;

if (!existsSync(APP)) {
  console.error(`Il pacchetto non c'è: ${APP}\nCostruiscilo con:  bun run app:build`);
  process.exit(2);
}

const pacchetto = mb(await pesoCartella(APP));
righe.push(`pacchetto        ${pacchetto} MB   (tetto ${TETTO_PACCHETTO_MB})`);
if (pacchetto > TETTO_PACCHETTO_MB) problemi++;

const dmg = existsSync(DMG_DIR)
  ? (await guscio(["ls", DMG_DIR])).split("\n").find((n) => n.endsWith(".dmg"))
  : undefined;
if (dmg) righe.push(`immagine disco   ${mb(statSync(join(DMG_DIR, dmg)).size)} MB`);

// La memoria si legge solo se l'applicazione è viva: un numero inventato sarebbe
// peggio di un numero mancante.
const pid = (await guscio(["pgrep", "-f", "Darkroom.app/Contents/MacOS"])).trim().split("\n")[0];
if (pid) {
  const rss = await guscio(["ps", "-o", "rss=", "-p", pid]);
  righe.push(`memoria a riposo ${mb(Number(rss.trim()) * 1024)} MB   (tetto ${TETTO_MEMORIA_MB})`);
  if (mb(Number(rss.trim()) * 1024) > TETTO_MEMORIA_MB) problemi++;
} else {
  righe.push("memoria a riposo —   (l'applicazione non è in esecuzione)");
}

console.log(righe.join("\n"));
if (problemi) {
  console.error(`\n${problemi} misura oltre il tetto.`);
  process.exit(1);
}
