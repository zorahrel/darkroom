import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// 127.0.0.1, non "localhost": su macOS localhost risolve prima a ::1, e il
// server (Bun, in ascolto solo su IPv4) rifiuta la connessione. Il risultato è
// un proxy che restituisce ECONNREFUSED su ogni chiamata mentre il backend,
// interrogato direttamente, risponde in 35 ms — una griglia che resta a
// "caricamento" per sempre senza un errore che spieghi perché.
const backendHost = process.env.BACKEND_HOST ?? "127.0.0.1";
const backend = `http://${backendHost}:${process.env.BACKEND_PORT ?? process.env.PORT ?? "3535"}`;

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/raw": backend,
      "/gen": backend,
      "/orphan": backend,
      "/thumb": backend,
      "/graded": backend,
      "/orig": backend,
      "/previews": backend,
    },
  },
  build: {
    outDir: resolve(here, "..", "dist"),
    emptyOutDir: true,
  },
});
