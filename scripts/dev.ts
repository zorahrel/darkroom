#!/usr/bin/env bun
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

async function findFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 100; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  throw new Error(`No free port in [${start}, ${start + 100})`);
}

const requestedBackend = Number(process.env.PORT ?? 3535);
const requestedClient = Number(process.env.CLIENT_PORT ?? 5173);
const backendPort = await findFreePort(requestedBackend);
const frontendPort = await findFreePort(requestedClient === backendPort ? requestedClient + 1 : requestedClient);

const env = {
  ...process.env,
  PORT: String(backendPort),
  BACKEND_PORT: String(backendPort),
  CLIENT_PORT: String(frontendPort),
  FORCE_COLOR: "1",
};

console.log(`[dev] backend  → http://localhost:${backendPort}`);
console.log(`[dev] frontend → http://localhost:${frontendPort}`);

const viteBin = resolve(ROOT, "node_modules", ".bin", "vite");
if (!existsSync(viteBin)) {
  console.error(`[dev] vite binary not found at ${viteBin} — run "bun install"`);
  process.exit(1);
}

const server = spawn("bun", ["run", "server/index.ts"], { env, stdio: ["ignore", "inherit", "inherit"], cwd: ROOT });
const client = spawn(viteBin, ["--config", "client/vite.config.ts", "--port", String(frontendPort), "--strictPort"], { env, stdio: ["ignore", "inherit", "inherit"], cwd: ROOT });

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals = "SIGTERM") => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill(signal);
  client.kill(signal);
  setTimeout(() => process.exit(0), 500).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (err) => { console.error("[dev] server spawn error:", err); shutdown(); });
client.on("error", (err) => { console.error("[dev] client spawn error:", err); shutdown(); });
server.on("exit", (code, sig) => { console.log(`[dev] server exited (code=${code} sig=${sig})`); shutdown(); });
client.on("exit", (code, sig) => { console.log(`[dev] client exited (code=${code} sig=${sig})`); shutdown(); });
